import { resolveProviderIcon } from '@/webview/shared/provider-icons';
import {
  formatAmount,
  formatProviderName,
  formatResetLabel,
  formatTimestamp,
  quotaRemainingPercent,
  quotaTone
} from '@/webview/shared/usage-format';
import type { ProviderIconDescriptor } from '@/webview/shared/provider-icons';
import type { QuotaTone } from '@/webview/shared/usage-format';
import type {
  RouterUsageEntry,
  RouterUsageQuota,
  RouterUsageSnapshot
} from '@/router/usage';

export interface QuotaView {
  readonly name: string;
  readonly tone: QuotaTone;
  readonly percent: number;
  readonly usedLabel: string;
  readonly resetLabel: string;
}

export interface UsageCardView {
  readonly provider: string;
  readonly account: string;
  readonly plan: string;
  readonly icon: ProviderIconDescriptor | undefined;
  readonly initial: string;
  readonly chips: readonly string[];
  readonly message: string | undefined;
  readonly quotaCountLabel: string;
  readonly quotas: readonly QuotaView[];
}

export interface UsageGroupView {
  readonly provider: string;
  readonly icon: ProviderIconDescriptor | undefined;
  readonly cards: readonly UsageCardView[];
}

export interface UsageView {
  readonly sweepLabel: string;
  readonly groups: readonly UsageGroupView[];
}

function buildQuota(name: string, quota: RouterUsageQuota, nowMs: number): QuotaView {
  const percent = quotaRemainingPercent(quota);

  return {
    name,
    tone: quota.unlimited ? 'ok' : quotaTone(percent),
    percent,
    usedLabel: `${formatAmount(quota.used)} / ${formatAmount(quota.total)}`,
    resetLabel: quota.unlimited ? 'N/A' : formatResetLabel(quota.resetAt, nowMs)
  };
}

function providerInitial(provider: string): string {
  const trimmed = provider.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

function buildChips(entry: RouterUsageEntry): string[] {
  const chips: string[] = [];
  if (entry.stale) {
    chips.push('stale');
  }
  if (entry.status.trim().toLowerCase() !== 'ok') {
    chips.push(entry.status);
  }

  return chips;
}

function buildCard(entry: RouterUsageEntry, nowMs: number): UsageCardView {
  const quotas = Object.entries(entry.quotas).map(([name, quota]) =>
    buildQuota(name, quota, nowMs)
  );
  const message =
    entry.message !== null && entry.message.trim().length > 0 ? entry.message : undefined;

  return {
    provider: formatProviderName(entry.provider),
    account: entry.name,
    plan: `${entry.plan} · ${entry.authType}`,
    icon: resolveProviderIcon(entry.provider),
    initial: providerInitial(entry.provider),
    chips: buildChips(entry),
    message,
    quotaCountLabel: `${quotas.length} quota${quotas.length === 1 ? '' : 's'}`,
    quotas
  };
}

function groupKey(provider: string): string {
  return provider.trim().toLowerCase();
}

function groupCards(entries: readonly RouterUsageEntry[], nowMs: number): UsageGroupView[] {
  const groups: UsageGroupView[] = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const card = buildCard(entry, nowMs);
    const key = groupKey(entry.provider);
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        provider: card.provider,
        icon: card.icon,
        cards: [card]
      });
      continue;
    }

    const existing = groups[existingIndex];
    if (!existing) {
      continue;
    }

    groups[existingIndex] = {
      provider: existing.provider,
      icon: existing.icon,
      cards: [...existing.cards, card]
    };
  }

  return groups;
}

export function buildUsageView(snapshot: RouterUsageSnapshot, nowMs: number): UsageView {
  return {
    sweepLabel: `Last sweep · ${formatTimestamp(snapshot.lastSweepAt)}`,
    groups: groupCards(snapshot.entries, nowMs)
  };
}
