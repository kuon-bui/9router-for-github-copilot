import { describe, expect, it } from 'vitest';
import {
  formatProviderName,
  formatResetLabel,
  quotaRemainingPercent,
  quotaTone,
  remainingPercent
} from '@/runtime/usage-format';

describe('usage-format', () => {
  it('title-cases provider names', () => {
    expect(formatProviderName('codex')).toBe('Codex');
    expect(formatProviderName('deepseek')).toBe('Deepseek');
    expect(formatProviderName('grok-cli')).toBe('Grok-Cli');
  });

  it('computes remaining percent', () => {
    expect(remainingPercent(95, 100)).toBe(5);
    expect(remainingPercent(0, 2.91)).toBe(100);
    expect(remainingPercent(100, 100)).toBe(0);
    expect(
      quotaRemainingPercent({
        used: 0,
        total: 2.91,
        remaining: null,
        resetAt: null,
        unlimited: true
      })
    ).toBe(100);
  });

  it('maps remaining percent to quota tones', () => {
    expect(quotaTone(100)).toBe('ok');
    expect(quotaTone(71)).toBe('ok');
    expect(quotaTone(70)).toBe('warn');
    expect(quotaTone(30)).toBe('warn');
    expect(quotaTone(29)).toBe('critical');
    expect(quotaTone(0)).toBe('critical');
  });

  it('formats compact remaining reset windows', () => {
    const nowMs = Date.parse('2026-08-29T02:15:29.747Z');
    expect(formatResetLabel('2026-08-29T05:50:05.000Z', nowMs)).toBe('in 3h 34m');
    expect(formatResetLabel(null, nowMs)).toBe('N/A');
  });
});
