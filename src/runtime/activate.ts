import * as vscode from 'vscode';
import {
  buildSettingsSnapshot,
  getExtensionConfiguration,
  loadRuntimeSettings
} from '../config/settings';
import { disposeOutputChannel } from '../debug/output-channel';
import { createRouterClient } from '../router/client';
import { NineRouterChatProvider } from '../provider/provider';
import { registerCommands } from './commands';
import { createVisionProxyConfigurator } from './vision-configuration';

let providerRegistration: vscode.Disposable | undefined;
let provider: NineRouterChatProvider | undefined;

export async function activateExtension(context: vscode.ExtensionContext): Promise<void> {
  const routerClient = createRouterClient({ fetch: globalThis.fetch });
  const configureVisionProxy = createVisionProxyConfigurator({
    secrets: context.secrets,
    routerClient,
    getRuntimeSettings: () => loadRuntimeSettings(getExtensionConfiguration())
  });

  provider = new NineRouterChatProvider(
    context,
    routerClient,
    buildSettingsSnapshot(getExtensionConfiguration()),
    { configureVisionProxy }
  );
  registerCommands(context, {
    getSettingsSnapshot: () => provider?.getSnapshot(),
    configureVisionProxy
  });
  providerRegistration = vscode.lm.registerLanguageModelChatProvider('9router', provider);
  context.subscriptions.push(providerRegistration);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) =>
      handleConfigurationChange(event, () => {
        provider?.refreshFromSnapshot(buildSettingsSnapshot(getExtensionConfiguration()));
      })
    )
  );

  const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
  await copilotChatExtension?.activate();
}

export function handleConfigurationChange(
  event: Pick<vscode.ConfigurationChangeEvent, 'affectsConfiguration'>,
  refresh: () => void
): void {
  if (event.affectsConfiguration('9router-copilot')) {
    refresh();
  }
}

export async function deactivateExtension(): Promise<void> {
  providerRegistration?.dispose();
  providerRegistration = undefined;
  provider?.dispose();
  provider = undefined;
  disposeOutputChannel();
}
