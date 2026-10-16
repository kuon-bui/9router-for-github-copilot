import { describe, expect, it } from 'vitest';
import { executePromptTurn } from '@/acp/turn-runner';
import { FakeRouterClient } from '../../support/fake-router-client';
import type { Session } from '@/acp/session-store';

function createMockSession(): Session {
  return {
    sessionId: 'test-session-1',
    cwd: 'C:/test-project',
    model: 'gh/gpt-5',
    reasoningEffort: 'off',
    mode: 'ask',
    history: [],
    activeTurn: null,
    grants: new Set(),
    mcpServers: []
  };
}

describe('executePromptTurn', () => {
  it('streams response text deltas and updates history', async () => {
    const fakeClient = new FakeRouterClient({ responseText: 'Hello from 9router ACP!' });
    const session = createMockSession();
    const sentChunks: string[] = [];

    const result = await executePromptTurn({
      session,
      client: fakeClient,
      apiKey: 'sk-test-key',
      baseUrl: 'http://127.0.0.1:20128/v1',
      timeoutMs: 30000,
      prompt: [
        {
          type: 'text',
          text: 'Hello!'
        }
      ],
      notifyClient: async (_method, rawParams: unknown) => {
        const params = rawParams as { update?: { sessionUpdate?: string; content?: { text?: string } } } | undefined;
        if (params?.update?.sessionUpdate === 'agent_message_chunk' && params.update.content?.text) {
          sentChunks.push(params.update.content.text);
        }
      }
    });

    expect(result.stopReason).toBe('end_turn');
    expect(sentChunks.join('')).toBe('Hello from 9router ACP!');
    expect(session.history.length).toBeGreaterThan(0);
  });

  it('handles cancellation and returns stopReason cancelled', async () => {
    const fakeClient = new FakeRouterClient({ responseText: 'Should be cancelled', delayMs: 50 });
    const session = createMockSession();
    const abortController = new AbortController();

    const turnPromise = executePromptTurn({
      session,
      client: fakeClient,
      apiKey: 'sk-test-key',
      baseUrl: 'http://127.0.0.1:20128/v1',
      timeoutMs: 30000,
      turnSignal: abortController.signal,
      prompt: [{ type: 'text', text: 'Hi' }],
      notifyClient: async () => {}
    });

    // Abort turn mid-flight
    abortController.abort('user cancel');

    const result = await turnPromise;
    expect(result.stopReason).toBe('cancelled');
  });
});
