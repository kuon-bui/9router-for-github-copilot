# Webview Asset Extraction Design

Date: 2026-08-31
Status: Approved for planning

## Problem

Both webviews in this extension build their HTML, CSS, and client-side
JavaScript as template literals inside TypeScript modules:

- `src/runtime/usage-html.ts` (353 lines) — the connection quota dashboard.
  Roughly 230 lines of that file are a CSS string.
- `src/runtime/model-editor-html.ts` (409 lines) — the model manager panel.
  One file holds three languages: a `STYLES` CSS string, a `CLIENT_SCRIPT`
  string of about 250 lines of browser JavaScript, and the HTML shell.

TypeScript sees all of this as opaque string data. Nothing highlights it,
lints it, formats it, or type-checks it.

That has already produced a shipped bug. The CSS in `usage-html.ts` is
currently corrupted at lines 303-319:

```
}warn { background: var(--track-warn); }
.bar.warn .fill { background: var(--warn);   background: var(--ok); }
      font-variwarn { color: var(--warn); }
    .remaining.ant-numeric: tabular-nums;
```

A bad edit spliced three rules apart. The result is that the `warn` and
`critical` quota bars render with the wrong colour, and no build step,
lint rule, or test caught it.

Secondary problems that follow from the same root cause:

1. The model editor's client script re-implements logic that already exists
   and is already tested. `sanitizeId`, the `-2`/`-3` duplicate-id suffix
   loop, the display-name derivation, and the catalog prefill that derives
   `maxInputTokens` from `contextWindow - maxOutput` are all duplicates of
   `sanitizeModelId`, `createUniqueModelId`, `suggestDisplayName`, and
   `createDraftFromCatalog` in `src/config/model-draft.ts`, which
   `test/unit/config/model-draft.test.ts` covers. The copy inside the string
   is the one with no coverage, and the two are free to drift.
2. `escapeHtml` exists as a private function inside `usage-html.ts` only.
   `model-editor-html.ts` interpolates without escaping.
3. The two views use unrelated styling systems: `usage-html.ts` defines
   `:root` tokens and uses `color-mix`, while `model-editor-html.ts` uses
   raw `var(--vscode-*)` throughout. There is no shared base.
4. Content Security Policy and nonce strings are hand-assembled separately
   in each file.
5. Tests assert against raw CSS substrings, for example
   `expect(html).toContain('width: 45px')`.
6. The model editor's client script is ~250 lines of imperative DOM
   synchronisation — `renderList`, `renderCatalogOptions`, `fillForm`,
   `showView` — kept in step with the panel state by hand.

## Goal

Webview markup, styling, and client code live in real files with real
tooling. Nothing about the UI is written as a string literal inside
TypeScript.

## Decisions

Settled during brainstorming. Not open in the plan:

- Assets ship as real files inside the VSIX and reach the webview through
  `webview.asWebviewUri`, not through build-time inlining.
- The usage panel moves to client-side rendering so its HTML can be a
  static file. It gains `enableScripts: true`.
- Webview code lives in a new top-level `src/webview/` directory.
- **Vite builds everything** — the extension host bundle and both webview
  bundles. `esbuild` is removed from `devDependencies`.
- **The webview UI is React with Tailwind CSS v4.**
- Tailwind's colour scale is remapped onto the host's `--vscode-*` custom
  properties through `@theme`, so panels follow the user's theme.
- `src/runtime/usage-markdown.ts` is deleted as dead code.
- `CODE_CONVENTION.md` is updated in the same change — both its Repository
  Structure section and its Decision Rules.

## Directory Layout

### New: `src/webview/`

Everything under this directory is browser code. It runs in the webview
sandbox, not in the extension host.

