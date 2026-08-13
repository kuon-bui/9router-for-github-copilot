import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { buildSettingsSnapshot, getExtensionConfiguration } from '../config/settings';
import { logDebugEvent } from '../debug/output-channel';
import { NineRouterError } from '../router/errors';
import { createAbortSignalFromToken } from './cancellation';
import { buildInlineCompletionRequest, normalizeInlineSuggestion } from './inline-request-adapter';
import type { RouterClient } from '../router/client';
import type { SettingsSnapshot } from '../config/settings';

export class NineRouterInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  public constructor(
    private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
    private readonly routerClient: RouterClient,
    private snapshot: SettingsSnapshot = buildSettingsSnapshot(getExtensionConfiguration())
  ) {}

  public refreshFromSnapshot(snapshot: SettingsSnapshot): void {
    this.snapshot = snapshot;
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | undefined> {
    const runtime = this.snapshot.runtime;
    const inline = runtime?.inline;
    if (
      !runtime ||
      !inline?.enabled ||
      inline.modelId.length === 0 ||
      !inline.languages.includes(document.languageId) ||
      !isSupportedDocumentScheme(document.uri.scheme) ||
      token.isCancellationRequested
    ) {
      return undefined;
    }

    const startedAt = Date.now();
    const requestCancellation = createAbortSignalFromToken(token);

    try {
      const apiKey = await getApiKey(this.context.secrets);
      if (!apiKey || requestCancellation.signal.aborted) {
        return undefined;
      }

      const request = buildInlineCompletionRequest({
        modelId: inline.modelId,
        document,
        position,
        ...(context.selectedCompletionInfo
          ? { selectedCompletionInfo: context.selectedCompletionInfo }
          : {}),
        settings: inline
      });
      const chunks: string[] = [];
      let finishReason: string | undefined;
      let requestId: string | undefined;
      let completed = false;

      logDebugEvent(
        runtime.debugMode,
        'Inline suggestion started',
        {
          languageId: document.languageId,
          modelId: inline.modelId
        },
        'minimal'
      );

      const stream = this.routerClient.streamChatCompletion({
        baseUrl: runtime.baseUrl,
        apiKey,
        request,
        timeoutMs: runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      });

      for await (const event of stream) {
        if (event.type === 'text-delta') {
          chunks.push(event.text);
          continue;
        }

        if (event.type === 'response-complete') {
          completed = true;
          finishReason = event.finishReason ?? finishReason;
          requestId = event.requestId ?? requestId;
          continue;
        }

        if (event.type === 'router-error') {
          throw new NineRouterError('UPSTREAM_UNAVAILABLE', event.error, {
            ...(event.requestId ? { requestId: event.requestId } : {})
          });
        }
      }

      if (!completed) {
        throw new NineRouterError(
          'MALFORMED_STREAM_ERROR',
          '9router inline suggestion stream ended before completion'
        );
      }

      const suggestion = normalizeInlineSuggestion(chunks.join(''));
      logDebugEvent(
        runtime.debugMode,
        'Inline suggestion completed',
        {
          languageId: document.languageId,
          modelId: inline.modelId,
          durationMs: Date.now() - startedAt,
          finishReason,
          requestId,
          hasSuggestion: suggestion !== undefined
        },
        'minimal'
      );

      if (!suggestion) {
        return undefined;
      }

      const selectedCompletion = context.selectedCompletionInfo;
      return new vscode.InlineCompletionList([
        new vscode.InlineCompletionItem(
          selectedCompletion ? `${selectedCompletion.text}${suggestion}` : suggestion,
          selectedCompletion?.range ?? new vscode.Range(position, position)
        )
      ]);
    } catch (error) {
      logDebugEvent(
        runtime.debugMode,
        'Inline suggestion failed',
        {
          languageId: document.languageId,
          modelId: inline.modelId,
          durationMs: Date.now() - startedAt,
          errorCode: error instanceof NineRouterError ? error.code : 'UNKNOWN',
          requestId: error instanceof NineRouterError ? error.requestId : undefined,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        },
        'minimal'
      );
      return undefined;
    } finally {
      requestCancellation.cleanup();
    }
  }
}

function isSupportedDocumentScheme(scheme: string): boolean {
  return scheme === 'file' || scheme === 'untitled';
}
