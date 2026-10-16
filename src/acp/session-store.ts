import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createInvalidParamsError } from './errors';
import type { AcpAgentMode, AcpReasoningEffort } from '@/types/acp-agent-contract';
import type { RouterResponseInputItem } from '@/types/router-contract';

export const MAX_SESSIONS = 32;

export interface ActiveTurnState {
  abortController: AbortController;
}

export interface Session {
  sessionId: string;
  cwd: string;
  model: string;
  reasoningEffort: AcpReasoningEffort;
  mode: AcpAgentMode;
  history: RouterResponseInputItem[];
  activeTurn: ActiveTurnState | null;
  grants: Set<string>;
  mcpServers: unknown[];
}

export interface SessionDefaults {
  defaultModel?: string | undefined;
  reasoningEffort?: AcpReasoningEffort | undefined;
  mode?: AcpAgentMode | undefined;
}

export interface CreateSessionParams {
  cwd: string;
  mcpServers?: unknown[] | undefined;
}

export interface SessionStore {
  createSession(params: CreateSessionParams): Session;
  getSession(sessionId: string): Session | undefined;
  closeSession(sessionId: string): void;
  cancelTurn(sessionId: string): boolean;
  count(): number;
}

export function createSessionStore(defaults: SessionDefaults = {}): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    createSession(params: CreateSessionParams): Session {
      if (sessions.size >= MAX_SESSIONS) {
        throw createInvalidParamsError(`Maximum concurrent session limit (${MAX_SESSIONS}) reached`);
      }

      if (!params.cwd || !isAbsolute(params.cwd)) {
        throw createInvalidParamsError('Session cwd must be an absolute path');
      }

      const sessionId = randomUUID();
      const session: Session = {
        sessionId,
        cwd: params.cwd,
        model: defaults.defaultModel ?? '',
        reasoningEffort: defaults.reasoningEffort ?? 'off',
        mode: defaults.mode ?? 'ask',
        history: [],
        activeTurn: null,
        grants: new Set<string>(),
        mcpServers: params.mcpServers ?? []
      };

      sessions.set(sessionId, session);
      return session;
    },

    getSession(sessionId: string): Session | undefined {
      return sessions.get(sessionId);
    },

    closeSession(sessionId: string): void {
      const session = sessions.get(sessionId);
      if (session?.activeTurn) {
        session.activeTurn.abortController.abort('session closed');
      }
      sessions.delete(sessionId);
    },

    cancelTurn(sessionId: string): boolean {
      const session = sessions.get(sessionId);
      if (session?.activeTurn) {
        session.activeTurn.abortController.abort('cancelled by user');
        session.activeTurn = null;
        return true;
      }
      return false;
    },

    count(): number {
      return sessions.size;
    }
  };
}
