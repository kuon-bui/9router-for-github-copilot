import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import { formatSettingsSnapshotDiagnostics } from '@/debug/output-channel';
import { NineRouterError } from '@/router/errors';
import { registerCommands } from '@/runtime/commands';
import { __resetUsagePanelForTests } from '@/runtime/usage-panel';
import {
  __createCancellationToken,
  __getErrorMessages,
  __getCommandHandler,
  __getInformationMessages,
  __getOutputLines,
  __getWebviewPanels,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __getConfigurationUpdates,
  __setConfigurationValues,
  __setQuickPickValues,
  ConfigurationTarget,
  Uri
} from '@test/support/vscode';

describe('9routerCopilot.showDiagnostics', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetUsagePanelForTests();
  });

  it('prints the current validated snapshot to the output channel', async () => {
    const subscriptions: { dispose(): void }[] = [];

    registerCommands(
      {
        subscriptions,
        extensionUri: Uri.file('/ext'),
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
        extensionUri: Uri.file('/ext'),
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
        extensionUri: Uri.file('/ext'),
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
        extensionUri: Uri.file('/ext'),
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

  it('opens a connection-card usage webview panel without a notification', async () => {
    const showUsage = vi.fn(async () => ({
      count: 2,
      lastSweepAt: '2026-08-29T02:15:29.747Z',
      entries: [
        {
          connectionId: 'conn-1',
          provider: 'codex',
          name: 'test@gmail.com',
          authType: 'oauth',
          status: 'ok',
          plan: 'plus',
          quotas: {
            session: {
              used: 95,
              total: 100,
              remaining: 5,
              resetAt: '2026-08-29T05:50:05.000Z',
              unlimited: false
            }
          },
          message: null,
          fetchedAt: '2026-08-29T02:15:28.016Z',
          stale: false
        }
      ]
    }));

    registerCommands(
      {
        subscriptions: [],
        extensionUri: Uri.file('/ext'),
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      { showUsage }
    );

    await __getCommandHandler('9routerCopilot.showUsage')?.();

    expect(showUsage).toHaveBeenCalledTimes(1);
    const panels = __getWebviewPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      viewType: '9routerCopilot.usage',
      title: 'Usage',
      showOptions: {
        viewColumn: -1,
        preserveFocus: false
      }
    });
    expect(panels[0]?.html).toContain('id="root"');
    expect(panels[0]?.html).toContain('vscode-webview://mock/ext/dist/webview/shared/react.js');
    expect(panels[0]?.html).toContain('vscode-webview://mock/ext/dist/webview/usage/client.js');
    const panel = __getWebviewPanelObjects()[0];
    expect(panel).toBeDefined();
    await panel?.webview.receiveMessage({ type: 'ready' });
    expect(panel?.webview.postedMessages).toEqual([
      expect.objectContaining({
        type: 'usage',
        snapshot: expect.objectContaining({ count: 2 }),
        nowMs: expect.any(Number)
      })
    ]);
    await __getCommandHandler('9routerCopilot.showUsage')?.();
    expect(__getWebviewPanels()).toHaveLength(1);
    expect(panel?.lastReveal).toEqual({ viewColumn: -1, preserveFocus: false });
    expect(panel?.webview.postedMessages).toHaveLength(2);
    expect(__getInformationMessages()).toEqual([]);
    expect(__getErrorMessages()).toEqual([]);
  });

  it('reports safe usage errors with request ids', async () => {
    registerCommands(
      {
        subscriptions: [],
        extensionUri: Uri.file('/ext'),
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      {
        showUsage: async () => {
          throw new NineRouterError('TRANSPORT_ERROR', '9router request failed with status 500', {
            requestId: 'req-usage'
          });
        }
      }
    );

    await __getCommandHandler('9routerCopilot.showUsage')?.();

    expect(__getErrorMessages()).toEqual([
      '9router usage failed: 9router request failed with status 500 Request ID: req-usage.'
    ]);
    expect(__getInformationMessages()).toEqual([]);
  });

  it('enables fast tier for the selected model', async () => {
    const models = [
      { id: 'daily', name: 'Daily', modelId: 'combo/daily' },
      { id: 'agent', name: 'Agent', modelId: 'combo/agent' }
    ];
    __setConfigurationValues({ models });
    __setQuickPickValues([
      {
        label: 'Agent',
        description: 'agent',
        detail: 'Router default tier',
        sourceIndex: 1,
        enabled: false
      }
    ]);

    registerCommands(
      {
        subscriptions: [],
        extensionUri: Uri.file('/ext'),
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      {
        getSettingsSnapshot: () =>
          buildSettingsSnapshot({ get: (key: string) => (key === 'models' ? models : undefined) } as never)
      }
    );

    await __getCommandHandler('9routerCopilot.toggleModelFastTier')?.();

    expect(__getConfigurationUpdates()).toEqual([
      {
        key: 'models',
        value: [
          { id: 'daily', name: 'Daily', modelId: 'combo/daily' },
          { id: 'agent', name: 'Agent', modelId: 'combo/agent', serviceTier: 'fast' }
        ],
        target: ConfigurationTarget.Global
      }
    ]);
  });

  it('disables fast tier for the selected model', async () => {
    const models = [{ id: 'agent', name: 'Agent', modelId: 'combo/agent', serviceTier: 'fast' }];
    __setConfigurationValues({ models });
    __setQuickPickValues([
      {
        label: 'Agent',
        description: 'agent',
        detail: 'Fast tier enabled',
        sourceIndex: 0,
        enabled: true
      }
    ]);

    registerCommands(
      {
        subscriptions: [],
        extensionUri: Uri.file('/ext'),
        secrets: {
          get: async () => undefined,
          store: async () => undefined,
          delete: async () => undefined
        }
      } as never,
      {
        getSettingsSnapshot: () =>
          buildSettingsSnapshot({ get: (key: string) => (key === 'models' ? models : undefined) } as never)
      }
    );

    await __getCommandHandler('9routerCopilot.toggleModelFastTier')?.();

    expect(__getConfigurationUpdates()).toEqual([
      {
        key: 'models',
        value: [{ id: 'agent', name: 'Agent', modelId: 'combo/agent' }],
        target: ConfigurationTarget.Global
      }
    ]);
  });
});
