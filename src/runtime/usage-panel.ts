import * as vscode from 'vscode';
import { renderWebviewPanelHtml, webviewLocalResourceRoot } from './webview-assets';
import type { RouterUsageSnapshot } from '@/router/usage';

const USAGE_VIEW_TYPE = '9routerCopilot.usage';
const USAGE_VIEW = 'usage';

interface UsageSession {
  panel: vscode.WebviewPanel;
  subscription: vscode.Disposable;
  snapshot: RouterUsageSnapshot;
}

let session: UsageSession | undefined;

function postState(current: UsageSession): void {
  void current.panel.webview.postMessage({
    type: 'usage',
    snapshot: current.snapshot,
    nowMs: Date.now()
  });
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
    session.panel.reveal(viewColumn, false);
    postState(session);
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
    subscription: panel.webview.onDidReceiveMessage((message: unknown) => {
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'ready') {
        postState(current);
      }
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
