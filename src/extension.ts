import type * as vscode from 'vscode';
import { activateExtension, deactivateExtension } from './runtime/activate';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateExtension(context);
}

export async function deactivate(): Promise<void> {
  await deactivateExtension();
}
