import { NineRouterError } from './errors';

export interface RouterUsageQuota {
  used: number;
  total: number;
  remaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
}

export interface RouterUsageEntry {
  connectionId: string;
  provider: string;
  name: string;
  authType: string;
  status: string;
  plan: string;
  quotas: Record<string, RouterUsageQuota>;
  message: string | null;
  fetchedAt: string;
  stale: boolean;
}

export interface RouterUsageSnapshot {
  count: number;
  lastSweepAt: string;
  entries: RouterUsageEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function malformedUsageError(): NineRouterError {
  return new NineRouterError(
    'UPSTREAM_UNAVAILABLE',
    '9router usage response is malformed',
    { details: { phase: 'usage-discovery' } }
  );
}

function parseQuota(value: unknown): RouterUsageQuota | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (!isFiniteNumber(value.used) || !isFiniteNumber(value.total)) {
    return undefined;
  }

  if (value.remaining !== null && !isFiniteNumber(value.remaining)) {
    return undefined;
  }

  if (value.resetAt !== null && typeof value.resetAt !== 'string') {
    return undefined;
  }

  if (typeof value.unlimited !== 'boolean') {
    return undefined;
  }

  return {
    used: value.used,
    total: value.total,
    remaining: value.remaining,
    resetAt: value.resetAt,
    unlimited: value.unlimited
  };
}

function parseQuotas(value: unknown): Record<string, RouterUsageQuota> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const quotas: Record<string, RouterUsageQuota> = {};
  for (const [key, quotaValue] of Object.entries(value)) {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) {
      continue;
    }

    const quota = parseQuota(quotaValue);
    if (!quota) {
      continue;
    }

    quotas[trimmedKey] = quota;
  }

  return quotas;
}

function parseEntry(value: unknown): RouterUsageEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    !isNonEmptyString(value.connectionId) ||
    !isNonEmptyString(value.provider) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.authType) ||
    !isNonEmptyString(value.status) ||
    !isNonEmptyString(value.plan) ||
    !isNonEmptyString(value.fetchedAt) ||
    typeof value.stale !== 'boolean'
  ) {
    return undefined;
  }

  if (value.message !== null && typeof value.message !== 'string') {
    return undefined;
  }

  const quotas = parseQuotas(value.quotas);
  if (!quotas) {
    return undefined;
  }

  return {
    connectionId: value.connectionId,
    provider: value.provider,
    name: value.name,
    authType: value.authType,
    status: value.status,
    plan: value.plan,
    quotas,
    message: value.message,
    fetchedAt: value.fetchedAt,
    stale: value.stale
  };
}

export function parseRouterUsage(payload: unknown): RouterUsageSnapshot {
  if (!isRecord(payload) || !Array.isArray(payload.entries)) {
    throw malformedUsageError();
  }

  if (!isNonNegativeInteger(payload.count) || !isNonEmptyString(payload.lastSweepAt)) {
    throw malformedUsageError();
  }

  const entries: RouterUsageEntry[] = [];
  for (const item of payload.entries) {
    const parsed = parseEntry(item);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return {
    count: payload.count,
    lastSweepAt: payload.lastSweepAt,
    entries
  };
}
