# Webview Asset Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all webview HTML, CSS, and client code out of TypeScript string literals into real files, built by Vite and served to the panels through `asWebviewUri`.

**Architecture:** A new top-level `src/webview/` holds browser code — React components, Tailwind stylesheets, and hand-written HTML shells. Vite builds three targets (the extension host bundle and one bundle per view), replacing esbuild entirely. The panels read their shell from `dist/webview/<view>/index.html`, substitute four placeholders through a pure `renderWebviewDocument`, and post state to the client instead of generating markup.

**Tech Stack:** TypeScript, Vite 8 (Rolldown), React, Tailwind CSS v4, Vitest, VS Code Extension API.

**Spec:** `docs/superpowers/specs/2026-08-31-webview-asset-extraction-design.md`

## Global Constraints

- TypeScript strict mode stays on, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Under `exactOptionalPropertyTypes`, never assign a possibly-`undefined` expression to an optional property — spread it in conditionally, as `createRow` in `src/runtime/model-editor-view.ts` already does.
- `@typescript-eslint/no-explicit-any` is an error. No `any`.
- `no-console` is an error in `src/**`. Build scripts under `scripts/` are `.mjs` and are not linted by the TypeScript block, so they may print.
- `@typescript-eslint/consistent-type-imports` is an error: type-only imports must use `import type`.
- Nothing under `src/webview/` may import `vscode` or any `node:*` module.
- Package manager is `pnpm`. Run commands as `pnpm run <script>`.
- The generated CSP is exactly: `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} https://unpkg.com`
- Webview asset filenames are fixed: `client.js` and `client.css` under `dist/webview/<view>/`.
- Placeholders in `index.html` shells are exactly `{{csp}}`, `{{styleUri}}`, `{{scriptUri}}`, `{{nonce}}`.
- **Every `.tsx` file must start with `import type { JSX } from 'react';`.** The components use `JSX.Element` as a return type, and React 19 removed the global `JSX` namespace — without that import the file does not compile. The code blocks below show the other imports each file needs; add this one to all of them.
- The watch script must print `[watch] build started` and `[watch] build finished`. `.vscode/tasks.json` gates F5 on those lines.
- Commit after every task. Do not squash tasks into one commit.

---

### Task 1: Vite replaces esbuild for the extension host

The extension bundle moves from an esbuild CLI line to Vite, and the build/watch scripts become Node scripts. Nothing under `src/` changes.

**Files:**
- Create: `scripts/vite-config.mjs`
- Create: `scripts/build.mjs`
- Create: `scripts/watch.mjs`
- Modify: `package.json` (scripts, devDependencies)
- Modify: `.vscode/tasks.json` (problem matcher)
- Modify: `.vscodeignore` (exclude `scripts/**`)

**Interfaces:**
- Produces: `createExtensionConfig({ watch })` and `createWebviewConfig(view, { watch })` from `scripts/vite-config.mjs`. Task 2 fills in the webview factory's callers; this task defines both signatures.

- [ ] **Step 1: Verify the three build assumptions before writing anything**

The spec flags these as the only unproven parts of the stack. Prove them in a scratch directory, not in the repo. Install nothing permanent yet.

Run, from the repo root:

```bash
node -e "console.log(require('./node_modules/.pnpm/vite@8.1.4_@types+node@26.1.1_esbuild@0.28.2/node_modules/vite/package.json').version)"
```

Expected: `8.1.4`. If Vite is not at that path, run `pnpm ls vite --depth 2` to find the actual version and use it below.

Record the answers to these three questions before continuing:

1. Does `build.lib` with `formats: ['cjs']` plus `rollupOptions.external: ['vscode']` produce a loadable CJS bundle? If `build.lib` and `build.ssr` conflict, drop `ssr` and rely on `build.target: 'node20'` plus an explicit external list of node builtins.
2. Does a `.tsx` file build with the automatic JSX runtime without `@vitejs/plugin-react`? (Needed by Task 2, not this task — but answer it now while you have a scratch project open.)
3. Does `@tailwindcss/vite` load under this Vite? (Same — needed by Task 2.)

If any answer is no, adjust the configs in this task and Task 2 accordingly and note the deviation in the commit message. Do not silently work around it.

- [ ] **Step 2: Add Vite, remove esbuild**

```bash
pnpm add -D vite
pnpm remove esbuild
```

- [ ] **Step 3: Write `scripts/vite-config.mjs`**

```js
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Prints the markers `.vscode/tasks.json` gates the F5 launch on. */
export function watchMarkerPlugin(counter) {
  return {
    name: '9router-watch-markers',
    buildStart() {
      if (counter.pending === 0) {
        console.log('[watch] build started');
      }
      counter.pending += 1;
    },
    writeBundle() {
      counter.pending -= 1;
      if (counter.pending === 0) {
        console.log('[watch] build finished');
      }
    }
  };
}

export function createExtensionConfig({ watch = false, counter } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    plugins: counter ? [watchMarkerPlugin(counter)] : [],
    resolve: { alias: { '@': resolve(root, 'src') } },
    build: {
      target: 'node20',
      outDir: resolve(root, 'dist/src'),
      emptyOutDir: false,
      minify: !watch,
      sourcemap: watch,
      lib: {
        entry: resolve(root, 'src/extension.ts'),
        formats: ['cjs'],
        fileName: () => 'extension.js'
      },
      rollupOptions: {
        external: ['vscode', /^node:/]
      },
      watch: watch ? {} : null
    }
  };
}

export function createWebviewConfig(view, { watch = false, counter, plugins = [] } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    plugins: [...plugins, ...(counter ? [watchMarkerPlugin(counter)] : [])],
    resolve: { alias: { '@': resolve(root, 'src') } },
    build: {
      target: 'es2022',
      outDir: resolve(root, `dist/webview/${view}`),
      emptyOutDir: true,
      minify: !watch,
      sourcemap: watch,
      lib: {
        entry: resolve(root, `src/webview/${view}/main.tsx`),
        formats: ['iife'],
        name: 'NineRouterWebview',
        fileName: () => 'client.js'
      },
      rollupOptions: {
        output: { assetFileNames: 'client.[ext]' }
      },
      watch: watch ? {} : null
    }
  };
}

export const WEBVIEW_VIEWS = [];
```

`WEBVIEW_VIEWS` is empty until Task 2 adds views. Leaving it declared here means Task 2 changes one line rather than restructuring the file.

- [ ] **Step 4: Write `scripts/build.mjs`**

```js
import { build } from 'vite';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEBVIEW_VIEWS, createExtensionConfig, createWebviewConfig } from './vite-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build(createExtensionConfig({}));

for (const view of WEBVIEW_VIEWS) {
  await build(createWebviewConfig(view, {}));
  await cp(
    resolve(root, `src/webview/${view}/index.html`),
    resolve(root, `dist/webview/${view}/index.html`)
  );
}
```

- [ ] **Step 5: Write `scripts/watch.mjs`**

```js
import { build } from 'vite';
import { cp, watch as watchDir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEBVIEW_VIEWS, createExtensionConfig, createWebviewConfig } from './vite-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const counter = { pending: 0 };

async function copyShell(view) {
  await cp(
    resolve(root, `src/webview/${view}/index.html`),
    resolve(root, `dist/webview/${view}/index.html`)
  );
}

await build(createExtensionConfig({ watch: true, counter }));

for (const view of WEBVIEW_VIEWS) {
  await copyShell(view);
  await build(createWebviewConfig(view, { watch: true, counter }));

  // Vite watches the module graph, and index.html is not in it.
  void (async () => {
    for await (const _event of watchDir(resolve(root, `src/webview/${view}`))) {
      await copyShell(view);
    }
  })();
}
```

- [ ] **Step 6: Update `package.json` scripts**

Replace the `build` and `watch` scripts with:

```json
"build": "pnpm run clean && tsc -p tsconfig.json && node scripts/build.mjs",
"watch": "node scripts/watch.mjs",
```

Leave `clean`, `lint`, `test:unit`, `test:integration`, `test`, `package`, and `vscode:prepublish` unchanged. Task 2 adds the second `tsc` invocation.

- [ ] **Step 7: Exclude build scripts from the VSIX**

`scripts/` was empty, so `.vscodeignore` never mentioned it. It now holds build tooling that must not ship. Add this line to `.vscodeignore`, next to the other tooling entries:

```
scripts/**
```

- [ ] **Step 8: Retarget the problem matcher in `.vscode/tasks.json`**

The `watch` task's matcher uses esbuild's error format. Replace the `problemMatcher` object of the `watch` task with:

```json
"problemMatcher": {
  "owner": "vite",
  "pattern": {
    "regexp": "^\\s*(?:error|✗)\\s+(.*)$",
    "message": 1
  },
  "background": {
    "activeOnStart": true,
    "beginsPattern": "^\\[watch\\] build started",
    "endsPattern": "^\\[watch\\] build finished"
  }
}
```

The `background` patterns are unchanged — those are what gate F5, and `watchMarkerPlugin` emits them.

- [ ] **Step 9: Verify the build produces the same artifact**

Run: `pnpm run build`
Expected: exits 0, and `dist/src/extension.js` exists.

Run: `node -e "const s=require('node:fs').readFileSync('dist/src/extension.js','utf8'); if(!s.includes('require(\"vscode\")')&&!s.includes(\"require('vscode')\")) { throw new Error('vscode was inlined, not left external'); } console.log('vscode is external: ok');"`
Expected: prints `vscode is external: ok`.