```
src/webview/
  tsconfig.json                 lib ES2022 + DOM, types: [], jsx: react-jsx
  css-modules.d.ts              declare module '*.css'
  shared/
    theme.css                   @theme mapping Tailwind tokens to --vscode-*
    protocol.ts                 message types for both sides of postMessage
    usage-format.ts             moved from src/runtime/usage-format.ts
    provider-icons.ts           moved from src/runtime/provider-icons.ts
  usage/
    index.html                  static shell with placeholders
    usage.css                   @import 'tailwindcss' + shared theme
    main.tsx                    createRoot + postMessage subscription
    UsagePanel.tsx
    ConnectionCard.tsx
    QuotaMeter.tsx
    view-model.ts               buildUsageView(snapshot, nowMs) — pure, no DOM
  model-editor/
    index.html
    model-editor.css
    main.tsx
    ModelEditor.tsx             list/form view switch
    ModelList.tsx
    ModelForm.tsx
    view-model.ts               buildModelListView(state) — pure, no DOM
```

Both `view-model.ts` files stay free of React and of the DOM. That is what
keeps the test suite in the `node` environment; see Testing.

`src/webview/shared/` holds modules that only the webview and its own panel
need. It is not, however, the only thing the webview may import.

The real boundary is **runtime-agnostic or not**. A webview module may import
any module in `src/` that carries no `vscode` and no `node:*` dependency —
`@/config/model-draft` and `@/types/product-model` qualify, and the model
editor reuses the former rather than duplicating it. Two mechanisms enforce
this and both are needed:

- eslint `no-restricted-imports` on `src/webview/**` catches a *direct*
  import of `vscode` or `node:*`.
- `tsc -p src/webview/tsconfig.json` catches *transitive* ones, because
  `types: []` leaves no `vscode` module declaration to resolve against, so
  any value import of it anywhere in the reachable graph fails to compile.

### Extension side

Added:

- `src/runtime/webview-document.ts` — a pure function that assembles the
  final document string.
- `scripts/vite-config.mjs` — config factories for every build target.
- `scripts/build.mjs` — one-shot build of all targets.
- `scripts/watch.mjs` — watch mode for all targets.

Deleted:

- `src/runtime/usage-html.ts`
- `src/runtime/model-editor-html.ts`
- `src/runtime/usage-markdown.ts`

Moved out of `src/runtime/`:

- `usage-format.ts` and `provider-icons.ts` to `src/webview/shared/`.

Reduced to panel lifecycle only, with no markup in them:

- `src/runtime/usage-panel.ts`
- `src/runtime/model-editor-panel.ts`

## Document Assembly

`src/runtime/webview-document.ts` exports:

```ts
export interface WebviewDocumentInput {
  readonly shell: string;
  readonly styleUri: string;
  readonly scriptUri: string;
  readonly cspSource: string;
  readonly nonce: string;
}

export function createNonce(): string;
export function renderWebviewDocument(input: WebviewDocumentInput): string;
```

`index.html` files carry four placeholders: `{{csp}}`, `{{styleUri}}`,
`{{scriptUri}}`, `{{nonce}}`. `renderWebviewDocument` builds the CSP value
itself and substitutes all four.

The substitution is strict. If a placeholder remains unreplaced after
substitution, or the shell contains a `{{...}}` token the function does not
recognise, it throws. A silently unreplaced `{{scriptUri}}` would produce a
blank panel, so this must fail loudly at the point of assembly.

The generated CSP:

```
default-src 'none';
style-src ${cspSource};
script-src 'nonce-${nonce}';
img-src ${cspSource} https://unpkg.com;
```

This removes the `style-src 'unsafe-inline'` both panels rely on today.
Tailwind compiles to a real stylesheet file, so no inline style source is
needed. `img-src` keeps `https://unpkg.com` because provider brand logos are
loaded from that CDN by `provider-icons.ts`; vendoring those icons locally is
out of scope.

React is bundled into the view's own `client.js`, which the `<script>` tag
loads with both the nonce and the `src`, so the nonce policy applies to the
externally loaded file.

## Build Pipeline

### One bundler

Vite builds all three targets: the extension host bundle and one bundle per
webview.

Vite 8 is already installed here as a transitive dependency of `vitest@4`
(`vite@8.1.4`, 2.3 MB). It bundles with Rolldown and ships Lightning CSS, and
no longer depends on esbuild — Vite 8's dependencies are `rolldown`,
`lightningcss`, `postcss`, `picomatch`, and `tinyglobby`. Promoting Vite to a
direct devDependency and dropping `esbuild` therefore removes a dependency
rather than adding one.

