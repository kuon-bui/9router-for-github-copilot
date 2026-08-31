import { randomBytes } from 'node:crypto';

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

export interface WebviewDocumentInput {
  readonly shell: string;
  readonly styleUri: string;
  readonly runtimeScriptUri: string;
  readonly scriptUri: string;
  readonly cspSource: string;
  readonly nonce: string;
}

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `style-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource} https://unpkg.com`
  ].join('; ');
}

// Missing placeholders make a blank panel with no host error, so fail during assembly.
export function renderWebviewDocument(input: WebviewDocumentInput): string {
  const values: Record<string, string> = {
    csp: buildCsp(input.cspSource, input.nonce),
    styleUri: input.styleUri,
    runtimeScriptUri: input.runtimeScriptUri,
    scriptUri: input.scriptUri,
    nonce: input.nonce
  };

  const seen = new Set<string>();
  const rendered = input.shell.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Unknown webview placeholder: {{${name}}}`);
    }

    seen.add(name);
    return value;
  });

  const missing = Object.keys(values).filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(`Webview shell is missing placeholders: ${missing.join(', ')}`);
  }

  return rendered;
}
