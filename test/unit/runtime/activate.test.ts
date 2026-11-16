import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateExtension, deactivateExtension } from '@/runtime/activate';
import {
  EventEmitter,
  Uri,
  __getOutputLines,
  __getRegisteredProvider,
  __resetVscodeState,
  __setExtension
} from '@test/support/vscode';
import type { NineRouterChatProvider } from '@/provider/provider';
import type { VisionProxyConfigurator } from '@/runtime/vision-configuration';

interface ContextOverrides {
  apiKey?: string | undefined;
}

function createContext(overrides: ContextOverrides = {}) {
  const secretChanges = new EventEmitter<{ key: string }>();
  const globalStateValues = new Map<string, unknown>();
  const apiKey = 'apiKey' in overrides ? overrides.apiKey : 'sk-secret';
  const context = {
    secrets: {
      get: async () => apiKey,
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

  return { context: context as never, secretChanges, globalStateValues };
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
