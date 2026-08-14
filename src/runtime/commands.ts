import * as vscode from 'vscode';
import { clearApiKey, setApiKey } from '@/config/secret-store';
import { showDiagnostics, showSettingsSnapshotDiagnostics } from '@/debug/output-channel';
import { NineRouterError } from '@/router/errors';
import type { SettingsSnapshot } from '@/config/settings';
import type { VisionProxyConfigurator } from './vision-configuration';
import type { ConnectionTester } from './test-connection';

interface CommandDependencies {
  getSettingsSnapshot?: () => SettingsSnapshot | undefined;
  configureVisionProxy?: VisionProxyConfigurator;
  testConnection?: ConnectionTester;
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
    vscode.commands.registerCommand('9routerCopilot.testConnection', async () => {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        const result = await dependencies.testConnection?.(cancellation.token);
        if (!result) {
          return;
        }

        const mapping =
          result.configuredModelCount === 0
            ? 'No configured models.'
            : `${result.matchedModelCount}/${result.configuredModelCount} configured model mappings found.`;
        const missing =
          result.missingDisplayModelIds.length > 0
            ? ` Missing: ${result.missingDisplayModelIds.join(', ')}.`
            : '';
        await vscode.window.showInformationMessage(
          `9router connection succeeded in ${result.durationMs} ms. ${result.modelCount} models available. ${mapping}${missing}`
        );
      } catch (error) {
        const requestId = error instanceof NineRouterError ? error.requestId : undefined;
        const message =
          error instanceof NineRouterError ? error.message : 'Unexpected connection error';
        await vscode.window.showErrorMessage(
          `9router connection failed: ${message}${requestId ? ` Request ID: ${requestId}.` : ''}`
        );
      } finally {
        cancellation.dispose();
      }
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
