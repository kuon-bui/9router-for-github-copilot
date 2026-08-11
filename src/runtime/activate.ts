import * as vscode from 'vscode';
import {
  buildSettingsSnapshot,
  getExtensionConfiguration,
  loadRuntimeSettings
} from '../config/settings';
import { disposeOutputChannel } from '../debug/output-channel';
import { createRouterClient } from '../router/client';
import { NineRouterInlineCompletionProvider } from '../provider/inline-completion-provider';
import { NineRouterChatProvider } from '../provider/provider';
import { registerCommands } from './commands';
import { createVisionProxyConfigurator } from './vision-configuration';
import { createConnectionTester } from './test-connection';
import type { RouterClient } from '../router/client';
import type { SettingsSnapshot } from '../config/settings';
import type { VisionProxyConfigurator } from './vision-configuration';

let providerRegistration: vscode.Disposable | undefined;
let inlineProviderRegistration: vscode.Disposable | undefined;
let provider: NineRouterChatProvider | undefined;
let inlineProvider: NineRouterInlineCompletionProvider | undefined;

interface ActivationHooks {
  createProvider?: (
    context: Pick<vscode.ExtensionContext, 'secrets'>,
    routerClient: RouterClient,
    snapshot: SettingsSnapshot,
    options: { configureVisionProxy: VisionProxyConfigurator }
  ) => NineRouterChatProvider;
  registerCommands?: typeof registerCommands;
}

export async function activateExtension(
  context: vscode.ExtensionContext,
  hooks: ActivationHooks = {}
): Promise<void> {
  const createProvider =
    hooks.createProvider ??
    ((providerContext, routerClient, snapshot, options) =>
      new NineRouterChatProvider(providerContext, routerClient, snapshot, options));
  const registerRuntimeCommands = hooks.registerCommands ?? registerCommands;
  const initialSnapshot = buildSettingsSnapshot(getExtensionConfiguration());

  const routerClient = createRouterClient({ fetch: globalThis.fetch });
  const configureVisionProxy = createVisionProxyConfigurator({
    secrets: context.secrets,
    routerClient,
    getRuntimeSettings: () => loadRuntimeSettings(getExtensionConfiguration())
  });

  provider = createProvider(
    context,
    routerClient,
    initialSnapshot,
    { configureVisionProxy }
  );
  inlineProvider = new NineRouterInlineCompletionProvider(context, routerClient, initialSnapshot);
  const testConnection = createConnectionTester({
    secrets: context.secrets,
    routerClient,
    getSettingsSnapshot: () => provider?.getSnapshot()
  });
  registerRuntimeCommands(context, {
    getSettingsSnapshot: () => provider?.getSnapshot(),
    configureVisionProxy,
    testConnection
  });
  providerRegistration = vscode.lm.registerLanguageModelChatProvider('9router', provider);
  context.subscriptions.push(providerRegistration);
  inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
    [{ scheme: 'file' }, { scheme: 'untitled' }],
    inlineProvider
  );
  context.subscriptions.push(inlineProviderRegistration);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) =>
      handleConfigurationChange(event, () => {
        const snapshot = buildSettingsSnapshot(getExtensionConfiguration());
        provider?.refreshFromSnapshot(snapshot);
        inlineProvider?.refreshFromSnapshot(snapshot);
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
  inlineProviderRegistration?.dispose();
  inlineProviderRegistration = undefined;
  provider?.dispose();
  provider = undefined;
  inlineProvider = undefined;
  disposeOutputChannel();
}
