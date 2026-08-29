import * as vscode from 'vscode';
import { formatUsageHtml } from './usage-html';
import type { RouterUsageSnapshot } from '@/router/usage';

const USAGE_VIEW_TYPE = '9routerCopilot.usage';

let usagePanel: vscode.WebviewPanel | undefined;

export function showUsagePanel(
  snapshot: RouterUsageSnapshot,
  options: { viewColumn?: vscode.ViewColumn } = {}
): void {
  // VS Code has no free-form HTML modal overlay. A focused editor webview panel is
  // the closest supported surface for the connection-card usage dashboard.
  const viewColumn = options.viewColumn ?? vscode.ViewColumn.Active;

  if (usagePanel) {
    usagePanel.reveal(viewColumn, false);
  } else {
    usagePanel = vscode.window.createWebviewPanel(
      USAGE_VIEW_TYPE,
      'Usage',
      { viewColumn, preserveFocus: false },
      {
        enableScripts: false,
        enableCommandUris: ['9routerCopilot.showUsage'],
        retainContextWhenHidden: true
      }
    );
    usagePanel.onDidDispose(() => {
      usagePanel = undefined;
    });
  }

  usagePanel.webview.html = formatUsageHtml(snapshot);
}

export function __resetUsagePanelForTests(): void {
  usagePanel?.dispose();
  usagePanel = undefined;
}
