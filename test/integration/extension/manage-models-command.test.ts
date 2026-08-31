import { beforeEach, describe, expect, it } from 'vitest';
import {
  __getCommandHandler,
  __getErrorMessages,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues
} from '@test/support/vscode';
import { NineRouterError } from '@/router/errors';
import { registerCommands } from '@/runtime/commands';

function createContext() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    secrets: {
      get: async () => 'test-key',
      store: async () => undefined,
      delete: async () => undefined
    }
  } as unknown as Parameters<typeof registerCommands>[0];
}

describe('9routerCopilot.manageModels', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  it('runs the opener', async () => {
    let opened = 0;
    registerCommands(createContext(), {
      manageModels: async () => {
        opened += 1;
      }
    });

    await __getCommandHandler('9routerCopilot.manageModels')?.();

    expect(opened).toBe(1);
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('surfaces opener failures as error messages', async () => {
    registerCommands(createContext(), {
      manageModels: async () => {
        throw new NineRouterError(
          'AUTHENTICATION_ERROR',
          '9router API key is not configured'
        );
      }
    });

    await __getCommandHandler('9routerCopilot.manageModels')?.();

    expect(__getErrorMessages().at(-1)).toContain('9router API key is not configured');
  });
});

describe('9routerCopilot.addModel', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  it('runs the opener straight into the form view', async () => {
    const requests: unknown[] = [];
    registerCommands(createContext(), {
      manageModels: async (_token, options) => {
        requests.push(options);
      }
    });

    await __getCommandHandler('9routerCopilot.addModel')?.();

    expect(requests).toEqual([{ initialView: 'form' }]);
  });

  it('surfaces opener failures as error messages', async () => {
    registerCommands(createContext(), {
      manageModels: async () => {
        throw new NineRouterError('UPSTREAM_UNAVAILABLE', 'catalog down');
      }
    });

    await __getCommandHandler('9routerCopilot.addModel')?.();

    expect(__getErrorMessages().at(-1)).toContain('catalog down');
  });
});
