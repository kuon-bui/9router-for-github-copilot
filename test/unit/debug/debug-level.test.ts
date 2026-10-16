import { describe, expect, it } from 'vitest';
import {
  DEBUG_RANK,
  isAllowedDebugLevel,
  shouldLogDebug
} from '@/debug/debug-level';

describe('debug-level', () => {
  it('correctly ranks debug modes', () => {
    expect(DEBUG_RANK.minimal).toBeLessThan(DEBUG_RANK.metadata);
    expect(DEBUG_RANK.metadata).toBeLessThan(DEBUG_RANK.verbose);
  });

  it('determines when events should be logged', () => {
    expect(shouldLogDebug('minimal', 'minimal')).toBe(true);
    expect(shouldLogDebug('minimal', 'metadata')).toBe(false);
    expect(shouldLogDebug('metadata', 'metadata')).toBe(true);
    expect(shouldLogDebug('metadata', 'verbose')).toBe(false);
    expect(shouldLogDebug('verbose', 'minimal')).toBe(true);
    expect(shouldLogDebug('verbose', 'metadata')).toBe(true);
    expect(shouldLogDebug('verbose', 'verbose')).toBe(true);
  });

  it('validates debug level strings', () => {
    expect(isAllowedDebugLevel('minimal')).toBe(true);
    expect(isAllowedDebugLevel('metadata')).toBe(true);
    expect(isAllowedDebugLevel('verbose')).toBe(true);
    expect(isAllowedDebugLevel('info')).toBe(false);
    expect(isAllowedDebugLevel('')).toBe(false);
  });
});
