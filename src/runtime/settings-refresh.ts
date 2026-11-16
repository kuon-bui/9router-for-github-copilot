import type * as vscode from 'vscode';

const SECTION = '9router-copilot';

// Only these keys feed the provider snapshot. Panel-only preferences such as usageCompact
// must not republish the picker, because every republish refetches the 9router catalog.
export const SNAPSHOT_SETTING_KEYS: readonly string[] = [
  'baseUrl',
  'models',
  'visionProxyModelId',
  'visionProxySource',
  'visionProxyPrompt',
  'maxTokens',
  'requestTimeoutMs',
  'debugMode'
];

// Multi-key writers (Configure Vision Proxy, Manage Models) emit several change events in a row.
export const SETTINGS_REFRESH_DELAY_MS = 100;

export interface CoalescedRefresh extends vscode.Disposable {
  schedule(): void;
}

export function affectsProviderSnapshot(
  event: Pick<vscode.ConfigurationChangeEvent, 'affectsConfiguration'>
): boolean {
  return SNAPSHOT_SETTING_KEYS.some((key) => event.affectsConfiguration(`${SECTION}.${key}`));
}

export function createCoalescedRefresh(refresh: () => void, delayMs: number): CoalescedRefresh {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    schedule(): void {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, delayMs);
    },
    dispose: cancel
  };
}
