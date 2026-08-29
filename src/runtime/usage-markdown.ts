import type { RouterUsageEntry, RouterUsageQuota, RouterUsageSnapshot } from '@/router/usage';
import {
  formatAmount,
  formatProviderName,
  formatResetLabel,
  formatTimestamp,
  quotaRemainingPercent
} from './usage-format';

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function quotaMarker(percent: number): string {
  return percent <= 0 ? '●' : '○';
}

function formatQuotaLine(name: string, quota: RouterUsageQuota, nowMs: number): string {
  const percent = quotaRemainingPercent(quota);
  const reset = quota.unlimited ? 'N/A' : formatResetLabel(quota.resetAt, nowMs);
  return `- ${quotaMarker(percent)} ${escapeMarkdown(name)} · ${escapeMarkdown(formatAmount(quota.used))} / ${escapeMarkdown(formatAmount(quota.total))} · ${escapeMarkdown(reset)}`;
}

function formatEntry(entry: RouterUsageEntry, nowMs: number): string {
  const quotas = Object.entries(entry.quotas);
  const quotaCountLabel = `${quotas.length} quota${quotas.length === 1 ? '' : 's'}`;
  const lines = [
    `### ${escapeMarkdown(formatProviderName(entry.provider))}`,
    '',
    escapeMarkdown(entry.name),
    '',
    `${escapeMarkdown(entry.plan)} · ${escapeMarkdown(entry.authType)}${entry.stale ? ' · stale' : ''}${entry.status.trim().toLowerCase() === 'ok' ? '' : ` · ${escapeMarkdown(entry.status)}`}`,
    ''
  ];

  if (entry.message && entry.message.trim().length > 0) {
    lines.push(`> ${escapeMarkdown(entry.message)}`, '');
  }

  lines.push(`${quotaCountLabel}`, '');

  if (quotas.length === 0) {
    lines.push('_No quotas reported for this connection._');
  } else {
    for (const [name, quota] of quotas) {
      lines.push(formatQuotaLine(name, quota, nowMs));
    }
  }

  return lines.join('\n');
}

export function formatUsageMarkdown(
  snapshot: RouterUsageSnapshot,
  options: { nowMs?: number } = {}
): string {
  const nowMs = options.nowMs ?? Date.now();
  const sections = [
    '## Usage',
    '',
    `Last sweep · ${escapeMarkdown(formatTimestamp(snapshot.lastSweepAt))}`,
    ''
  ];

  if (snapshot.entries.length === 0) {
    sections.push('_No connection usage entries returned._');
    return sections.join('\n');
  }

  for (const entry of snapshot.entries) {
    sections.push(formatEntry(entry, nowMs), '');
  }

  return sections.join('\n').trimEnd();
}
