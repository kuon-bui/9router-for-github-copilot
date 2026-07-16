import { beforeEach, describe, expect, it } from 'vitest';
import { NineRouterError } from '../../../src/router/errors';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { __resetVscodeState, __setConfigurationValues } from '../../support/vscode';

describe('NineRouterChatProvider cancellation flow', () => {
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

  it('surfaces cancellation-safe failures from the router client', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
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
        [{ role: 1, content: 'Say hello' }] as never,
        {} as never,
        { report: () => undefined } as never,
        new AbortController().signal as never
      )
    ).rejects.toMatchObject({
      code: 'CANCELLATION_ERROR'
    });
  });
});
