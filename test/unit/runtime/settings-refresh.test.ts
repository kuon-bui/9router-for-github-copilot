import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SETTINGS_REFRESH_DELAY_MS,
  SNAPSHOT_SETTING_KEYS,
  affectsProviderSnapshot,
  createCoalescedRefresh
} from '@/runtime/settings-refresh';

const eventFor = (section: string) => ({
  affectsConfiguration: (candidate: string) => candidate === section
});

describe('affectsProviderSnapshot', () => {
  it('covers exactly the settings the provider snapshot reads', () => {
    expect(SNAPSHOT_SETTING_KEYS).toEqual([
      'baseUrl',
      'models',
      'visionProxyModelId',
      'visionProxySource',
      'visionProxyPrompt',
      'maxTokens',
      'requestTimeoutMs',
      'debugMode'
    ]);
  });

  it.each(SNAPSHOT_SETTING_KEYS)('treats %s as a snapshot setting', (key) => {
    expect(affectsProviderSnapshot(eventFor(`9router-copilot.${key}`))).toBe(true);
  });

  it('ignores usageCompact and unrelated sections', () => {
    expect(affectsProviderSnapshot(eventFor('9router-copilot.usageCompact'))).toBe(false);
    expect(affectsProviderSnapshot(eventFor('editor.fontSize'))).toBe(false);
  });
});

describe('createCoalescedRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one refresh for a burst of schedules', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const coalesced = createCoalescedRefresh(refresh, SETTINGS_REFRESH_DELAY_MS);

    coalesced.schedule();
    coalesced.schedule();
    coalesced.schedule();
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SETTINGS_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels a pending refresh', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const coalesced = createCoalescedRefresh(refresh, SETTINGS_REFRESH_DELAY_MS);

    coalesced.schedule();
    coalesced.dispose();
    vi.advanceTimersByTime(SETTINGS_REFRESH_DELAY_MS);

    expect(refresh).not.toHaveBeenCalled();
  });
});
