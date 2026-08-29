export const MOCK_USAGE_PAYLOAD = {
  count: 2,
  lastSweepAt: '2026-08-29T02:15:29.747Z',
  entries: [
    {
      connectionId: '0111f102-2996-4ddd-8991-e61fd85bc7d4',
      provider: 'codex',
      name: 'test@gmail.com',
      authType: 'oauth',
      status: 'ok',
      plan: 'plus',
      quotas: {
        session: {
          used: 95,
          total: 100,
          remaining: 5,
          resetAt: '2026-08-29T05:50:05.000Z',
          unlimited: false
        },
        weekly: {
          used: 23,
          total: 100,
          remaining: 77,
          resetAt: '2026-09-04T00:42:13.000Z',
          unlimited: false
        }
      },
      message: null,
      fetchedAt: '2026-08-29T02:15:28.016Z',
      stale: false
    },
    {
      connectionId: 'c3bc4195-ecb1-4ccf-9ec7-a7e6abe96e56',
      provider: 'deepseek',
      name: '12',
      authType: 'apikey',
      status: 'ok',
      plan: 'DeepSeek',
      quotas: {
        'Balance (USD)': {
          used: 0,
          total: 2.91,
          remaining: null,
          resetAt: null,
          unlimited: true
        }
      },
      message: null,
      fetchedAt: '2026-08-29T02:15:29.747Z',
      stale: false
    }
  ]
} as const;
