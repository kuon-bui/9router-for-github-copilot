import * as vscode from 'vscode';
import { clearApiKey, setApiKey } from '../config/secret-store';
import { showDiagnostics, showSettingsSnapshotDiagnostics } from '../debug/output-channel';
import type { SettingsSnapshot } from '../config/settings';
import type { VisionProxyConfigurator } from './vision-configuration';

interface CommandDependencies {
  getSettingsSnapshot?: () => SettingsSnapshot | undefined;
  configureVisionProxy?: VisionProxyConfigurator;
}

export function registerCommands(
  context: Pick<vscode.ExtensionContext, 'subscriptions' | 'secrets'>,
  dependencies: CommandDependencies = {}
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        password: true,
        prompt: 'Enter 9router API key'
      });

      if (value) {
        await setApiKey(context.secrets, value);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.clearApiKey', async () => {
      await clearApiKey(context.secrets);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.showDiagnostics', async () => {
      const snapshot = dependencies.getSettingsSnapshot?.();
      if (snapshot) {
        showSettingsSnapshotDiagnostics(snapshot);
        return;
      }

      showDiagnostics();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.configureVisionProxy', async () => {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        await dependencies.configureVisionProxy?.(cancellation.token);
      } finally {
        cancellation.dispose();
      }
    })
  );
}
