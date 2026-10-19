import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateExtension, deactivateExtension } from '@/runtime/activate';
import { Uri, __resetVscodeState } from '@test/support/vscode';
import type { NineRouterChatProvider } from '@/provider/provider';
import type { VisionProxyConfigurator } from '@/runtime/vision-configuration';

describe('activateExtension', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  afterEach(async () => {
    await deactivateExtension();
  });

  it('passes one shared vision configurator to both provider and command wiring', async () => {
    const context = {
      secrets: { get: async () => undefined },
      subscriptions: [],
      extensionUri: Uri.file('/ext')
    } as never;

    let providerConfigurator: VisionProxyConfigurator | undefined;
    let commandConfigurator: VisionProxyConfigurator | undefined;

    const providerStub = {
      getSnapshot: () => undefined,
      refreshFromSnapshot: () => undefined,
      dispose: vi.fn()
    } as unknown as NineRouterChatProvider;

    await activateExtension(context, {
      readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.',
      readDefaultCodexInstructions: async () => 'Default Codex instructions.',
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

  it('activates successfully without reading Codex instructions during activation', async () => {
    const context = {
      secrets: { get: async () => undefined },
      subscriptions: [],
      extensionUri: Uri.file('/ext'),
      extensionPath: '/ext'
    } as never;

    const readInstructionsMock = vi.fn(async () => {
      throw new Error('Should not be called during activation');
    });

    const providerStub = {
      getSnapshot: () => undefined,
      refreshFromSnapshot: () => undefined,
      dispose: vi.fn()
    } as unknown as NineRouterChatProvider;

    await expect(
      activateExtension(context, {
        readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.',
        readDefaultCodexInstructions: readInstructionsMock,
        createProvider: () => providerStub
      })
    ).resolves.toBeUndefined();

    expect(readInstructionsMock).not.toHaveBeenCalled();
  });
});
