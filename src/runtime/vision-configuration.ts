import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { NineRouterError } from '../router/errors';
import { createAbortSignalFromToken } from '../provider/cancellation';
import type { RuntimeSettings, VisionProxySource } from '../config/settings';
import type { RouterClient } from '../router/client';

export interface VisionProxySelection {
  source: VisionProxySource;
  modelId: string;
}

export type VisionProxyConfigurator = (
  token: vscode.CancellationToken
) => Promise<VisionProxySelection | undefined>;

interface Dependencies {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getRuntimeSettings: () => RuntimeSettings;
}

interface SourceQuickPickItem extends vscode.QuickPickItem {
  source: VisionProxySource;
}

interface ModelQuickPickItem extends vscode.QuickPickItem {
  modelId: string;
}

interface CopilotModelOption {
  id: string;
  name: string;
  family?: string;
}

export function createVisionProxyConfigurator(
  dependencies: Dependencies
): VisionProxyConfigurator {
  let inFlight: Promise<VisionProxySelection | undefined> | undefined;

  return async (token: vscode.CancellationToken): Promise<VisionProxySelection | undefined> => {
    if (!inFlight) {
      inFlight = runConfiguration(dependencies, token).finally(() => {
        inFlight = undefined;
      });
    }

    return inFlight;
  };
}

async function runConfiguration(
  dependencies: Dependencies,
  token: vscode.CancellationToken
): Promise<VisionProxySelection | undefined> {
  if (token.isCancellationRequested) {
    return undefined;
  }

  const sourceSelection = await pickSource();
  if (!sourceSelection) {
    return undefined;
  }

  const modelSelection =
    sourceSelection.source === '9router'
      ? await pickNineRouterModel(dependencies, token)
      : await pickCopilotModel(token);

  if (!modelSelection) {
    return undefined;
  }

  if (token.isCancellationRequested) {
    return undefined;
  }

  const settings = vscode.workspace.getConfiguration('9router-copilot');

  await updateSetting(settings, 'visionProxyModelId', modelSelection.modelId);
  await updateSetting(settings, 'visionProxySource', sourceSelection.source);

  return {
    source: sourceSelection.source,
    modelId: modelSelection.modelId
  };
}

async function pickSource(): Promise<SourceQuickPickItem | undefined> {
  return vscode.window.showQuickPick<SourceQuickPickItem>(
    [
      { label: '9router', source: '9router' },
      { label: 'GitHub Copilot', source: 'copilot' }
    ],
    {
      title: '9router: Configure Vision Proxy',
      placeHolder: 'Select the source used for Vision proxy summaries'
    }
  );
}

async function pickNineRouterModel(
  dependencies: Dependencies,
  token: vscode.CancellationToken
): Promise<ModelQuickPickItem | undefined> {
  const apiKey = await getApiKey(dependencies.secrets);
  if (!apiKey) {
    throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
  }

  const runtime = dependencies.getRuntimeSettings();
  if (!isValidRuntime(runtime)) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      '9router runtime settings are invalid. Check diagnostics for details.'
    );
  }

  const requestCancellation = createAbortSignalFromToken(token);

  try {
    const models = await dependencies.routerClient.listVisionModels({
      baseUrl: runtime.baseUrl,
      apiKey,
      timeoutMs: runtime.requestTimeoutMs,
      signal: requestCancellation.signal
    });

    if (token.isCancellationRequested) {
      return undefined;
    }

    const options = toNineRouterModelOptions(models);
    if (options.length === 0) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'No Vision-capable 9router models are available for selection.',
        {
          details: {
            phase: 'vision-configuration',
            source: '9router'
          }
        }
      );
    }

    return vscode.window.showQuickPick<ModelQuickPickItem>(options, {
      title: '9router: Configure Vision Proxy',
      placeHolder: 'Select a Vision-capable 9router model'
    });
  } catch (error) {
    if (error instanceof NineRouterError && error.code === 'CANCELLATION_ERROR') {
      return undefined;
    }

    throw error;
  } finally {
    requestCancellation.cleanup();
  }
}

async function pickCopilotModel(
  token: vscode.CancellationToken
): Promise<ModelQuickPickItem | undefined> {
  const discovered = await vscode.lm.selectChatModels({ vendor: 'copilot' });

  if (token.isCancellationRequested) {
    return undefined;
  }

  const options = toCopilotModelOptions(discovered);
  if (options.length === 0) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      'No GitHub Copilot models are available for Vision proxy selection.',
      {
        details: {
          phase: 'vision-configuration',
          source: 'copilot'
        }
      }
    );
  }

  return vscode.window.showQuickPick<ModelQuickPickItem>(options, {
    title: '9router: Configure Vision Proxy',
    placeHolder: 'Select a GitHub Copilot model'
  });
}

function toNineRouterModelOptions(models: Array<{ id: string }>): ModelQuickPickItem[] {
  const ids = new Set<string>();

  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0) {
      continue;
    }

    ids.add(id);
  }

  return [...ids].sort((left, right) => left.localeCompare(right)).map((id) => ({
    label: id,
    modelId: id
  }));
}

function toCopilotModelOptions(models: readonly vscode.LanguageModelChat[]): ModelQuickPickItem[] {
  const byId = new Map<string, CopilotModelOption>();

  for (const model of models) {
    const id = model.id.trim();
    if (id.length === 0 || byId.has(id)) {
      continue;
    }

    const name = model.name.trim();
    const family = model.family.trim();

    byId.set(id, {
      id,
      name: name.length > 0 ? name : id,
      ...(family.length > 0 ? { family } : {})
    });
  }

  return [...byId.values()]
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) {
        return byName;
      }

      return left.id.localeCompare(right.id);
    })
    .map((model) => ({
      label: model.name,
      modelId: model.id,
      ...(model.family ? { description: model.family } : {}),
      detail: model.id
    }));
}

async function updateSetting(
  settings: vscode.WorkspaceConfiguration,
  key: 'visionProxyModelId' | 'visionProxySource',
  value: string
): Promise<void> {
  try {
    await settings.update(key, value, vscode.ConfigurationTarget.Global);
  } catch {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to update 9router-copilot.${key}.`,
      {
        details: {
          phase: 'vision-configuration',
          settingsKey: `9router-copilot.${key}`
        }
      }
    );
  }
}

function isValidRuntime(runtime: RuntimeSettings): boolean {
  if (!Number.isFinite(runtime.requestTimeoutMs) || runtime.requestTimeoutMs <= 0) {
    return false;
  }

  try {
    const url = new URL(runtime.baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