`scripts/vite-config.mjs` exports two factories:

```js
export function createExtensionConfig({ watch = false } = {});
export function createWebviewConfig(view, { watch = false } = {});
```

**Extension host target.** `build.lib` with `src/extension.ts` as entry,
`formats: ['cjs']`, `fileName: () => 'extension.js'`, output directory
`dist/src`, `build.ssr: true` so node builtins stay external and no
browser-targeted transforms run, `build.target: 'node20'`, and
`rollupOptions.external: ['vscode']`. This reproduces what the current
esbuild CLI line produces.

**Webview targets.** One config per view, `build.lib` with that view's
`main.tsx` as entry, `formats: ['iife']`, `fileName: () => 'client.js'`,
`assetFileNames: 'client.[ext]'`, output directory `dist/webview/<view>`,
`build.target: 'es2022'`, `emptyOutDir: true`, plugins `[tailwindcss()]` from
`@tailwindcss/vite`. Sourcemaps when `watch` is true, minify when it is not.

`index.html` is copied verbatim to `dist/webview/<view>/index.html` by
`scripts/build.mjs`.

### One Vite build per view

This is deliberate. Rolldown cannot emit `iife` for a multi-entry build, and
a multi-entry `es` build would hoist anything shared between the two views —
React included — into a common chunk with a generated name. That chunk would
be a third asset the panel has to locate and pass through `asWebviewUri`, and
cross-chunk relative imports do not resolve under a `vscode-webview://`
origin without also injecting a `<base href>`.

The cost is that React lands in both bundles — roughly 45 KB compressed each,
so about 45 KB more than a shared-chunk layout would produce. The alternative
costs generated chunk names, a `<base href>`, and the nonce-scoped
`script-src`. Two fixed-name files per view is worth 45 KB.

### Vite's HTML entry pipeline is not used

Given an `index.html` entry, Vite rewrites `<script src>` and `<link href>`
to hashed paths and emits a processed HTML file. A webview cannot load that:
asset references must be absolute `vscode-webview://` URIs produced by
`asWebviewUri` at runtime, and Vite's emitted tags carry no nonce. So
`index.html` stays a hand-written shell with placeholders, and Vite produces
only `client.js` and `client.css` under fixed names. The panel builds
`asWebviewUri` for those two paths without reading a manifest.

### React

`react`, `react-dom`, `@types/react`, and `@types/react-dom` are added as
devDependencies; they are bundled into `client.js`, so nothing ships at
runtime through `package.json`. Exact versions are pinned at implementation
time.

`@vitejs/plugin-react` is **not** expected to be needed. Its main job is Fast
Refresh, which a build-only pipeline does not use, and Vite reads
`jsx: 'react-jsx'` from the tsconfig for the automatic runtime. If the
automatic runtime is not picked up in practice, add the plugin — this is the
one build assumption in this document that must be verified early rather than
assumed.

### Tailwind CSS v4

`tailwindcss` and `@tailwindcss/vite` are added as devDependencies. Each
view's stylesheet is its Tailwind entry:

```css
/* usage.css */
@import 'tailwindcss';
@import '../shared/theme.css';
@source './**/*.tsx';
@source '../shared/**/*.ts';
```

`css.transformer` is left at Vite's default. `@tailwindcss/vite` runs
Lightning CSS internally; layering Vite's own `lightningcss` transformer on
top is an untested combination and buys nothing.

### Type checking

Vite and Rolldown strip types without checking them, so `tsc` remains the
type-checking step and must stay in the `build` chain — once for the
extension host, once for the webview code.

`tsconfig.json` gains `"exclude": ["src/webview/**"]` so browser code is not
type-checked with `node` and `vscode` types in scope.

`src/webview/tsconfig.json`:

