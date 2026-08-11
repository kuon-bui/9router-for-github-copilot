import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { NineRouterError } from '../../../src/router/errors';
import { handleConfigurationChange } from '../../../src/runtime/activate';
import type { RouterChatCompletionRequest } from '../../../src/types/router-contract';
import type { PublishedModel } from '../../../src/types/product-model';
import { __createCancellationToken } from '../../support/vscode';

const createSnapshot = (models: unknown[], values: Record<string, unknown> = {}) =>
  buildSettingsSnapshot({
    get: (key: string) => (key === 'models' ? models : values[key])
  } as never);

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
  const context = { secrets: { get: async () => 'token' } } as never;
  const streamChatCompletion = async function* () {
    yield { type: 'response-complete' };
  };
  const routerClient = {
    async listModels() {
      return [];
    },
    streamChatCompletion
  } as never;

  it('adds, removes, renames, and reorders arbitrary picker models after refresh', async () => {
    const provider = new NineRouterChatProvider(
      context,
      routerClient,
      createSnapshot([
        { id: 'research', name: 'Research', modelId: 'router/research' },
        { id: 'coder', name: 'Coder', modelId: 'router/coder' }
      ])
    );

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'research', name: 'Research' },
      { id: 'coder', name: 'Coder' }
    ]);

    provider.refreshFromSnapshot(
      createSnapshot([
        { id: 'coder', name: 'Coding Pro', modelId: 'router/coder' },
        { id: 'fast', name: 'Fast', modelId: 'router/fast' }
      ])
    );

    const refreshedModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(refreshedModels.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'coder', name: 'Coding Pro' },
      { id: 'fast', name: 'Fast' }
    ]);
  });

  it('refreshes published context window metadata from model objects', async () => {
    const snapshotWithLimits = (maxInputTokens: number, maxOutputTokens: number) =>
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          maxInputTokens,
          maxOutputTokens
        }
      ]);
    const provider = new NineRouterChatProvider(
      context,
      routerClient,
      snapshotWithLimits(32_000, 2_048)
    );

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels[0]).toMatchObject({
      maxInputTokens: 32_000,
      maxOutputTokens: 2_048
    });

    provider.refreshFromSnapshot(snapshotWithLimits(64_000, 4_096));

    const refreshedModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(refreshedModels[0]).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });
  });

  it('refreshes each model thinking effort schema from settings', async () => {
    const provider = new NineRouterChatProvider(
      context,
      routerClient,
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          thinkingMode: 'low',
          thinkingEfforts: ['low']
        }
      ])
    );

    const initial = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initial[0]?.configurationSchema?.properties.reasoningEffort.enum).toEqual([
      'none',
      'low'
    ]);

    provider.refreshFromSnapshot(
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          thinkingMode: 'off',
          thinkingEfforts: ['high', 'max']
        }
      ])
    );

    const refreshed = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(refreshed[0]?.configurationSchema?.properties.reasoningEffort).toMatchObject({
      enum: ['none', 'high', 'max'],
      default: 'none'
    });
  });

  it('keeps valid models when one thinking effort configuration is invalid', async () => {
    const provider = new NineRouterChatProvider(
      context,
      routerClient,
      createSnapshot([
        {
          id: 'broken',
          name: 'Broken',
          modelId: 'router/broken',
          thinkingMode: 'high',
          thinkingEfforts: ['low']
        },
        { id: 'coder', name: 'Coder', modelId: 'router/coder' }
      ])
    );

    const models = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(models.map((model) => model.id)).toEqual(['coder']);
  });

  it('refreshes on every information call, retains failed cache, and replaces it after success', async () => {
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'router/coder', contextWindow: 400_000, maxOutput: 128_000 }
      ])
      .mockRejectedValueOnce(
        new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable')
      )
      .mockResolvedValueOnce([
        { id: 'router/coder', contextWindow: 200_000, maxOutput: 64_000 }
      ]);
    const provider = new NineRouterChatProvider(
      context,
      { listModels, streamChatCompletion } as never,
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          maxInputTokens: 32_000,
          maxOutputTokens: 2_048
        }
      ])
    );
    const token = __createCancellationToken().value as never;

    await expect(
      provider.provideLanguageModelChatInformation({} as never, token)
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })
    ]);
    await expect(
      provider.provideLanguageModelChatInformation({} as never, token)
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })
    ]);
    await expect(
      provider.provideLanguageModelChatInformation({} as never, token)
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 136_000, maxOutputTokens: 64_000 })
    ]);

    expect(listModels).toHaveBeenCalledTimes(3);
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3456/v1',
        apiKey: 'token',
        timeoutMs: 60_000,
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('uses configured fallback metadata when the first catalog refresh fails', async () => {
    const provider = new NineRouterChatProvider(
      context,
      {
        listModels: vi.fn().mockRejectedValue(
          new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable')
        ),
        streamChatCompletion
      } as never,
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          maxInputTokens: 32_000,
          maxOutputTokens: 2_048
        }
      ])
    );

    await expect(
      provider.provideLanguageModelChatInformation(
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 32_000, maxOutputTokens: 2_048 })
    ]);
  });

  it('does not reuse cached catalog metadata across base URLs', async () => {
    const model = {
      id: 'coder',
      name: 'Coder',
      modelId: 'router/coder',
      maxInputTokens: 32_000,
      maxOutputTokens: 2_048
    };
    const listModels = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'router/coder', contextWindow: 400_000, maxOutput: 128_000 }
      ])
      .mockRejectedValueOnce(new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable'));
    const provider = new NineRouterChatProvider(
      context,
      { listModels, streamChatCompletion } as never,
      createSnapshot([model], { baseUrl: 'https://old-router.example.com/v1' })
    );
    const token = __createCancellationToken().value as never;

    await expect(provider.provideLanguageModelChatInformation({} as never, token)).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })
    ]);

    provider.refreshFromSnapshot(
      createSnapshot([model], { baseUrl: 'https://new-router.example.com/v1' })
    );

    await expect(provider.provideLanguageModelChatInformation({} as never, token)).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 32_000, maxOutputTokens: 2_048 })
    ]);
  });

  it('deduplicates concurrent catalog refreshes for one snapshot', async () => {
    let resolveCatalog: ((models: unknown[]) => void) | undefined;
    const catalog = new Promise<unknown[]>((resolve) => {
      resolveCatalog = resolve;
    });
    const listModels = vi.fn().mockReturnValue(catalog);
    const provider = new NineRouterChatProvider(
      context,
      { listModels, streamChatCompletion } as never,
      createSnapshot([
        {
          id: 'coder',
          name: 'Coder',
          modelId: 'router/coder',
          maxInputTokens: 32_000,
          maxOutputTokens: 2_048
        }
      ])
    );
    const token = __createCancellationToken().value as never;

    const first = provider.provideLanguageModelChatInformation({} as never, token);
    const second = provider.provideLanguageModelChatInformation({} as never, token);

    await vi.waitFor(() => {
      expect(listModels).toHaveBeenCalledTimes(1);
    });
    resolveCatalog?.([
      { id: 'router/coder', contextWindow: 400_000, maxOutput: 128_000 }
    ]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })],
      [expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })]
    ]);
  });

  it('skips discovery without an API key and uses built-in fallback metadata', async () => {
    const listModels = vi.fn();
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => undefined } } as never,
      { listModels, streamChatCompletion } as never,
      createSnapshot([
        { id: 'coder', name: 'Coder', modelId: 'router/coder' }
      ])
    );

    await expect(
      provider.provideLanguageModelChatInformation(
        {} as never,
        __createCancellationToken().value as never
      )
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 264_000, maxOutputTokens: 264_000 })
    ]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it('does not let an older runtime refresh overwrite a newer successful catalog', async () => {
    let resolveFirst: ((models: unknown[]) => void) | undefined;
    let resolveSecond: ((models: unknown[]) => void) | undefined;
    const firstCatalog = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve;
    });
    const secondCatalog = new Promise<unknown[]>((resolve) => {
      resolveSecond = resolve;
    });
    const listModels = vi
      .fn()
      .mockReturnValueOnce(firstCatalog)
      .mockReturnValueOnce(secondCatalog)
      .mockRejectedValueOnce(new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable'));
    const model = {
      id: 'coder',
      name: 'Coder',
      modelId: 'router/coder',
      maxInputTokens: 32_000,
      maxOutputTokens: 2_048
    };
    const provider = new NineRouterChatProvider(
      context,
      { listModels, streamChatCompletion } as never,
      createSnapshot([model], { baseUrl: 'https://old-router.example.com/v1' })
    );
    const token = __createCancellationToken().value as never;

    const oldInformation = provider.provideLanguageModelChatInformation({} as never, token);
    provider.refreshFromSnapshot(
      createSnapshot([model], { baseUrl: 'https://new-router.example.com/v1' })
    );
    const newInformation = provider.provideLanguageModelChatInformation({} as never, token);

    resolveSecond?.([
      { id: 'router/coder', contextWindow: 400_000, maxOutput: 128_000 }
    ]);
    await expect(newInformation).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })
    ]);

    resolveFirst?.([
      { id: 'router/coder', contextWindow: 64_000, maxOutput: 8_192 }
    ]);
    await oldInformation;

    await expect(
      provider.provideLanguageModelChatInformation({} as never, token)
    ).resolves.toEqual([
      expect.objectContaining({ maxInputTokens: 272_000, maxOutputTokens: 128_000 })
    ]);
  });

  it('blocks requests when the current snapshot has invalid runtime settings', async () => {
    const provider = new NineRouterChatProvider(
      context,
      routerClient,
      createSnapshot(
        [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }],
        { baseUrl: 'not-a-url' }
      )
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'coder',
          name: 'Coder',
          vendor: '9router',
          family: 'coder',
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
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('uses one settings snapshot for the full response request', async () => {
    let releaseSecret: ((value: string) => void) | undefined;
    const secretPromise = new Promise<string>((resolve) => {
      releaseSecret = resolve;
    });
    const oldSnapshot = createSnapshot(
      [{ id: 'coder', name: 'Coder', modelId: 'router/old', maxOutputTokens: 2048 }],
      { baseUrl: 'https://old-router.example.com/v1', maxTokens: 128 }
    );
    const newSnapshot = createSnapshot(
      [{ id: 'coder', name: 'Coder', modelId: 'router/new', maxOutputTokens: 4096 }],
      { baseUrl: 'not-a-url', maxTokens: 256 }
    );
    let submitted:
      | { baseUrl: string; timeoutMs: number; request: RouterChatCompletionRequest }
      | undefined;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: () => secretPromise
        }
      } as never,
      {
        async *streamChatCompletion(input: {
          baseUrl: string;
          timeoutMs: number;
          request: RouterChatCompletionRequest;
        }) {
          submitted = input;
          yield { type: 'response-complete' };
        }
      } as never,
      oldSnapshot
    );

    const response = provider.provideLanguageModelChatResponse(
      {
        id: 'coder',
        name: 'Coder',
        vendor: '9router',
        family: 'coder',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      } as PublishedModel,
      [{ role: 1, content: 'hello' }] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    provider.refreshFromSnapshot(newSnapshot);
    releaseSecret?.('token');
    await response;

    expect(submitted).toMatchObject({
      baseUrl: 'https://old-router.example.com/v1',
      request: {
        model: 'router/old',
        max_tokens: 128
      }
    });
  });

  it('publishes proxy image capability for guided setup while still requiring a prompt', async () => {
    const snapshotWithProxy = (overrides: Record<string, unknown> = {}) =>
      createSnapshot(
        [{ id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'proxy' }],
        overrides
      );
    const provider = new NineRouterChatProvider(context, routerClient, snapshotWithProxy());

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels[0]?.capabilities.imageInput).toBe(true);

    provider.refreshFromSnapshot(
      snapshotWithProxy({
        visionProxySource: 'invalid-source',
        visionProxyModelId: 'router/vision',
        visionProxyPrompt: 'Describe image.'
      })
    );

    const invalidSourceModels = await provider.provideLanguageModelChatInformation(
      {} as never,
      {} as never
    );
    expect(invalidSourceModels[0]?.capabilities.imageInput).toBe(true);

    provider.refreshFromSnapshot(
      snapshotWithProxy({
        visionProxySource: '9router',
        visionProxyModelId: 'router/vision',
        visionProxyPrompt: '   '
      })
    );

    const missingPromptModels = await provider.provideLanguageModelChatInformation(
      {} as never,
      {} as never
    );
    expect(missingPromptModels[0]?.capabilities.imageInput).toBeUndefined();

    provider.refreshFromSnapshot(
      snapshotWithProxy({
        visionProxySource: 'copilot',
        visionProxyModelId: 'copilot/vision',
        visionProxyPrompt: 'Describe image.'
      })
    );

    const refreshedModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(refreshedModels[0]?.capabilities.imageInput).toBe(true);
  });
});