- [ ] **Step 10: Verify the whole suite still passes**

Run: `pnpm run lint`
Expected: exits 0.

Run: `pnpm test`
Expected: all tests pass. No source changed, so nothing should have moved.

- [ ] **Step 11: Verify the watch markers**

Run: `pnpm run watch`
Expected: the output contains `[watch] build started` and then `[watch] build finished`. Stop it with Ctrl-C once both appear. If they do not appear, F5 will hang — fix `watchMarkerPlugin` before continuing.

- [ ] **Step 12: Commit**

```bash
git add scripts package.json pnpm-lock.yaml .vscode/tasks.json .vscodeignore
git commit -m "build: replace esbuild with vite for the extension bundle"
```

---

### Task 2: Webview toolchain and the usage scaffold

Stands up `src/webview/` with its own tsconfig, lint rules, React, and Tailwind, proven by a usage view that builds and renders a heading. Task 6 fills in the real UI.

**Files:**
- Create: `src/webview/tsconfig.json`
- Create: `src/webview/css-modules.d.ts`
- Create: `src/webview/shared/theme.css`
- Create: `src/webview/usage/index.html`
- Create: `src/webview/usage/usage.css`
- Create: `src/webview/usage/main.tsx`
- Modify: `tsconfig.json` (exclude `src/webview/**`)
- Modify: `eslint.config.js` (webview block)
- Modify: `scripts/vite-config.mjs:WEBVIEW_VIEWS`
- Modify: `package.json` (deps, second `tsc` in `build`)

**Interfaces:**
- Consumes: `createWebviewConfig(view, opts)` from Task 1.
- Produces: `dist/webview/usage/{index.html,client.js,client.css}`. Tasks 3 and 6 depend on those exact paths and names.

- [ ] **Step 1: Install React and Tailwind**

```bash
pnpm add -D react react-dom @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create `src/webview/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "noEmit": true,
    "paths": {
      "@/*": ["../*"]
    },
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts", "./**/*.tsx"]
}
```

`types: []` is the transitive guard described in the spec: with no ambient type packages, any module in the reachable graph that imports `vscode` as a value fails to resolve, so a boundary violation five imports deep still breaks the build.

- [ ] **Step 3: Create `src/webview/css-modules.d.ts`**

```ts
declare module '*.css';
```

- [ ] **Step 4: Exclude webview code from the root tsconfig**

Add to `tsconfig.json`, as a sibling of `"include"`:

```json
"exclude": ["src/webview/**"]
```

- [ ] **Step 5: Create `src/webview/shared/theme.css`**

```css
@theme {
  --color-bg: var(--vscode-editor-background);
  --color-fg: var(--vscode-editor-foreground);
  --color-muted: var(--vscode-descriptionForeground);
  --color-card: var(--vscode-editorWidget-background);
  --color-border: var(--vscode-widget-border);
  --color-panel-border: var(--vscode-panel-border);
  --color-input: var(--vscode-input-background);
  --color-input-fg: var(--vscode-input-foreground);
  --color-btn: var(--vscode-button-background);
  --color-btn-fg: var(--vscode-button-foreground);
  --color-btn-alt: var(--vscode-button-secondaryBackground);
  --color-btn-alt-fg: var(--vscode-button-secondaryForeground);
  --color-badge: var(--vscode-badge-background);
  --color-badge-fg: var(--vscode-badge-foreground);
  --color-err: var(--vscode-inputValidation-errorBorder);
  --color-err-bg: var(--vscode-inputValidation-errorBackground);
  --color-err-fg: var(--vscode-errorForeground);
  --color-warn-border: var(--vscode-inputValidation-warningBorder);
  --color-warn-bg: var(--vscode-inputValidation-warningBackground);
  --color-ok: #3dd68c;
  --color-warn: #e3b341;
  --color-critical: #f85149;
  --font-sans: var(--vscode-font-family);
  --font-mono: var(--vscode-editor-font-family);
}
```

VS Code swaps the underlying `--vscode-*` values when the user changes theme, so no `dark:` variants and no `prefers-color-scheme` blocks belong anywhere in this project.

- [ ] **Step 6: Create `src/webview/usage/usage.css`**

```css
@import 'tailwindcss';
@import '../shared/theme.css';
@source './**/*.tsx';
@source '../shared/**/*.ts';
```

- [ ] **Step 7: Create `src/webview/usage/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="{{csp}}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>9router Usage</title>
<link rel="stylesheet" href="{{styleUri}}">
</head>
<body>
<div id="root"></div>
<script nonce="{{nonce}}" src="{{scriptUri}}"></script>
</body>
</html>
```

- [ ] **Step 8: Create `src/webview/usage/main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import './usage.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<h1 className="text-fg font-sans">Usage</h1>);
}
```

- [ ] **Step 9: Register the view and wire the Tailwind plugin**

In `scripts/vite-config.mjs`, replace the `WEBVIEW_VIEWS` line with:

```js
export const WEBVIEW_VIEWS = ['usage'];
```

and add the Tailwind plugin so every webview build gets it. At the top of the file:

```js
import tailwindcss from '@tailwindcss/vite';
```

and in `createWebviewConfig`, change the `plugins` line to:

```js
    plugins: [tailwindcss(), ...plugins, ...(counter ? [watchMarkerPlugin(counter)] : [])],
```

- [ ] **Step 10: Add the webview lint block**

In `eslint.config.js`, append this object to the exported array, after the existing `**/*.ts` block:

```js
  {
    files: ['src/webview/**/*.ts', 'src/webview/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        document: 'readonly',
        window: 'readonly',
        Element: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        Event: 'readonly',
        MessageEvent: 'readonly',
        acquireVsCodeApi: 'readonly'
      }
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'Webview code runs in the browser sandbox.' }],
          patterns: [{ group: ['node:*'], message: 'Webview code runs in the browser sandbox.' }]
        }
      ]
    }
  }
```

- [ ] **Step 11: Add webview type checking to the build**

In `package.json`, change `build` to:

```json
"build": "pnpm run clean && tsc -p tsconfig.json && tsc -p src/webview/tsconfig.json && node scripts/build.mjs",
```

- [ ] **Step 12: Verify the toolchain end to end**

Run: `pnpm run build`
Expected: exits 0.

Run: `node -e "const fs=require('node:fs'); for (const f of ['index.html','client.js','client.css']) { fs.accessSync('dist/webview/usage/'+f); } const css=fs.readFileSync('dist/webview/usage/client.css','utf8'); if(!css.includes('--vscode-editor-background')) throw new Error('theme tokens missing from emitted css'); console.log('webview assets ok');"`
Expected: prints `webview assets ok`. This proves Tailwind ran, the `@theme` block reached the output, and the file names are the fixed ones the panels will look for.

Run: `pnpm run lint`
Expected: exits 0.

- [ ] **Step 13: Verify the boundary guard actually bites**

Temporarily add this line to the top of `src/webview/usage/main.tsx`:

```tsx
import * as vscode from 'vscode';
```

Run: `pnpm run lint`
Expected: FAIL, reporting the restricted import.

Run: `npx tsc -p src/webview/tsconfig.json`
Expected: FAIL, cannot find module `vscode`.

Remove the line before continuing. If either check passed, the guard is not working — fix it now, because it is the only thing preventing the boundary from eroding silently.

- [ ] **Step 14: Commit**

```bash
git add src/webview tsconfig.json eslint.config.js package.json pnpm-lock.yaml scripts/vite-config.mjs
git commit -m "build: add the webview toolchain with react and tailwind"
```

---

### Task 3: Document assembly and asset resolution

The pure placeholder/CSP renderer, the vscode-facing shell reader, and the test-mock surface both panels will need.

**Files:**
- Create: `src/runtime/webview-document.ts`
- Create: `src/runtime/webview-assets.ts`
- Create: `test/unit/runtime/webview-document.test.ts`
- Modify: `test/support/vscode.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `createNonce(): string`
  - `renderWebviewDocument(input: WebviewDocumentInput): string`
  - `renderWebviewPanelHtml(webview, extensionUri, view): Promise<string>`
  - `__resetWebviewShellCacheForTests(): void`
  - From the mock: `Uri.file`, `Uri.joinPath`, `workspace.fs.readFile`, `webview.cspSource`, `webview.asWebviewUri`, `__setWebviewShell(html)`.
  Tasks 6 and 8 call `renderWebviewPanelHtml`; their tests call `__setWebviewShell`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/runtime/webview-document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNonce, renderWebviewDocument } from '@/runtime/webview-document';

const SHELL = [
  '<meta http-equiv="Content-Security-Policy" content="{{csp}}">',
  '<link rel="stylesheet" href="{{styleUri}}">',
  '<script nonce="{{nonce}}" src="{{scriptUri}}"></script>'
].join('\n');

