import { beforeEach, describe, expect, it } from 'vitest';
import { loadRuntimeSettings } from '../../../src/config/settings';
import { createVisionProxyConfigurator } from '../../../src/runtime/vision-configuration';
import {
  __createCancellationToken,
  __getConfigurationUpdates,
  __resetVscodeState,
  __setQuickPickValues,
  __setSelectedChatModels
} from '../../support/vscode';

function configuration(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key]
  } as never;
}

function createDependencies(overrides?: {
  getApiKey?: () => Promise<string | undefined>;
  listVisionModels?: () => Promise<Array<{ id: string }>>;
  runtimeValues?: Record<string, unknown>;
}) {
  return {
    secrets: {
      get: async () => (overrides?.getApiKey ? overrides.getApiKey() : 'secret')
    } as never,
    routerClient: {
      listVisionModels:
        overrides?.listVisionModels ??
        (async () => [{ id: 'router/vision' }])
    } as never,
    getRuntimeSettings: () =>
      loadRuntimeSettings(
        configuration({
          baseUrl: 'https://router.example.com/v1',
          requestTimeoutMs: 5_000,
          ...(overrides?.runtimeValues ?? {})
        })
      )
  };
}

describe('createVisionProxyConfigurator', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('selects a discovered 9router Vision model and writes model before source', async () => {
    __setQuickPickValues([
      { label: '9router', source: '9router' },
      { label: 'router/vision', modelId: 'router/vision' }
    ]);

    const configure = createVisionProxyConfigurator(createDependencies());

    await expect(configure(__createCancellationToken().value as never)).resolves.toEqual({
      source: '9router',
      modelId: 'router/vision'
    });
    expect(__getConfigurationUpdates().map(({ key }) => key)).toEqual([
      'visionProxyModelId',
      'visionProxySource'
    ]);
  });

  it('selects a native Copilot model by opaque id', async () => {
    __setSelectedChatModels([
      { id: 'copilot/vision', name: 'Vision', family: 'gpt', vendor: 'copilot' }
    ]);
    __setQuickPickValues([
      { label: 'GitHub Copilot', source: 'copilot' },
      { label: 'Vision', modelId: 'copilot/vision' }
    ]);

    const result = await createVisionProxyConfigurator(createDependencies())(
      __createCancellationToken().value as never
    );

    expect(result).toEqual({ source: 'copilot', modelId: 'copilot/vision' });
    expect(__getConfigurationUpdates().map(({ key }) => key)).toEqual([
      'visionProxyModelId',
      'visionProxySource'
    ]);
  });

  it('returns undefined when source selection is cancelled and writes nothing', async () => {
    __setQuickPickValues([undefined]);

    const result = await createVisionProxyConfigurator(createDependencies())(
      __createCancellationToken().value as never
    );

    expect(result).toBeUndefined();
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('returns undefined when model selection is cancelled and writes nothing', async () => {
    __setQuickPickValues([
      { label: '9router', source: '9router' },
      undefined
    ]);

    const result = await createVisionProxyConfigurator(createDependencies())(
      __createCancellationToken().value as never
    );

    expect(result).toBeUndefined();
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('fails when selecting 9router without an API key', async () => {
    __setQuickPickValues([{ label: '9router', source: '9router' }]);

    const configure = createVisionProxyConfigurator(
      createDependencies({ getApiKey: async () => undefined })
    );

    await expect(configure(__createCancellationToken().value as never)).rejects.toMatchObject({
      code: 'AUTHENTICATION_ERROR'
    });
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('fails when 9router returns an empty Vision catalog', async () => {
    __setQuickPickValues([{ label: '9router', source: '9router' }]);

    const configure = createVisionProxyConfigurator(
      createDependencies({
        listVisionModels: async () => []
      })
    );

    await expect(configure(__createCancellationToken().value as never)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR'
    });
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('fails when Copilot model discovery returns no models', async () => {
    __setQuickPickValues([{ label: 'GitHub Copilot', source: 'copilot' }]);
    __setSelectedChatModels([]);

    const configure = createVisionProxyConfigurator(createDependencies());

    await expect(configure(__createCancellationToken().value as never)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR'
    });
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('shares one in-flight setup promise across concurrent calls', async () => {
    __setQuickPickValues([
      { label: '9router', source: '9router' },
      { label: 'router/vision', modelId: 'router/vision' }
    ]);

    let listCalls = 0;
    let release: (() => void) | undefined;
    const blockedCall = new Promise<void>((resolve) => {
      release = resolve;
    });

    const configure = createVisionProxyConfigurator(
      createDependencies({
        listVisionModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision' }];
        }
      })
    );

    const first = configure(__createCancellationToken().value as never);
    const second = configure(__createCancellationToken().value as never);

    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual({ source: '9router', modelId: 'router/vision' });
    expect(secondResult).toEqual({ source: '9router', modelId: 'router/vision' });
    expect(listCalls).toBe(1);
    expect(__getConfigurationUpdates()).toHaveLength(2);
  });

  it('returns promptly for a cancelled first caller while a second caller still completes setup', async () => {
    __setQuickPickValues([
      { label: '9router', source: '9router' },
      { label: 'router/vision', modelId: 'router/vision' }
    ]);

    let listCalls = 0;
    let release: (() => void) | undefined;
    const blockedCall = new Promise<void>((resolve) => {
      release = resolve;
    });

    const configure = createVisionProxyConfigurator(
      createDependencies({
        listVisionModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision' }];
        }
      })
    );

    const firstCaller = __createCancellationToken();
    const secondCaller = __createCancellationToken();
    const first = configure(firstCaller.value as never);
    const second = configure(secondCaller.value as never);

    firstCaller.cancel();

    const timedOut = Symbol('timed-out');
    const firstResult = await Promise.race([
      first,
      new Promise<typeof timedOut>((resolve) => {
        setTimeout(() => {
          resolve(timedOut);
        }, 0);
      })
    ]);

    expect(firstResult).toBeUndefined();

    release?.();

    await expect(second).resolves.toEqual({ source: '9router', modelId: 'router/vision' });
    expect(listCalls).toBe(1);
    expect(__getConfigurationUpdates()).toHaveLength(2);
  });

  it('returns promptly for a cancelled second caller while the first caller still completes setup', async () => {
    __setQuickPickValues([
      { label: '9router', source: '9router' },
      { label: 'router/vision', modelId: 'router/vision' }
    ]);

    let listCalls = 0;
    let release: (() => void) | undefined;
    const blockedCall = new Promise<void>((resolve) => {
      release = resolve;
    });

    const configure = createVisionProxyConfigurator(
      createDependencies({
        listVisionModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision' }];
        }
      })
    );

    const firstCaller = __createCancellationToken();
    const secondCaller = __createCancellationToken();
    const first = configure(firstCaller.value as never);
    const second = configure(secondCaller.value as never);

    secondCaller.cancel();

    const timedOut = Symbol('timed-out');
    const secondResult = await Promise.race([
      second,
      new Promise<typeof timedOut>((resolve) => {
        setTimeout(() => {
          resolve(timedOut);
        }, 0);
      })
    ]);

    expect(secondResult).toBeUndefined();

    release?.();

    await expect(first).resolves.toEqual({ source: '9router', modelId: 'router/vision' });
    expect(listCalls).toBe(1);
    expect(__getConfigurationUpdates()).toHaveLength(2);
  });
});
