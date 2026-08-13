import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import { formatSettingsSnapshotDiagnostics } from '@/debug/output-channel';
import { NineRouterError } from '@/router/errors';
import { registerCommands } from '@/runtime/commands';
import {
  __createCancellationToken,
  __getErrorMessages,
  __getCommandHandler,
  __getInformationMessages,
  __getOutputLines,
  __resetVscodeState
} from '@test/support/vscode';

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
                  return 'copilot/private-model-id';
                }

                if (key === 'visionProxySource') {
                  return 'copilot';
                }

                if (key === 'visionProxyPrompt') {
                  return 'private custom prompt';
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
    const output = __getOutputLines().join('\n');
    expect(output).toContain('"visionProxySource":"copilot"');
    expect(output).toContain('"visionProxyConfigured":true');
    expect(output).not.toContain('copilot/private-model-id');
    expect(output).not.toContain('private custom prompt');
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
      return undefined;
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

  it('reports successful connection details and missing mappings', async () => {
    const testConnection = vi.fn(async () => ({
      durationMs: 42,
      modelCount: 7,
      configuredModelCount: 2,
      matchedModelCount: 1,
      missingDisplayModelIds: ['coder']
    }));

    registerCommands(
      {
        subscriptions: [],
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      { testConnection }
    );

    await __getCommandHandler('9routerCopilot.testConnection')?.();

    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(__getInformationMessages()).toEqual([
      '9router connection succeeded in 42 ms. 7 models available. 1/2 configured model mappings found. Missing: coder.'
    ]);
    expect(__getErrorMessages()).toEqual([]);
  });

  it('reports safe connection errors with request ids', async () => {
    registerCommands(
      {
        subscriptions: [],
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      {
        testConnection: async () => {
          throw new NineRouterError('AUTHENTICATION_ERROR', '9router authentication failed', {
            requestId: 'req-safe'
          });
        }
      }
    );

    await __getCommandHandler('9routerCopilot.testConnection')?.();

    expect(__getErrorMessages()).toEqual([
      '9router connection failed: 9router authentication failed Request ID: req-safe.'
    ]);
    expect(__getInformationMessages()).toEqual([]);
  });
});
