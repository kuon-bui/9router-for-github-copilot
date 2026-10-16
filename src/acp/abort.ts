export interface RaceAbortResult {
  signal: AbortSignal;
  cleanup: () => void;
}

export function raceAbort(signals: (AbortSignal | undefined | null)[]): RaceAbortResult {
  const controller = new AbortController();
  const validSignals = signals.filter((s): s is AbortSignal => Boolean(s));

  for (const s of validSignals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return {
        signal: controller.signal,
        cleanup: () => {}
      };
    }
  }

  const listener = (event: Event): void => {
    const target = event.target as AbortSignal;
    if (!controller.signal.aborted) {
      controller.abort(target.reason);
    }
    cleanup();
  };

  for (const s of validSignals) {
    s.addEventListener('abort', listener, { once: true });
  }

  function cleanup(): void {
    for (const s of validSignals) {
      s.removeEventListener('abort', listener);
    }
  }

  return {
    signal: controller.signal,
    cleanup
  };
}
