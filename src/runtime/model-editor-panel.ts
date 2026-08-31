import * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';
import { isUsableRuntimeSettings } from '@/config/settings';
import { NineRouterError } from '@/router/errors';
import { createAbortSignalFromToken } from '@/provider/cancellation';
import { createModelEditorState } from './model-editor-view';
import { createNonce, renderModelEditorHtml } from './model-editor-html';
import type { RuntimeSettings } from '@/config/settings';
import type { RouterClient } from '@/router/client';
import type { RouterModelMetadata } from '@/router/model-catalog';

const MODEL_EDITOR_VIEW_TYPE = '9routerCopilot.models';
const SECTION = '9router-copilot';
const MODELS_KEY = 'models';

export type ModelEditorOpener = (token: vscode.CancellationToken) => Promise<void>;

interface Dependencies {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getRuntimeSettings: () => RuntimeSettings;
}

interface PanelSession {
  panel: vscode.WebviewPanel;
  catalog: readonly RouterModelMetadata[];
  subscriptions: vscode.Disposable[];
}

let session: PanelSession | undefined;

async function fetchCatalog(
  dependencies: Dependencies,
  token: vscode.CancellationToken
): Promise<RouterModelMetadata[]> {
  const apiKey = await getApiKey(dependencies.secrets);
  if (!apiKey) {
    throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
  }

  const runtime = dependencies.getRuntimeSettings();
  if (!isUsableRuntimeSettings(runtime)) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      '9router runtime settings are invalid. Check diagnostics for details.'
    );
  }

  const cancellation = createAbortSignalFromToken(token);
  try {
    return await dependencies.routerClient.listModels({
      baseUrl: runtime.baseUrl,
      apiKey,
      timeoutMs: runtime.requestTimeoutMs,
      signal: cancellation.signal
    });
  } finally {
    cancellation.cleanup();
  }
}

// The merged `get()` value can come from the workspace scope. Editing it would make a
// workspace list the base of a user-scope write, so the panel only ever reads its own scope.
function readGlobalEntries(): unknown {
  const inspection = vscode.workspace
    .getConfiguration(SECTION)
    .inspect<unknown>(MODELS_KEY);
  return inspection?.globalValue ?? inspection?.defaultValue ?? [];
}

function hasWorkspaceOverride(): boolean {
  return (
    vscode.workspace.getConfiguration(SECTION).inspect<unknown>(MODELS_KEY)
      ?.workspaceValue !== undefined
  );
}

async function postState(current: PanelSession): Promise<void> {
  await current.panel.webview.postMessage({
    type: 'state',
    state: createModelEditorState({
      entries: readGlobalEntries(),
      catalog: current.catalog,
      ...(hasWorkspaceOverride() ? { workspaceOverride: true } : {})
    })
  });
}

export function createModelEditorOpener(dependencies: Dependencies): ModelEditorOpener {
  return async (token) => {
    const catalog = await fetchCatalog(dependencies, token);

    if (session) {
      session.catalog = catalog;
      session.panel.reveal(vscode.ViewColumn.Active, false);
      await postState(session);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MODEL_EDITOR_VIEW_TYPE,
      '9router Models',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );
    panel.webview.html = renderModelEditorHtml(createNonce());

    const current: PanelSession = { panel, catalog, subscriptions: [] };
    session = current;

    current.subscriptions.push(
      // Return the promise rather than discarding it so callers can await the dispatch.
      panel.webview.onDidReceiveMessage((message: unknown) =>
        handleMessage(message, current, dependencies)
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.${MODELS_KEY}`)) {
          void postState(current);
        }
      })
    );

    panel.onDidDispose(() => {
      for (const subscription of current.subscriptions) {
        subscription.dispose();
      }
      current.subscriptions.length = 0;
      if (session === current) {
        session = undefined;
      }
    });
  };
}

async function handleMessage(
  message: unknown,
  current: PanelSession,
  dependencies: Dependencies
): Promise<void> {
  void dependencies;
  if (typeof message !== 'object' || message === null) {
    return;
  }

  const { type } = message as { type?: unknown };
  if (type === 'ready') {
    await postState(current);
  }
}

export function __resetModelEditorPanelForTests(): void {
  session?.panel.dispose();
  session = undefined;
}
