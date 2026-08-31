import * as vscode from 'vscode';
import { createNonce, renderWebviewDocument } from './webview-document';

const shells = new Map<string, string>();

function viewRoot(extensionUri: vscode.Uri, view: string): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview', view);
}

export function webviewLocalResourceRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
}

export async function renderWebviewPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: string
): Promise<string> {
  const root = viewRoot(extensionUri, view);

  let shell = shells.get(view);
  if (shell === undefined) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'index.html'));
    shell = new TextDecoder().decode(bytes);
    shells.set(view, shell);
  }

  const sharedRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'shared');

  return renderWebviewDocument({
    shell,
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'client.css')).toString(),
    runtimeScriptUri: webview
      .asWebviewUri(vscode.Uri.joinPath(sharedRoot, 'react.js'))
      .toString(),
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'client.js')).toString(),
    cspSource: webview.cspSource,
    nonce: createNonce()
  });
}

export function __resetWebviewShellCacheForTests(): void {
  shells.clear();
}
