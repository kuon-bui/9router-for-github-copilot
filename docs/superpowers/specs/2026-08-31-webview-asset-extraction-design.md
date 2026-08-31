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

1. The model editor's client script contains real logic — `sanitizeId`,
   the `-2`/`-3` duplicate-id suffix loop, and the catalog prefill that
   derives `maxInputTokens` from `contextWindow - maxOutput`. None of it
   is covered by tests, because it is a string.
2. `escapeHtml` exists as a private function inside `usage-html.ts` only.
   `model-editor-html.ts` interpolates without escaping.
3. The two views use unrelated styling systems: `usage-html.ts` defines
   `:root` tokens and uses `color-mix`, while `model-editor-html.ts` uses
   raw `var(--vscode-*)` throughout. There is no shared base.
4. Content Security Policy and nonce strings are hand-assembled separately
   in each file.
5. Tests assert against raw CSS substrings, for example
   `expect(html).toContain('width: 45px')`.

## Goal

HTML and CSS live in their own files with their own tooling. No webview
markup or styling is written as a string literal inside TypeScript.

## Decisions

These were settled during brainstorming and are not open in the plan:

- Assets ship as real files inside the VSIX and reach the webview through
  `webview.asWebviewUri`, not through build-time inlining.
- The usage panel moves to client-side rendering so its HTML can be a
  static file. It gains `enableScripts: true`.
- Webview code lives in a new top-level `src/webview/` directory, which
  requires an explicit update to `CODE_CONVENTION.md`.
- `stylelint` is added so CI blocks the class of bug described above.
- `src/runtime/usage-markdown.ts` is deleted as dead code.

## Directory Layout

### New: `src/webview/`

Everything under this directory is browser code. It runs in the webview
sandbox, not in the extension host.

```
src/webview/
  tsconfig.json                 lib ES2022 + DOM, types: []
  shared/
    tokens.css                  design tokens: --bg --fg --muted --ok --warn --critical
    base.css                    reset, typography, shared button/chip/error rules
    protocol.ts                 message types for both sides of postMessage
    usage-format.ts             moved from src/runtime/usage-format.ts
    provider-icons.ts           moved from src/runtime/provider-icons.ts
  usage/
    index.html                  static shell with placeholders
    usage.css
    view-model.ts               buildUsageView(snapshot, nowMs), no DOM access
    client.ts                   mounts the view model, handles postMessage
  model-editor/
    index.html
    model-editor.css
    draft-form.ts               sanitizeId, uniqueModelId, deriveDraftFromCatalogEntry
    view-model.ts               buildModelListView(state)
    client.ts
```

`src/webview/shared/` is the only directory both sides import from. It must
stay runtime-agnostic: no `vscode` import, no `node:*` import.

### Extension side

Added:

- `src/runtime/webview-document.ts` — a pure function that assembles the
  final document string.

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
`img-src` keeps `https://unpkg.com` because provider brand logos are loaded
from that CDN by `provider-icons.ts`; bundling those icons locally is out of
scope for this change.

The `<script>` tag carries both the nonce and the `src`, so the nonce
policy applies to an externally loaded file.

## Build Pipeline

### Webview bundling

New file `scripts/build-webviews.mjs`, using the esbuild JavaScript API.
For each directory under `src/webview/` other than `shared/`:

- entry point is that directory's `client.ts`
- `bundle: true`, `format: 'iife'`, `target: 'es2022'`
- output directory `dist/webview/<view>/`
- minify when not in watch mode, sourcemap when in watch mode

Each `client.ts` imports its own stylesheet:

```ts
import './usage.css';
```

and each view stylesheet imports the shared layer, which in turn imports the
tokens:

```css
/* usage.css */
@import '../shared/base.css';

/* shared/base.css */
@import './tokens.css';
```

esbuild follows all of it, so it emits `dist/webview/<view>/client.js` and
`dist/webview/<view>/client.css` with tokens and base rules already folded
in. No manual copy step is needed for CSS.

`index.html` is copied verbatim to `dist/webview/<view>/index.html`.

### Type checking

`tsconfig.json` gains `"exclude": ["src/webview/**"]` so browser code is not
type-checked with `node` and `vscode` types in scope.

`src/webview/tsconfig.json`:

