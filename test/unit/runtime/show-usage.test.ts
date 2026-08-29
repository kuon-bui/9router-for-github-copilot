import { describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import { createUsageReporter } from '@/runtime/show-usage';
import { __createCancellationToken } from '@test/support/vscode';
import type { NineRouterError } from '@/router/errors';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

function snapshot(models: unknown, baseUrl = 'https://router.example.com/v1') {
  return buildSettingsSnapshot({
    get: (key: string) => {
      if (key === 'models') {
        return models;
      }

      if (key === 'baseUrl') {
        return baseUrl;
      }

      if (key === 'requestTimeoutMs') {
        return 5_000;
      }

      return undefined;
    }
  } as never);
}

describe('createUsageReporter', () => {
  it('fetches usage with runtime settings and api key', async () => {
    const getUsage = vi.fn(async () => MOCK_USAGE_PAYLOAD);
    const showUsage = createUsageReporter({
      secrets: { get: async () => 'secret' } as never,
      routerClient: { getUsage } as never,
      getSettingsSnapshot: () =>
        snapshot([{ id: 'agent', name: 'Agent', modelId: 'router/agent' }])
    });

    await expect(showUsage(__createCancellationToken().value as never)).resolves.toEqual(
      MOCK_USAGE_PAYLOAD
    );
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret',
        timeoutMs: 5_000,
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('fails before transport when API key is missing', async () => {
    const getUsage = vi.fn();
    const showUsage = createUsageReporter({
      secrets: { get: async () => undefined } as never,
      routerClient: { getUsage } as never,
      getSettingsSnapshot: () =>
        snapshot([{ id: 'agent', name: 'Agent', modelId: 'router/agent' }])
    });

    await expect(showUsage(__createCancellationToken().value as never)).rejects.toMatchObject<NineRouterError>({
      code: 'AUTHENTICATION_ERROR',
      message: '9router API key is not configured'
    });
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('fails before transport when runtime settings are invalid', async () => {
    const getUsage = vi.fn();
    const showUsage = createUsageReporter({
      secrets: { get: async () => 'secret' } as never,
      routerClient: { getUsage } as never,
      getSettingsSnapshot: () => undefined
    });

    await expect(showUsage(__createCancellationToken().value as never)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR'
    });
    expect(getUsage).not.toHaveBeenCalled();
  });
});
