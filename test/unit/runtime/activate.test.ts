import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateExtension, deactivateExtension } from '@/runtime/activate';
import { SETTINGS_REFRESH_DELAY_MS } from '@/runtime/settings-refresh';
import {
  EventEmitter,
  Uri,
  __fireConfigurationChange,
  __getExecutedCommands,
  __getInformationMessages,
  __getOutputLines,
  __getRegisteredProvider,
  __getWarningMessages,
  __resetVscodeState,
  __setConfigurationValues,
  __setExtension,
  __setWarningResponse
} from '@test/support/vscode';
import { WELCOME_SHOWN_KEY } from '@/runtime/welcome';
import type { NineRouterChatProvider } from '@/provider/provider';
import type { VisionProxyConfigurator } from '@/runtime/vision-configuration';

const coderModel = { id: 'coder', name: 'Coder', modelId: 'router/coder' };

interface ContextOverrides {
  apiKey?: string | undefined;
  secretReadError?: Error;
}

function createContext(overrides: ContextOverrides = {}) {
  const secretChanges = new EventEmitter<{ key: string }>();
  const globalStateValues = new Map<string, unknown>();
  const state = { apiKey: 'apiKey' in overrides ? overrides.apiKey : 'sk-secret' };
  const context = {
    secrets: {
      get: async () => {
        if (overrides.secretReadError) {
          throw overrides.secretReadError;
        }
        return state.apiKey;
      },
      store: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      onDidChange: secretChanges.event
    },
    globalState: {
      get: (key: string) => globalStateValues.get(key),
      update: async (key: string, value: unknown) => {
        globalStateValues.set(key, value);
      }
    },
    subscriptions: [] as { dispose(): void }[],
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext'
  };

  const setApiKey = (value: string | undefined): void => {
    state.apiKey = value;
    secretChanges.fire({ key: '9router.apiKey' });
  };

  return { context: context as never, secretChanges, globalStateValues, setApiKey };
}

function createProviderStub() {
  return {
    getSnapshot: () => undefined,
    refreshFromSnapshot: vi.fn(),
    dispose: vi.fn()
  } as unknown as NineRouterChatProvider & { refreshFromSnapshot: ReturnType<typeof vi.fn> };
}

