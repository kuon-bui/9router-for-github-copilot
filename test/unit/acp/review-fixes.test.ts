import { describe, expect, it } from 'vitest';
import { assertPathWithinCwd } from '@/acp/tools/path-guard';
import { truncateOutput } from '@/acp/tools/output-limits';
import { sanitizeEnvironment } from '@/acp/tools/local-process-runner';
import { parseToolCallArguments } from '@/router/response-assembler';
import { createSessionStore } from '@/acp/session-store';
import { checkToolPermission } from '@/acp/permissions';
import { executePromptTurn } from '@/acp/turn-runner';
import { createMcpHub } from '@/acp/mcp/mcp-hub';
import { FakeRouterClient } from '../../support/fake-router-client';
import type { RouterStreamEvent } from '@/types/router-contract';

describe('Review Fixes', () => {
  it('rejects case-insensitive .git directory variants on Windows/macOS', () => {
    expect(() => assertPathWithinCwd('.Git/config', 'C:/workspace', false)).toThrow(/protected \.git directory/i);
    expect(() => assertPathWithinCwd('.GIT/hooks', 'C:/workspace', false)).toThrow(/protected \.git directory/i);
    expect(() => assertPathWithinCwd('sub/.git', 'C:/workspace', false)).toThrow(/protected \.git directory/i);
  });

  it('sanitizes case-insensitive NINEROUTER_* environment variables', () => {
    const env = {
      ninerouter_api_key: 'secret1',
      NineRouter_Base_Url: 'secret2',
      NINEROUTER_TOKEN: 'secret3',
      SAFE_PATH: '/usr/bin'
    };

    const sanitized = sanitizeEnvironment(env);
    expect(sanitized['ninerouter_api_key']).toBeUndefined();
    expect(sanitized['NineRouter_Base_Url']).toBeUndefined();
    expect(sanitized['NINEROUTER_TOKEN']).toBeUndefined();
    expect(sanitized['SAFE_PATH']).toBe('/usr/bin');
  });

  it('truncateOutput does not exceed maxBytes on multibyte strings', () => {
    // 50,000 CJK characters (each 3 bytes in UTF-8 = 150,000 bytes)
    const cjk = '中'.repeat(50000);
    const maxBytes = 64 * 1024;
    const truncated = truncateOutput(cjk, maxBytes);
    const byteLength = Buffer.byteLength(truncated, 'utf8');

    expect(byteLength).toBeLessThanOrEqual(maxBytes);
    expect(truncated).toContain('[... truncated');
    expect(truncated).not.toContain('truncated -');
  });

  it('cancelTurn does not prematurely clear session.activeTurn before turn finishes', () => {
    const store = createSessionStore();
    const session = store.createSession({ cwd: 'C:/workspace' });
    const controller = new AbortController();
    session.activeTurn = { abortController: controller };

    expect(store.cancelTurn(session.sessionId)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // activeTurn should still reference the turn until executePromptTurn's finally block clears it
    expect(session.activeTurn).not.toBeNull();
  });

  it('parseToolCallArguments accepts empty string as empty object', () => {
    const emptyResult = parseToolCallArguments('');
    expect(emptyResult.ok).toBe(true);
    if (emptyResult.ok) {
      expect(emptyResult.value).toEqual({});
    }

    const whitespaceResult = parseToolCallArguments('   ');
    expect(whitespaceResult.ok).toBe(true);
    if (whitespaceResult.ok) {
      expect(whitespaceResult.value).toEqual({});
    }
  });

  it('checkToolPermission respects cancellation signal while waiting for user confirmation', async () => {
    const session = storeHelperSession('ask');
    const controller = new AbortController();

    const slowPrompt = () => new Promise<never>(() => {
      // never resolves unless cancelled
    });

    const promise = checkToolPermission({
      session,
      toolName: 'run_command',
      args: { command: 'npm start' },
      signal: controller.signal,
      requestPermission: slowPrompt
    });

    controller.abort('user cancel');
    const decision = await promise;
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('cancelled');
  });

  it('detects broken symlinks escaping workspace using lstatSync and readlinkSync', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-symlink-'));
    try {
      const linkPath = path.join(tempDir, 'broken-link');
      const outsideTarget = path.resolve(tempDir, '../outside-nonexistent-dir');
      const isWindows = process.platform === 'win32';
      fs.symlinkSync(outsideTarget, linkPath, isWindows ? 'junction' : 'dir');

      expect(() => assertPathWithinCwd('broken-link', tempDir)).toThrow(/outside workspace/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('executePromptTurn stops immediately on abort during permission check and does not process subsequent tool calls', async () => {
    const session = storeHelperSession('ask');
    const controller = new AbortController();

    const toolEvents: RouterStreamEvent[] = [
      {
        type: 'tool-call-delta',
        toolCallIndex: 0,
        toolCallId: 'call_1',
        toolName: 'first_tool',
        delta: '{}'
      },
      {
        type: 'tool-call-delta',
        toolCallIndex: 1,
        toolCallId: 'call_2',
        toolName: 'second_tool',
        delta: '{}'
      },
      { type: 'response-complete' }
    ];

    const fakeClient = new FakeRouterClient({ events: toolEvents });
    const promptedTools: string[] = [];

    const requestPermission = async (req: { toolCall: { title: string } }) => {
      promptedTools.push(req.toolCall.title);
      controller.abort('user cancel');
      return { outcome: { outcome: 'cancelled' as const } };
    };

    const result = await executePromptTurn({
      session,
      client: fakeClient,
      apiKey: 'sk-test-key',
      baseUrl: 'http://127.0.0.1:20128/v1',
      timeoutMs: 30000,
      turnSignal: controller.signal,
      prompt: [{ type: 'text', text: 'Run tools' }],
      requestPermission,
      notifyClient: async () => {}
    });

    expect(result.stopReason).toBe('cancelled');
    expect(promptedTools).toEqual(['Run first_tool']);
    const outputs = session.history.filter((h) => h.type === 'function_call_output');
    expect(outputs.length).toBeGreaterThan(0);
  });
});

function storeHelperSession(mode: 'ask' | 'auto-edit' | 'read-only') {
  return {
    sessionId: 'test-session',
    cwd: 'C:/workspace',
    model: 'gh/gpt-5',
    reasoningEffort: 'off' as const,
    mode,
    history: [],
    activeTurn: null,
    grants: new Set<string>(),
    mcpServers: [],
    mcpHub: createMcpHub()
  };
}
