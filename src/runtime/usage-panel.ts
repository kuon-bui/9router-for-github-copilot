import * as vscode from 'vscode';
import { renderWebviewPanelHtml, webviewLocalResourceRoot } from './webview-assets';
import type { RouterUsageSnapshot } from '@/router/usage';

const USAGE_VIEW_TYPE = '9routerCopilot.usage';
const USAGE_VIEW = 'usage';
const SECTION = '9router-copilot';
const USAGE_COMPACT_KEY = 'usageCompact';

interface UsageSession {
  panel: vscode.WebviewPanel;
  subscription: vscode.Disposable;
  snapshot: RouterUsageSnapshot;
  compact: boolean;
}

let session: UsageSession | undefined;

function readUsageCompact(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>(USAGE_COMPACT_KEY) === true;
}

function postState(current: UsageSession): void {
  void current.panel.webview.postMessage({
    type: 'usage',
    snapshot: current.snapshot,
    nowMs: Date.now(),
    compact: current.compact
  });
}

async function handleMessage(current: UsageSession, message: unknown): Promise<void> {
  if (typeof message !== 'object' || message === null) {
    return;
  }

  const type = (message as { type?: unknown }).type;
  if (type === 'ready') {
    current.compact = readUsageCompact();
    postState(current);
    return;
  }

  if (type !== 'setCompact') {
    return;
  }

  const compact = (message as { compact?: unknown }).compact === true;
  current.compact = compact;
  await vscode.workspace
    .getConfiguration(SECTION)
    .update(USAGE_COMPACT_KEY, compact, vscode.ConfigurationTarget.Global);
  postState(current);
}

export async function showUsagePanel(
  extensionUri: vscode.Uri,
  snapshot: RouterUsageSnapshot,
  options: { viewColumn?: vscode.ViewColumn } = {}
): Promise<void> {
  // VS Code has no free-form HTML modal overlay. A focused editor webview panel is
  // the closest supported surface for the connection-card usage dashboard.
  const viewColumn = options.viewColumn ?? vscode.ViewColumn.Active;

  if (session) {
    session.snapshot = snapshot;
    session.compact = readUsageCompact();
    session.panel.reveal(viewColumn, false);
    // Reload HTML so watch-rebuilt webview assets replace a retained old document.
    session.panel.webview.html = await renderWebviewPanelHtml(
      session.panel.webview,
      extensionUri,
      USAGE_VIEW
    );
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    USAGE_VIEW_TYPE,
    'Usage',
    { viewColumn, preserveFocus: false },
    {
      enableScripts: true,
      enableCommandUris: ['9routerCopilot.showUsage'],
      retainContextWhenHidden: true,
      localResourceRoots: [webviewLocalResourceRoot(extensionUri)]
    }
  );
  panel.webview.html = await renderWebviewPanelHtml(panel.webview, extensionUri, USAGE_VIEW);

  const current: UsageSession = {
    panel,
    snapshot,
    compact: readUsageCompact(),
    subscription: panel.webview.onDidReceiveMessage((message: unknown) => {
      void handleMessage(current, message);
    })
  };
  session = current;

  panel.onDidDispose(() => {
    current.subscription.dispose();
    if (session === current) {
      session = undefined;
    }
  });
}

export function __resetUsagePanelForTests(): void {
  session?.panel.dispose();
  session = undefined;
}
