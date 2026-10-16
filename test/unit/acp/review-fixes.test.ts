import { describe, expect, it } from 'vitest';
import { assertPathWithinCwd } from '@/acp/tools/path-guard';
import { truncateOutput } from '@/acp/tools/output-limits';
import { sanitizeEnvironment } from '@/acp/tools/local-process-runner';
import { parseToolCallArguments } from '@/router/response-assembler';
import { createSessionStore } from '@/acp/session-store';
import { checkToolPermission } from '@/acp/permissions';

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
    mcpHub: {
      connectServers: async () => {},
      getTools: () => [],
      hasTool: () => false,
      executeTool: async () => ({ ok: true, output: '' }),
      close: async () => {}
    }
  };
}
