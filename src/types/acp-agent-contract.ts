import type { DebugMode } from '@/debug/debug-level';

export type AcpAgentMode = 'ask' | 'auto-edit' | 'read-only';

export type AcpReasoningEffort =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface AcpAgentEnvConfig {
  apiKey?: string;
  baseUrl: string;
  defaultModel?: string;
  reasoningEffort: AcpReasoningEffort;
  mode: AcpAgentMode;
  timeoutMs: number;
  debugMode: DebugMode;
  maxTurnRequests: number;
}

export const ACP_ENV_VARS = [
  'NINEROUTER_API_KEY',
  'NINEROUTER_BASE_URL',
  'NINEROUTER_MODEL',
  'NINEROUTER_REASONING_EFFORT',
  'NINEROUTER_MODE',
  'NINEROUTER_TIMEOUT_MS',
  'NINEROUTER_DEBUG',
  'NINEROUTER_MAX_TURN_REQUESTS'
] as const;

export type AcpEnvVarName = (typeof ACP_ENV_VARS)[number];

export const DEFAULT_ACP_BASE_URL = 'http://127.0.0.1:20128';
export const DEFAULT_ACP_TIMEOUT_MS = 300000;
export const DEFAULT_ACP_DEBUG_MODE: DebugMode = 'minimal';
export const DEFAULT_ACP_MODE: AcpAgentMode = 'ask';
export const DEFAULT_ACP_REASONING_EFFORT: AcpReasoningEffort = 'off';
export const DEFAULT_ACP_MAX_TURN_REQUESTS = 50;
export const MAX_ACP_TURN_REQUESTS = 500;
