import type { RouterUsageQuota } from '@/router/usage';

export function formatProviderName(provider: string): string {
  const trimmed = provider.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  return trimmed
    .split(/([-_\s]+)/)
    .map((part) => {
      if (part.length === 0 || /^[-_\s]+$/.test(part)) {
        return part === '_' ? '-' : part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export function formatAmount(value: number): string {
  return Number.isFinite(value) ? String(value) : '—';
}

export function remainingPercent(used: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(used) || !Number.isFinite(total)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100)));
}

export type QuotaTone = 'ok' | 'warn' | 'critical';

export function quotaTone(percent: number): QuotaTone {
  if (percent > 70) {
    return 'ok';
  }

  return percent >= 30 ? 'warn' : 'critical';
}

export function quotaRemainingPercent(quota: RouterUsageQuota): number {
  return quota.unlimited ? 100 : remainingPercent(quota.used, quota.total);
}

export function formatResetLabel(resetAt: string | null, nowMs: number): string {
  if (resetAt === null || resetAt.trim().length === 0) {
    return 'N/A';
  }

  const resetMs = Date.parse(resetAt);
  if (!Number.isFinite(resetMs)) {
    return resetAt;
  }

  const deltaMs = resetMs - nowMs;
  if (deltaMs <= 0) {
    return 'Reset available';
  }

  const totalSeconds = Math.max(1, Math.floor(deltaMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (days > 0 || hours > 0) {
    parts.push(`${hours}h`);
  }
  if (days > 0 || hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`);
  } else {
    parts.push('1m');
  }

  return `in ${parts.join(' ')}`;
}

export function formatTimestamp(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(ms));
}