describe('activateExtension', () => {
  let providerStub: ReturnType<typeof createProviderStub>;
  const hooks = () => ({
    readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.',
    createProvider: () => providerStub
  });

  beforeEach(() => {
    __resetVscodeState();
    providerStub = createProviderStub();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await deactivateExtension();
  });

  it('passes one shared vision configurator to both provider and command wiring', async () => {
    let providerConfigurator: VisionProxyConfigurator | undefined;
    let commandConfigurator: VisionProxyConfigurator | undefined;

    await activateExtension(createContext().context, {
      readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.',
      createProvider: (_context, _routerClient, _snapshot, options) => {
        providerConfigurator = options.configureVisionProxy;
        return providerStub;
      },
      registerCommands: (_context, dependencies) => {
        commandConfigurator = dependencies.configureVisionProxy;
      }
    });

    expect(providerConfigurator).toBeTypeOf('function');
    expect(commandConfigurator).toBe(providerConfigurator);
  });

  it('completes activation when Copilot Chat is not installed', async () => {
    await activateExtension(createContext().context, hooks());

    expect(__getRegisteredProvider()).toBe(providerStub);
  });

  it('keeps the provider registered when Copilot Chat activation rejects', async () => {
    __setExtension('GitHub.copilot-chat', {
      activate: () => Promise.reject(new Error('copilot boom'))
    });

    await activateExtension(createContext().context, hooks());

    expect(__getRegisteredProvider()).toBe(providerStub);
    await vi.waitFor(() =>
      expect(__getOutputLines().join('\n')).toContain('GitHub Copilot Chat activation failed')
    );
    expect(__getOutputLines().join('\n')).toContain('copilot boom');
  });

  it('does not wait for Copilot Chat activation to settle', async () => {
    __setExtension('GitHub.copilot-chat', {
      activate: () => new Promise<void>(() => undefined)
    });

    await expect(
      activateExtension(createContext().context, hooks())
    ).resolves.toBeUndefined();
  });

  it('republishes once after a burst of model setting changes', async () => {
    vi.useFakeTimers();
    await activateExtension(createContext().context, hooks());

    __fireConfigurationChange('9router-copilot.models');
    __fireConfigurationChange('9router-copilot.models');
    __fireConfigurationChange('9router-copilot.usageCompact');
    vi.advanceTimersByTime(SETTINGS_REFRESH_DELAY_MS);

    expect(providerStub.refreshFromSnapshot).toHaveBeenCalledTimes(1);
  });

  it('republishes immediately when the API key changes', async () => {
    const { context, secretChanges } = createContext();
    await activateExtension(context, hooks());

    secretChanges.fire({ key: '9router.apiKey' });
    expect(providerStub.refreshFromSnapshot).toHaveBeenCalledTimes(1);

    secretChanges.fire({ key: 'other.secret' });
    expect(providerStub.refreshFromSnapshot).toHaveBeenCalledTimes(1);
  });

  it('logs one activation summary without secrets', async () => {
    __setConfigurationValues({ models: [coderModel] });

    await activateExtension(createContext().context, hooks());

    const summaries = __getOutputLines().filter((line) =>
      line.startsWith('9router extension activated')
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('"snapshotState":"valid"');
    expect(summaries[0]).toContain('"publishedModelCount":1');
    expect(summaries[0]).toContain('"apiKeyConfigured":true');
    expect(__getOutputLines().join('\n')).not.toContain('sk-secret');
  });

  it('warns about invalid runtime settings at activation and opens diagnostics', async () => {
    __setConfigurationValues({ baseUrl: 'not-a-url' });

    await activateExtension(createContext().context, hooks());

    expect(__getWarningMessages()).toEqual([
      '9router settings are invalid (9router-copilot.baseUrl). All 9router models are hidden from the Copilot Chat model picker.'
    ]);
    await vi.waitFor(() =>
      expect(__getExecutedCommands()).toContain('9routerCopilot.showDiagnostics')
    );
  });

  it('does not warn at activation without an API key', async () => {
    __setConfigurationValues({ baseUrl: 'not-a-url' });

    await activateExtension(createContext({ apiKey: undefined }).context, hooks());

    expect(__getWarningMessages()).toEqual([]);
  });

  it('warns once when a settings change hides a model', async () => {
    vi.useFakeTimers();
    __setConfigurationValues({ models: [coderModel] });
    await activateExtension(createContext().context, hooks());

    for (let attempt = 0; attempt < 2; attempt += 1) {
      __setConfigurationValues({ models: [coderModel, { id: 'bad', name: '', modelId: 'router/bad' }] });
      __fireConfigurationChange('9router-copilot.models');
      vi.advanceTimersByTime(SETTINGS_REFRESH_DELAY_MS);
    }

    expect(__getWarningMessages()).toEqual([
      '9router hid 1 model entry with invalid settings from the Copilot Chat model picker.'
    ]);
  });

  it('greets a fresh install without a settings warning', async () => {
    const { context, globalStateValues } = createContext({ apiKey: undefined });

    await activateExtension(context, hooks());

    await vi.waitFor(() =>
      expect(__getInformationMessages()).toEqual([
        'Connect 9router to use its models in GitHub Copilot Chat.'
      ])
    );
    expect(__getWarningMessages()).toEqual([]);
    expect(globalStateValues.get(WELCOME_SHOWN_KEY)).toBe(true);
  });

  it('opens Manage Models from the hidden-models warning', async () => {
    __setWarningResponse('Manage Models');
    __setConfigurationValues({
      models: [coderModel, { id: 'bad', name: '', modelId: 'router/bad' }]
    });

    await activateExtension(createContext().context, hooks());

    await vi.waitFor(() =>
      expect(__getExecutedCommands()).toEqual(['9routerCopilot.manageModels'])
    );
  });

  it('warns about broken settings once the first API key is saved', async () => {
    __setConfigurationValues({ baseUrl: 'not-a-url' });
    const { context, setApiKey } = createContext({ apiKey: undefined });
    await activateExtension(context, hooks());
    expect(__getWarningMessages()).toEqual([]);

    setApiKey('sk-secret');

    await vi.waitFor(() =>
      expect(__getWarningMessages()).toEqual([
        '9router settings are invalid (9router-copilot.baseUrl). All 9router models are hidden from the Copilot Chat model picker.'
      ])
    );
  });

  it('does not warn when the API key is cleared', async () => {
    __setConfigurationValues({ baseUrl: 'not-a-url' });
    const { context, setApiKey } = createContext({ apiKey: undefined });
    await activateExtension(context, hooks());

    setApiKey(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(providerStub.refreshFromSnapshot).toHaveBeenCalledTimes(1);
    expect(__getWarningMessages()).toEqual([]);
  });

  it('completes activation when the API key cannot be read', async () => {
    const { context } = createContext({ secretReadError: new Error('keyring locked') });

    await expect(activateExtension(context, hooks())).resolves.toBeUndefined();

    expect(__getRegisteredProvider()).toBe(providerStub);
    expect(
      __getOutputLines().some(
        (line) =>
          line.startsWith('9router extension activated') && line.includes('"apiKeyConfigured":false')
      )
    ).toBe(true);
  });

  it('redacts bearer tokens in logged failure reasons', async () => {
    __setExtension('GitHub.copilot-chat', {
      activate: () => Promise.reject(new Error('proxy rejected Bearer sk-live-123 header'))
    });

    await activateExtension(createContext().context, hooks());

    await vi.waitFor(() =>
      expect(__getOutputLines().join('\n')).toContain('Bearer [REDACTED]')
    );
    expect(__getOutputLines().join('\n')).not.toContain('sk-live-123');
  });

  it('registers the provider with an empty Vision prompt when the bundled prompt is unreadable', async () => {
    let receivedPrompt: string | undefined;

    await activateExtension(createContext().context, {
      readDefaultVisionProxyPrompt: async () => {
        throw new Error('Unable to read default Vision proxy prompt: /ext/prompts/vision/x.md');
      },
      createProvider: (_context, _routerClient, _snapshot, options) => {
        receivedPrompt = options.defaultVisionProxyPrompt;
        return providerStub;
      }
    });

    expect(receivedPrompt).toBe('');
    expect(__getRegisteredProvider()).toBe(providerStub);
    expect(__getOutputLines().join('\n')).toContain(
      '9router default Vision proxy prompt unavailable'
    );
  });
});