- `lib: ["ES2022", "DOM"]`
- `types: []`
- `jsx: "react-jsx"`, `jsxImportSource: "react"`
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` matching
  the root config
- same `@/*` path mapping so shared modules resolve identically

The root `exclude` removes `src/webview/**` from the root config's own file
set, but TypeScript still follows imports. `src/webview/shared/protocol.ts`
is imported by `src/runtime/`, so it is checked under both configs. That is
intentional: a shared module that only compiles with `node` or `vscode` types
in scope is a module that does not belong in `shared/`. The `.tsx` files are
imported by neither, so they are checked only by the webview config.

`css-modules.d.ts` declares `declare module '*.css';` so `main.tsx` can
import its stylesheet. The `vite/client` reference types are not used,
because they would require populating `types` in a config that deliberately
sets `types: []`.

Webview modules import extension-side types with `import type` only.
`buildUsageView` needs `RouterUsageSnapshot` from `@/router/usage`, but must
not pull that module's parsing code into the client bundle. The eslint block
below does not catch this, so it is a review point rather than an automated
one.

### Scripts

```
build: clean
       && tsc -p tsconfig.json
       && tsc -p src/webview/tsconfig.json
       && node scripts/build.mjs
watch: node scripts/watch.mjs
lint:  eslint .
```

### Watch must keep the F5 flow working

`.vscode/launch.json` runs the `watch` task before launching the extension
host, and `.vscode/tasks.json` gates that background task on a problem
matcher looking for `^\[watch\] build started` and `^\[watch\] build
finished`. Those lines come from the esbuild CLI's `--watch` output today and
disappear with esbuild.

`scripts/watch.mjs` is a single Node process that starts all three Vite
builds in watch mode. It must print `[watch] build started` and `[watch]
build finished` itself, from a small plugin on `buildStart`/`writeBundle`,
with a counter so the "finished" line is printed only once every target has
settled rather than once per target. Without those lines F5 hangs waiting for
output that never arrives.

`.vscode/tasks.json` also needs its problem matcher updated. Its `owner` is
`esbuild` and its error pattern is `^✘ \[ERROR\] (.*)$`, which is esbuild's
output format. Rolldown reports errors differently, so that pattern would
silently stop surfacing build errors in the Problems panel even while the
background begin/end markers keep working. The matcher is retargeted at the
format `scripts/watch.mjs` actually emits.

Both `scripts/build.mjs` and `scripts/watch.mjs` obtain their options from
`scripts/vite-config.mjs`, so the two paths cannot drift.

Unifying on one bundler is what makes this tractable: the marker plugin is
written once against one plugin API, rather than bridging esbuild's
`onStart`/`onEnd` and Vite's `buildStart`/`writeBundle`.

## Panel Wiring

Both panel factories take `extensionUri: vscode.Uri`. `ExtensionContext` is
already in scope at both call sites (`src/runtime/commands.ts` and
`src/runtime/activate.ts`), so this is parameter threading only.

Both panels set:

```ts
localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')]
```

The model editor currently passes `[]` and must be widened to this.

The shell HTML is read once per view with `vscode.workspace.fs.readFile`,
decoded with `TextDecoder`, and cached in a module-level `Map` keyed by view
name. This makes `showUsagePanel` asynchronous; its single caller at
`src/runtime/commands.ts:125` gains an `await`.

`webview.html` is assigned once when the panel is created. Subsequent opens
reveal the existing panel and post fresh state, matching what the model
editor already does.

## Usage Panel Rendering

The usage panel moves from extension-side HTML generation to a React app.

Message flow:

1. Client posts `{ type: 'ready' }` on mount.
2. Extension posts `{ type: 'usage', snapshot, nowMs }`.
3. Client renders.

`nowMs` is sent by the extension rather than read from `Date.now()` in the
client, so reset labels stay deterministic and testable.

`RouterUsageSnapshot` survives `postMessage` unchanged: it is plain JSON
data, and `RouterUsageQuota.resetAt` is already `string | null` rather than a
`Date`. No serialisation step is needed.

The refresh control keeps its current form: an anchor with
`href="command:9routerCopilot.showUsage"`, with `enableCommandUris`
unchanged. No new message type is introduced for refresh, and refresh
behaviour does not change.

### View model boundary

`src/webview/usage/view-model.ts` exports a pure function:

```ts
export function buildUsageView(
  snapshot: RouterUsageSnapshot,
  nowMs: number
): UsageView;
```

`UsageView` is plain data:

```ts
interface UsageView {
  readonly sweepLabel: string;
  readonly cards: readonly UsageCardView[];
}

interface UsageCardView {
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

interface QuotaView {
  readonly name: string;
  readonly tone: 'ok' | 'warn' | 'critical';
  readonly percent: number;
  readonly usedLabel: string;
  readonly resetLabel: string;
}
```

The components render `UsageView` and hold no formatting logic, no branching
on quota state, and no escaping — JSX escapes text children by default, which
removes the `escapeHtml` problem entirely.

This split is what keeps the test suite free of a DOM environment. Every
assertion in the current `usage-html.test.ts` maps onto a `UsageView` field.

## Model Editor Rendering

The imperative client script is replaced by React components. Behaviour does
not change.

- The duplicated draft logic in the script is deleted, not moved. `ModelForm`
  imports `createDraftFromCatalog` and `createUniqueModelId` from
  `@/config/model-draft`, which already implements and tests exactly this
  behaviour. The catalog prefill then runs the same code path the extension
  host uses, and cannot drift from it.
- `createDraftFromCatalog` takes a `RouterModelMetadata`, while the webview
  holds `ModelEditorCatalogEntry` — the two differ in that the entry names
  the field `modelId` rather than `id` and carries `vision: boolean` rather
  than `vision?: true`. `src/runtime/model-editor-view.ts` gains an exported
  `toCatalogMetadata(entry)` to bridge them, next to the type it converts.
- `view-model.ts` — `buildModelListView(state)` producing row labels and the
  chip list per row.
- `ModelEditor.tsx` — holds the list/form view state and the
  `editingSourceIndex`, subscribes to `postMessage`.
- `ModelList.tsx`, `ModelForm.tsx` — presentation and form state.

This is where React earns its place: `renderList`, `renderCatalogOptions`,
`fillForm`, and `showView` all disappear, replaced by rendering from state.

The dynamic `<option>` and thinking-effort checkbox markup currently built by
`renderModelEditorHtml` from `THINKING_MODES` and `ENABLED_THINKING_MODES`
moves into the components, which receive those lists in the `state` message.
`DEFAULT_MODEL_MAX_INPUT_TOKENS` and `DEFAULT_MODEL_MAX_OUTPUT_TOKENS`, today
interpolated into the script string, move into the same message so
`src/config/defaults.ts` stays the single source.

Both additions widen the `state` payload, so `createModelEditorState` in
`src/runtime/model-editor-view.ts` and its test at
`test/unit/runtime/model-editor-view.test.ts` change alongside. The row and
warning fields it already produces stay as they are.

`index.html` for this view shrinks to a shell with a single mount node. The
element ids the old script queried no longer exist as a contract between two
files.

## Theming

VS Code injects hundreds of `--vscode-*` custom properties into the webview
and changes them when the user changes theme. Panels must follow those, so
Tailwind's own colour scale is not used. `src/webview/shared/theme.css` maps
the host properties onto Tailwind tokens:

```css
@theme {
  --color-bg: var(--vscode-editor-background);
  --color-fg: var(--vscode-editor-foreground);
  --color-muted: var(--vscode-descriptionForeground);
  --color-card: var(--vscode-editorWidget-background);
  --color-border: var(--vscode-widget-border);
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
  --color-warn-border: var(--vscode-inputValidation-warningBorder);
  --color-warn-bg: var(--vscode-inputValidation-warningBackground);
  --color-ok: #3dd68c;
  --color-warn: #e3b341;
  --color-critical: #f85149;
  --font-sans: var(--vscode-font-family);
  --font-mono: var(--vscode-editor-font-family);
}
```

Components then use `bg-card`, `text-muted`, `border-border`, and so on.

Because the host swaps the underlying properties itself, no `dark:` variants
and no `prefers-color-scheme` blocks are needed anywhere. Light and dark are
handled by VS Code.

The three quota tones (`--color-ok`, `--color-warn`, `--color-critical`) are
fixed hex values because VS Code has no stable semantic property for a
"healthy / warning / exhausted" meter. Their track backgrounds use Tailwind's
opacity modifier (`bg-warn/20`) rather than the `color-mix` expressions the
current CSS uses.

The three corrupted rules at `usage-html.ts:303-319` disappear with the file.
Restored intent, as utilities on the meter components:

- track: `bg-ok/20`, `bg-warn/20`, `bg-critical/20` by tone
- fill: `bg-ok`, `bg-warn`, `bg-critical` by tone
- percent label: `tabular-nums` plus `text-ok`, `text-warn`, `text-critical`

Neither panel's layout or visual result changes beyond this repair.

## Testing

New:

- `test/unit/runtime/webview-document.test.ts` — the generated CSP string,
  placeholder substitution, and the throw paths for a leftover or unknown
  placeholder.
- `test/unit/webview/usage/view-model.test.ts` — replaces the assertions from
  `usage-html.test.ts`, checking `UsageView` fields instead of HTML
  substrings. It must cover the same cases: `95 / 100` at `5%` with tone
  `critical`, `23 / 100` at `77%` with tone `ok`, the unlimited balance quota
  reporting `100%` and an `N/A` reset, and the `in 3h 34m` reset label at the
  fixed `nowMs`.

Extended:

- `test/unit/runtime/model-editor-view.test.ts` — covers the widened `state`
  payload and the new `toCatalogMetadata`.

No new test is written for the model editor's draft logic. Deleting the
duplicate brings that behaviour under `test/unit/config/model-draft.test.ts`,
which already covers id sanitisation, the suffix loop and its `100` ceiling,
display-name derivation, and the derived-input fallback.

Moved:

- `test/unit/runtime/usage-format.test.ts` to `test/unit/webview/shared/`
- `test/unit/runtime/provider-icons.test.ts` to `test/unit/webview/shared/`

Deleted:

- `test/unit/runtime/usage-html.test.ts`, superseded by the view-model test.
- `test/unit/runtime/model-editor-html.test.ts`. Its subject was the contract
  between a hand-written HTML shell and a script that queried it by id. React
  removes that contract, so the test has nothing left to guard.

No DOM test environment is added, and React components are not unit-tested.
Everything under test is DOM-free by construction and runs in the existing
`node` environment. Adding `happy-dom` and `@testing-library/react` for
component tests is a deliberate follow-up if the components grow logic worth
testing; it is not part of this change.

`vitest.config.ts` needs no alias change; `@/webview/*` resolves through the
existing `@` alias.

## Lint

`eslint.config.js` gains a block for `src/webview/**/*.{ts,tsx}`:

- browser globals: `document`, `window`, `HTMLElement`, `Element`, `Event`,
  `acquireVsCodeApi`
- `no-restricted-imports` forbidding `vscode` and any `node:*` specifier
- the TypeScript parser configured for `.tsx`

`stylelint` is **not** added. With Tailwind, each view's `.css` file is a
handful of `@import`, `@theme`, and `@source` directives; there is no
hand-written rule set left for it to check, and stylelint has no built-in
understanding of Tailwind v4's at-rules.

This is a real consequence of the chosen stack and is recorded under Risks
rather than papered over.

## Dead Code Removal

`src/runtime/usage-markdown.ts` exports `formatUsageMarkdown`, which no
module in `src/` or `test/` imports. It is the only remaining extension-side
consumer of `usage-format.ts`, so it blocks the clean move of that module
into `src/webview/shared/`. It is deleted.

## Convention Update

`CODE_CONVENTION.md` changes in the same commit.

Repository Structure and Boundary rules:

- add `src/webview/` to the structure block
- `src/webview` owns webview markup, styling, and client code; it must not
  import `vscode` or `node:*`, and must not contain routing or transport
  logic
- `src/webview` may import any module in `src/` that is runtime-agnostic, and
  must not duplicate logic that already exists on the extension side;
  `src/webview/shared` holds modules only the webview and its own panel need
- webview markup and styling live in `.tsx` and `.css` files and must not be
  written as string literals in TypeScript

Decision Rules:

The existing rule *"choose the option that keeps the extension smaller"* is
what React and Tailwind trade against. The rule is not deleted — it still
governs the provider, router, and config layers, which are the thin-adapter
core the convention exists to protect. It is scoped: the rule applies to the
extension host and its runtime dependencies, and the configuration panels are
explicitly exempted, because their cost is package size rather than adapter
complexity.

The Prohibited Patterns entry *"separate chat UI for the primary Copilot
integration path"* is unaffected. These panels are configuration and
diagnostics surfaces, not a chat UI, and the Copilot Chat integration path is
untouched.

## Out of Scope

- No layout or visual redesign of either panel beyond repairing the corrupted
  quota-meter styling.
- No changes to `src/provider`, `src/router`, or `src/config`.
- No Vite dev server and no HMR. Serving the webview from
  `http://localhost:5173` during development would require
  `webview-document.ts` to branch on dev versus production and the dev CSP to
  admit `http://localhost:5173` plus `ws://localhost:5173` for the HMR
  socket. That reintroduces exactly the CSP looseness this change removes,
  inside the module whose job is to keep the policy tight. If HMR is wanted
  later it is a separate, deliberate change.
