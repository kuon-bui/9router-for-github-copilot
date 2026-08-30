import { describe, expect, it } from 'vitest';
import { parseRouterUsage } from '@/router/usage';
import { NineRouterError } from '@/router/errors';
import { buildUsageUrl } from '@/router/url';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

describe('buildUsageUrl', () => {
  it('appends /tools/usage to a normalized base url', () => {
    expect(buildUsageUrl('https://router.example.com')).toBe(
      'https://router.example.com/tools/quotas'
    );
  });
});

describe('parseRouterUsage', () => {
  it('parses the mock usage payload with dynamic quota keys', () => {
    expect(parseRouterUsage(MOCK_USAGE_PAYLOAD)).toEqual({
      count: 2,
      lastSweepAt: '2026-08-29T02:15:29.747Z',
      entries: [
        expect.objectContaining({
          provider: 'codex',
          quotas: {
            session: expect.objectContaining({ used: 95, remaining: 5, unlimited: false }),
            weekly: expect.objectContaining({ used: 23, remaining: 77, unlimited: false })
          }
        }),
        expect.objectContaining({
          provider: 'deepseek',
          quotas: {
            'Balance (USD)': expect.objectContaining({
              used: 0,
              total: 2.91,
              remaining: null,
              resetAt: null,
              unlimited: true
            })
          }
        })
      ]
    });
  });

  it('skips malformed entries while keeping valid ones', () => {
    const result = parseRouterUsage({
      count: 2,
      lastSweepAt: '2026-08-29T02:15:29.747Z',
      entries: [
        MOCK_USAGE_PAYLOAD.entries[0],
        { provider: 'broken' },
        MOCK_USAGE_PAYLOAD.entries[1]
      ]
    });

    expect(result.entries.map((entry) => entry.provider)).toEqual(['codex', 'deepseek']);
  });

  it('rejects malformed top-level payloads', () => {
    expect(() => parseRouterUsage({ entries: [] })).toThrow(NineRouterError);
    expect(() => parseRouterUsage(null)).toThrow(/usage response is malformed/);
  });
});
