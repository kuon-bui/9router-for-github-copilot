import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { NineRouterInlineCompletionProvider } from '../../../src/provider/inline-completion-provider';
import { NineRouterError } from '../../../src/router/errors';
import type { RouterChatCompletionRequest } from '../../../src/types/router-contract';
import { __createCancellationToken, __resetVscodeState } from '../../support/vscode';

function snapshot(values: Record<string, unknown> = {}) {
  return buildSettingsSnapshot({
    get: (key: string) => values[key]
  } as never);
}

function document(text: string, languageId = 'typescript') {
  return {
    languageId,
    fileName: 'src/example.ts',
    uri: { scheme: 'file' },
    getText: () => text,
    offsetAt: (position: { line: number; character: number }) => {
      const lines = text.split('\n');
      return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) +
        position.character;
    }
  } as never;
}

describe('NineRouterInlineCompletionProvider', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('streams 9router deltas into an inline completion item', async () => {
    let submittedRequest: RouterChatCompletionRequest | undefined;
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          submittedRequest = input.request;
          yield { type: 'text-delta', text: 'value' };
          yield { type: 'text-delta', text: '.map(Boolean)' };
          yield { type: 'response-complete', finishReason: 'stop', requestId: 'req-1' };
        }
      } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        baseUrl: 'https://router.example.com/v1',
        requestTimeoutMs: 5000,
        'inline.enabled': true,
        'inline.modelId': 'combo/inline',
        'inline.maxTokens': 64,
        'inline.languages': ['typescript']
      })
    );

    const result = await provider.provideInlineCompletionItems(
      document('const value = items\nvalue'),
      new vscode.Position(1, 5),
      {} as never,
      __createCancellationToken().value as never
    );

    expect(submittedRequest).toMatchObject({
      model: 'combo/inline',
      max_tokens: 64
    });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.insertText).toBe('value.map(Boolean)');
  });

  it('returns nothing when inline suggestions are disabled', async () => {
    const streamChatCompletion = vi.fn();
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      { streamChatCompletion } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        'inline.enabled': false,
        'inline.modelId': 'combo/inline'
      })
    );

    await expect(
      provider.provideInlineCompletionItems(
        document('const value = '),
        new vscode.Position(0, 14),
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it('does not compete with a selected autocomplete item', async () => {
    const streamChatCompletion = vi.fn();
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      { streamChatCompletion } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        'inline.enabled': true,
        'inline.modelId': 'combo/inline'
      })
    );

    await expect(
      provider.provideInlineCompletionItems(
        document('console.'),
        new vscode.Position(0, 8),
        { selectedCompletionInfo: { text: 'log', range: {} } } as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it('returns nothing without API key', async () => {
    const streamChatCompletion = vi.fn();
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => undefined } } as never,
      { streamChatCompletion } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        'inline.enabled': true,
        'inline.modelId': 'combo/inline'
      })
    );

    await expect(
      provider.provideInlineCompletionItems(
        document('const value = '),
        new vscode.Position(0, 14),
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it('swallows cancellation as empty inline result', async () => {
    const cancellation = __createCancellationToken();
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion({ signal }: { signal: AbortSignal }) {
          cancellation.cancel();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
        }
      } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        'inline.enabled': true,
        'inline.modelId': 'combo/inline'
      })
    );

    await expect(
      provider.provideInlineCompletionItems(
        document('const value = '),
        new vscode.Position(0, 14),
        {} as never,
        cancellation.value as never
      )
    ).resolves.toBeUndefined();
  });
});
