import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '../../../src/config/settings';
import { formatSettingsSnapshotDiagnostics } from '../../../src/debug/output-channel';
import { registerCommands } from '../../../src/runtime/commands';
import {
  __createCancellationToken,
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
                if (key === 'models') {
                  return [
                    { id: 'daily', name: 'Daily', modelId: 'combo/daily' },
                    { id: 'agent', name: 'Agent', modelId: '' }
                  ];
                }

                if (key === 'visionProxyModelId') {
                  return 'combo/vision-private';
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
    expect(__getOutputLines().join('\n')).toContain('Rejected models: agent (INVALID_MODEL_MAPPING)');
    expect(__getOutputLines().join('\n')).toContain('"visionProxyConfigured":true');
    expect(__getOutputLines().join('\n')).not.toContain('combo/vision-private');
  });

  it('reports one broken model without hiding unrelated valid models', () => {
    const snapshot = buildSettingsSnapshot({
      get: (key: string) =>
        key === 'models'
          ? [
              { id: 'broken', name: 'Broken', modelId: '' },
              { id: 'coder', name: 'Coder', modelId: 'router/coder' }
            ]
          : undefined
    } as never);

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['coder']);
    expect(formatSettingsSnapshotDiagnostics(snapshot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Published models: coder'),
        expect.stringContaining('INVALID_MODEL_MAPPING')
      ])
    );
  });

  it('invokes the guided Vision configurator command dependency', async () => {
    const subscriptions: { dispose(): void }[] = [];
    const configureVisionProxy = vi.fn(async (_token: unknown) => {
      const cancellation = __createCancellationToken().value;
      expect(_token).toMatchObject({
        isCancellationRequested: cancellation.isCancellationRequested
      });
    });

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
        configureVisionProxy
      }
    );

    const handler = __getCommandHandler('9routerCopilot.configureVisionProxy');
    await handler?.();

    expect(configureVisionProxy).toHaveBeenCalledTimes(1);
  });
});
