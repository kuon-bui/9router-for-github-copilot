import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { buildSettingsSnapshot, getExtensionConfiguration } from '../config/settings';
import { logDebugEvent } from '../debug/output-channel';
import { NineRouterError } from '../router/errors';
import { adaptToolOptionsForRouter } from './tool-adapter';
import { adaptMessagesToRouterRequest } from './request-adapter';
import { isLanguageModelThinkingPartAvailable } from './reasoning-part-compat';
import { createRouterEventEmitter } from './stream-adapter';
import { createAbortSignalFromToken } from './cancellation';
import { resolveEffectiveThinkingMode } from './thinking-effort';
import { VisionProxyService } from './vision-proxy';
import type { RouterClient } from '../router/client';
import type { SettingsSnapshot } from '../config/settings';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';
import type { ModelConfigurationResponseOptions } from '../types/vscode-chat-compat';
import type { HostToolDefinition } from './tool-adapter';
import type { HostChatRequestMessage } from './vision-proxy';
import type { RouterEventEmitter } from './stream-adapter';

type ReasoningStreamOutcome = 'completed' | 'cancelled' | 'failed';

function getRequestTools(options: unknown): readonly HostToolDefinition[] | undefined {
  if (typeof options !== 'object' || options === null || !('tools' in options)) {
    return undefined;
  }

  const tools = options.tools;
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.filter((tool): tool is HostToolDefinition => {
    return (
      typeof tool === 'object' &&
      tool !== null &&
      'name' in tool &&
      typeof tool.name === 'string' &&
      (!('inputSchema' in tool) || typeof tool.inputSchema === 'object')
    );
  });
}

function getRequestToolMode(options: unknown): unknown {
  if (typeof options !== 'object' || options === null || !('toolMode' in options)) {
    return undefined;
  }

  return options.toolMode;
}

