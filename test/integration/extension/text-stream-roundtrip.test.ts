import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { __resetVscodeState, __setConfigurationValues } from '../../support/vscode';

describe('NineRouterChatProvider', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationValues({
      displayModels: ['daily'],
      'modelMappings.daily': 'combo/daily',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
  });

  it('streams text deltas from 9router into VS Code response parts', async () => {
    const progressCalls: string[] = [];
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'text-delta', text: 'Hello' };
          yield { type: 'text-delta', text: ' world' };
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'daily',
        name: 'Daily',
        vendor: '9router',
        family: 'daily',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: 'Say hello' }] as never,
      {} as never,
      {
        report: (part: vscode.LanguageModelResponsePart) => {
          if (part instanceof vscode.LanguageModelTextPart) {
            progressCalls.push(part.value);
          }
        }
      } as vscode.Progress<vscode.LanguageModelResponsePart>,
      new AbortController().signal as never
    );

    expect(progressCalls.join('')).toBe('Hello world');
  });

  it('blocks image inputs when the selected model is configured as vision off', async () => {
    let streamCalled = false;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          streamCalled = true;
          yield { type: 'response-complete' };
        }
      } as never
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'daily',
          name: 'Daily',
          vendor: '9router',
          family: 'daily',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [{ role: 1, content: [{ mimeType: 'image/png' }] }] as never,
        {} as never,
        { report: () => undefined } as never,
        new AbortController().signal as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({
        visionOutcome: 'vision-blocked'
      })
    });

    expect(streamCalled).toBe(false);
  });
});
