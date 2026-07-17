import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { handleConfigurationChange } from '../../../src/runtime/activate';
import type { PublishedModel } from '../../../src/types/product-model';
import { __createCancellationToken } from '../../support/vscode';

describe('handleConfigurationChange', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unrelated settings changes and refreshes on 9router keys', () => {
    const refresh = vi.fn();

    handleConfigurationChange(
      {
        affectsConfiguration: (section: string) => section === '9router-copilot'
      } as never,
      refresh
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('NineRouterChatProvider snapshot refresh', () => {
  it('publishes models from the latest validated snapshot after refresh', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'response-complete' };
        }
      } as never,
      buildSettingsSnapshot(
        {
          get: (key: string) => {
            if (key === 'displayModels') {
              return ['daily'];
            }

            if (key === 'modelMappings.daily') {
              return 'combo/daily';
            }

            return undefined;
          }
        } as never
      )
    );

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels.map((model) => model.id)).toEqual(['daily']);

    provider.refreshFromSnapshot(
      buildSettingsSnapshot(
        {
          get: (key: string) => {
            if (key === 'displayModels') {
              return ['fallback'];
            }

            if (key === 'modelMappings.fallback') {
              return 'combo/fallback';
            }

            return undefined;
          }
        } as never
      )
    );

    const refreshedModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(refreshedModels.map((model) => model.id)).toEqual(['fallback']);
  });

  it('blocks requests when the current snapshot has invalid runtime settings', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'response-complete' };
        }
      } as never,
      buildSettingsSnapshot(
        {
          get: (key: string) => {
            if (key === 'displayModels') {
              return ['daily'];
            }

            if (key === 'modelMappings.daily') {
              return 'combo/daily';
            }

            if (key === 'baseUrl') {
              return 'not-a-url';
            }

            return undefined;
          }
        } as never
      )
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
        } as PublishedModel,
        [{ role: 1, content: 'hello' }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR'
    });
  });

  it('refreshes proxy image capability when the shared Vision combo is configured', async () => {
    const createSnapshot = (visionProxyComboId?: string) =>
      buildSettingsSnapshot(
        {
          get: (key: string) => {
            if (key === 'displayModels') return ['agent'];
            if (key === 'modelMappings.agent') return 'combo/agent';
            if (key === 'visionMode.agent') return 'proxy';
            if (key === 'visionProxyComboId') return visionProxyComboId;
            return undefined;
          }
        } as never
      );
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'response-complete' };
        }
      } as never,
      createSnapshot()
    );

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels[0]?.capabilities.imageInput).toBeUndefined();

    provider.refreshFromSnapshot(createSnapshot('combo/vision'));

    const refreshedModels = await provider.provideLanguageModelChatInformation(
      {} as never,
      {} as never
    );
    expect(refreshedModels[0]?.capabilities.imageInput).toBe(true);
  });
});
