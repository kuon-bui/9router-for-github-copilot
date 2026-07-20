import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { handleConfigurationChange } from '../../../src/runtime/activate';
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
  const routerClient = {
    async *streamChatCompletion() {
      yield { type: 'response-complete' };
    }
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

  it('requires source, model, and prompt before publishing proxy image capability', async () => {
    const snapshotWithProxy = (overrides: Record<string, unknown> = {}) =>
      createSnapshot(
        [{ id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'proxy' }],
        overrides
      );
    const provider = new NineRouterChatProvider(context, routerClient, snapshotWithProxy());

    const initialModels = await provider.provideLanguageModelChatInformation({} as never, {} as never);
    expect(initialModels[0]?.capabilities.imageInput).toBeUndefined();

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
    expect(invalidSourceModels[0]?.capabilities.imageInput).toBeUndefined();

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
