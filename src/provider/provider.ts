import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { buildSettingsSnapshot, getExtensionConfiguration } from '../config/settings';
import { logDebugEvent } from '../debug/output-channel';
import { NineRouterError } from '../router/errors';
import { adaptToolOptionsForRouter } from './tool-adapter';
import { adaptMessagesToRouterRequest } from './request-adapter';
import { createRouterEventEmitter } from './stream-adapter';
import { createAbortSignalFromToken } from './cancellation';
import { prepareVisionCompatibleMessages } from './vision-proxy';
import type { RouterClient } from '../router/client';
import type { SettingsSnapshot } from '../config/settings';
import type { DisplayModelSetting, PublishedModel } from '../types/product-model';
import type { HostToolDefinition } from './tool-adapter';
import type { HostChatRequestMessage } from './vision-proxy';

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

  public readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
    private readonly routerClient: RouterClient,
    private snapshot: SettingsSnapshot = buildSettingsSnapshot(getExtensionConfiguration())
  ) {}

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
    options: vscode.ProvideLanguageModelChatResponseOptions,
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

    const selectedModel = this.snapshot.displayModels.find((setting) => setting.key === model.id);
    if (!selectedModel) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        `Display model "${model.id}" is not available in the current validated snapshot.`
      );
    }

    const visionResult = await prepareVisionCompatibleMessages({
      selectedModel,
      messages: messages as readonly HostChatRequestMessage[]
    });

    logDebugEvent(this.snapshot.runtime.debugMode, 'Vision compatibility resolved', {
      displayModel: selectedModel.key,
      comboId: selectedModel.comboId,
      visionMode: selectedModel.visionMode,
      visionOutcome: visionResult.outcome,
      hasVisionInput: visionResult.hasVisionInput
    });

    if (visionResult.outcome === 'vision-blocked') {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        visionResult.blockReason ?? 'The selected 9router display model cannot accept image inputs.',
        {
          details: {
            displayModel: selectedModel.key,
            comboId: selectedModel.comboId,
            visionMode: selectedModel.visionMode,
            visionOutcome: visionResult.outcome
          }
        }
      );
    }

    const requestInput: Parameters<typeof adaptMessagesToRouterRequest>[0] = {
      selectedModel,
      messages: visionResult.messages
    };

    const requestTools = getRequestTools(options);
    if (requestTools) {
      requestInput.tools = requestTools;
      requestInput.hostToolMode = getRequestToolMode(options);

      const toolOptions = adaptToolOptionsForRouter({
        selectedModel,
        tools: requestTools,
        hostToolMode: getRequestToolMode(options)
      });

      if (toolOptions.rejectedTools.length > 0) {
        logDebugEvent(this.snapshot.runtime.debugMode, 'Some tools were not exposed to 9router', {
          rejectedTools: toolOptions.rejectedTools.map((tool) => `${tool.name}:${tool.code}`).join(', ')
        });
      }
    }

    if (typeof this.snapshot.runtime.maxTokens === 'number') {
      requestInput.maxTokens = this.snapshot.runtime.maxTokens;
    }

    const request = adaptMessagesToRouterRequest(requestInput);

    logDebugEvent(this.snapshot.runtime.debugMode, 'Submitting request to 9router', {
      displayModel: selectedModel.key,
      comboId: selectedModel.comboId,
      thinkingMode: selectedModel.thinkingMode,
      baseUrl: this.snapshot.runtime.baseUrl,
      snapshotState: this.snapshot.state,
      issueCount: this.snapshot.issues.length
    });

    const emitter = createRouterEventEmitter(progress);
    const requestCancellation = createAbortSignalFromToken(token);

    try {
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
  settings: DisplayModelSetting[],
  model: PublishedModel
): DisplayModelSetting | undefined {
  return settings.find((setting) => setting.key === model.id);
}

function mapProviderError(error: unknown, selectedModel: DisplayModelSetting): NineRouterError {
  if (!(error instanceof NineRouterError) || error.code !== 'COMBO_MAPPING_ERROR') {
    if (error instanceof NineRouterError) {
      return error;
    }

    throw error;
  }

  return new NineRouterError(
    'CONFIGURATION_ERROR',
    `9router combo mapping for display model "${selectedModel.key}" was not found. Update 9router-copilot.modelMappings.${selectedModel.key} to a valid combo id.`,
    buildMissingComboMappingOptions(error, selectedModel)
  );
}

function buildMissingComboMappingOptions(
  error: NineRouterError,
  selectedModel: DisplayModelSetting
): { requestId?: string; details: Record<string, unknown> } {
  const options: { requestId?: string; details: Record<string, unknown> } = {
    details: {
      ...error.details,
      displayModel: selectedModel.key,
      comboId: selectedModel.comboId,
      settingsKey: `9router-copilot.modelMappings.${selectedModel.key}`
    }
  };

  if (error.requestId) {
    options.requestId = error.requestId;
  }

  return options;
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
