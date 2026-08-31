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

describe('client script behaviour', () => {
  const html = renderModelEditorHtml('abc123');

  it('wires the form to the save message contract', () => {
    expect(html).toContain("type: 'saveModel'");
    expect(html).toContain('editingSourceIndex');
    expect(html).toContain('prefillFromCatalog');
  });

  it('has no stubbed handlers left', () => {
    expect(html).not.toContain('function openForm() {}');
    expect(html).not.toContain('function renderCatalogOptions() {}');
  });
});

describe('two-page navigation', () => {
  const html = renderModelEditorHtml('abc123');

  it('splits the panel into a list view and a form view', () => {
    expect(html).toContain('id="view-list"');
    expect(html).toContain('id="view-form"');
  });

  it('opens on the list view with the form view hidden', () => {
    expect(html).toMatch(/id="view-form"[^>]*hidden/);
    expect(html).not.toMatch(/id="view-list"[^>]*hidden/);
  });

  it('gives each view its own error host', () => {
    expect(html).toContain('id="list-error"');
    expect(html).toContain('id="form-error"');
  });

  it('offers a back control on the form view', () => {
    expect(html).toContain('id="form-back"');
  });

  it('switches views from the client script', () => {
    expect(html).toContain('function showView(');
    expect(html).toContain("showView('list')");
    expect(html).toContain("showView('form')");
  });

  it('opens a blank add form when the host asks for the form view', () => {
    expect(html).toContain("message.type === 'showForm'");
    expect(html).toContain('openForm();');
  });
});
