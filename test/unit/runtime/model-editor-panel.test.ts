import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __createCancellationToken,
  __fireConfigurationChange,
  __getConfigurationUpdates,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues,
  __setWarningResponse
} from '@test/support/vscode';
import { Uri } from '@test/support/vscode';
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
    extensionUri: Uri.file('/ext'),
    getRuntimeSettings: () => runtime
  };
}

function readMessageTypes(
  panel: ReturnType<typeof __getWebviewPanelObjects>[number] | undefined
): unknown[] {
  return (panel?.webview.postedMessages ?? []).map(
    (message) => (message as { type?: unknown }).type
  );
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
    expect(panels[0]?.webview.html).toContain('id="root"');
    expect(panels[0]?.webview.html).toContain('ui.css');
    expect(panels[0]?.webview.html).toContain('preact.js');
    expect(panels[0]?.webview.html).toContain('client.js');

    await panels[0]?.webview.receiveMessage({ type: 'ready' });

    expect(panels[0]?.webview.postedMessages).toEqual([
      expect.objectContaining({
        type: 'state',
        state: expect.objectContaining({
          models: [],
          catalog: [{ modelId: 'router/combo', vision: false, inUse: false }],
          warnings: []
        })
      })
    ]);
  });

  it('opens with the shipped default timeout of zero, which disables timeouts', async () => {
    const open = createModelEditorOpener({
      ...createDependencies(),
      getRuntimeSettings: () => ({ ...runtime, requestTimeoutMs: 0 })
    });
    const token = __createCancellationToken();

    await open(token.value);

    expect(__getWebviewPanelObjects()).toHaveLength(1);
  });

  it('reveals the existing panel instead of creating a second one', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);
    await open(token.value);

    expect(__getWebviewPanelObjects()).toHaveLength(1);
  });

  it('asks a fresh panel for the add form once the first state has landed', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value, { initialView: 'form' });

    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });

    expect(readMessageTypes(panel)).toEqual(['state', 'showForm']);
  });

  it('asks an already open panel for the add form', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);
    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });

    await open(token.value, { initialView: 'form' });

    expect(readMessageTypes(panel)).toEqual(['state', 'state', 'showForm']);
  });

  it('leaves the panel on the list view without an initial view', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);
    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });
    await open(token.value);

    expect(readMessageTypes(panel)).toEqual(['state', 'state']);
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

const draft = {
  id: 'agent',
  name: 'Agent',
  modelId: 'router/combo',
  toolMode: 'auto',
  visionMode: 'off',
  thinkingMode: 'off',
  thinkingEfforts: [],
  maxInputTokens: 264_000,
  maxOutputTokens: 264_000
};

async function openPanel() {
  const open = createModelEditorOpener(createDependencies());
  const token = __createCancellationToken();
  await open(token.value);
  const panel = __getWebviewPanelObjects()[0];
  if (!panel) {
    throw new Error('panel was not created');
  }
  return panel;
}

describe('model editor mutations', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetModelEditorPanelForTests();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  afterEach(() => {
    __resetModelEditorPanelForTests();
  });

  it('appends a validated draft', async () => {
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: null, draft });

    expect(__getConfigurationUpdates()).toEqual([
      { key: 'models', value: [draft], target: 1 }
    ]);
  });

  it('overwrites the entry at a given index', async () => {
    __setConfigurationValues({ models: [{ id: 'old', name: 'Old', modelId: 'router/combo' }] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: 0, draft });

    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([draft]);
  });

  it('rejects an invalid draft without writing settings', async () => {
    const panel = await openPanel();

    await panel.webview.receiveMessage({
      type: 'saveModel',
      sourceIndex: null,
      draft: { ...draft, id: 'Bad Id' }
    });

    expect(__getConfigurationUpdates()).toEqual([]);
    expect(panel.webview.postedMessages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('rejects a duplicate id against the other entries', async () => {
    __setConfigurationValues({ models: [draft] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: null, draft });

    expect(__getConfigurationUpdates()).toEqual([]);
    expect(panel.webview.postedMessages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('deletes only after a modal confirmation', async () => {
    __setConfigurationValues({ models: [draft] });
    __setWarningResponse(undefined);
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'removeModel', sourceIndex: 0 });
    expect(__getConfigurationUpdates()).toEqual([]);

    __setWarningResponse('Delete');
    await panel.webview.receiveMessage({ type: 'removeModel', sourceIndex: 0 });
    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([]);
  });

  it('moves an entry within the list', async () => {
    const second = { ...draft, id: 'second' };
    __setConfigurationValues({ models: [draft, second] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'moveModel', sourceIndex: 1, direction: 'up' });

    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([second, draft]);
  });

  it('ignores out-of-range indexes', async () => {
    __setConfigurationValues({ models: [draft] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'moveModel', sourceIndex: 9, direction: 'up' });
    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: 9, draft });

    expect(__getConfigurationUpdates()).toEqual([]);
  });
});
