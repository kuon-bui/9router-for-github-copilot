import { describe, expect, it } from 'vitest';
import { formatResetLabel, formatUsageHtml } from '@/runtime/usage-html';
import { parseRouterUsage } from '@/router/usage';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

describe('formatUsageHtml', () => {
  it('renders connection cards with remaining quota meters', () => {
    const nowMs = Date.parse('2026-08-29T02:15:29.747Z');
    const html = formatUsageHtml(parseRouterUsage(MOCK_USAGE_PAYLOAD), { nowMs });

    expect(html).toContain('Codex');
    expect(html).toContain('test@gmail.com');
    expect(html).toContain('plus · oauth');
    expect(html).toContain('session');
    expect(html).toContain('weekly');
    expect(html).toContain('95 / 100');
    expect(html).toContain('5%');
    expect(html).toContain('23 / 100');
    expect(html).toContain('77%');
    expect(html).toContain('in 3h 34m');
    expect(html).toContain('Balance (USD)');
    expect(html).toContain('0 / 2.91');
    expect(html).toContain('100%');
    expect(html).toContain('N/A');
    expect(html).toContain('command:9routerCopilot.showUsage');
    expect(html).not.toContain('Plan: plus');
    expect(html).not.toContain('Current session');
    expect(html).not.toContain('Weekly limits');
  });

  it('marks exhausted quotas as 0% remaining', () => {
    const html = formatUsageHtml(
      {
        count: 1,
        lastSweepAt: '2026-08-29T02:15:29.747Z',
        entries: [
          {
            connectionId: 'conn-exhausted',
            provider: 'codex',
            name: 'used-up@example.com',
            authType: 'oauth',
            status: 'ok',
            plan: 'plus',
            quotas: {
              session: {
                used: 100,
                total: 100,
                remaining: 0,
                resetAt: '2026-09-17T22:30:00.000Z',
                unlimited: false
              }
            },
            message: null,
            fetchedAt: '2026-08-29T02:15:28.016Z',
            stale: false
          }
        ]
      },
      { nowMs: Date.parse('2026-08-29T02:15:29.747Z') }
    );

    expect(html).toContain('100 / 100');
    expect(html).toContain('0%');
    expect(html).toContain('bar critical');
    expect(html).toContain('in 19d 20h 14m');
  });
});

describe('formatResetLabel', () => {
  it('formats compact remaining reset windows', () => {
    const nowMs = Date.parse('2026-08-29T02:15:29.747Z');
    expect(formatResetLabel('2026-08-29T05:50:05.000Z', nowMs)).toBe('in 3h 34m');
    expect(formatResetLabel('2026-09-04T00:42:13.000Z', nowMs)).toBe('in 5d 22h 26m');
    expect(formatResetLabel('2026-08-29T02:00:00.000Z', nowMs)).toBe('Reset available');
    expect(formatResetLabel(null, nowMs)).toBe('N/A');
  });
});
