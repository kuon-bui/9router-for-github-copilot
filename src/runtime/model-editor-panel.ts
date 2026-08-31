import * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';
import { isUsableRuntimeSettings } from '@/config/settings';
import { NineRouterError } from '@/router/errors';
import { createAbortSignalFromToken } from '@/provider/cancellation';
import { toSettingsEntry, validateDraft } from '@/config/model-draft';
import {
  addModelEntry,
  moveModelEntry,
  readModelEntries,
  removeModelEntry,
  updateModelEntry
} from '@/config/model-entry-edits';
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

function readEntryId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return undefined;
  }

  const { id } = entry as { id?: unknown };
  return typeof id === 'string' ? id : undefined;
}

function isInRange(
  entries: readonly unknown[],
  sourceIndex: unknown
): sourceIndex is number {
  return (
    typeof sourceIndex === 'number' &&
    Number.isSafeInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < entries.length
  );
}

async function writeEntries(current: PanelSession, entries: unknown[]): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update(MODELS_KEY, entries, vscode.ConfigurationTarget.Global);
  } catch {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to update ${SECTION}.${MODELS_KEY}.`,
      { details: { phase: 'model-editor', settingsKey: `${SECTION}.${MODELS_KEY}` } }
    );
  }

  await postState(current);
}

async function postError(current: PanelSession, message: string): Promise<void> {
  await current.panel.webview.postMessage({ type: 'error', message });
}

async function handleSaveModel(
  message: { sourceIndex?: unknown; draft?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  const rawIndex = message.sourceIndex;
  const isEdit = rawIndex !== null && rawIndex !== undefined;
  if (isEdit && !isInRange(entries, rawIndex)) {
    await postError(current, 'That model no longer exists. Reopen the panel and try again.');
    return;
  }

  const editIndex = isEdit ? (rawIndex as number) : undefined;
  const takenIds = entries
    .map((entry, index) => (index === editIndex ? undefined : readEntryId(entry)))
    .filter((id): id is string => id !== undefined);
  const validation = validateDraft(message.draft, { takenIds });
  if (!validation.draft) {
    await postError(current, validation.errors.map((error) => error.message).join(' '));
    return;
  }

  const entry = toSettingsEntry(validation.draft);
  await writeEntries(
    current,
    editIndex === undefined
      ? addModelEntry(entries, entry)
      : updateModelEntry(entries, editIndex, entry)
  );
}

async function handleRemoveModel(
  message: { sourceIndex?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  const sourceIndex = message.sourceIndex;
  if (!isInRange(entries, sourceIndex)) {
    return;
  }

  const label = readEntryId(entries[sourceIndex]) ?? 'this model';
  const confirmation = await vscode.window.showWarningMessage(
    `Delete ${label} from the Copilot model picker?`,
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  await writeEntries(current, removeModelEntry(entries, sourceIndex));
}

async function handleMoveModel(
  message: { sourceIndex?: unknown; direction?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  const sourceIndex = message.sourceIndex;
  const direction =
    message.direction === 'up' || message.direction === 'down'
      ? message.direction
      : undefined;
  if (direction === undefined || !isInRange(entries, sourceIndex)) {
    return;
  }

  const next = moveModelEntry(entries, sourceIndex, direction);
  if (next.every((entry, index) => entry === entries[index])) {
    return;
  }

  await writeEntries(current, next);
}

async function handleMessage(
  message: unknown,
  current: PanelSession,
  dependencies: Dependencies
): Promise<void> {
  if (typeof message !== 'object' || message === null) {
    return;
  }

  const payload = message as {
    type?: unknown;
    sourceIndex?: unknown;
    direction?: unknown;
    draft?: unknown;
  };

  try {
    if (payload.type === 'ready') {
      await postState(current);
      return;
    }
    if (payload.type === 'saveModel') {
      await handleSaveModel(payload, current);
      return;
    }
    if (payload.type === 'removeModel') {
      await handleRemoveModel(payload, current);
      return;
    }
    if (payload.type === 'moveModel') {
      await handleMoveModel(payload, current);
      return;
    }
    if (payload.type === 'refreshCatalog') {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        current.catalog = await fetchCatalog(dependencies, cancellation.token);
        await postState(current);
      } finally {
        cancellation.dispose();
      }
    }
  } catch (error) {
    const failure =
      error instanceof NineRouterError ? error.message : 'Unexpected model editor error';
    await postError(current, failure);
  }
}

export function __resetModelEditorPanelForTests(): void {
  session?.panel.dispose();
  session = undefined;
}
