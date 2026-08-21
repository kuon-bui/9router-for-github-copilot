import { beforeEach, describe, expect, it } from 'vitest';
import { NineRouterError } from '@/router/errors';
import { NineRouterChatProvider } from '@/provider/provider';
import type { RouterResponseRequest } from '@/types/router-contract';
import {
  __createCancellationToken,
  __resetVscodeState,
  __setConfigurationValues
} from '@test/support/vscode';

describe('NineRouterChatProvider cancellation flow', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationValues({
      models: [{ id: 'daily', name: 'Daily', modelId: 'combo/daily' }],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
  });

  it('surfaces cancellation-safe failures from the router client', async () => {
    let cancelRequest: (() => void) | undefined;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamResponse({ signal }) {
          const abortPromise = new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              resolve();
            }, { once: true });
          });

          cancelRequest?.();
          await abortPromise;

          expect(signal.aborted).toBe(true);
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
        }
      } as never
    );

    const token = __createCancellationToken();
    cancelRequest = token.cancel;

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
        token.value
      )
    ).rejects.toMatchObject({
      code: 'CANCELLATION_ERROR'
    });
  });

  it('cancels Vision before the primary combo starts', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyModelId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
    const cancellation = __createCancellationToken();
    const modelsCalled: string[] = [];
    let visionSignal: AbortSignal | undefined;
    let markVisionStarted: (() => void) | undefined;
    const visionStarted = new Promise<void>((resolve) => {
      markVisionStarted = resolve;
    });
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamResponse(input: {
          request: RouterResponseRequest;
          signal: AbortSignal;
        }) {
          modelsCalled.push(input.request.model);
          visionSignal = input.signal;
          markVisionStarted?.();
          await new Promise<void>((resolve) => {
            if (input.signal.aborted) resolve();
            else input.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
        }
      } as never
    );

    const responsePromise = provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
      {} as never,
      { report: () => undefined } as never,
      cancellation.value as never
    );
    await visionStarted;
    cancellation.cancel();

    await expect(responsePromise).rejects.toMatchObject({ code: 'CANCELLATION_ERROR' });
    expect(modelsCalled).toEqual(['combo/vision']);
    expect(visionSignal?.aborted).toBe(true);
  });
});
