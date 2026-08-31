import * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';
import { isUsableRuntimeSettings } from '@/config/settings';
import { NineRouterError } from '@/router/errors';
import { toVisionModels } from '@/router/model-catalog';
import { createAbortSignalFromToken } from '@/provider/cancellation';
import type { RuntimeSettings, VisionProxySource } from '@/config/settings';
import type { RouterClient } from '@/router/client';

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

interface InFlightConfiguration {
  promise: Promise<VisionProxySelection | undefined>;
  cancellation: vscode.CancellationTokenSource;
  waiters: number;
}

export function createVisionProxyConfigurator(
  dependencies: Dependencies
): VisionProxyConfigurator {
  let inFlight: InFlightConfiguration | undefined;

  return async (token: vscode.CancellationToken): Promise<VisionProxySelection | undefined> => {
    if (!inFlight) {
      const cancellation = new vscode.CancellationTokenSource();
      const operation: InFlightConfiguration = {
        waiters: 0,
        cancellation,
        promise: runConfiguration(dependencies, cancellation.token).finally(() => {
          cancellation.dispose();
          if (inFlight === operation) {
            inFlight = undefined;
          }
        })
      };

      inFlight = operation;
    }

    const operation = inFlight;
    operation.waiters += 1;

    try {
      return await waitForCaller(operation.promise, token);
    } finally {
      operation.waiters -= 1;

      if (operation.waiters === 0 && inFlight === operation) {
        operation.cancellation.cancel();
      }
    }
  };
}

function waitForCaller(
  promise: Promise<VisionProxySelection | undefined>,
  token: vscode.CancellationToken
): Promise<VisionProxySelection | undefined> {
  if (token.isCancellationRequested) {
    return Promise.resolve(undefined);
  }

  return new Promise<VisionProxySelection | undefined>((resolve, reject) => {
    let settled = false;
    const subscription = token.onCancellationRequested(() => {
      if (settled) {
        return;
      }

      settled = true;
      subscription.dispose();
      resolve(undefined);
    });

    promise.then(
      (result) => {
        if (settled) {
          return;
        }

        settled = true;
        subscription.dispose();
        resolve(result);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        subscription.dispose();
        reject(error);
      }
    );
  });
}

async function runConfiguration(
  dependencies: Dependencies,
  token: vscode.CancellationToken
): Promise<VisionProxySelection | undefined> {
  if (token.isCancellationRequested) {
    return undefined;
  }

  const sourceSelection = await pickSource(token);
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

async function pickSource(
  token: vscode.CancellationToken
): Promise<SourceQuickPickItem | undefined> {
  return vscode.window.showQuickPick<SourceQuickPickItem>(
    [
      { label: '9router', source: '9router' },
      { label: 'GitHub Copilot', source: 'copilot' }
    ],
    {
      title: '9router: Configure Vision Proxy',
      placeHolder: 'Select the source used for Vision proxy summaries'
    },
    token
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
  if (!isUsableRuntimeSettings(runtime)) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      '9router runtime settings are invalid. Check diagnostics for details.'
    );
  }

  const requestCancellation = createAbortSignalFromToken(token);

  try {
    const models = toVisionModels(
      await dependencies.routerClient.listModels({
        baseUrl: runtime.baseUrl,
        apiKey,
        timeoutMs: runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      })
    );

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

    return vscode.window.showQuickPick<ModelQuickPickItem>(
      options,
      {
        title: '9router: Configure Vision Proxy',
        placeHolder: 'Select a Vision-capable 9router model'
      },
      token
    );
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
  if (token.isCancellationRequested) {
    return undefined;
  }

  let discovered: readonly vscode.LanguageModelChat[];

  try {
    discovered = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  } catch (error) {
    throw mapCopilotDiscoveryError(error, token);
  }

  if (token.isCancellationRequested) {
    throw createCopilotDiscoveryCancellationError();
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

  return vscode.window.showQuickPick<ModelQuickPickItem>(
    options,
    {
      title: '9router: Configure Vision Proxy',
      placeHolder: 'Select a GitHub Copilot model'
    },
    token
  );
}

function createCopilotDiscoveryDetails(): Record<string, unknown> {
  return {
    phase: 'vision-configuration',
    source: 'copilot'
  };
}

function createCopilotDiscoveryCancellationError(): NineRouterError {
  return new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled', {
    details: createCopilotDiscoveryDetails()
  });
}

function isDiscoveryCancellationError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error;
  return code === 'Canceled' || code === 'Cancelled';
}

function getLanguageModelErrorCode(error: unknown): string | undefined {
  if (error instanceof vscode.LanguageModelError) {
    return error.code;
  }

  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function mapCopilotDiscoveryError(
  error: unknown,
  token: vscode.CancellationToken
): NineRouterError {
  if (error instanceof NineRouterError) {
    return error;
  }

  const details = createCopilotDiscoveryDetails();

  if (token.isCancellationRequested || isDiscoveryCancellationError(error)) {
    return new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled', {
      details
    });
  }

  const languageModelErrorCode = getLanguageModelErrorCode(error);

  if (languageModelErrorCode === 'NoPermissions') {
    return new NineRouterError(
      'AUTHENTICATION_ERROR',
      'GitHub Copilot model discovery requires permission.',
      { details }
    );
  }

  if (languageModelErrorCode === 'NotFound') {
    return new NineRouterError(
      'CONFIGURATION_ERROR',
      'Configured GitHub Copilot model discovery is unavailable. Run 9router: Configure Vision Proxy.',
      { details }
    );
  }

  if (languageModelErrorCode === 'Blocked') {
    return new NineRouterError(
      'UPSTREAM_UNAVAILABLE',
      'GitHub Copilot model discovery is currently unavailable.',
      { details }
    );
  }

  return new NineRouterError(
    'UPSTREAM_UNAVAILABLE',
    'GitHub Copilot model discovery failed.',
    { details }
  );
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
