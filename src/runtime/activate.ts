import * as vscode from 'vscode';
import { buildSettingsSnapshot, getExtensionConfiguration } from '../config/settings';
import { disposeOutputChannel } from '../debug/output-channel';
import { createRouterClient } from '../router/client';
import { NineRouterChatProvider } from '../provider/provider';
import { registerCommands } from './commands';

let providerRegistration: vscode.Disposable | undefined;
let provider: NineRouterChatProvider | undefined;

export async function activateExtension(context: vscode.ExtensionContext): Promise<void> {
  provider = new NineRouterChatProvider(
    context,
    createRouterClient({ fetch: globalThis.fetch }),
    buildSettingsSnapshot(getExtensionConfiguration())
  );
  registerCommands(context, {
    getSettingsSnapshot: () => provider?.getSnapshot()
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
