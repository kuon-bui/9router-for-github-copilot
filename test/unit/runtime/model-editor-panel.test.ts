import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __createCancellationToken,
  __fireConfigurationChange,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues
} from '@test/support/vscode';
import { NineRouterError } from '@/router/errors';
import {
  __resetModelEditorPanelForTests,
  createModelEditorOpener
} from '@/runtime/model-editor-panel';
import type { RouterClient } from '@/router/client';

const runtime = {
  baseUrl: 'http://127.0.0.1:20128/v1',
  requestTimeoutMs: 60_000,
  debugMode: 'minimal' as const,
  visionProxySource: undefined,
  visionProxyModelId: '',
  visionProxyPrompt: 'prompt'
};

function createDependencies(
  overrides: {
    apiKey?: string | undefined;
    listModels?: RouterClient['listModels'];
  } = {}
) {
  const apiKey = 'apiKey' in overrides ? overrides.apiKey : 'test-key';

  return {
    secrets: {
      get: async () => apiKey,
      store: async () => undefined,
      delete: async () => undefined
    } as unknown as Parameters<typeof createModelEditorOpener>[0]['secrets'],
    routerClient: {
      listModels: overrides.listModels ?? (async () => [{ id: 'router/combo' }])
    } as unknown as RouterClient,
    getRuntimeSettings: () => runtime
  };
}

describe('createModelEditorOpener', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetModelEditorPanelForTests();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  afterEach(() => {
    __resetModelEditorPanelForTests();
  });

  it('opens one panel and answers ready with the current state', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);

    const panels = __getWebviewPanelObjects();
    expect(panels).toHaveLength(1);
    expect(panels[0]?.webview.html).toContain('id="model-list"');

    await panels[0]?.webview.receiveMessage({ type: 'ready' });

    expect(panels[0]?.webview.postedMessages).toEqual([
      {
        type: 'state',
        state: {
          models: [],
          catalog: [{ modelId: 'router/combo', vision: false, inUse: false }],
          warnings: []
        }
      }
    ]);
  });

  it('reveals the existing panel instead of creating a second one', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);
    await open(token.value);

    expect(__getWebviewPanelObjects()).toHaveLength(1);
  });

  it('refuses to open without an API key', async () => {
    const open = createModelEditorOpener(createDependencies({ apiKey: undefined }));
    const token = __createCancellationToken();

    await expect(open(token.value)).rejects.toBeInstanceOf(NineRouterError);
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('refuses to open when the catalog request fails', async () => {
    const listModels = vi.fn(async () => {
      throw new NineRouterError('UPSTREAM_UNAVAILABLE', 'catalog down');
    }) as unknown as RouterClient['listModels'];
    const open = createModelEditorOpener(createDependencies({ listModels }));
    const token = __createCancellationToken();

    await expect(open(token.value)).rejects.toThrow('catalog down');
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('pushes fresh state when configuration changes', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();
    await open(token.value);
    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });

    __setConfigurationValues({
      models: [{ id: 'agent', name: 'Agent', modelId: 'router/combo' }]
    });
    __fireConfigurationChange('9router-copilot.models');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const last = panel?.webview.postedMessages.at(-1) as { state: { models: unknown[] } };
    expect(last.state.models).toHaveLength(1);
  });
});
