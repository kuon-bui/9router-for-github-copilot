import * as vscode from 'vscode';
import {
  buildSettingsSnapshot,
  getExtensionConfiguration,
  loadRuntimeSettings
} from '@/config/settings';
import { readDefaultVisionProxyPrompt } from '@/config/vision-proxy-prompt';
import { disposeOutputChannel } from '@/debug/output-channel';
import { createRouterClient } from '@/router/client';
import { NineRouterChatProvider } from '@/provider/provider';
import { registerCommands } from './commands';
import { registerUsageChatParticipant } from './chat-participant';
import { createVisionProxyConfigurator } from './vision-configuration';
import { createModelEditorOpener } from './model-editor-panel';
import { createConnectionTester } from './test-connection';
import { createUsageReporter } from './show-usage';
import type { RouterClient } from '@/router/client';
import type { SettingsSnapshot } from '@/config/settings';
import type { VisionProxyConfigurator } from './vision-configuration';

let providerRegistration: vscode.Disposable | undefined;
let provider: NineRouterChatProvider | undefined;

interface ActivationHooks {
  createProvider?: (
    context: Pick<vscode.ExtensionContext, 'secrets'>,
    routerClient: RouterClient,
    snapshot: SettingsSnapshot,
    options: {
      configureVisionProxy: VisionProxyConfigurator;
      defaultVisionProxyPrompt: string;
    }
  ) => NineRouterChatProvider;
  registerCommands?: typeof registerCommands;
  readDefaultVisionProxyPrompt?: typeof readDefaultVisionProxyPrompt;
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
  const defaultVisionProxyPrompt = await (
    hooks.readDefaultVisionProxyPrompt ?? readDefaultVisionProxyPrompt
  )(context.extensionPath);

  const routerClient = createRouterClient({ fetch: globalThis.fetch });
  const configureVisionProxy = createVisionProxyConfigurator({
    secrets: context.secrets,
    routerClient,
    getRuntimeSettings: () =>
      loadRuntimeSettings(getExtensionConfiguration(), defaultVisionProxyPrompt)
  });

  const manageModels = createModelEditorOpener({
    secrets: context.secrets,
    routerClient,
    extensionUri: context.extensionUri,
    getRuntimeSettings: () =>
      loadRuntimeSettings(getExtensionConfiguration(), defaultVisionProxyPrompt)
  });

  provider = createProvider(
    context,
    routerClient,
    buildSettingsSnapshot(getExtensionConfiguration(), defaultVisionProxyPrompt),
    { configureVisionProxy, defaultVisionProxyPrompt }
  );
  const testConnection = createConnectionTester({
    secrets: context.secrets,
    routerClient,
    getSettingsSnapshot: () => provider?.getSnapshot()
  });
  const showUsage = createUsageReporter({
    secrets: context.secrets,
    routerClient,
    getSettingsSnapshot: () => provider?.getSnapshot()
  });
  registerRuntimeCommands(context, {
    getSettingsSnapshot: () => provider?.getSnapshot(),
    configureVisionProxy,
    manageModels,
    testConnection,
    showUsage
  });
  registerUsageChatParticipant(context, { showUsage });
  providerRegistration = vscode.lm.registerLanguageModelChatProvider('9router', provider);
  context.subscriptions.push(providerRegistration);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) =>
      handleConfigurationChange(event, () => {
        provider?.refreshFromSnapshot(
          buildSettingsSnapshot(getExtensionConfiguration(), defaultVisionProxyPrompt)
        );
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