export class NineRouterChatProvider
  implements vscode.LanguageModelChatProvider<PublishedModel>
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly visionProxyService: VisionProxyService;

  public readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
    private readonly routerClient: RouterClient,
    private snapshot: SettingsSnapshot = buildSettingsSnapshot(getExtensionConfiguration())
  ) {
    this.visionProxyService = new VisionProxyService(routerClient);
  }

  public refresh(): void {
    this.snapshot = buildSettingsSnapshot(getExtensionConfiguration());
    this.onDidChangeEmitter.fire();
  }

  public refreshFromSnapshot(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot;
    this.onDidChangeEmitter.fire();
  }

  public getSnapshot(): SettingsSnapshot {
    return this.snapshot;
  }

  public async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<PublishedModel[]> {
    return this.snapshot.publishedModels;
  }

  public async provideLanguageModelChatResponse(
    model: PublishedModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ModelConfigurationResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await getApiKey(this.context.secrets);
    if (!apiKey) {
      throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
    }

    if (!this.snapshot.runtime) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        '9router runtime settings are invalid. Check diagnostics for details.'
      );
    }

    const selectedModel = this.snapshot.models.find((setting) => setting.id === model.id);
    if (!selectedModel) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        `Display model "${model.id}" is not available in the current validated snapshot.`
      );
    }

    const effectiveThinking = resolveEffectiveThinkingMode(options, selectedModel.thinkingMode);
    const requestSelectedModel: ConfiguredModel = {
      ...selectedModel,
      thinkingMode: effectiveThinking.thinkingMode
    };
    const requestCancellation = createAbortSignalFromToken(token);
    const requestStartedAt = Date.now();
    const visionStartedAt = requestStartedAt;
    let reasoningEmitter: RouterEventEmitter | undefined;
    let reasoningStreamOutcome: ReasoningStreamOutcome | undefined;

    try {
      const visionResult = await this.visionProxyService.prepare({
        selectedModel: requestSelectedModel,
        messages: messages as readonly HostChatRequestMessage[],
        visionProxyModelId: this.snapshot.runtime.visionProxyModelId,
        baseUrl: this.snapshot.runtime.baseUrl,
        apiKey,
        ...(typeof this.snapshot.runtime.maxTokens === 'number'
          ? { maxTokens: this.snapshot.runtime.maxTokens }
          : {}),
        requestTimeoutMs: this.snapshot.runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      });

      logDebugEvent(this.snapshot.runtime.debugMode, 'Vision compatibility resolved', {
        displayModel: selectedModel.id,
        visionMode: selectedModel.visionMode,
        visionOutcome: visionResult.outcome,
        hasVisionInput: visionResult.hasVisionInput,
        imageCount: visionResult.imageCount,
        imageMessageCount: visionResult.imageMessageCount,
        visionRequestIds: visionResult.requestIds.join(','),
        durationMs: Date.now() - visionStartedAt
      });

      if (visionResult.outcome === 'vision-blocked') {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          visionResult.blockReason ?? 'The selected 9router display model cannot accept image inputs.',
          {
            details: {
              displayModel: selectedModel.id,
              modelId: selectedModel.modelId,
              visionMode: selectedModel.visionMode,
              visionOutcome: visionResult.outcome
            }
          }
        );
      }

      const requestInput: Parameters<typeof adaptMessagesToRouterRequest>[0] = {
        selectedModel: requestSelectedModel,
        messages: visionResult.messages
      };

      const requestTools = getRequestTools(options);
      if (requestTools) {
        requestInput.tools = requestTools;
        requestInput.hostToolMode = getRequestToolMode(options);

        const toolOptions = adaptToolOptionsForRouter({
          selectedModel: requestSelectedModel,
          tools: requestTools,
          hostToolMode: getRequestToolMode(options)
        });

        if (toolOptions.rejectedTools.length > 0) {
          logDebugEvent(this.snapshot.runtime.debugMode, 'Some tools were not exposed to 9router', {
            rejectedTools: toolOptions.rejectedTools
              .map((tool) => `${tool.name}:${tool.code}`)
              .join(', ')
          });
        }
      }

      if (typeof this.snapshot.runtime.maxTokens === 'number') {
        requestInput.maxTokens = this.snapshot.runtime.maxTokens;
      }

      const request = adaptMessagesToRouterRequest(requestInput);

      logDebugEvent(this.snapshot.runtime.debugMode, 'Submitting request to 9router', {
        displayModel: selectedModel.id,
        modelId: selectedModel.modelId,
        configuredThinkingMode: selectedModel.thinkingMode,
        effectiveThinkingMode: effectiveThinking.thinkingMode,
        thinkingModeSource: effectiveThinking.source,
        baseUrl: this.snapshot.runtime.baseUrl,
        snapshotState: this.snapshot.state,
        issueCount: this.snapshot.issues.length
      });

      if (requestCancellation.signal.aborted) {
        throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
      }

      reasoningEmitter = createRouterEventEmitter(progress);
      reasoningStreamOutcome = 'failed';
      const stream = this.routerClient.streamChatCompletion({
        baseUrl: this.snapshot.runtime.baseUrl,
        apiKey,
        request,
        timeoutMs: this.snapshot.runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      });

      for await (const event of stream) {
        reasoningEmitter.emit(event);
      }
      reasoningStreamOutcome = 'completed';
    } catch (error) {
      const mappedError = mapProviderError(error, selectedModel);
      if (reasoningEmitter) {
        reasoningStreamOutcome =
          mappedError.code === 'CANCELLATION_ERROR' ? 'cancelled' : 'failed';
      }
      logDebugEvent(
        this.snapshot.runtime.debugMode,
        '9router request failed',
        buildFailureMetadata(
          this.snapshot.runtime.debugMode,
          mappedError,
          selectedModel,
          Date.now() - requestStartedAt
        ),
        'minimal'
      );
      throw mappedError;
    } finally {
      if (reasoningEmitter && reasoningStreamOutcome) {
        const reasoningSummary = reasoningEmitter.getReasoningSummary();
        logDebugEvent(
          this.snapshot.runtime.debugMode,
          'Reasoning stream diagnostic',
          {
            displayModel: selectedModel.id,
            effectiveThinkingMode: effectiveThinking.thinkingMode,
            outcome: reasoningStreamOutcome,
            receivedDeltas: reasoningSummary.receivedDeltas,
            receivedCharacters: reasoningSummary.receivedCharacters,
            emittedDeltas: reasoningSummary.emittedDeltas,
            droppedDeltas: reasoningSummary.droppedDeltas,
            hostThinkingPartAvailable: isLanguageModelThinkingPartAvailable()
          },
          'minimal'
        );
      }
      requestCancellation.cleanup();
    }
  }

  public async provideTokenCount(
    _model: PublishedModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const content = typeof text === 'string' ? text : flattenRequestContent(text.content);
    return estimateTokenCount(content);
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

export function findSelectedModelSetting(
  settings: ConfiguredModel[],
  model: PublishedModel
): ConfiguredModel | undefined {
  return settings.find((setting) => setting.id === model.id);
}

function mapProviderError(error: unknown, selectedModel: ConfiguredModel): NineRouterError {
  if (!(error instanceof NineRouterError) || error.code !== 'MODEL_MAPPING_ERROR') {
    if (error instanceof NineRouterError) {
      return error;
    }

    throw error;
  }

  const settingsKey = `9router-copilot.models[${selectedModel.sourceIndex}].modelId`;
  return new NineRouterError(
    'CONFIGURATION_ERROR',
    `9router model mapping for display model "${selectedModel.id}" was not found. Update ${settingsKey}.`,
    {
      ...(error.requestId ? { requestId: error.requestId } : {}),
      details: {
        ...(typeof error.details?.status === 'number' ? { status: error.details.status } : {}),
        displayModel: selectedModel.id,
        modelId: selectedModel.modelId,
        settingsKey
      }
    }
  );
}

function buildFailureMetadata(
  debugMode: 'minimal' | 'metadata' | 'verbose',
  error: NineRouterError,
  selectedModel: ConfiguredModel,
  durationMs: number
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    errorCode: error.code,
    durationMs
  };

  if (typeof error.details?.status === 'number') {
    metadata.status = error.details.status;
  }

  if (debugMode !== 'minimal') {
    metadata.displayModel = selectedModel.id;
    metadata.modelId = selectedModel.modelId;
    if (error.requestId) {
      metadata.requestId = error.requestId;
    }
  }

  return metadata;
}

function flattenRequestContent(content: string | readonly unknown[]): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        return part.value;
      }

      return '';
    })
    .join(' ');
}

function estimateTokenCount(input: string): number {
  const normalized = input.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}
