import { isAllowedDebugLevel } from '@/debug/debug-level';
import { isHttpBaseUrl, normalizeBaseUrl } from '@/router/url';
import {
  DEFAULT_ACP_BASE_URL,
  DEFAULT_ACP_DEBUG_MODE,
  DEFAULT_ACP_MAX_TURN_REQUESTS,
  DEFAULT_ACP_MODE,
  DEFAULT_ACP_REASONING_EFFORT,
  DEFAULT_ACP_TIMEOUT_MS,
  MAX_ACP_TURN_REQUESTS
} from '@/types/acp-agent-contract';
import type {
  AcpAgentEnvConfig,
  AcpAgentMode,
  AcpReasoningEffort
} from '@/types/acp-agent-contract';

export type AgentSettings = AcpAgentEnvConfig;

const VALID_MODES: ReadonlySet<AcpAgentMode> = new Set(['ask', 'auto-edit', 'read-only']);
const VALID_REASONING: ReadonlySet<AcpReasoningEffort> = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

export function isPlaceholderApiKey(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

export function loadAgentSettings(env: Record<string, string | undefined> = process.env): AgentSettings {
  const rawApiKey = env['NINEROUTER_API_KEY']?.trim();
  const apiKey = rawApiKey && !isPlaceholderApiKey(rawApiKey) ? rawApiKey : undefined;

  const rawBaseUrl = env['NINEROUTER_BASE_URL']?.trim() ?? DEFAULT_ACP_BASE_URL;
  const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl);
  const baseUrl = isHttpBaseUrl(normalizedBaseUrl) ? normalizedBaseUrl : DEFAULT_ACP_BASE_URL;

  const rawModel = env['NINEROUTER_MODEL']?.trim();
  const defaultModel = rawModel && rawModel.length > 0 ? rawModel : undefined;

  const rawReasoning = env['NINEROUTER_REASONING_EFFORT']?.trim() as AcpReasoningEffort | undefined;
  const reasoningEffort = rawReasoning && VALID_REASONING.has(rawReasoning)
    ? rawReasoning
    : DEFAULT_ACP_REASONING_EFFORT;

  const rawMode = env['NINEROUTER_MODE']?.trim() as AcpAgentMode | undefined;
  const mode = rawMode && VALID_MODES.has(rawMode) ? rawMode : DEFAULT_ACP_MODE;

  let timeoutMs = DEFAULT_ACP_TIMEOUT_MS;
  const rawTimeout = env['NINEROUTER_TIMEOUT_MS']?.trim();
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isFinite(parsed) && parsed >= 0) {
      timeoutMs = parsed;
    }
  }

  const rawDebug = env['NINEROUTER_DEBUG']?.trim();
  const debugMode = isAllowedDebugLevel(rawDebug) ? rawDebug : DEFAULT_ACP_DEBUG_MODE;

  let maxTurnRequests = DEFAULT_ACP_MAX_TURN_REQUESTS;
  const rawMaxTurns = env['NINEROUTER_MAX_TURN_REQUESTS']?.trim();
  if (rawMaxTurns) {
    const parsed = parseInt(rawMaxTurns, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      maxTurnRequests = Math.min(parsed, MAX_ACP_TURN_REQUESTS);
    }
  }

  return {
    apiKey,
    baseUrl,
    defaultModel,
    reasoningEffort,
    mode,
    timeoutMs,
    debugMode,
    maxTurnRequests
  };
}
