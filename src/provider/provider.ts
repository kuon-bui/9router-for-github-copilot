import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import {
  buildSettingsSnapshot,
  getExtensionConfiguration,
  isVisionProxyConfigured
} from '../config/settings';
import { logDebugEvent } from '../debug/output-channel';
import { NineRouterError } from '../router/errors';
import { adaptToolOptionsForRouter } from './tool-adapter';
import { adaptMessagesToRouterRequest } from './request-adapter';
import { createRouterEventEmitter } from './stream-adapter';
import { createAbortSignalFromToken } from './cancellation';
import { resolveEffectiveThinkingMode } from './thinking-effort';
import { VisionProxyService } from './vision-proxy';
import { hasImageParts } from './image-input-adapter';
import { resolvePublishedModels } from './model-catalog';
import type { RouterClient } from '../router/client';
import type { RuntimeSettings, SettingsSnapshot } from '../config/settings';
import type { RouterModelMetadata } from '../router/model-catalog';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';
import type { ModelConfigurationResponseOptions } from '../types/vscode-chat-compat';
import type { HostToolDefinition } from './tool-adapter';
import type { HostChatRequestMessage } from './vision-proxy';
import type { VisionProxyConfigurator } from '../runtime/vision-configuration';

interface NineRouterChatProviderOptions {
  configureVisionProxy?: VisionProxyConfigurator;
}

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
  private readonly options: NineRouterChatProviderOptions;
  private latestModelCatalog: readonly RouterModelMetadata[] | undefined;
  private snapshotVersion = 0;

  public readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
    private readonly routerClient: RouterClient,
    private snapshot: SettingsSnapshot = buildSettingsSnapshot(getExtensionConfiguration()),
    options: NineRouterChatProviderOptions = {}
  ) {
    this.options = options;
    this.visionProxyService = new VisionProxyService(routerClient);
  }

  public refresh(): void {
    this.snapshot = buildSettingsSnapshot(getExtensionConfiguration());
    this.snapshotVersion += 1;
    this.onDidChangeEmitter.fire();
  }

  public refreshFromSnapshot(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot;
    this.snapshotVersion += 1;
    this.onDidChangeEmitter.fire();
  }

  public getSnapshot(): SettingsSnapshot {
    return this.snapshot;
  }

  public async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<PublishedModel[]> {
    const snapshot = this.snapshot;
    const runtime = snapshot.runtime;
    if (!runtime || snapshot.models.length === 0) {
      return snapshot.publishedModels;
    }

    const snapshotVersion = this.snapshotVersion;
    const routerModels = await this.refreshModelCatalog(runtime, token, snapshotVersion);

    return resolvePublishedModels(snapshot.models, {
      visionProxyConfigured: isVisionProxyConfigured(runtime),
      ...(routerModels ? { routerModels } : {})
    });
  }

  private async refreshModelCatalog(
    runtime: RuntimeSettings,
    token: vscode.CancellationToken,
    snapshotVersion: number
  ): Promise<readonly RouterModelMetadata[] | undefined> {
    const startedAt = Date.now();
    const fallbackCatalog = this.latestModelCatalog;

    try {
      const apiKey = await getApiKey(this.context.secrets);
      if (!apiKey) {
        return fallbackCatalog;
      }

      const requestCancellation = createAbortSignalFromToken(token);
      try {
        const catalog = await this.routerClient.listModels({
          baseUrl: runtime.baseUrl,
          apiKey,
          timeoutMs: runtime.requestTimeoutMs,
          signal: requestCancellation.signal
        });

        if (snapshotVersion === this.snapshotVersion) {
          this.latestModelCatalog = catalog;
        }

        logDebugEvent(runtime.debugMode, '9router model catalog refreshed', {
          modelCount: catalog.length,
          durationMs: Date.now() - startedAt
        });
        return catalog;
      } finally {
        requestCancellation.cleanup();
      }
    } catch (error) {
      logDebugEvent(runtime.debugMode, '9router model catalog refresh failed', {
        errorCode: error instanceof NineRouterError ? error.code : 'UNKNOWN',
        requestId: error instanceof NineRouterError ? error.requestId : undefined,
        cached: this.latestModelCatalog !== undefined,
        durationMs: Date.now() - startedAt
      });
      return fallbackCatalog;
    }
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

    const effectiveThinking = resolveEffectiveThinkingMode(
      options,
      selectedModel.thinkingMode,
      selectedModel.thinkingEfforts
    );
    const requestSelectedModel: ConfiguredModel = {
      ...selectedModel,
      thinkingMode: effectiveThinking.thinkingMode
    };
    const hasVisionInput = messages.some((message) => hasImageParts(message.content));
    let visionProxySource = this.snapshot.runtime.visionProxySource;
    let visionProxyModelId = this.snapshot.runtime.visionProxyModelId;
    const needsVisionSetup =
      requestSelectedModel.visionMode === 'proxy' &&
      hasVisionInput &&
      (!visionProxySource || visionProxyModelId.length === 0);
    const requestCancellation = createAbortSignalFromToken(token);
    const visionStartedAt = Date.now();

    try {
      if (needsVisionSetup) {
        const selection = await this.options.configureVisionProxy?.(token);
        if (!selection) {
          throw new NineRouterError(
            'CONFIGURATION_ERROR',
            'Vision proxy configuration was cancelled. Run 9router: Configure Vision Proxy before sending images.',
            { details: { phase: 'vision-configuration' } }
          );
        }

        visionProxySource = selection.source;
        visionProxyModelId = selection.modelId;
      }

      const visionResult = await this.visionProxyService.prepare({
        selectedModel: requestSelectedModel,
        messages: messages as readonly HostChatRequestMessage[],
        visionProxySource,
        visionProxyModelId,
        visionProxyPrompt: this.snapshot.runtime.visionProxyPrompt,
        baseUrl: this.snapshot.runtime.baseUrl,
        apiKey,
        ...(typeof this.snapshot.runtime.maxTokens === 'number'
          ? { maxTokens: this.snapshot.runtime.maxTokens }
          : {}),
        requestTimeoutMs: this.snapshot.runtime.requestTimeoutMs,
        signal: requestCancellation.signal,
        cancellationToken: token
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

      const emitter = createRouterEventEmitter(progress);
      const stream = this.routerClient.streamChatCompletion({
        baseUrl: this.snapshot.runtime.baseUrl,
        apiKey,
        request,
        timeoutMs: this.snapshot.runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      });

      for await (const event of stream) {
        emitter.emit(event);
      }
    } catch (error) {
      throw mapProviderError(error, selectedModel);
    } finally {
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
