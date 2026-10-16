import { describe, expect, it } from 'vitest';
import { createSessionStore } from '@/acp/session-store';

describe('createSessionStore', () => {
  it('creates a session with valid absolute cwd and settings', () => {
    const store = createSessionStore({
      defaultModel: 'gh/gpt-5',
      reasoningEffort: 'low',
      mode: 'ask'
    });

    const session = store.createSession({
      cwd: 'C:/my-project'
    });

    expect(session.sessionId).toBeDefined();
    expect(session.cwd).toBe('C:/my-project');
    expect(session.model).toBe('gh/gpt-5');
    expect(session.reasoningEffort).toBe('low');
    expect(session.mode).toBe('ask');
    expect(session.history).toHaveLength(0);
    expect(store.count()).toBe(1);
  });

  it('rejects relative cwd with invalid params error', () => {
    const store = createSessionStore();
    expect(() => store.createSession({ cwd: 'relative/path' })).toThrow(/absolute/i);
  });

  it('retrieves and closes existing session', () => {
    const store = createSessionStore();
    const session = store.createSession({ cwd: 'C:/project' });

    expect(store.getSession(session.sessionId)).toBe(session);
    store.closeSession(session.sessionId);
    expect(store.getSession(session.sessionId)).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it('caps total concurrent sessions at 32', () => {
    const store = createSessionStore();
    for (let i = 0; i < 32; i++) {
      store.createSession({ cwd: `C:/proj-${i}` });
    }
    expect(store.count()).toBe(32);
    expect(() => store.createSession({ cwd: 'C:/proj-overflow' })).toThrow(/session limit/i);
  });
});
