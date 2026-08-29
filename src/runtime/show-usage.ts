import type * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';
import { NineRouterError } from '@/router/errors';
import { createAbortSignalFromToken } from '@/provider/cancellation';
import type { SettingsSnapshot } from '@/config/settings';
import type { RouterClient } from '@/router/client';
import type { RouterUsageSnapshot } from '@/router/usage';

export type UsageReporter = (token: vscode.CancellationToken) => Promise<RouterUsageSnapshot>;

export function createUsageReporter(dependencies: {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getSettingsSnapshot: () => SettingsSnapshot | undefined;
}): UsageReporter {
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
    try {
      return await dependencies.routerClient.getUsage({
        baseUrl: snapshot.runtime.baseUrl,
        apiKey,
        timeoutMs: snapshot.runtime.requestTimeoutMs,
        signal: cancellation.signal
      });
    } finally {
      cancellation.cleanup();
    }
  };
}
