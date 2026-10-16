import { describe, expect, it } from 'vitest';
import { checkToolPermission } from '@/acp/permissions';
import { createMcpHub } from '@/acp/mcp/mcp-hub';
import type { Session } from '@/acp/session-store';

function createTestSession(mode: 'ask' | 'auto-edit' | 'read-only'): Session {
  return {
    sessionId: 'test-session',
    cwd: 'C:/test/workspace',
    model: 'gh/gpt-5',
    reasoningEffort: 'off',
    mode,
    history: [],
    activeTurn: null,
    grants: new Set(),
    mcpServers: [],
    mcpHub: createMcpHub()
  };
}

describe('checkToolPermission', () => {
  it('blocks mutating tools in read-only mode without asking client', async () => {
    const session = createTestSession('read-only');
    let askedClient = false;
    const askFn = async () => {
      askedClient = true;
      return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
    };

    const editDecision = await checkToolPermission({
      session,
      toolName: 'edit_file',
      args: { path: 'file.txt' },
      requestPermission: askFn
    });
    expect(editDecision.allowed).toBe(false);
    expect(askedClient).toBe(false);

    const cmdDecision = await checkToolPermission({
      session,
      toolName: 'run_command',
      args: { command: 'npm test' },
      requestPermission: askFn
    });
    expect(cmdDecision.allowed).toBe(false);
  });

  it('allows read tools inside cwd in ask mode without prompting', async () => {
    const session = createTestSession('ask');
    let askedClient = false;
    const askFn = async () => {
      askedClient = true;
      return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
    };

    const readDecision = await checkToolPermission({
      session,
      toolName: 'read_file',
      args: { path: 'README.md' },
      requestPermission: askFn
    });

    expect(readDecision.allowed).toBe(true);
    expect(askedClient).toBe(false);
  });

  it('prompts user for edit_file in ask mode', async () => {
    const session = createTestSession('ask');
    let requestedOptions: unknown[] = [];
    const askFn = async (req: { options: unknown[] }) => {
      requestedOptions = req.options;
      return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
    };

    const decision = await checkToolPermission({
      session,
      toolName: 'edit_file',
      args: { path: 'src/main.ts' },
      requestPermission: askFn
    });

    expect(decision.allowed).toBe(true);
    expect(requestedOptions.length).toBeGreaterThan(0);
  });

  it('allows edit_file without prompt in auto-edit mode', async () => {
    const session = createTestSession('auto-edit');
    let askedClient = false;
    const askFn = async () => {
      askedClient = true;
      return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
    };

    const decision = await checkToolPermission({
      session,
      toolName: 'edit_file',
      args: { path: 'src/main.ts' },
      requestPermission: askFn
    });

    expect(decision.allowed).toBe(true);
    expect(askedClient).toBe(false);
  });

  it('still prompts for run_command in auto-edit mode', async () => {
    const session = createTestSession('auto-edit');
    let askedClient = false;
    const askFn = async () => {
      askedClient = true;
      return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
    };

    const decision = await checkToolPermission({
      session,
      toolName: 'run_command',
      args: { command: 'ls' },
      requestPermission: askFn
    });

    expect(decision.allowed).toBe(true);
    expect(askedClient).toBe(true);
  });

  it('records allow_always grant and skips future prompts', async () => {
    const session = createTestSession('ask');
    const askFn = async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'allow_always' }
    });

    const first = await checkToolPermission({
      session,
      toolName: 'edit_file',
      args: { path: 'src/a.ts' },
      requestPermission: askFn
    });
    expect(first.allowed).toBe(true);
    expect(session.grants.has('edit_file')).toBe(true);

    let askedAgain = false;
    const second = await checkToolPermission({
      session,
      toolName: 'edit_file',
      args: { path: 'src/b.ts' },
      requestPermission: async () => {
        askedAgain = true;
        return { outcome: { outcome: 'selected' as const, optionId: 'allow' } };
      }
    });
    expect(second.allowed).toBe(true);
    expect(askedAgain).toBe(false);
  });

  it('handles user rejection gracefully', async () => {
    const session = createTestSession('ask');
    const askFn = async () => ({
      outcome: { outcome: 'selected' as const, optionId: 'reject' }
    });

    const decision = await checkToolPermission({
      session,
      toolName: 'run_command',
      args: { command: 'rm -rf /' },
      requestPermission: askFn
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('User rejected this action');
  });
});
