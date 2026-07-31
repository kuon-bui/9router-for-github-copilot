import type * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { NineRouterError } from '../router/errors';
import { createAbortSignalFromToken } from '../provider/cancellation';
import type { SettingsSnapshot } from '../config/settings';
import type { RouterClient } from '../router/client';

export interface ConnectionTestResult {
  durationMs: number;
  modelCount: number;
  configuredModelCount: number;
  matchedModelCount: number;
  missingDisplayModelIds: string[];
}

export type ConnectionTester = (
  token: vscode.CancellationToken
) => Promise<ConnectionTestResult>;

export function createConnectionTester(dependencies: {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getSettingsSnapshot: () => SettingsSnapshot | undefined;
}): ConnectionTester {
  return async (token) => {
    const snapshot = dependencies.getSettingsSnapshot();
    if (!snapshot?.runtime) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        '9router runtime settings are invalid. Check diagnostics for details.'
      );
    }

    const apiKey = await getApiKey(dependencies.secrets);
    if (!apiKey) {
      throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
    }

    const cancellation = createAbortSignalFromToken(token);
    const startedAt = Date.now();
    try {
      const catalog = await dependencies.routerClient.listModels({
        baseUrl: snapshot.runtime.baseUrl,
        apiKey,
        timeoutMs: snapshot.runtime.requestTimeoutMs,
        signal: cancellation.signal
      });
      const catalogIds = new Set(catalog.map((model) => model.id));
      const missingDisplayModelIds = snapshot.models
        .filter((model) => !catalogIds.has(model.modelId))
        .map((model) => model.id);

      return {
        durationMs: Date.now() - startedAt,
        modelCount: catalog.length,
        configuredModelCount: snapshot.models.length,
        matchedModelCount: snapshot.models.length - missingDisplayModelIds.length,
        missingDisplayModelIds
      };
    } finally {
      cancellation.cleanup();
    }
  };
}
