import * as vscode from 'vscode';
import { clearApiKey, setApiKey } from '@/config/secret-store';
import { showDiagnostics, showSettingsSnapshotDiagnostics } from '@/debug/output-channel';
import { NineRouterError } from '@/router/errors';
import { showUsagePanel } from './usage-panel';
import type { SettingsSnapshot } from '@/config/settings';
import type { VisionProxyConfigurator } from './vision-configuration';
import type { ConnectionTester } from './test-connection';
import type { UsageReporter } from './show-usage';

interface FastTierQuickPickItem extends vscode.QuickPickItem {
  sourceIndex: number;
  enabled: boolean;
}

interface CommandDependencies {
  getSettingsSnapshot?: () => SettingsSnapshot | undefined;
  configureVisionProxy?: VisionProxyConfigurator;
  testConnection?: ConnectionTester;
  showUsage?: UsageReporter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    vscode.commands.registerCommand('9routerCopilot.showUsage', async () => {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        const snapshot = await dependencies.showUsage?.(cancellation.token);
        if (!snapshot) {
          return;
        }

        showUsagePanel(snapshot);
      } catch (error) {
        const requestId = error instanceof NineRouterError ? error.requestId : undefined;
        const message =
          error instanceof NineRouterError ? error.message : 'Unexpected usage error';
        await vscode.window.showErrorMessage(
          `9router usage failed: ${message}${requestId ? ` Request ID: ${requestId}.` : ''}`
        );
      } finally {
        cancellation.dispose();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.toggleModelFastTier', async () => {
      const models = dependencies.getSettingsSnapshot?.()?.models ?? [];
      if (models.length === 0) {
        await vscode.window.showErrorMessage('9router fast-tier update failed: no valid models found.');
        return;
      }

      const selection = await vscode.window.showQuickPick<FastTierQuickPickItem>(
        models.map((model) => ({
          label: model.name,
          description: model.id,
          detail: model.serviceTier === 'fast' ? 'Fast tier enabled' : 'Router default tier',
          sourceIndex: model.sourceIndex,
          enabled: model.serviceTier === 'fast'
        })),
        {
          title: '9router: Toggle Model Fast Tier',
          placeHolder: 'Select a model to toggle fast tier'
        }
      );
      if (!selection) {
        return;
      }

      const settings = vscode.workspace.getConfiguration('9router-copilot');
      const configuredModels = settings.get<unknown>('models');
      if (!Array.isArray(configuredModels) || !isRecord(configuredModels[selection.sourceIndex])) {
        await vscode.window.showErrorMessage(
          '9router fast-tier update failed: selected model configuration is invalid.'
        );
        return;
      }

      const configuredModel = configuredModels[selection.sourceIndex];
      const updatedModels = [...configuredModels];
      if (selection.enabled) {
        const modelWithoutFastTier = { ...configuredModel };
        delete modelWithoutFastTier.serviceTier;
        updatedModels[selection.sourceIndex] = modelWithoutFastTier;
      } else {
        updatedModels[selection.sourceIndex] = { ...configuredModel, serviceTier: 'fast' };
      }

      await settings.update('models', updatedModels, vscode.ConfigurationTarget.Global);
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
