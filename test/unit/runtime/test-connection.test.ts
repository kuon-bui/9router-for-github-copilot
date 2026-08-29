import { describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import { createConnectionTester } from '@/runtime/test-connection';
import { __createCancellationToken } from '@test/support/vscode';
import type { NineRouterError } from '@/router/errors';

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

describe('createConnectionTester', () => {
  it('lists models and reports exact configured mapping matches', async () => {
    const listModels = vi.fn(async () => [
      { id: 'router/agent' },
      { id: 'router/vision', vision: true as const }
    ]);
    const testConnection = createConnectionTester({
      secrets: { get: async () => 'secret' } as never,
      routerClient: { listModels } as never,
      getSettingsSnapshot: () =>
        snapshot([
          { id: 'agent', name: 'Agent', modelId: 'router/agent' },
          { id: 'coder', name: 'Coder', modelId: 'router/missing' }
        ])
    });

    const result = await testConnection(__createCancellationToken().value as never);

    expect(result).toMatchObject({
      modelCount: 2,
      configuredModelCount: 2,
      matchedModelCount: 1,
      missingDisplayModelIds: ['coder']
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret',
        timeoutMs: 5_000,
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('fails before transport when API key is missing', async () => {
    const listModels = vi.fn();
    const testConnection = createConnectionTester({
      secrets: { get: async () => undefined } as never,
      routerClient: { listModels } as never,
      getSettingsSnapshot: () =>
        snapshot([{ id: 'agent', name: 'Agent', modelId: 'router/agent' }])
    });

    await expect(
      testConnection(__createCancellationToken().value as never)
    ).rejects.toMatchObject<NineRouterError>({
      code: 'AUTHENTICATION_ERROR',
      message: '9router API key is not configured'
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it('fails before transport when runtime settings are invalid', async () => {
    const listModels = vi.fn();
    const testConnection = createConnectionTester({
      secrets: { get: async () => 'secret' } as never,
      routerClient: { listModels } as never,
      getSettingsSnapshot: () =>
        snapshot([{ id: 'agent', name: 'Agent', modelId: 'router/agent' }], 'file:///router')
    });

    await expect(
      testConnection(__createCancellationToken().value as never)
    ).rejects.toMatchObject<NineRouterError>({
      code: 'CONFIGURATION_ERROR'
    });
    expect(listModels).not.toHaveBeenCalled();
  });
});
