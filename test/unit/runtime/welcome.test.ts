import { beforeEach, describe, expect, it } from 'vitest';
import { WELCOME_SHOWN_KEY, showWelcomeIfNeeded } from '@/runtime/welcome';
import {
  __getExecutedCommands,
  __getInformationMessages,
  __resetVscodeState,
  __setInformationResponse
} from '@test/support/vscode';

function createContext(apiKey: string | undefined) {
  const values = new Map<string, unknown>();
  const context = {
    secrets: { get: async () => apiKey },
    globalState: {
      get: (key: string) => values.get(key),
      update: async (key: string, value: unknown) => {
        values.set(key, value);
      }
    }
  };

  return { context: context as never, values };
}

describe('showWelcomeIfNeeded', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('greets a fresh install once and remembers it', async () => {
    const { context, values } = createContext(undefined);

    await showWelcomeIfNeeded(context);
    await showWelcomeIfNeeded(context);

    expect(__getInformationMessages()).toEqual([
      'Connect 9router to use its models in GitHub Copilot Chat.'
    ]);
    expect(values.get(WELCOME_SHOWN_KEY)).toBe(true);
  });

  it('stays quiet when an API key exists', async () => {
    const { context, values } = createContext('sk-secret');

    await showWelcomeIfNeeded(context);

    expect(__getInformationMessages()).toEqual([]);
    expect(values.has(WELCOME_SHOWN_KEY)).toBe(false);
  });

  it('runs Set API Key when the user chooses it', async () => {
    __setInformationResponse('Set API Key');

    await showWelcomeIfNeeded(createContext(undefined).context);

    expect(__getExecutedCommands()).toEqual(['9routerCopilot.setApiKey']);
  });
});
