import { beforeEach, describe, expect, it } from 'vitest';
import { setupAcpAgent } from '@/runtime/acp-setup';
import {
  __getClipboardText,
  __getErrorMessages,
  __getOpenedDocuments,
  __getShownDocuments,
  __getWarningMessages,
  __resetVscodeState,
  __setQuickPickValues,
  __setWarningResponse
} from '@test/support/vscode';

describe('setupAcpAgent', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  const baseSettings = {
    baseUrl: 'http://127.0.0.1:20128/v1',
    models: [{ id: 'gpt5', name: 'GPT-5', modelId: 'gh/gpt-5' }]
  };

  it('generates placeholder snippet, copies to clipboard and opens editor', async () => {
    __setQuickPickValues([
      { label: 'Zed', target: 'zed' },
      { label: 'GPT-5', modelId: 'gh/gpt-5' },
      { label: 'Placeholder (Recommended)', useRealKey: false }
    ]);

    await setupAcpAgent({
      secretStore: { getApiKey: async () => 'sk-secret' },
      settings: baseSettings,
      version: '0.15.0'
    });

    const clipboard = __getClipboardText();
    expect(clipboard).toContain('"command": "npx"');
    expect(clipboard).toContain('<your-9router-api-key>');

    const openedDocs = __getOpenedDocuments();
    expect(openedDocs).toHaveLength(1);
    expect(openedDocs[0]?.language).toBe('json');
    expect(openedDocs[0]?.content).toContain('<your-9router-api-key>');
    expect(__getShownDocuments()).toHaveLength(1);
    expect(__getWarningMessages()).toHaveLength(0);
  });

  it('generates real key snippet, shows modal warning, copies to clipboard, and NEVER opens editor', async () => {
    __setQuickPickValues([
      { label: 'JetBrains', target: 'jetbrains' },
      { label: 'GPT-5', modelId: 'gh/gpt-5' },
      { label: 'Include Current API Key', useRealKey: true }
    ]);
    __setWarningResponse('Copy to Clipboard');

    await setupAcpAgent({
      secretStore: { getApiKey: async () => 'sk-real-secret-key' },
      settings: baseSettings,
      version: '0.15.0'
    });

    const clipboard = __getClipboardText();
    expect(clipboard).toContain('sk-real-secret-key');

    // Modal warning was shown
    expect(__getWarningMessages()).toHaveLength(1);
    expect(__getWarningMessages()[0]).toContain('API key will be copied to your clipboard');

    // Never opened in document buffer
    expect(__getOpenedDocuments()).toHaveLength(0);
    expect(__getShownDocuments()).toHaveLength(0);
  });

  it('shows error if real key is requested but no key is stored', async () => {
    __setQuickPickValues([
      { label: 'Zed', target: 'zed' },
      { label: 'GPT-5', modelId: 'gh/gpt-5' },
      { label: 'Include Current API Key', useRealKey: true }
    ]);

    await setupAcpAgent({
      secretStore: { getApiKey: async () => undefined },
      settings: baseSettings,
      version: '0.15.0'
    });

    expect(__getErrorMessages()).toHaveLength(1);
    expect(__getErrorMessages()[0]).toContain('No 9router API key is stored');
    expect(__getClipboardText()).toBe('');
  });
});
