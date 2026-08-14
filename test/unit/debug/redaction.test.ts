import { describe, expect, it } from 'vitest';
import { redactBearerToken } from '@/debug/redaction';

describe('redactBearerToken', () => {
  it('replaces sensitive token content before logging', () => {
    expect(redactBearerToken('Bearer secret-token')).toBe('Bearer [REDACTED]');
  });
});
