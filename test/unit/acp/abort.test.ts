import { describe, expect, it } from 'vitest';
import { raceAbort } from '@/acp/abort';

describe('raceAbort', () => {
  it('aborts when any underlying signal aborts', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();

    const { signal, cleanup } = raceAbort([c1.signal, c2.signal]);
    expect(signal.aborted).toBe(false);

    c2.abort('cancelled by user');
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('cancelled by user');

    cleanup();
  });

  it('immediately returns aborted signal if an input signal is already aborted', () => {
    const c1 = new AbortController();
    c1.abort('pre-aborted');

    const { signal } = raceAbort([c1.signal]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('pre-aborted');
  });

  it('handles empty or undefined signals gracefully', () => {
    const { signal, cleanup } = raceAbort([undefined, undefined]);
    expect(signal.aborted).toBe(false);
    cleanup();
  });
});
