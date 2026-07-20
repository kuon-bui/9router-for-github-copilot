import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateExtension, deactivateExtension } from '../../../src/runtime/activate';
import { __resetVscodeState } from '../../support/vscode';
import type { NineRouterChatProvider } from '../../../src/provider/provider';
import type { VisionProxyConfigurator } from '../../../src/runtime/vision-configuration';

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
      subscriptions: []
    } as never;

    let providerConfigurator: VisionProxyConfigurator | undefined;
    let commandConfigurator: VisionProxyConfigurator | undefined;

    const providerStub = {
      getSnapshot: () => undefined,
      refreshFromSnapshot: () => undefined,
      dispose: vi.fn()
    } as unknown as NineRouterChatProvider;

    await activateExtension(context, {
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
});
