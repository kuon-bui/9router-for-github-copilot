import * as vscode from 'vscode';
import {
  buildSettingsSnapshot,
  getExtensionConfiguration,
  loadRuntimeSettings
} from '@/config/settings';
import { getApiKey, isApiKeyChange } from '@/config/secret-store';
import { readDefaultVisionProxyPrompt } from '@/config/vision-proxy-prompt';
import { disposeOutputChannel, logDebugEvent } from '@/debug/output-channel';
import { createRouterClient } from '@/router/client';
import { NineRouterChatProvider } from '@/provider/provider';
import { registerCommands } from './commands';
import { registerUsageChatParticipant } from './chat-participant';
import { createVisionProxyConfigurator } from './vision-configuration';
import { createModelEditorOpener } from './model-editor-panel';
import { createConnectionTester } from './test-connection';
import { createUsageReporter } from './show-usage';
import {
  SETTINGS_REFRESH_DELAY_MS,
  affectsProviderSnapshot,
  createCoalescedRefresh
} from './settings-refresh';
import { createSnapshotHealthReporter } from './snapshot-health';
import { showWelcomeIfNeeded } from './welcome';
import type { SnapshotHealthNotice } from './snapshot-health';
import type { RouterClient } from '@/router/client';
import type { RuntimeSettings, SettingsSnapshot } from '@/config/settings';
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
  const activationStartedAt = Date.now();
  const createProvider =
    hooks.createProvider ??
    ((providerContext, routerClient, snapshot, options) =>
      new NineRouterChatProvider(providerContext, routerClient, snapshot, options));
  const registerRuntimeCommands = hooks.registerCommands ?? registerCommands;
  const defaultVisionProxyPrompt = await loadDefaultVisionPrompt(
    hooks.readDefaultVisionProxyPrompt ?? readDefaultVisionProxyPrompt,
    context.extensionPath
  );
  const getRuntimeSettings = (): RuntimeSettings =>
    loadRuntimeSettings(getExtensionConfiguration(), defaultVisionProxyPrompt);
  const buildSnapshot = (): SettingsSnapshot =>
    buildSettingsSnapshot(getExtensionConfiguration(), defaultVisionProxyPrompt);

  const routerClient = createRouterClient({ fetch: globalThis.fetch });
  const configureVisionProxy = createVisionProxyConfigurator({
    secrets: context.secrets,
    routerClient,
    getRuntimeSettings
  });

  const manageModels = createModelEditorOpener({
    secrets: context.secrets,
    routerClient,
    extensionUri: context.extensionUri,
    getRuntimeSettings
  });

  const initialSnapshot = buildSnapshot();
  provider = createProvider(context, routerClient, initialSnapshot, {
    configureVisionProxy,
    defaultVisionProxyPrompt
  });
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

  const healthReporter = createSnapshotHealthReporter(showSnapshotHealthNotice);
  const settingsRefresh = createCoalescedRefresh(() => {
    const snapshot = buildSnapshot();
    provider?.refreshFromSnapshot(snapshot);
    healthReporter.report(snapshot);
  }, SETTINGS_REFRESH_DELAY_MS);
  context.subscriptions.push(
    settingsRefresh,
    vscode.workspace.onDidChangeConfiguration((event) =>
      handleConfigurationChange(event, () => settingsRefresh.schedule())
    ),
    // Fires for set, change, and clear, including from another window. A new snapshot version
    // makes the provider refetch catalog metadata with the current key.
    context.secrets.onDidChange((event) => {
      if (isApiKeyChange(event)) {
        provider?.refreshFromSnapshot(buildSnapshot());
      }
    })
  );

  // A fresh install has no key yet; the first-run guidance speaks for it instead of a warning.
  const apiKeyConfigured = (await getApiKey(context.secrets)) !== undefined;
  if (apiKeyConfigured) {
    healthReporter.report(initialSnapshot);
  }

  activateCopilotChat();
  showWelcomeIfNeeded(context).catch((error: unknown) => {
    logDebugEvent(
      'minimal',
      '9router welcome message failed',
      { reason: describeFailure(error) },
      'minimal'
    );
  });

  logDebugEvent(
    initialSnapshot.runtime?.debugMode ?? 'minimal',
    '9router extension activated',
    {
      snapshotState: initialSnapshot.state,
      publishedModelCount: initialSnapshot.publishedModels.length,
      rejectedModelCount: initialSnapshot.rejectedModels.length,
      issueCount: initialSnapshot.issues.length,
      apiKeyConfigured,
      durationMs: Date.now() - activationStartedAt
    },
    'minimal'
  );
}

const HEALTH_NOTICE_ACTIONS: Readonly<Record<string, string>> = {
  'Show Diagnostics': '9routerCopilot.showDiagnostics',
  'Manage Models': '9routerCopilot.manageModels'
};

function showSnapshotHealthNotice(notice: SnapshotHealthNotice): void {
  void vscode.window
    .showWarningMessage(notice.message, ...Object.keys(HEALTH_NOTICE_ACTIONS))
    .then((choice) => {
      const command = choice ? HEALTH_NOTICE_ACTIONS[choice] : undefined;
      return command ? vscode.commands.executeCommand(command) : undefined;
    });
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Text chat must keep working without the bundled prompt; an empty prompt already means
// "proxy Vision unavailable" to the snapshot, so the failure only needs to be visible.
async function loadDefaultVisionPrompt(
  read: typeof readDefaultVisionProxyPrompt,
  extensionPath: string
): Promise<string> {
  try {
    return await read(extensionPath);
  } catch (error) {
    logDebugEvent(
      'minimal',
      '9router default Vision proxy prompt unavailable',
      { reason: describeFailure(error) },
      'minimal'
    );
    return '';
  }
}

// Not awaited: under lazy activation Copilot Chat may be the one activating us, and waiting on
// it from inside that chain could deadlock. A failure there must not fail our activation.
function activateCopilotChat(): void {
  const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
  copilotChatExtension?.activate().then(undefined, (error: unknown) => {
    logDebugEvent(
      'minimal',
      'GitHub Copilot Chat activation failed',
      { reason: describeFailure(error) },
      'minimal'
    );
  });
}

export function handleConfigurationChange(
  event: Pick<vscode.ConfigurationChangeEvent, 'affectsConfiguration'>,
  refresh: () => void
): void {
  if (affectsProviderSnapshot(event)) {
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
