import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from '@/runtime/commands';
import { NineRouterError } from '@/router/errors';
import {
  __getCommandHandler,
  __getErrorMessages,
  __getInformationMessages,
  __resetVscodeState,
  Uri
} from '@test/support/vscode';

function createContext() {
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: Uri.file('/ext'),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined
    }
  } as never;
}

describe('9routerCopilot.exportCodexConfig', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('registers and invokes the exporter dependency', async () => {
    const exportCodexConfig = vi.fn(async () => ({
      mode: 'profile' as const,
      directory: '/tmp/codex',
      catalogPath: '/tmp/codex/9router-models.json',
      configPath: '/tmp/codex/9router.config.toml',
      warnings: []
    }));

    registerCommands(createContext(), { exportCodexConfig });
    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(exportCodexConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces configuration errors without writing guidance about secrets', async () => {
    registerCommands(createContext(), {
      exportCodexConfig: async () => {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          'No publishable models available to export.'
        );
      }
    });

    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(__getErrorMessages().join('\n')).toContain('No publishable models available to export.');
    expect(__getErrorMessages().join('\n')).not.toMatch(/sk-|api key value/i);
    expect(__getInformationMessages()).toEqual([]);
  });
});
