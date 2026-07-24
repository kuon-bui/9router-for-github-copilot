import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { loadRuntimeSettings } from '../../../src/config/settings';
import { NineRouterError } from '../../../src/router/errors';
import { createVisionProxyConfigurator } from '../../../src/runtime/vision-configuration';
import {
  __createCancellationToken,
  __getConfigurationUpdates,
  __resetVscodeState,
  __setQuickPickValues,
  __setSelectedChatModels
} from '../../support/vscode';

const defaultSelectChatModels = vscode.lm.selectChatModels;

function setSelectChatModels(fn: typeof vscode.lm.selectChatModels): void {
  (
    vscode.lm as unknown as {
      selectChatModels: typeof vscode.lm.selectChatModels;
    }
  ).selectChatModels = fn;
}

async function expectMappedSafeError(
  promise: Promise<unknown>,
  expectedCode: NineRouterError['code'],
  forbiddenValues: readonly string[]
): Promise<void> {
  const failure = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(NineRouterError);

  const error = failure as NineRouterError;
  expect(error.code).toBe(expectedCode);
  expect(error.details).toMatchObject({
    phase: 'vision-configuration',
    source: 'copilot'
  });

  const exposed = JSON.stringify({
    message: error.message,
    requestId: error.requestId,
    details: error.details
  });

  for (const forbidden of forbiddenValues) {
    expect(exposed).not.toContain(forbidden);
  }
}

function configuration(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key]
  } as never;
}

function createDependencies(overrides?: {
  getApiKey?: () => Promise<string | undefined>;
  listModels?: () => Promise<Array<{ id: string; vision?: true }>>;
  runtimeValues?: Record<string, unknown>;
}) {
  return {
    secrets: {
      get: async () => (overrides?.getApiKey ? overrides.getApiKey() : 'secret')
    } as never,
    routerClient: {
      listModels:
        overrides?.listModels ??
        (async () => [{ id: 'router/vision', vision: true as const }])
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
    setSelectChatModels(defaultSelectChatModels);
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
        listModels: async () => []
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

  it.each([
    {
      languageModelError: 'NoPermissions',
      expectedCode: 'AUTHENTICATION_ERROR',
      createError: (message: string) => vscode.LanguageModelError.NoPermissions(message)
    },
    {
      languageModelError: 'NotFound',
      expectedCode: 'CONFIGURATION_ERROR',
      createError: (message: string) => vscode.LanguageModelError.NotFound(message)
    },
    {
      languageModelError: 'Blocked',
      expectedCode: 'UPSTREAM_UNAVAILABLE',
      createError: (message: string) => vscode.LanguageModelError.Blocked(message)
    }
  ] as const)(
    'maps selectChatModels %s to a safe NineRouterError without raw cause leakage',
    async ({ expectedCode, createError }) => {
      const promptSecret = 'prompt-secret';
      const rawCauseSecret = 'raw-cause-secret';
      const sourceSecret = 'source-secret';
      const imageSecret = 'data:image/png;base64,YQ==';

      __setQuickPickValues([{ label: 'GitHub Copilot', source: 'copilot' }]);
      setSelectChatModels(async () => {
        throw Object.assign(createError(`${rawCauseSecret} ${promptSecret}`), {
          cause: {
            source: sourceSecret,
            image: imageSecret
          }
        });
      });

      const configure = createVisionProxyConfigurator(createDependencies());
      await expectMappedSafeError(
        configure(__createCancellationToken().value as never),
        expectedCode,
        [promptSecret, rawCauseSecret, sourceSecret, imageSecret]
      );
      expect(__getConfigurationUpdates()).toEqual([]);
    }
  );

  it('maps selectChatModels cancellation to CANCELLATION_ERROR without leaking raw details', async () => {
    const promptSecret = 'prompt-secret';
    const rawCauseSecret = 'raw-cause-secret';
    const sourceSecret = 'source-secret';

    __setQuickPickValues([{ label: 'GitHub Copilot', source: 'copilot' }]);
    setSelectChatModels(async () => {
      const failure = new Error(`${rawCauseSecret} ${promptSecret}`);
      failure.name = 'AbortError';

      throw Object.assign(failure, {
        cause: {
          source: sourceSecret
        }
      });
    });

    const configure = createVisionProxyConfigurator(createDependencies());
    await expectMappedSafeError(
      configure(__createCancellationToken().value as never),
      'CANCELLATION_ERROR',
      [promptSecret, rawCauseSecret, sourceSecret]
    );
    expect(__getConfigurationUpdates()).toEqual([]);
  });

  it('maps unknown selectChatModels errors to UPSTREAM_UNAVAILABLE without leaking raw details', async () => {
    const promptSecret = 'prompt-secret';
    const rawCauseSecret = 'raw-cause-secret';
    const sourceSecret = 'source-secret';
    const summarySecret = 'summary-secret';

    __setQuickPickValues([{ label: 'GitHub Copilot', source: 'copilot' }]);
    setSelectChatModels(async () => {
      const failure = new Error(rawCauseSecret);

      throw Object.assign(failure, {
        cause: {
          prompt: promptSecret,
          source: sourceSecret,
          summary: summarySecret
        }
      });
    });

    const configure = createVisionProxyConfigurator(createDependencies());
    await expectMappedSafeError(
      configure(__createCancellationToken().value as never),
      'UPSTREAM_UNAVAILABLE',
      [promptSecret, rawCauseSecret, sourceSecret, summarySecret]
    );
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
        listModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision', vision: true as const }];
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
        listModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision', vision: true as const }];
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
        listModels: async () => {
          listCalls += 1;
          await blockedCall;
          return [{ id: 'router/vision', vision: true as const }];
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
