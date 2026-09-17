import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Uri,
  __getConfigurationUpdates,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues
} from '@test/support/vscode';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';
import { parseRouterUsage } from '@/router/usage';
import { __resetUsagePanelForTests, showUsagePanel } from '@/runtime/usage-panel';

describe('showUsagePanel compact preference', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetUsagePanelForTests();
    __setConfigurationDefaults({ usageCompact: false });
    __setConfigurationValues({ usageCompact: false });
  });

  afterEach(() => {
    __resetUsagePanelForTests();
  });

  it('posts compact from settings on ready', async () => {
    __setConfigurationValues({ usageCompact: true });
    await showUsagePanel(Uri.file('/ext'), parseRouterUsage(MOCK_USAGE_PAYLOAD));

    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });

    expect(panel?.webview.postedMessages).toEqual([
      expect.objectContaining({
        type: 'usage',
        compact: true,
        snapshot: expect.objectContaining({ count: 2 })
      })
    ]);
  });

  it('persists compact toggle to global settings and rebroadcasts', async () => {
    await showUsagePanel(Uri.file('/ext'), parseRouterUsage(MOCK_USAGE_PAYLOAD));
    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });
    panel?.webview.postedMessages.length && (panel.webview.postedMessages.length = 0);

    await panel?.webview.receiveMessage({ type: 'setCompact', compact: true });

    expect(__getConfigurationUpdates()).toEqual([
      { key: 'usageCompact', value: true, target: 1 }
    ]);
    expect(panel?.webview.postedMessages).toEqual([
      expect.objectContaining({ type: 'usage', compact: true })
    ]);
  });
});
