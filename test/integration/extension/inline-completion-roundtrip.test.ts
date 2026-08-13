import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { NineRouterInlineCompletionProvider } from '../../../src/provider/inline-completion-provider';
import { NineRouterError } from '../../../src/router/errors';
import type { RouterChatCompletionRequest } from '../../../src/types/router-contract';
import {
  __createCancellationToken,
  __getOutputLines,
  __resetVscodeState
} from '../../support/vscode';

function snapshot(values: Record<string, unknown> = {}) {
  return buildSettingsSnapshot({
    get: (key: string) => values[key]
  } as never);
}

function document(text: string, languageId = 'typescript') {
  const offsetAt = (position: { line: number; character: number }) => {
    const lines = text.split('\n');
    return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) +
      position.character;
  };

  return {
    languageId,
    fileName: 'src/example.ts',
    uri: { scheme: 'file' },
    getText: (range?: vscode.Range) =>
      range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
    offsetAt,
    positionAt: (offset: number) => {
      const lines = text.split('\n');
      let remaining = Math.min(text.length, offset);
      for (let line = 0; line < lines.length; line += 1) {
        const length = lines[line]?.length ?? 0;
        if (remaining <= length) return new vscode.Position(line, remaining);
        remaining -= length + 1;
      }
      return new vscode.Position(lines.length - 1, lines.at(-1)?.length ?? 0);
    }
  };
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
          yield { type: 'text-delta', text: '.map(Boolean)' };
          yield { type: 'response-complete', finishReason: 'stop', requestId: 'req-1' };
          yield { type: 'response-complete' };
        }
      } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        baseUrl: 'https://router.example.com/v1',
        requestTimeoutMs: 5000,
        debugMode: 'minimal',
        'inline.enabled': true,
        'inline.modelId': 'combo/inline',
        'inline.maxTokens': 64,
        'inline.languages': ['typescript']
      })
    );

    const source = 'const value = items\nvalue';
    const completionDocument = document(source);
    const position = new vscode.Position(1, 5);
    const result = await provider.provideInlineCompletionItems(
      completionDocument as never,
      position,
      {} as never,
      __createCancellationToken().value as never
    );

    expect(submittedRequest).toMatchObject({
      model: 'combo/inline',
      max_tokens: 64
    });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.insertText).toBe('.map(Boolean)');
    const insertion = String(result?.items[0]?.insertText);
    const offset = completionDocument.offsetAt(position);
    expect(`${source.slice(0, offset)}${insertion}${source.slice(offset)}`).toBe(
      'const value = items\nvalue.map(Boolean)'
    );
    expect(__getOutputLines()[0]).toContain('Inline suggestion started');
    expect(__getOutputLines().at(-1)).toContain('Inline suggestion completed');
    expect(__getOutputLines().at(-1)).toContain('"finishReason":"stop"');
    expect(__getOutputLines().at(-1)).toContain('"requestId":"req-1"');
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
        document('const value = ') as never,
        new vscode.Position(0, 14),
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it('extends a selected autocomplete item', async () => {
    let submittedRequest: RouterChatCompletionRequest | undefined;
    const selectedRange = new vscode.Range(
      new vscode.Position(0, 8),
      new vscode.Position(0, 10)
    );
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          submittedRequest = input.request;
          yield { type: 'text-delta', text: '()' };
          yield { type: 'response-complete', finishReason: 'stop' };
        }
      } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        'inline.enabled': true,
        'inline.modelId': 'combo/inline'
      })
    );

    const result = await provider.provideInlineCompletionItems(
      document('console.lo') as never,
      new vscode.Position(0, 10),
      { selectedCompletionInfo: { text: 'log', range: selectedRange } } as never,
      __createCancellationToken().value as never
    );

    expect(submittedRequest?.messages[1]?.content).toContain('console.log');
    expect(result?.items[0]?.insertText).toBe('log()');
    expect(result?.items[0]?.range).toBe(selectedRange);
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
        document('const value = ') as never,
        new vscode.Position(0, 14),
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it('rejects partial text from a truncated stream', async () => {
    const provider = new NineRouterInlineCompletionProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'text-delta', text: '.partial()' };
        }
      } as never,
      snapshot({
        models: [{ id: 'chat', name: 'Chat', modelId: 'combo/chat' }],
        debugMode: 'metadata',
        'inline.enabled': true,
        'inline.modelId': 'combo/inline'
      })
    );

    await expect(
      provider.provideInlineCompletionItems(
        document('value') as never,
        new vscode.Position(0, 5),
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toBeUndefined();
    expect(__getOutputLines().at(-1)).toContain('"errorCode":"MALFORMED_STREAM_ERROR"');
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
        document('const value = ') as never,
        new vscode.Position(0, 14),
        {} as never,
        cancellation.value as never
      )
    ).resolves.toBeUndefined();
  });
});