- `lib: ["ES2022", "DOM"]`
- `types: []`
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` matching
  the root config
- same `@/*` path mapping so shared modules resolve identically

The root `exclude` removes `src/webview/**` from the root config's own file
set, but TypeScript still follows imports. `src/webview/shared/protocol.ts`
is imported by `src/runtime/`, so it is checked under both configs. That is
intentional: a shared module that only compiles with `node` or `vscode` types
in scope is a module that does not belong in `shared/`. The view `client.ts`
files are imported by neither, so they are checked only by the webview
config.

Webview modules import extension-side types with `import type` only.
`buildUsageView` needs `RouterUsageSnapshot` from `@/router/usage`, but must
not pull that module's parsing code into the client bundle. The eslint block
below does not catch this, so it is a review point rather than an
automated one.

### Scripts

```
build: clean
       && tsc -p tsconfig.json
       && tsc -p src/webview/tsconfig.json
       && node scripts/build-webviews.mjs
       && esbuild src/extension.ts --bundle ... --outfile=dist/src/extension.js
watch: node scripts/watch.mjs
lint:css: stylelint "src/webview/**/*.css"
lint: eslint . && pnpm run lint:css
```

`pnpm run lint` gains the CSS pass, so the existing CI step at
`.github/workflows/tag-build.yml:77` picks it up with no workflow change.

### Watch must keep the F5 flow working

`.vscode/launch.json` runs the `watch` task before launching the extension
host, and `.vscode/tasks.json` gates that background task on a problem
matcher looking for `^\[watch\] build started` and `^\[watch\] build
finished`. Those lines come from the esbuild CLI's `--watch` output today.

Because the watch now has to drive two builds — the extension bundle and the
webview bundles — chaining two CLI invocations in one npm script is not
portable on Windows, which is the development platform here. Instead,
`scripts/watch.mjs` runs a single Node process that creates one esbuild
context per target and calls `watch()` on each.

That script must print `[watch] build started` and `[watch] build finished`
itself, via an esbuild plugin on `onStart`/`onEnd`, or F5 hangs waiting for a
line that never arrives. `scripts/build-webviews.mjs` and `scripts/watch.mjs`
share their esbuild option construction so the two paths cannot drift.

`.vscodeignore` needs no change. It already ships `dist/**` while excluding
`dist/package.json`, `dist/test/**`, and `dist/vitest.config.js`, and it
already excludes `src/**`.

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

The usage panel moves from extension-side HTML generation to client-side
rendering.

Message flow:

1. Client posts `{ type: 'ready' }` once its script runs.
2. Extension posts `{ type: 'usage', snapshot, nowMs }`.
3. Client renders.

`nowMs` is sent by the extension rather than read from `Date.now()` in the
client, so reset labels stay deterministic and testable.

`RouterUsageSnapshot` survives `postMessage` unchanged: it is plain JSON
data, and `RouterUsageQuota.resetAt` is already `string | null` rather than a
`Date`. No serialisation layer is needed.

The refresh control keeps its current form: an anchor with
`href="command:9routerCopilot.showUsage"`, with `enableCommandUris`
unchanged on the panel. No new message type is introduced for refresh, and
refresh behaviour does not change.

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

`client.ts` turns `UsageView` into DOM nodes and nothing else. It contains no
formatting, no branching on quota state, and no string escaping — building
nodes with `document.createElement` and `textContent` removes the need for
manual escaping entirely.

This split is what keeps the test suite free of a DOM environment. Every
assertion in the current `usage-html.test.ts` maps onto a `UsageView` field.

## Model Editor Rendering

The existing client script is split rather than rewritten. Its behaviour
stays the same.

- `draft-form.ts` — the pure logic currently trapped in the string:
  `sanitizeId(value)`, `uniqueModelId(base, takenIds)` for the `-2`/`-3`
  suffix loop, and `deriveDraftFromCatalogEntry(entry, modelId, takenIds)`
  which derives the display name, vision mode, and token limits.
- `view-model.ts` — `buildModelListView(state)` producing row labels and the
  chip list per row.
- `client.ts` — DOM wiring, form read/fill, postMessage handling.

The list, form, and warning containers move into
`src/webview/model-editor/index.html` unchanged, keeping every element id the
client depends on.

The dynamic `<option>` and thinking-effort checkbox markup currently built by
`renderModelEditorHtml` from `THINKING_MODES` and `ENABLED_THINKING_MODES`
moves to the client, which receives those lists in the `state` message. This
removes the last piece of string-built markup from the extension side.

`DEFAULT_MODEL_MAX_INPUT_TOKENS` and `DEFAULT_MODEL_MAX_OUTPUT_TOKENS` are
currently interpolated into the script string. They move into the `state`
message as well, so `src/config/defaults.ts` stays the single source.

Both additions widen the `state` payload, so `createModelEditorState` in
`src/runtime/model-editor-view.ts` and its test at
`test/unit/runtime/model-editor-view.test.ts` change alongside. The row and
warning fields it already produces stay as they are.

## CSS Consolidation

`src/webview/shared/tokens.css` holds the token set currently defined only in
`usage-html.ts`: `--bg`, `--fg`, `--muted`, `--subtle`, `--card`, `--border`,
`--ok`, `--warn`, `--critical`, and the three `--track-*` values.

`src/webview/shared/base.css` holds the reset, body typography, and the
button, chip, and error rules that both views need.

The three corrupted rules at `usage-html.ts:303-319` are repaired during the
move. Restored intent:

```css
.bar.warn { background: var(--track-warn); }
.bar.warn .fill { background: var(--warn); }
.remaining { font-variant-numeric: tabular-nums; color: var(--ok); }
.remaining.warn { color: var(--warn); }
```

The model editor stylesheet is rewritten against the shared tokens rather
than raw `var(--vscode-*)` values. Its visual result must not change; this is
a substitution of equivalent values, not a redesign.

## Testing

New:

- `test/unit/webview/model-editor/draft-form.test.ts` — `sanitizeId`
  normalisation, the duplicate-id suffix loop including its `100` ceiling,
  and catalog-derived draft values. This logic has no coverage today.
- `test/unit/runtime/webview-document.test.ts` — the generated CSP string,
  placeholder substitution, and the throw paths for a leftover or unknown
  placeholder.
- `test/unit/webview/usage/view-model.test.ts` — replaces the assertions from
  `usage-html.test.ts`, checking `UsageView` fields instead of HTML
  substrings. It must cover the same cases: `95 / 100` at `5%` with tone
  `critical`, `23 / 100` at `77%` with tone `ok`, the unlimited balance quota
  reporting `100%` and an `N/A` reset, and the `in 3h 34m` reset label at the
  fixed `nowMs`.

Rewritten:

- `test/unit/runtime/model-editor-html.test.ts` becomes a test that reads
  `src/webview/model-editor/index.html` and asserts every element id the
  client queries is present. This preserves the existing guarantee that the
  shell and the script agree on ids.

Moved:

- `test/unit/runtime/usage-format.test.ts` to `test/unit/webview/shared/`
- `test/unit/runtime/provider-icons.test.ts` to `test/unit/webview/shared/`

Deleted:

- `test/unit/runtime/usage-html.test.ts`, superseded by the view-model test.

No DOM test environment is added. Every new test runs in the existing `node`
environment because all logic under test is DOM-free by construction.

`vitest.config.ts` needs no alias change; `@/webview/*` resolves through the
existing `@` alias.

## Lint

`eslint.config.js` gains a block for `src/webview/**/*.ts`:

- browser globals: `document`, `window`, `HTMLElement`, `Element`, `Event`,
  `acquireVsCodeApi`
- `no-restricted-imports` forbidding `vscode` and any `node:*` specifier

`stylelint` and `stylelint-config-standard` are added as devDependencies with
a `lint:css` script over `src/webview/**/*.css`. This is the check that would
have caught the corrupted rules, so it is part of the change rather than a
follow-up.

## Dead Code Removal

`src/runtime/usage-markdown.ts` exports `formatUsageMarkdown`, which no
module in `src/` or `test/` imports. It is the only remaining extension-side
consumer of `usage-format.ts`, so it blocks the clean move of that module
into `src/webview/shared/`. It is deleted.

## Convention Update

`CODE_CONVENTION.md` must be updated in the same change:

- add `src/webview/` to the Repository Structure block
- add a boundary rule: `src/webview` owns webview markup, styling, and client
  code; it must not import `vscode` or `node:*`, and must not contain routing
  or transport logic
- add a rule that `src/webview/shared` is the only directory imported by both
  the extension host and the webview, and must stay runtime-agnostic
- add a rule that webview markup and styling live in `.html` and `.css` files
  and must not be written as string literals in TypeScript

The convention states the repository structure is fixed unless the user
approves a change. That approval was given during brainstorming on
2026-08-31.

## Out of Scope

- No layout or visual redesign of either panel beyond repairing the corrupted
  CSS and substituting equivalent token values.
- No changes to `src/provider`, `src/router`, or `src/config`.
- No CSS preprocessor.
- No UI framework. Adding lit or preact would contradict the
  `CODE_CONVENTION.md` decision rule that favours keeping the extension
  smaller.
- Provider brand logos continue to load from `https://unpkg.com`. Vendoring
  them locally is a separate change.

## Risks

- **Widening `localResourceRoots` on the model editor.** It is `[]` today,
  which is a deliberate lockdown. Scoping the new root to `dist/webview`
  only, and keeping `default-src 'none'`, holds the same posture for
  everything except the two asset files the panel needs.
- **The usage panel gains scripts.** It runs with `enableScripts: false`
  today. The mitigation is that the client builds DOM nodes through
  `createElement` and `textContent` and never assigns `innerHTML`, so no
  snapshot value can be interpreted as markup.
- **Missing asset at runtime.** If `scripts/build-webviews.mjs` fails to run,
  the panel loads a shell pointing at files that do not exist and renders
  blank. `pnpm build` chains the script before the extension bundle, and
  `vscode:prepublish` runs `pnpm build`, so a packaged VSIX cannot miss it.

## User-Visible Result

One change: the `warn` and `critical` quota bars in the usage dashboard show
their correct colours again. Everything else behaves exactly as it does now.
