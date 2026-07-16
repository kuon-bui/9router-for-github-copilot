import { beforeEach, describe, expect, it } from 'vitest';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { registerCommands } from '../../../src/runtime/commands';
import {
  __getCommandHandler,
  __getOutputLines,
  __resetVscodeState
} from '../../support/vscode';

describe('9routerCopilot.showDiagnostics', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('prints the current validated snapshot to the output channel', async () => {
    const subscriptions: { dispose(): void }[] = [];

    registerCommands(
      {
        subscriptions,
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      {
        getSettingsSnapshot: () =>
          buildSettingsSnapshot(
            {
              get: (key: string) => {
                if (key === 'displayModels') {
                  return ['daily', 'agent'];
                }

                if (key === 'modelMappings.daily') {
                  return 'combo/daily';
                }

                if (key === 'modelMappings.agent') {
                  return '';
                }

                return undefined;
              }
            } as never
          )
      }
    );

    const handler = __getCommandHandler('9routerCopilot.showDiagnostics');
    await handler?.();

    expect(__getOutputLines().join('\n')).toContain('Snapshot state: degraded');
    expect(__getOutputLines().join('\n')).toContain('Rejected models: agent (INVALID_COMBO_MAPPING)');
  });
});
