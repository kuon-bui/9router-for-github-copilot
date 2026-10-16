import { describe, expect, it } from 'vitest';
import { executePromptTurn } from '@/acp/turn-runner';
import { createMcpHub } from '@/acp/mcp/mcp-hub';
import { FakeRouterClient } from '../../support/fake-router-client';
import type { Session } from '@/acp/session-store';
import type { RouterStreamEvent } from '@/types/router-contract';

function createMockSession(): Session {
  return {
    sessionId: 'test-tool-loop',
    cwd: 'C:/test-project',
    model: 'gh/gpt-5',
    reasoningEffort: 'off',
    mode: 'ask',
    history: [],
    activeTurn: null,
    grants: new Set(),
    mcpServers: [],
    mcpHub: createMcpHub()
  };
}

describe('tool execution loop in turn runner', () => {
  it('executes tool call and feeds function_call_output back to router', async () => {
    const session = createMockSession();
    // Pre-grant read_file so it runs without asking
    session.grants.add('read_file');

    const firstTurnEvents: RouterStreamEvent[] = [
      {
        type: 'tool-call-delta',
        toolCallIndex: 0,
        toolCallId: 'call_read_1',
        toolName: 'read_file',
        delta: JSON.stringify({ path: 'sample.txt' })
      },
      { type: 'response-complete' }
    ];

    const secondTurnEvents: RouterStreamEvent[] = [
      { type: 'text-delta', text: 'I read the file successfully.' },
      { type: 'response-complete' }
    ];

    const fakeClient = new FakeRouterClient();
    let callCount = 0;
    fakeClient.streamResponse = async function* () {
      callCount++;
      const events = callCount === 1 ? firstTurnEvents : secondTurnEvents;
      for (const e of events) {
        yield e;
      }
    };

    const clientNotifications: Array<{ method: string; params: unknown }> = [];

    const mockFs = {
      readText: async () => 'File contents here',
      writeText: async () => {}
    };

    const result = await executePromptTurn({
      session,
      client: fakeClient,
      apiKey: 'sk-test-key',
      baseUrl: 'http://127.0.0.1:20128/v1',
      timeoutMs: 30000,
      prompt: [{ type: 'text', text: 'Read sample.txt' }],
      workspaceFs: mockFs,
      notifyClient: async (method, params) => {
        clientNotifications.push({ method, params });
      }
    });

    expect(result.stopReason).toBe('end_turn');
    expect(callCount).toBe(2);

    // Verify session history has user message, assistant function_call, function_call_output, and assistant reply
    expect(session.history.some((item) => item.type === 'function_call')).toBe(true);
    expect(session.history.some((item) => item.type === 'function_call_output')).toBe(true);
  });
});