function render(shell: string): string {
  return renderWebviewDocument({
    shell,
    styleUri: 'https://host/client.css',
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/webview-document.test.ts`
Expected: FAIL — cannot resolve `@/runtime/webview-document`.

- [ ] **Step 3: Write `src/runtime/webview-document.ts`**

```ts
import { randomBytes } from 'node:crypto';

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

export interface WebviewDocumentInput {
  readonly shell: string;
  readonly styleUri: string;
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

// A placeholder left unsubstituted renders a blank panel with no error anywhere,
// so both directions of mismatch are treated as bugs at assembly time.
export function renderWebviewDocument(input: WebviewDocumentInput): string {
  const values: Record<string, string> = {
    csp: buildCsp(input.cspSource, input.nonce),
    styleUri: input.styleUri,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/webview-document.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `src/runtime/webview-assets.ts`**

This is the only module that touches the filesystem, which is what keeps `webview-document.ts` pure and directly testable.

```ts
import * as vscode from 'vscode';
import { createNonce, renderWebviewDocument } from './webview-document';

const shells = new Map<string, string>();

function viewRoot(extensionUri: vscode.Uri, view: string): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview', view);
}

export function webviewLocalResourceRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
}

export async function renderWebviewPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: string
): Promise<string> {
  const root = viewRoot(extensionUri, view);

  let shell = shells.get(view);
  if (shell === undefined) {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(root, 'index.html')
    );
    shell = new TextDecoder().decode(bytes);
    shells.set(view, shell);
  }

  return renderWebviewDocument({
    shell,
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'client.css')).toString(),
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'client.js')).toString(),
    cspSource: webview.cspSource,
    nonce: createNonce()
  });
}

export function __resetWebviewShellCacheForTests(): void {
  shells.clear();
}
```

- [ ] **Step 6: Extend the vscode test mock**

In `test/support/vscode.ts`, add a `Uri` implementation. Place it above the `Webview` class:

```ts
interface MockUri {
  readonly scheme: string;
  readonly fsPath: string;
  readonly path: string;
  toString(): string;
}

function createUri(fsPath: string): MockUri {
  return {
    scheme: 'file',
    fsPath,
    path: fsPath,
    toString: () => `file://${fsPath}`
  };
}

export const Uri = {
  file: createUri,
  joinPath(base: MockUri, ...segments: string[]): MockUri {
    return createUri([base.fsPath, ...segments].join('/'));
  }
};
```

Add these two members to the `Webview` class body:

```ts
  public readonly cspSource = 'vscode-webview://mock';

  public asWebviewUri(uri: MockUri): MockUri {
    return {
      ...uri,
      scheme: 'vscode-webview',
      toString: () => `vscode-webview://mock${uri.fsPath}`
    };
  }
```

Add the shell store and its reset near the other module-level test state:

```ts
const DEFAULT_WEBVIEW_SHELL = [
  '<meta http-equiv="Content-Security-Policy" content="{{csp}}">',
  '<link rel="stylesheet" href="{{styleUri}}">',
  '<div id="root"></div>',
  '<script nonce="{{nonce}}" src="{{scriptUri}}"></script>'
].join('\n');

let webviewShell = DEFAULT_WEBVIEW_SHELL;

export function __setWebviewShell(html: string): void {
  webviewShell = html;
}
```

Add `webviewShell = DEFAULT_WEBVIEW_SHELL;` to the body of `__resetVscodeState`.

Add an `fs` member to the exported `workspace` object:

```ts
  fs: {
    async readFile(_uri: MockUri): Promise<Uint8Array> {
      return new TextEncoder().encode(webviewShell);
    }
  },
```

The mock serves a stub shell rather than reading `dist/`, so unit tests never depend on a prior build.

- [ ] **Step 7: Verify nothing regressed**

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm run lint`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/webview-document.ts src/runtime/webview-assets.ts test/unit/runtime/webview-document.test.ts test/support/vscode.ts
git commit -m "feat: add webview document assembly and asset resolution"
```

---

### Task 4: Move the shared formatters and delete dead code

`usage-format.ts` and `provider-icons.ts` become webview modules. `usage-markdown.ts` is the only thing still holding them on the extension side, and nothing imports it.

**Files:**
- Delete: `src/runtime/usage-markdown.ts`
- Move: `src/runtime/usage-format.ts` → `src/webview/shared/usage-format.ts`
- Move: `src/runtime/provider-icons.ts` → `src/webview/shared/provider-icons.ts`
- Move: `test/unit/runtime/usage-format.test.ts` → `test/unit/webview/shared/usage-format.test.ts`
- Move: `test/unit/runtime/provider-icons.test.ts` → `test/unit/webview/shared/provider-icons.test.ts`
- Modify: `src/runtime/usage-html.ts` (import paths only)

**Interfaces:**
- Produces: `@/webview/shared/usage-format` exporting `formatProviderName`, `formatAmount`, `remainingPercent`, `quotaTone`, `quotaRemainingPercent`, `formatResetLabel`, `formatTimestamp`, and the type `QuotaTone`. `@/webview/shared/provider-icons` exporting `resolveProviderIcon` and the type `ProviderIconDescriptor`. Task 5 imports both.

- [ ] **Step 1: Confirm the dead code is dead before deleting it**

Run: `grep -rn "usage-markdown\|formatUsageMarkdown" src test`
Expected: matches only inside `src/runtime/usage-markdown.ts` itself. If anything else matches, stop — the spec's premise is wrong and the file must be kept.

- [ ] **Step 2: Delete it**

```bash
git rm src/runtime/usage-markdown.ts
```

- [ ] **Step 3: Move the two modules**

```bash
mkdir -p src/webview/shared test/unit/webview/shared
git mv src/runtime/usage-format.ts src/webview/shared/usage-format.ts
git mv src/runtime/provider-icons.ts src/webview/shared/provider-icons.ts
git mv test/unit/runtime/usage-format.test.ts test/unit/webview/shared/usage-format.test.ts
git mv test/unit/runtime/provider-icons.test.ts test/unit/webview/shared/provider-icons.test.ts
```

- [ ] **Step 4: Fix the import paths**

In `test/unit/webview/shared/usage-format.test.ts`, change `@/runtime/usage-format` to `@/webview/shared/usage-format`.

In `test/unit/webview/shared/provider-icons.test.ts`, change `@/runtime/provider-icons` to `@/webview/shared/provider-icons`.

In `src/runtime/usage-html.ts`, change `'./usage-format'` to `'@/webview/shared/usage-format'` (two occurrences: the named import and the re-export) and `'./provider-icons'` to `'@/webview/shared/provider-icons'`.

`usage-html.ts` is deleted in Task 6. It is repointed here so the tree stays green between tasks.

- [ ] **Step 5: Verify**

Run: `pnpm test`
Expected: all tests pass, including the two moved files at their new paths.

Run: `npx tsc -p src/webview/tsconfig.json`
Expected: exits 0. The moved modules must compile under `types: []` — this proves they were runtime-agnostic.

Run: `pnpm run lint`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A src test
git commit -m "refactor: move usage formatters into the webview and drop dead markdown"
```

---

### Task 5: The usage view model

A pure function turning a snapshot into plain data. This is what makes the usage panel testable without a DOM.

**Files:**
- Create: `src/webview/usage/view-model.ts`
- Create: `test/unit/webview/usage/view-model.test.ts`

**Interfaces:**
- Consumes: `@/webview/shared/usage-format`, `@/webview/shared/provider-icons` from Task 4.
- Produces: `buildUsageView(snapshot, nowMs): UsageView`, and the exported types `UsageView`, `UsageCardView`, `QuotaView`. Task 6's components render these.

- [ ] **Step 1: Write the failing test**

Create `test/unit/webview/usage/view-model.test.ts`. The expectations are carried over from the deleted `usage-html.test.ts` so coverage does not regress.

```ts
import { describe, expect, it } from 'vitest';
import { buildUsageView } from '@/webview/usage/view-model';
import { parseRouterUsage } from '@/router/usage';
import { MOCK_USAGE_PAYLOAD } from '@test/support/usage-fixture';

const NOW_MS = Date.parse('2026-08-29T02:15:29.747Z');

function build() {
  return buildUsageView(parseRouterUsage(MOCK_USAGE_PAYLOAD), NOW_MS);
}

describe('buildUsageView', () => {
  it('titles each card from the provider, account, and plan', () => {
    const [codex, deepseek] = build().cards;

    expect(codex?.provider).toBe('Codex');
    expect(codex?.account).toBe('test@gmail.com');
    expect(codex?.plan).toBe('plus · oauth');
    expect(codex?.icon?.slug).toBe('codex');
    expect(deepseek?.icon?.slug).toBe('deepseek');
  });

  it('grades a nearly exhausted quota as critical and a healthy one as ok', () => {
    const quotas = build().cards[0]?.quotas ?? [];
    const session = quotas.find((quota) => quota.name === 'session');
    const weekly = quotas.find((quota) => quota.name === 'weekly');

    expect(session).toMatchObject({
      tone: 'critical',
      percent: 5,
      usedLabel: '95 / 100',
      resetLabel: 'in 3h 34m'
    });
    expect(weekly).toMatchObject({ tone: 'ok', percent: 77, usedLabel: '23 / 100' });
  });

  it('reports an unlimited quota as full with no reset', () => {
    const balance = build().cards[1]?.quotas[0];

    expect(balance).toMatchObject({
      name: 'Balance (USD)',
      tone: 'ok',
      percent: 100,
      usedLabel: '0 / 2.91',
      resetLabel: 'N/A'
    });
  });

  it('counts quotas per card and pluralises the label', () => {
    const cards = build().cards;

    expect(cards[0]?.quotaCountLabel).toBe('2 quotas');
    expect(cards[1]?.quotaCountLabel).toBe('1 quota');
  });

  it('leaves chips and message empty for a healthy connection', () => {
    const codex = build().cards[0];

    expect(codex?.chips).toEqual([]);
    expect(codex?.message).toBeUndefined();
  });

  it('falls back to an initial when the provider has no known icon', () => {
    const view = buildUsageView(
      parseRouterUsage({
        count: 1,
        lastSweepAt: '2026-08-29T02:15:29.747Z',
        entries: [
          {
            connectionId: 'x',
            provider: 'custom-router',
            name: 'n',
            authType: 'apikey',
            status: 'degraded',
            plan: 'free',
            quotas: {},
            message: 'upstream slow',
            fetchedAt: '2026-08-29T02:15:29.747Z',
            stale: true
          }
        ]
      }),
      NOW_MS
    );
    const card = view.cards[0];

    expect(card?.icon).toBeUndefined();
    expect(card?.initial).toBe('C');
    expect(card?.chips).toEqual(['stale', 'degraded']);
    expect(card?.message).toBe('upstream slow');
    expect(card?.quotaCountLabel).toBe('0 quotas');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/webview/usage/view-model.test.ts`
Expected: FAIL — cannot resolve `@/webview/usage/view-model`.

- [ ] **Step 3: Write `src/webview/usage/view-model.ts`**

```ts
import { resolveProviderIcon } from '@/webview/shared/provider-icons';
import {
  formatAmount,
  formatProviderName,
  formatResetLabel,
  formatTimestamp,
  quotaRemainingPercent,
  quotaTone
} from '@/webview/shared/usage-format';
import type { ProviderIconDescriptor } from '@/webview/shared/provider-icons';
import type { QuotaTone } from '@/webview/shared/usage-format';
import type {
  RouterUsageEntry,
  RouterUsageQuota,
  RouterUsageSnapshot
} from '@/router/usage';

export interface QuotaView {
  readonly name: string;
  readonly tone: QuotaTone;
  readonly percent: number;
  readonly usedLabel: string;
  readonly resetLabel: string;
}

export interface UsageCardView {
  readonly provider: string;
  readonly account: string;
  readonly plan: string;
  readonly icon: ProviderIconDescriptor | undefined;
  readonly initial: string;
  readonly chips: readonly string[];
  readonly message: string | undefined;
  readonly quotaCountLabel: string;
  readonly quotas: readonly QuotaView[];
}

export interface UsageView {
  readonly sweepLabel: string;
  readonly cards: readonly UsageCardView[];
}

function buildQuota(name: string, quota: RouterUsageQuota, nowMs: number): QuotaView {
  const percent = quotaRemainingPercent(quota);

  return {
    name,
    tone: quota.unlimited ? 'ok' : quotaTone(percent),
    percent,
    usedLabel: `${formatAmount(quota.used)} / ${formatAmount(quota.total)}`,
    resetLabel: quota.unlimited ? 'N/A' : formatResetLabel(quota.resetAt, nowMs)
  };
}

function providerInitial(provider: string): string {
  const trimmed = provider.trim();
  return trimmed.length === 0 ? '?' : trimmed.charAt(0).toUpperCase();
}

function buildChips(entry: RouterUsageEntry): string[] {
  const chips: string[] = [];
  if (entry.stale) {
    chips.push('stale');
  }
  if (entry.status.trim().toLowerCase() !== 'ok') {
    chips.push(entry.status);
  }

  return chips;
}

function buildCard(entry: RouterUsageEntry, nowMs: number): UsageCardView {
  const quotas = Object.entries(entry.quotas).map(([name, quota]) =>
    buildQuota(name, quota, nowMs)
  );
  const message =
    entry.message !== null && entry.message.trim().length > 0 ? entry.message : undefined;

  return {
    provider: formatProviderName(entry.provider),
    account: entry.name,
    plan: `${entry.plan} · ${entry.authType}`,
    icon: resolveProviderIcon(entry.provider),
    initial: providerInitial(entry.provider),
    chips: buildChips(entry),
    message,
    quotaCountLabel: `${quotas.length} quota${quotas.length === 1 ? '' : 's'}`,
    quotas
  };
}

export function buildUsageView(
  snapshot: RouterUsageSnapshot,
  nowMs: number
): UsageView {
  return {
    sweepLabel: `Last sweep · ${formatTimestamp(snapshot.lastSweepAt)}`,
    cards: snapshot.entries.map((entry) => buildCard(entry, nowMs))
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/webview/usage/view-model.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the module stays browser-safe**

Run: `npx tsc -p src/webview/tsconfig.json`
Expected: exits 0. This proves the type-only import of `@/router/usage` pulled in no node or vscode dependency.

- [ ] **Step 6: Commit**

```bash
git add src/webview/usage/view-model.ts test/unit/webview/usage/view-model.test.ts
git commit -m "feat: add the usage view model"
```

---

### Task 6: The usage panel as a React app

Replaces `usage-html.ts` end to end: components render the view model, the panel posts state, and the extension stops generating markup.

**Files:**
- Create: `src/webview/usage/QuotaMeter.tsx`
- Create: `src/webview/usage/ConnectionCard.tsx`
- Create: `src/webview/usage/UsagePanel.tsx`
- Create: `src/webview/shared/protocol.ts`
- Modify: `src/webview/usage/main.tsx`
- Modify: `src/runtime/usage-panel.ts`
- Modify: `src/runtime/commands.ts:125`
- Delete: `src/runtime/usage-html.ts`
- Delete: `test/unit/runtime/usage-html.test.ts`

**Interfaces:**
- Consumes: `buildUsageView`, `UsageView`, `UsageCardView`, `QuotaView` (Task 5); `renderWebviewPanelHtml`, `webviewLocalResourceRoot` (Task 3).
- Produces: `showUsagePanel(extensionUri, snapshot, options?): Promise<void>` — note it is now async and takes `extensionUri` first. `UsageMessage` in `@/webview/shared/protocol`.

- [ ] **Step 1: Create `src/webview/shared/protocol.ts`**

Both sides import this, so it must stay free of `vscode` and `node:*`.

```ts
import type { RouterUsageSnapshot } from '@/router/usage';

export interface UsageStateMessage {
  readonly type: 'usage';
  readonly snapshot: RouterUsageSnapshot;
  readonly nowMs: number;
}

export interface ReadyMessage {
  readonly type: 'ready';
}

export type UsageHostMessage = UsageStateMessage;
export type UsageClientMessage = ReadyMessage;

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
```

- [ ] **Step 2: Write `src/webview/usage/QuotaMeter.tsx`**

Tailwind has no way to build a class name from a runtime value, so tone classes are looked up from a literal map. Never interpolate — `bg-${tone}` produces a class Tailwind never generated.

```tsx
import type { QuotaView } from './view-model';

const TRACK_CLASS = {
  ok: 'bg-ok/20',
  warn: 'bg-warn/20',
  critical: 'bg-critical/20'
} as const;

const FILL_CLASS = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  critical: 'bg-critical'
} as const;

const TEXT_CLASS = {
  ok: 'text-ok',
  warn: 'text-warn',
  critical: 'text-critical'
} as const;

const DOT_CLASS = FILL_CLASS;

export function QuotaMeter({ quota }: { quota: QuotaView }): JSX.Element {
  return (
    <section className="grid grid-cols-[minmax(92px,118px)_minmax(0,1fr)_42px_88px] items-center gap-x-2.5 gap-y-1 py-2">
      <div className="col-start-1 row-span-2 flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[quota.tone]}`} />
        {quota.name}
      </div>
      <div className="col-start-2 text-[11px] tabular-nums text-muted">{quota.usedLabel}</div>
      <div
        className={`col-start-2 h-1 overflow-hidden rounded-full ${TRACK_CLASS[quota.tone]}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.percent}
        aria-label={`${quota.name} remaining`}
      >
        <div
          className={`h-full rounded-[inherit] ${FILL_CLASS[quota.tone]}`}
          style={{ width: `${quota.percent}%` }}
        />
      </div>
      <div
        className={`col-start-3 row-span-2 justify-self-end text-xs font-semibold tabular-nums ${TEXT_CLASS[quota.tone]}`}
      >
        {quota.percent}%
      </div>
      <div className="col-start-4 row-span-2 whitespace-nowrap text-xs text-muted">
        {quota.resetLabel}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Write `src/webview/usage/ConnectionCard.tsx`**

```tsx
import { QuotaMeter } from './QuotaMeter';
import type { UsageCardView } from './view-model';

const REFRESH_HREF = 'command:9routerCopilot.showUsage';

function RefreshButton(): JSX.Element {
  return (
    <a
      className="grid size-7 place-items-center rounded-lg text-muted no-underline hover:text-fg"
      href={REFRESH_HREF}
      title="Refresh usage"
      aria-label="Refresh usage"
    >
      <svg
        className="size-[15px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <path d="M20 12a8 8 0 1 1-2.2-5.5" />
        <path d="M20 5v5h-5" />
      </svg>
    </a>
  );
}

function Avatar({ card }: { card: UsageCardView }): JSX.Element {
  if (!card.icon) {
    return (
      <div
        className="grid size-11 shrink-0 place-items-center rounded-full bg-fg/10 text-lg font-bold text-fg"
        aria-hidden="true"
      >
        {card.initial}
      </div>
    );
  }

  return (
    <div
      className="relative grid size-11 shrink-0 place-items-center rounded-full bg-[#f4f4f4] text-base font-bold text-[#111]"
      data-provider-logo={card.icon.slug}
      aria-hidden="true"
    >
      <span>{card.initial}</span>
      <img
        className="absolute left-1/2 top-1/2 block size-[26px] -translate-x-1/2 -translate-y-1/2"
        src={card.icon.url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export function ConnectionCard({ card }: { card: UsageCardView }): JSX.Element {
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card px-[18px] pb-3 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar card={card} />
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-tight">{card.provider}</div>
            <div className="truncate text-xs text-muted">{card.account}</div>
            <div className="mt-px truncate text-[11px] text-muted">{card.plan}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-border px-[7px] py-0.5 text-[10px] uppercase tracking-wide text-muted"
            >
              {chip}
            </span>
          ))}
          <RefreshButton />
        </div>
      </header>
      {card.message !== undefined && (
        <p className="mt-3 border-l-[3px] border-critical bg-critical/10 px-2.5 py-2 text-muted">
          {card.message}
        </p>
      )}
      <p className="mb-1 mt-3.5 text-xs text-muted">{card.quotaCountLabel}</p>
      {card.quotas.map((quota) => (
        <QuotaMeter key={quota.name} quota={quota} />
      ))}
    </article>
  );
}
```

- [ ] **Step 4: Write `src/webview/usage/UsagePanel.tsx`**

```tsx
import { ConnectionCard } from './ConnectionCard';
import type { UsageView } from './view-model';

export function UsagePanel({ view }: { view: UsageView }): JSX.Element {
  return (
    <>
      <header className="mx-auto mb-4.5 flex max-w-[1180px] items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-lg font-bold tracking-tight">Usage</h1>
          <p className="text-xs text-muted">{view.sweepLabel}</p>
        </div>
      </header>
      {view.cards.length === 0 ? (
        <p className="mx-auto my-6 max-w-[1180px] text-muted">
          No connection usage entries returned.
        </p>
      ) : (
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-4 md:grid-cols-2">
          {view.cards.map((card) => (
            <ConnectionCard key={`${card.provider}-${card.account}`} card={card} />
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Rewrite `src/webview/usage/main.tsx`**

```tsx
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UsagePanel } from './UsagePanel';
import { buildUsageView } from './view-model';
import './usage.css';
import type { UsageHostMessage } from '@/webview/shared/protocol';
import type { UsageView } from './view-model';

const vscodeApi = acquireVsCodeApi();

function App(): JSX.Element | null {
  const [view, setView] = useState<UsageView | undefined>(undefined);

  useEffect(() => {
    function onMessage(event: MessageEvent<UsageHostMessage>): void {
      const message = event.data;
      if (message.type === 'usage') {
        setView(buildUsageView(message.snapshot, message.nowMs));
      }
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return view === undefined ? null : <UsagePanel view={view} />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
```

- [ ] **Step 6: Set the page background and padding on the shell**

`body` is outside React, so its base styling belongs in the shell. In `src/webview/usage/index.html`, change the body tag to:

```html
<body class="m-0 bg-bg p-6 font-sans text-[13px]/[1.4] text-fg">
```

and add `@source './index.html';` to `src/webview/usage/usage.css` so Tailwind sees those classes.

- [ ] **Step 7: Rewrite `src/runtime/usage-panel.ts`**

```ts
import * as vscode from 'vscode';
import { renderWebviewPanelHtml, webviewLocalResourceRoot } from './webview-assets';
import type { RouterUsageSnapshot } from '@/router/usage';

const USAGE_VIEW_TYPE = '9routerCopilot.usage';
const USAGE_VIEW = 'usage';

interface UsageSession {
  panel: vscode.WebviewPanel;
  subscription: vscode.Disposable;
  snapshot: RouterUsageSnapshot;
}

let session: UsageSession | undefined;

function postState(current: UsageSession): void {
  void current.panel.webview.postMessage({
    type: 'usage',
    snapshot: current.snapshot,
    nowMs: Date.now()
  });
}

export async function showUsagePanel(
  extensionUri: vscode.Uri,
  snapshot: RouterUsageSnapshot,
  options: { viewColumn?: vscode.ViewColumn } = {}
): Promise<void> {
  // VS Code has no free-form HTML modal overlay. A focused editor webview panel is
  // the closest supported surface for the connection-card usage dashboard.
  const viewColumn = options.viewColumn ?? vscode.ViewColumn.Active;

  if (session) {
    session.snapshot = snapshot;
    session.panel.reveal(viewColumn, false);
    postState(session);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    USAGE_VIEW_TYPE,
    'Usage',
    { viewColumn, preserveFocus: false },
    {
      enableScripts: true,
      enableCommandUris: ['9routerCopilot.showUsage'],
      retainContextWhenHidden: true,
      localResourceRoots: [webviewLocalResourceRoot(extensionUri)]
    }
  );
  panel.webview.html = await renderWebviewPanelHtml(
    panel.webview,
    extensionUri,
    USAGE_VIEW
  );

  const current: UsageSession = {
    panel,
    snapshot,
    // A fresh webview cannot receive state before its script runs, so the first
    // post waits for the client to report itself ready.
    subscription: panel.webview.onDidReceiveMessage((message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'ready'
      ) {
        postState(current);
      }
    })
  };
  session = current;

  panel.onDidDispose(() => {
    current.subscription.dispose();
    if (session === current) {
      session = undefined;
    }
  });
}

export function __resetUsagePanelForTests(): void {
  session?.panel.dispose();
  session = undefined;
}
```

- [ ] **Step 8: Await the panel in `src/runtime/commands.ts`**

At `src/runtime/commands.ts:125`, change:

```ts
        showUsagePanel(snapshot);
```

to:

```ts
        await showUsagePanel(context.extensionUri, snapshot);
```

The enclosing command handler is already `async`, and `context` is already the first parameter of `registerCommands`.

- [ ] **Step 9: Delete the string-built HTML and its test**

```bash
git rm src/runtime/usage-html.ts test/unit/runtime/usage-html.test.ts
```

- [ ] **Step 10: Give the integration test context an extensionUri**

`test/integration/extension/manage-models-command.test.ts` and `test/integration/extension/diagnostics-command.test.ts` build a fake `ExtensionContext`. Add `extensionUri` to each `createContext()` helper:

```ts
import { Uri } from '@test/support/vscode';
```

and inside the returned object:

```ts
    extensionUri: Uri.file('/ext'),
```

- [ ] **Step 11: Verify**

Run: `pnpm test`
Expected: all tests pass. `usage-html.test.ts` is gone; `view-model.test.ts` carries its assertions.

Run: `pnpm run build`
Expected: exits 0.

Run: `node -e "const css=require('node:fs').readFileSync('dist/webview/usage/client.css','utf8'); for (const cls of ['bg-critical','bg-ok','text-warn']) { if(!css.includes(cls)) throw new Error('missing utility: '+cls); } console.log('tone utilities emitted: ok');"`
Expected: prints `tone utilities emitted: ok`. This is the guard against the tone-class lookup silently producing classes Tailwind never generated.

Run: `pnpm run lint`
Expected: exits 0.

- [ ] **Step 12: Confirm the panel renders in a real host**

Press F5 to launch the extension host, then run `9router: Show Usage` from the command palette.
Expected: the dashboard renders with connection cards. Each quota bar's fill colour matches its percentage — green above 70, amber from 30 to 70, red below 30. This is the user-visible bug fix; verify it by eye, because no test covers the rendered colour.

- [ ] **Step 13: Commit**

```bash
git add -A src test
git commit -m "feat: render the usage panel with react"
```

---

### Task 7: Widen the model editor state

The client needs the thinking-mode lists and token defaults that are currently interpolated into the script string, plus a bridge between the editor's catalog entry and `createDraftFromCatalog`.

**Files:**
- Modify: `src/runtime/model-editor-view.ts`
- Modify: `test/unit/runtime/model-editor-view.test.ts`

**Interfaces:**
- Produces: `ModelEditorState` gains `thinkingModes`, `thinkingEfforts`, `defaultMaxInputTokens`, `defaultMaxOutputTokens`. New export `toCatalogMetadata(entry: ModelEditorCatalogEntry): RouterModelMetadata`. Task 8 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/runtime/model-editor-view.test.ts`:

```ts
import { toCatalogMetadata } from '@/runtime/model-editor-view';
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from '@/config/defaults';
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';

describe('createModelEditorState field options', () => {
  it('ships the option lists and token defaults the webview form needs', () => {
    const state = createModelEditorState({ entries: [], catalog: [] });

    expect(state.thinkingModes).toEqual([...THINKING_MODES]);
    expect(state.thinkingEfforts).toEqual([...ENABLED_THINKING_MODES]);
    expect(state.defaultMaxInputTokens).toBe(DEFAULT_MODEL_MAX_INPUT_TOKENS);
    expect(state.defaultMaxOutputTokens).toBe(DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
  });
});

describe('toCatalogMetadata', () => {
  it('renames modelId to id and narrows vision to the metadata shape', () => {
    expect(
      toCatalogMetadata({
        modelId: 'router/combo',
        vision: true,
        contextWindow: 200_000,
        maxOutput: 32_000,
        inUse: false
      })
    ).toEqual({
      id: 'router/combo',
      vision: true,
      contextWindow: 200_000,
      maxOutput: 32_000
    });
  });

  it('omits absent optional metadata rather than setting it undefined', () => {
    const metadata = toCatalogMetadata({
      modelId: 'router/basic',
      vision: false,
      inUse: true
    });

    expect(metadata).toEqual({ id: 'router/basic' });
    expect('vision' in metadata).toBe(false);
    expect('contextWindow' in metadata).toBe(false);
  });
});
```

Check the existing imports at the top of the file first — `createModelEditorState` and `describe`/`expect`/`it` are already imported. Merge the new imports into the existing statements rather than duplicating them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-view.test.ts`
Expected: FAIL — `toCatalogMetadata` is not exported and the four state fields do not exist.

- [ ] **Step 3: Extend `src/runtime/model-editor-view.ts`**

Add to the imports:

```ts
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from '@/config/defaults';
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';
```

Add these four fields to the `ModelEditorState` interface:

```ts
  thinkingModes: ThinkingMode[];
  thinkingEfforts: EnabledThinkingMode[];
  defaultMaxInputTokens: number;
  defaultMaxOutputTokens: number;
```

Add them to the object `createModelEditorState` returns:

```ts
    thinkingModes: [...THINKING_MODES],
    thinkingEfforts: [...ENABLED_THINKING_MODES],
    defaultMaxInputTokens: DEFAULT_MODEL_MAX_INPUT_TOKENS,
    defaultMaxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
```

Add the bridge function at the end of the file. `exactOptionalPropertyTypes` is on, so every optional field is spread in conditionally:

```ts
// `createDraftFromCatalog` takes router metadata, while the editor holds an entry
// keyed by `modelId`. Bridging here keeps the prefill on the tested code path.
export function toCatalogMetadata(entry: ModelEditorCatalogEntry): RouterModelMetadata {
  return {
    id: entry.modelId,
    ...(entry.ownedBy !== undefined ? { ownedBy: entry.ownedBy } : {}),
    ...(entry.vision ? { vision: true as const } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxOutput !== undefined ? { maxOutput: entry.maxOutput } : {})
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify nothing else broke**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/model-editor-view.ts test/unit/runtime/model-editor-view.test.ts
git commit -m "feat: ship form options and catalog metadata in the editor state"
```

---

### Task 8: The model editor as a React app

Replaces the 250-line imperative client script. The duplicated draft logic is deleted rather than ported: the form calls the already-tested `@/config/model-draft`.

**Files:**
- Create: `src/webview/model-editor/index.html`
- Create: `src/webview/model-editor/model-editor.css`
- Create: `src/webview/model-editor/main.tsx`
- Create: `src/webview/model-editor/ModelEditor.tsx`
- Create: `src/webview/model-editor/ModelList.tsx`
- Create: `src/webview/model-editor/ModelForm.tsx`
- Create: `src/webview/model-editor/view-model.ts`
- Create: `test/unit/webview/model-editor/view-model.test.ts`
- Modify: `src/webview/shared/protocol.ts`
- Modify: `src/runtime/model-editor-panel.ts`
- Modify: `src/runtime/activate.ts:50-54`
- Modify: `scripts/vite-config.mjs:WEBVIEW_VIEWS`
- Modify: `test/unit/runtime/model-editor-panel.test.ts`
- Delete: `src/runtime/model-editor-html.ts`
- Delete: `test/unit/runtime/model-editor-html.test.ts`

**Interfaces:**
- Consumes: `ModelEditorState`, `ModelEditorRow`, `ModelEditorCatalogEntry`, `toCatalogMetadata` (Task 7); `createDraftFromCatalog`, `createUniqueModelId`, `ModelDraft` from `@/config/model-draft`; `renderWebviewPanelHtml`, `webviewLocalResourceRoot` (Task 3).
- Produces: `createModelEditorOpener` now requires `extensionUri` in its dependencies object. `buildModelListView(state): ModelRowView[]`.

- [ ] **Step 1: Write the failing view-model test**

Create `test/unit/webview/model-editor/view-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildModelListView } from '@/webview/model-editor/view-model';

const BASE_STATE = {
  catalog: [],
  warnings: [],
  thinkingModes: ['off' as const],
  thinkingEfforts: [],
  defaultMaxInputTokens: 264_000,
  defaultMaxOutputTokens: 264_000
};

describe('buildModelListView', () => {
  it('labels a row from its name and maps the id pair', () => {
    const [row] = buildModelListView({
      ...BASE_STATE,
      models: [
        {
          sourceIndex: 0,
          valid: true,
          id: 'agent',
          name: 'Agent',
          modelId: 'router/combo',
          toolMode: 'auto',
          visionMode: 'native',
          thinkingMode: 'off',
          catalogStatus: 'matched'
        }
      ]
    });

    expect(row?.title).toBe('Agent');
    expect(row?.idLabel).toBe('agent -> router/combo');
    expect(row?.chips).toEqual([
      { label: 'tools: auto', tone: 'plain' },
      { label: 'vision: native', tone: 'plain' },
      { label: 'thinking: off', tone: 'plain' }
    ]);
  });

  it('falls back through name, id, then a placeholder title', () => {
    const rows = buildModelListView({
      ...BASE_STATE,
      models: [
        { sourceIndex: 0, valid: true, id: 'only-id', catalogStatus: 'missing' },
        { sourceIndex: 1, valid: true, catalogStatus: 'missing' }
      ]
    });

    expect(rows[0]?.title).toBe('only-id');
    expect(rows[0]?.idLabel).toBe('only-id -> (no modelId)');
    expect(rows[1]?.title).toBe('Unnamed model');
    expect(rows[1]?.idLabel).toBe('(no id) -> (no modelId)');
  });

  it('flags a fast tier, a missing catalog entry, and a validation issue', () => {
    const [row] = buildModelListView({
      ...BASE_STATE,
      models: [
        {
          sourceIndex: 0,
          valid: false,
          id: 'agent',
          modelId: 'router/gone',
          serviceTier: 'fast',
          catalogStatus: 'missing',
          issue: { code: 'INVALID_ID', message: 'id is not usable' }
        }
      ]
    });

    expect(row?.chips).toEqual([
      { label: 'Fast', tone: 'plain' },
      { label: 'tools: off', tone: 'plain' },
      { label: 'vision: off', tone: 'plain' },
      { label: 'thinking: off', tone: 'plain' },
      { label: 'not in catalog', tone: 'warn' },
      { label: 'id is not usable', tone: 'bad' }
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/unit/webview/model-editor/view-model.test.ts`
Expected: FAIL — cannot resolve `@/webview/model-editor/view-model`.

- [ ] **Step 3: Write `src/webview/model-editor/view-model.ts`**

```ts
import type { ModelEditorRow, ModelEditorState } from '@/runtime/model-editor-view';

export type ChipTone = 'plain' | 'warn' | 'bad';

export interface ChipView {
  readonly label: string;
  readonly tone: ChipTone;
}

export interface ModelRowView {
  readonly sourceIndex: number;
  readonly valid: boolean;
  readonly title: string;
  readonly idLabel: string;
  readonly chips: readonly ChipView[];
}

function buildChips(row: ModelEditorRow): ChipView[] {
  const chips: ChipView[] = [];
  if (row.serviceTier === 'fast') {
    chips.push({ label: 'Fast', tone: 'plain' });
  }

  chips.push({ label: `tools: ${row.toolMode ?? 'off'}`, tone: 'plain' });
  chips.push({ label: `vision: ${row.visionMode ?? 'off'}`, tone: 'plain' });
  chips.push({ label: `thinking: ${row.thinkingMode ?? 'off'}`, tone: 'plain' });

  if (row.catalogStatus === 'missing') {
    chips.push({ label: 'not in catalog', tone: 'warn' });
  }
  if (row.issue) {
    chips.push({ label: row.issue.message, tone: 'bad' });
  }

  return chips;
}

export function buildModelListView(state: ModelEditorState): ModelRowView[] {
  return state.models.map((row) => ({
    sourceIndex: row.sourceIndex,
    valid: row.valid,
    title: row.name ?? row.id ?? 'Unnamed model',
    idLabel: `${row.id ?? '(no id)'} -> ${row.modelId ?? '(no modelId)'}`,
    chips: buildChips(row)
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/unit/webview/model-editor/view-model.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Extend `src/webview/shared/protocol.ts`**

Append:

```ts
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorState } from '@/runtime/model-editor-view';

export interface ModelStateMessage {
  readonly type: 'state';
  readonly state: ModelEditorState;
}

export interface ModelShowFormMessage {
  readonly type: 'showForm';
}

export interface ModelErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

export type ModelHostMessage =
  | ModelStateMessage
  | ModelShowFormMessage
  | ModelErrorMessage;

export type ModelClientMessage =
  | ReadyMessage
  | { readonly type: 'refreshCatalog' }
  | { readonly type: 'removeModel'; readonly sourceIndex: number }
  | { readonly type: 'moveModel'; readonly sourceIndex: number; readonly direction: 'up' | 'down' }
  | { readonly type: 'saveModel'; readonly sourceIndex: number | null; readonly draft: ModelDraft };
```

- [ ] **Step 6: Create the shell and stylesheet**

`src/webview/model-editor/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="{{csp}}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>9router Models</title>
<link rel="stylesheet" href="{{styleUri}}">
</head>
<body class="m-0 bg-bg p-4 font-sans text-fg">
<div id="root"></div>
<script nonce="{{nonce}}" src="{{scriptUri}}"></script>
</body>
</html>
```

`src/webview/model-editor/model-editor.css`:

```css
@import 'tailwindcss';
@import '../shared/theme.css';
@source './**/*.tsx';
@source './index.html';
@source '../shared/**/*.ts';
```

- [ ] **Step 7: Write `src/webview/model-editor/ModelList.tsx`**

```tsx
import { buildModelListView } from './view-model';
import type { ChipTone } from './view-model';
import type { ModelEditorState } from '@/runtime/model-editor-view';

const CHIP_CLASS: Record<ChipTone, string> = {
  plain: 'bg-badge text-badge-fg',
  warn: 'bg-warn-bg text-fg',
  bad: 'bg-err-bg text-fg'
};

interface ModelListProps {
  readonly state: ModelEditorState;
  readonly error: string;
  readonly onAdd: () => void;
  readonly onEdit: (sourceIndex: number) => void;
  readonly onRemove: (sourceIndex: number) => void;
  readonly onMove: (sourceIndex: number, direction: 'up' | 'down') => void;
  readonly onRefreshCatalog: () => void;
}

const BUTTON = 'cursor-pointer rounded-sm border border-transparent bg-btn-alt px-2.5 py-1 text-xs text-btn-alt-fg disabled:cursor-default disabled:opacity-50';
const PRIMARY = 'cursor-pointer rounded-sm border border-transparent bg-btn px-2.5 py-1 text-xs text-btn-fg';

export function ModelList(props: ModelListProps): JSX.Element {
  const rows = buildModelListView(props.state);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h1 className="m-0 text-[15px]">9router models</h1>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} onClick={props.onRefreshCatalog}>
            Refresh catalog
          </button>
          <button type="button" className={PRIMARY} onClick={props.onAdd}>
            Add model
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-1" role="status">
        {props.state.warnings.map((warning) => (
          <p
            key={warning}
            className="rounded-sm border border-warn-border bg-warn-bg px-2 py-1.5 text-xs"
          >
            {warning}
          </p>
        ))}
      </div>

      {props.error.length > 0 && (
        <div className="rounded-sm border border-err bg-err-bg px-2 py-1.5 text-xs" role="alert">
          {props.error}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-muted">
          No models configured yet. Choose Add model to create one.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row, index) => (
            <li
              key={row.sourceIndex}
              className={`flex items-start justify-between gap-3 rounded border p-2.5 ${row.valid ? 'border-panel-border' : 'border-err'}`}
            >
              <div className="min-w-0">
                <div className="font-semibold">{row.title}</div>
                <div className="font-mono text-[11px] text-muted">{row.idLabel}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.chips.map((chip) => (
                    <span
                      key={chip.label}
                      className={`rounded-lg px-1.5 py-px text-[11px] ${CHIP_CLASS[chip.tone]}`}
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <button type="button" className={BUTTON} onClick={() => props.onEdit(row.sourceIndex)}>
                  Edit
                </button>
                <button type="button" className={BUTTON} onClick={() => props.onRemove(row.sourceIndex)}>
                  Delete
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={index === 0}
                  onClick={() => props.onMove(row.sourceIndex, 'up')}
                >
                  Up
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={index === rows.length - 1}
                  onClick={() => props.onMove(row.sourceIndex, 'down')}
                >
                  Down
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Write `src/webview/model-editor/ModelForm.tsx`**

The catalog prefill calls `createDraftFromCatalog` — the same function the extension host uses — instead of re-deriving ids, names, and token budgets.

```tsx
import { useState } from 'react';
import { createDraftFromCatalog } from '@/config/model-draft';
import { toCatalogMetadata } from '@/runtime/model-editor-view';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorRow, ModelEditorState } from '@/runtime/model-editor-view';

interface ModelFormProps {
  readonly state: ModelEditorState;
  readonly row: ModelEditorRow | undefined;
  readonly error: string;
  readonly onCancel: () => void;
  readonly onSave: (draft: ModelDraft) => void;
}

function initialDraft(state: ModelEditorState, row: ModelEditorRow | undefined): ModelDraft {
  return {
    id: row?.id ?? '',
    name: row?.name ?? '',
    modelId: row?.modelId ?? '',
    ...(row?.serviceTier === 'fast' ? { serviceTier: 'fast' as const } : {}),
    toolMode: row?.toolMode ?? 'auto',
    visionMode: row?.visionMode ?? 'off',
    thinkingMode: row?.thinkingMode ?? 'off',
    thinkingEfforts: row?.thinkingEfforts ?? [],
    maxInputTokens: row?.maxInputTokens ?? state.defaultMaxInputTokens,
    maxOutputTokens: row?.maxOutputTokens ?? state.defaultMaxOutputTokens
  };
}

const LABEL = 'mt-1.5 text-xs';
const FIELD = 'rounded-sm border border-transparent bg-input px-1.5 py-0.5 text-xs text-input-fg';
const BUTTON = 'cursor-pointer rounded-sm border border-transparent bg-btn-alt px-2.5 py-1 text-xs text-btn-alt-fg';
const PRIMARY = 'cursor-pointer rounded-sm border border-transparent bg-btn px-2.5 py-1 text-xs text-btn-fg';

export function ModelForm(props: ModelFormProps): JSX.Element {
  const [draft, setDraft] = useState<ModelDraft>(() => initialDraft(props.state, props.row));

  function patch(changes: Partial<ModelDraft>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function prefill(modelId: string): void {
    const entry = props.state.catalog.find((item) => item.modelId === modelId);
    if (!entry) {
      return;
    }

    const takenIds = props.state.models
      .filter((model) => model.id !== undefined && model.sourceIndex !== props.row?.sourceIndex)
      .map((model) => model.id as string);
    setDraft(createDraftFromCatalog(toCatalogMetadata(entry), { takenIds }));
  }

  function toggleEffort(effort: ModelDraft['thinkingEfforts'][number]): void {
    patch({
      thinkingEfforts: draft.thinkingEfforts.includes(effort)
        ? draft.thinkingEfforts.filter((item) => item !== effort)
        : [...draft.thinkingEfforts, effort]
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <button type="button" className={BUTTON} onClick={props.onCancel}>
          &#8592; Back
        </button>
        <h2 className="m-0 text-[13px]">{props.row ? 'Edit model' : 'Add model'}</h2>
      </header>

      {props.error.length > 0 && (
        <div className="rounded-sm border border-err bg-err-bg px-2 py-1.5 text-xs" role="alert">
          {props.error}
        </div>
      )}

      <form
        className="flex flex-col gap-1 rounded border border-panel-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave(draft);
        }}
      >
        <label className={LABEL} htmlFor="field-catalog">9router model</label>
        <select
          id="field-catalog"
          className={FIELD}
          value={draft.modelId}
          onChange={(event) => prefill(event.target.value)}
        >
          <option value="">Select a 9router model</option>
          {props.state.catalog.map((entry) => (
            <option key={entry.modelId} value={entry.modelId}>
              {`${entry.modelId}${entry.inUse ? ' (in use)' : ''}${entry.vision ? ' - vision' : ''}`}
            </option>
          ))}
        </select>

        <label className={LABEL} htmlFor="field-id">Copilot id</label>
        <input
          id="field-id"
          className={FIELD}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft.id}
          onChange={(event) => patch({ id: event.target.value })}
        />

        <label className={LABEL} htmlFor="field-name">Display name</label>
        <input
          id="field-name"
          className={FIELD}
          type="text"
          autoComplete="off"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />

        <label className={LABEL} htmlFor="field-model-id">9router model id</label>
        <input
          id="field-model-id"
          className={FIELD}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={draft.modelId}
          onChange={(event) => patch({ modelId: event.target.value })}
        />

        <label className="mt-1.5 inline-flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={draft.serviceTier === 'fast'}
            onChange={(event) => {
              // Rebuilt field by field rather than by rest-spread: `exactOptionalPropertyTypes`
              // needs `serviceTier` absent, not undefined, and an unused `_dropped` binding
              // would fail `no-unused-vars`, which has no varsIgnorePattern here.
              const fast = event.target.checked;
              setDraft((current) => ({
                id: current.id,
                name: current.name,
                modelId: current.modelId,
                toolMode: current.toolMode,
                visionMode: current.visionMode,
                thinkingMode: current.thinkingMode,
                thinkingEfforts: current.thinkingEfforts,
                maxInputTokens: current.maxInputTokens,
                maxOutputTokens: current.maxOutputTokens,
                ...(fast ? { serviceTier: 'fast' as const } : {})
              }));
            }}
          />
          Fast tier
        </label>

        <fieldset className="mt-2 flex flex-wrap gap-2.5 rounded-sm border border-panel-border px-2 py-1.5">
          <legend className="text-[11px] text-muted">Tool calling</legend>
          {(['auto', 'off'] as const).map((mode) => (
            <label key={mode} className="inline-flex items-center gap-1 text-xs">
              <input
                type="radio"
                name="toolMode"
                value={mode}
                checked={draft.toolMode === mode}
                onChange={() => patch({ toolMode: mode })}
              />
              {mode}
            </label>
          ))}
        </fieldset>

        <fieldset className="mt-2 flex flex-wrap gap-2.5 rounded-sm border border-panel-border px-2 py-1.5">
          <legend className="text-[11px] text-muted">Vision</legend>
          {(['native', 'proxy', 'off'] as const).map((mode) => (
            <label key={mode} className="inline-flex items-center gap-1 text-xs">
              <input
                type="radio"
                name="visionMode"
                value={mode}
                checked={draft.visionMode === mode}
                onChange={() => patch({ visionMode: mode })}
              />
              {mode}
            </label>
          ))}
        </fieldset>

        <label className={LABEL} htmlFor="field-thinking-mode">Default thinking mode</label>
        <select
          id="field-thinking-mode"
          className={FIELD}
          value={draft.thinkingMode}
          onChange={(event) =>
            patch({ thinkingMode: event.target.value as ModelDraft['thinkingMode'] })
          }
        >
          {props.state.thinkingModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>

        <fieldset className="mt-2 flex flex-wrap gap-2.5 rounded-sm border border-panel-border px-2 py-1.5">
          <legend className="text-[11px] text-muted">Thinking efforts</legend>
          {props.state.thinkingEfforts.map((effort) => (
            <label key={effort} className="inline-flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={draft.thinkingEfforts.includes(effort)}
                onChange={() => toggleEffort(effort)}
              />
              {effort}
            </label>
          ))}
        </fieldset>

        <label className={LABEL} htmlFor="field-max-input-tokens">Max input tokens</label>
        <input
          id="field-max-input-tokens"
          className={FIELD}
          type="number"
          min={1}
          step={1}
          value={draft.maxInputTokens}
          onChange={(event) => patch({ maxInputTokens: Number(event.target.value) })}
        />

        <label className={LABEL} htmlFor="field-max-output-tokens">Max output tokens</label>
        <input
          id="field-max-output-tokens"
          className={FIELD}
          type="number"
          min={1}
          step={1}
          value={draft.maxOutputTokens}
          onChange={(event) => patch({ maxOutputTokens: Number(event.target.value) })}
        />

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className={PRIMARY}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 9: Write `src/webview/model-editor/ModelEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ModelForm } from './ModelForm';
import { ModelList } from './ModelList';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorState } from '@/runtime/model-editor-view';
import type { ModelHostMessage, VsCodeApi } from '@/webview/shared/protocol';

const EMPTY_STATE: ModelEditorState = {
  models: [],
  catalog: [],
  warnings: [],
  thinkingModes: [],
  thinkingEfforts: [],
  defaultMaxInputTokens: 0,
  defaultMaxOutputTokens: 0
};

export function ModelEditor({ api }: { api: VsCodeApi }): JSX.Element {
  const [state, setState] = useState<ModelEditorState>(EMPTY_STATE);
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [pendingSave, setPendingSave] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent<ModelHostMessage>): void {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.state);
        setError('');
        setPendingSave((pending) => {
          if (pending) {
            setEditing(undefined);
          }
          return false;
        });
      }
      if (message.type === 'showForm') {
        setEditing(null);
        setError('');
      }
      if (message.type === 'error') {
        setPendingSave(false);
        setError(message.message);
      }
    }

    window.addEventListener('message', onMessage);
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [api]);

  if (editing === undefined) {
    return (
      <ModelList
        state={state}
        error={error}
        onAdd={() => {
          setError('');
          setEditing(null);
        }}
        onEdit={(sourceIndex) => {
          setError('');
          setEditing(sourceIndex);
        }}
        onRemove={(sourceIndex) => api.postMessage({ type: 'removeModel', sourceIndex })}
        onMove={(sourceIndex, direction) =>
          api.postMessage({ type: 'moveModel', sourceIndex, direction })
        }
        onRefreshCatalog={() => api.postMessage({ type: 'refreshCatalog' })}
      />
    );
  }

  const row = state.models.find((model) => model.sourceIndex === editing);

  return (
    <ModelForm
      // Remounting on the edited row resets the draft when the target changes.
      key={editing ?? 'new'}
      state={state}
      row={row}
      error={error}
      onCancel={() => {
        setError('');
        setEditing(undefined);
      }}
      onSave={(draft: ModelDraft) => {
        setError('');
        setPendingSave(true);
        api.postMessage({ type: 'saveModel', sourceIndex: editing, draft });
      }}
    />
  );
}
```

- [ ] **Step 10: Write `src/webview/model-editor/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEditor } from './ModelEditor';
import './model-editor.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ModelEditor api={acquireVsCodeApi()} />
    </StrictMode>
  );
}
```

- [ ] **Step 11: Register the second view**

In `scripts/vite-config.mjs`:

```js
export const WEBVIEW_VIEWS = ['usage', 'model-editor'];
```

- [ ] **Step 12: Rewire `src/runtime/model-editor-panel.ts`**

Add `extensionUri: vscode.Uri;` to the `Dependencies` interface.

Replace the import of `./model-editor-html` with:

```ts
import { renderWebviewPanelHtml, webviewLocalResourceRoot } from './webview-assets';
```

In `createModelEditorOpener`, replace the `createWebviewPanel` options and the `html` assignment with:

```ts
    const panel = vscode.window.createWebviewPanel(
      MODEL_EDITOR_VIEW_TYPE,
      '9router Models',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewLocalResourceRoot(dependencies.extensionUri)]
      }
    );
    panel.webview.html = await renderWebviewPanelHtml(
      panel.webview,
      dependencies.extensionUri,
      'model-editor'
    );
```

Nothing else in the file changes. The message protocol, the settings writes, and the `pendingFormRequest` handshake all stay as they are.

- [ ] **Step 13: Pass the uri from `src/runtime/activate.ts`**

At `src/runtime/activate.ts:50`, add `extensionUri` to the dependencies object:

```ts
  const manageModels = createModelEditorOpener({
    secrets: context.secrets,
    extensionUri: context.extensionUri,
    routerClient,
    getRuntimeSettings: () => loadRuntimeSettings(getExtensionConfiguration())
  });
```

- [ ] **Step 14: Update the panel unit test**

In `test/unit/runtime/model-editor-panel.test.ts`, add to the imports:

```ts
import { Uri } from '@test/support/vscode';
```

and add this line to the object returned by `createDependencies`:

```ts
    extensionUri: Uri.file('/ext'),
```

- [ ] **Step 15: Delete the string-built HTML and its test**

```bash
git rm src/runtime/model-editor-html.ts test/unit/runtime/model-editor-html.test.ts
```

- [ ] **Step 16: Verify**

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm run build`
Expected: exits 0, and `dist/webview/model-editor/` holds `index.html`, `client.js`, and `client.css`.

Run: `pnpm run lint`
Expected: exits 0.

Run: `grep -rn "acquireVsCodeApi\|DOCTYPE" src/runtime`
Expected: no matches. No markup or client-side API use is left on the extension side.

- [ ] **Step 17: Confirm the editor works in a real host**

Press F5, then run `9router: Manage Models`. Check each of these, because none is covered by a test:
- the list renders configured models with their chips
- **Add model** opens the form; picking a catalog entry prefills id, name, vision mode, and both token budgets
- adding a second model whose id collides gets the `-2` suffix
- **Save** returns to the list with the new row present
- **Delete** prompts for confirmation and removes the row
- **Up** / **Down** reorder, and the end buttons are disabled
- a validation failure shows the error beside the form rather than on the list

- [ ] **Step 18: Commit**

```bash
git add -A src test scripts
git commit -m "feat: render the model editor with react"
```

---

### Task 9: Update the convention and close out

**Files:**
- Modify: `CODE_CONVENTION.md`
- Modify: `README.md` (only if it documents the build)

**Interfaces:**
- Consumes: everything. Produces: nothing further.

- [ ] **Step 1: Add `src/webview/` to the structure block**

In `CODE_CONVENTION.md`, under Repository Structure, add `webview/` to the tree:

```text
src/
  runtime/
  webview/
  provider/
  router/
  config/
  debug/
  types/
```

- [ ] **Step 2: Add the boundary rules**

Under Boundary rules, after the `src/runtime` entry, add:

```markdown
`src/webview`

- owns webview markup, styling, and client-side rendering
- runs in the webview browser sandbox, not the extension host
- must not import `vscode` or any `node:*` module, directly or transitively
- must not duplicate logic that already exists on the extension side; import
  the runtime-agnostic module instead
- `src/webview/shared` holds modules only the webview and its own panel need

Webview markup and styling live in `.tsx` and `.css` files. They must never be
written as string literals in TypeScript.
```

- [ ] **Step 3: Scope the size decision rule**

Under Decision Rules, replace the bare `keeps the extension smaller` bullet with:

```markdown
- keeps the extension smaller — this governs the extension host and its
  runtime dependencies, which are the thin adapter this convention exists to
  protect. Configuration and diagnostics panels under `src/webview` are
  exempt: their cost is package size, not adapter complexity.
```

- [ ] **Step 4: Check the README**

Run: `grep -n "esbuild\|usage-html\|model-editor-html" README.md`
Expected: no matches. If any appear, update those lines to describe the Vite build. Do not otherwise rewrite the README.

- [ ] **Step 5: Full verification**

Run: `pnpm run build`
Expected: exits 0.

Run: `pnpm run lint`
Expected: exits 0.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm run package`
Expected: produces a `.vsix`. Note its size — the spec predicts roughly double the 100 KB of 0.11.2. If it is dramatically larger than about 200 KB, something is bundling more than intended; investigate before shipping.

- [ ] **Step 6: Confirm the shipped assets are actually in the package**

```bash
node -e "const {execSync}=require('node:child_process'); const out=execSync('npx vsce ls --no-dependencies').toString(); for (const f of ['dist/webview/usage/index.html','dist/webview/usage/client.js','dist/webview/usage/client.css','dist/webview/model-editor/index.html','dist/webview/model-editor/client.js','dist/webview/model-editor/client.css']) { if(!out.includes(f)) throw new Error('missing from vsix: '+f); } if (out.includes('scripts/')) throw new Error('build scripts leaked into the vsix'); console.log('vsix contents ok');"
```

Expected: prints `vsix contents ok`. A panel that renders blank in a published extension but works on F5 is exactly what this check prevents.

- [ ] **Step 7: Commit**

```bash
git add CODE_CONVENTION.md README.md
git commit -m "docs: record the webview boundary in the convention"
```
