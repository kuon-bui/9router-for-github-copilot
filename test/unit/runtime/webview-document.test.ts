import { describe, expect, it } from 'vitest';
import { createNonce, renderWebviewDocument } from '@/runtime/webview-document';

const SHELL = [
  '<meta http-equiv="Content-Security-Policy" content="{{csp}}">',
  '<link rel="stylesheet" href="{{styleUri}}">',
  '<script nonce="{{nonce}}" src="{{runtimeScriptUri}}"></script>',
  '<script nonce="{{nonce}}" src="{{scriptUri}}"></script>'
].join('\n');

function render(shell: string): string {
  return renderWebviewDocument({
    shell,
    styleUri: 'https://host/client.css',
    runtimeScriptUri: 'https://host/react.js',
    scriptUri: 'https://host/client.js',
    cspSource: 'vscode-webview://host',
    nonce: 'abc123'
  });
}

describe('createNonce', () => {
  it('produces a fresh hex nonce per call', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('renderWebviewDocument', () => {
  it('builds a policy that admits only extension assets and the nonced script', () => {
    expect(render(SHELL)).toContain(
      `content="default-src 'none'; style-src vscode-webview://host; script-src 'nonce-abc123'; img-src vscode-webview://host https://unpkg.com"`
    );
  });

  it('substitutes every asset placeholder', () => {
    const html = render(SHELL);

    expect(html).toContain('href="https://host/client.css"');
    expect(html).toContain('src="https://host/react.js"');
    expect(html).toContain('src="https://host/client.js"');
    expect(html).toContain('nonce="abc123"');
    expect(html).not.toContain('{{');
  });

  it('throws when the shell omits a placeholder', () => {
    expect(() => render('<meta content="{{csp}}">')).toThrow(/missing placeholders/);
  });

  it('throws on an unknown placeholder rather than leaving it in the output', () => {
    expect(() => render(`${SHELL}\n<p>{{title}}</p>`)).toThrow(/Unknown webview placeholder/);
  });
});
