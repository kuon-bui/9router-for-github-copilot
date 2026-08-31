import { describe, expect, it } from 'vitest';
import { createNonce, renderModelEditorHtml } from '@/runtime/model-editor-html';

describe('createNonce', () => {
  it('produces a fresh hex nonce per call', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('renderModelEditorHtml', () => {
  const html = renderModelEditorHtml('abc123');

  it('locks the page down with a nonce-bound CSP', () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-abc123';">`
    );
    expect(html).toContain('<script nonce="abc123">');
    expect(html).not.toContain('img-src');
  });

  it('ships the list, form, and warning containers the script targets', () => {
    for (const id of [
      'warnings',
      'model-list',
      'add-model',
      'model-form',
      'field-id',
      'field-name',
      'field-model-id',
      'field-catalog',
      'field-service-tier',
      'field-thinking-mode',
      'field-max-input-tokens',
      'field-max-output-tokens',
      'form-save',
      'form-cancel',
      'refresh-catalog'
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('embeds no settings or catalog data', () => {
    expect(html).not.toContain('9router-copilot.models');
  });

  it('interpolates no undefined values into the markup', () => {
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('="undefined"');
  });
});
