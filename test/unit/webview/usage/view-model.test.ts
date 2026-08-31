import { describe, expect, it } from 'vitest';
import { buildUsageView } from '@/webview/usage/view-model';
import { parseRouterUsage } from '@/router/usage';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

const NOW_MS = Date.parse('2026-08-29T02:15:29.747Z');

function build() {
  return buildUsageView(parseRouterUsage(MOCK_USAGE_PAYLOAD), NOW_MS);
}

describe('buildUsageView', () => {
  it('titles cards from provider, account, and plan', () => {
    const [codex, deepseek] = build().cards;

    expect(codex?.provider).toBe('Codex');
    expect(codex?.account).toBe('test@gmail.com');
    expect(codex?.plan).toBe('plus · oauth');
    expect(codex?.icon?.slug).toBe('codex');
    expect(deepseek?.icon?.slug).toBe('deepseek');
  });

  it('grades nearly exhausted quota critical and healthy quota ok', () => {
    const quotas = build().cards[0]?.quotas ?? [];
    const session = quotas.find((quota) => quota.name === 'session');
    const weekly = quotas.find((quota) => quota.name === 'weekly');

    expect(session).toMatchObject({
      tone: 'critical', percent: 5, usedLabel: '95 / 100', resetLabel: 'in 3h 34m'
    });
    expect(weekly).toMatchObject({ tone: 'ok', percent: 77, usedLabel: '23 / 100' });
  });

  it('reports unlimited quota as full with no reset', () => {
    expect(build().cards[1]?.quotas[0]).toMatchObject({
      name: 'Balance (USD)', tone: 'ok', percent: 100, usedLabel: '0 / 2.91', resetLabel: 'N/A'
    });
  });

  it('counts quotas and pluralizes labels', () => {
    const cards = build().cards;
    expect(cards[0]?.quotaCountLabel).toBe('2 quotas');
    expect(cards[1]?.quotaCountLabel).toBe('1 quota');
  });

  it('keeps healthy connection chips and message empty', () => {
    const codex = build().cards[0];
    expect(codex?.chips).toEqual([]);
    expect(codex?.message).toBeUndefined();
  });

  it('falls back to provider initial without known icon', () => {
    const view = buildUsageView(parseRouterUsage({
      count: 1,
      lastSweepAt: '2026-08-29T02:15:29.747Z',
      entries: [{
        connectionId: 'x', provider: 'custom-router', name: 'n', authType: 'apikey',
        status: 'degraded', plan: 'free', quotas: {}, message: 'upstream slow',
        fetchedAt: '2026-08-29T02:15:29.747Z', stale: true
      }]
    }), NOW_MS);
    const card = view.cards[0];

    expect(card?.icon).toBeUndefined();
    expect(card?.initial).toBe('C');
    expect(card?.chips).toEqual(['stale', 'degraded']);
    expect(card?.message).toBe('upstream slow');
    expect(card?.quotaCountLabel).toBe('0 quotas');
  });
});
