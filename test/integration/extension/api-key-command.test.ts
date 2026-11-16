import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import { registerCommands } from '@/runtime/commands';
import {
  Uri,
  __getCommandHandler,
  __getExecutedCommands,
  __getInformationMessages,
  __resetVscodeState,
  __setInformationResponse,
  __setInputBoxValue
} from '@test/support/vscode';

const snapshotOf = (models: unknown[]) =>
  buildSettingsSnapshot({ get: (key: string) => (key === 'models' ? models : undefined) } as never);

function register(models: unknown[]) {
  const store = vi.fn(async () => undefined);
  registerCommands(
    {
      subscriptions: [],
      extensionUri: Uri.file('/ext'),
      secrets: { get: async () => undefined, store, delete: async () => undefined }
    } as never,
    { getSettingsSnapshot: () => snapshotOf(models) }
  );

  return { store };
}

describe('9routerCopilot.setApiKey', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setInputBoxValue('sk-new');
  });

  it('offers Add Model after saving a key while no model is published', async () => {
    __setInformationResponse('Add Model');
    const { store } = register([{ id: 'agent', name: 'Agent', modelId: '' }]);

    await __getCommandHandler('9routerCopilot.setApiKey')?.();

    expect(store).toHaveBeenCalledWith('9router.apiKey', 'sk-new');
    expect(__getInformationMessages()).toEqual([
      '9router API key saved. Add a model to show it in Copilot Chat.'
    ]);
    expect(__getExecutedCommands()).toEqual(['9routerCopilot.addModel']);
  });

  it('stays quiet after saving a key when models are published', async () => {
    const { store } = register([{ id: 'coder', name: 'Coder', modelId: 'router/coder' }]);

    await __getCommandHandler('9routerCopilot.setApiKey')?.();

    expect(store).toHaveBeenCalledWith('9router.apiKey', 'sk-new');
    expect(__getInformationMessages()).toEqual([]);
  });
});