- No component tests, and therefore no DOM test environment.
- No component library. React and Tailwind are the whole UI stack.
- Provider brand logos continue to load from `https://unpkg.com`. Vendoring
  them locally is a separate change.

## Risks

- **Package size roughly doubles.** The 0.11.2 VSIX is 100 KB. React bundled
  into two view bundles adds roughly 90 KB compressed. This is the accepted
  cost of the chosen UI stack; it is package size, not runtime weight, and
  the extension host bundle is unaffected.
- **Typo'd utility classes fail silently.** This change exists because broken
  CSS shipped unnoticed. Tailwind does not fully close that hole: it moves
  most styling into `className` strings, where `bg-editorr` produces no
  style, no build error, no lint error, and no type error. What the change
  does deliver is that no CSS is assembled by string concatenation any more,
  and that a broken *rule* is now impossible. A wrong *class name* is not.
  Mitigation is the Tailwind IntelliSense editor extension plus review;
  `eslint-plugin-tailwindcss` should be evaluated once its v4 support is
  confirmed.
- **Three build assumptions must be smoke-tested before anything is built on
  them.** The plan's first step is a throwaway spike that proves all three,
  because each one, if wrong, changes the build config rather than the
  application code:
  1. `@tailwindcss/vite` works against a Rolldown-based Vite 8.
  2. `.tsx` builds with the automatic JSX runtime without
     `@vitejs/plugin-react`.
  3. `build.lib` with `formats: ['cjs']` produces a working extension host
     bundle with `vscode` external. `build.lib` and `build.ssr` may not
     compose; if they do not, the node-target settings come from
     `build.target: 'node20'` plus an explicit external list for node
     builtins instead.
- **Widening `localResourceRoots` on the model editor.** It is `[]` today,
  which is a deliberate lockdown. Scoping the new root to `dist/webview`
  only, and keeping `default-src 'none'`, holds the same posture for
  everything except the two asset files the panel needs.
- **The usage panel gains scripts.** It runs with `enableScripts: false`
  today. The mitigation is that React escapes text children by default and no
  component uses `dangerouslySetInnerHTML`, so no snapshot value can be
  interpreted as markup.
- **Vite version drift.** `vite` currently arrives through `vitest`. Pinning
  it as a direct devDependency means a `vitest` upgrade that moves its Vite
  range can produce a duplicate install. Renovate will surface the mismatch;
  the two must be bumped together.
- **Missing asset at runtime.** If the webview build does not run, the panel
  loads a shell pointing at files that do not exist and renders blank.
  `pnpm build` chains `scripts/build.mjs` before finishing, and
  `vscode:prepublish` runs `pnpm build`, so a packaged VSIX cannot miss it.

## User-Visible Result

One change: the `warn` and `critical` quota bars in the usage dashboard show
their correct colours again. Everything else behaves exactly as it does now.
