# Webview Design Maintainability Implementation Plan

> **For agentic workers:** Execute tasks in order. Keep commits small. Do not edit generated files under `dist/`.

**Goal:** Make both webviews easier to restyle and maintain without creating a generic React component library or duplicating browser/host contracts.

**Architecture:** Keep domain UI local to each panel. Share only VS Code theme tokens and native control presentation. Move model-editor wire types to `src/types` so runtime and webview depend on a neutral contract and webview modules no longer import `src/runtime`. Keep host validation and settings writes unchanged.

**Tech Stack:** TypeScript strict mode, React 19, Tailwind CSS 4, Vite 8, Vitest, ESLint, pnpm.

## Global Constraints

- Follow `AGENTS.md` and `CODE_CONVENTION.md`.
- Preserve thin provider adapter architecture and all current panel behavior.
- Do not edit `dist/`; `pnpm run build` owns generated assets.
- Do not modify or revert unrelated working-tree changes, especially current `scripts/vite-config.mjs` changes.
- Do not add dependencies.
- Do not create generic `Button`, `Card`, `Stack`, `Field`, or design-system React components.
- Keep `ConnectionCard`, `QuotaMeter`, `UsagePanel`, `ModelEditor`, `ModelList`, and `ModelForm` domain-local.
- Shared presentation belongs in CSS. Shared wire data belongs in browser-safe TypeScript contracts.
- Keep host-side draft validation through `validateDraft`; browser changes must not weaken trust-boundary checks.
- Preserve accessibility: native controls, labels, disabled states, `role="alert"`, meter semantics, and icon labels.
- Run `pnpm run lint` and focused tests after each source task. Run full release gate at end.

---

### Task 1: Make browser-host model contracts runtime-safe

**Files:**
- Create: `src/types/model-editor.ts`
- Modify: `src/config/model-settings.ts`
- Modify: `src/runtime/model-editor-view.ts`
- Modify: `src/webview/shared/protocol.ts`
- Modify: `src/webview/model-editor/ModelEditor.tsx`
- Modify: `src/webview/model-editor/ModelForm.tsx`
- Modify: `src/webview/model-editor/ModelList.tsx`
- Modify: `src/webview/model-editor/view-model.ts`
- Modify: `test/unit/runtime/model-editor-view.test.ts`
- Modify: `test/unit/webview/model-editor/view-model.test.ts`

**Interfaces:**
- Move, without changing shape:
  - `ModelSettingsIssueCode`
  - `ModelEditorRow`
  - `ModelEditorCatalogEntry`
  - `ModelEditorState`
- Add pure browser-side conversion in `src/webview/model-editor/view-model.ts`:
  - `toRouterModelMetadata(entry: ModelEditorCatalogEntry): RouterModelMetadata`

- [ ] **Step 1: Add the shared contract**

Create `src/types/model-editor.ts` with the three existing interfaces from `src/runtime/model-editor-view.ts`.

Move `ModelSettingsIssueCode` from `src/config/model-settings.ts` into this contract, then have the parser import and re-export it for compatibility. Use type-only imports for:

```ts
import type {
  EnabledThinkingMode,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '@/types/product-model';
```

Keep this file type-only. `src/types/model-editor.ts` must not import `src/config`, `src/runtime`, or `src/webview`. Do not add conversion or runtime logic.

- [ ] **Step 2: Move conversion coverage to browser-safe tests**

Move `toCatalogMetadata` test cases from `test/unit/runtime/model-editor-view.test.ts` into `test/unit/webview/model-editor/view-model.test.ts`. Implement and export `toRouterModelMetadata` from `src/webview/model-editor/view-model.ts`.

Test:

- all supported catalog metadata maps correctly
- `inUse` is omitted
- absent optional fields stay absent
- `vision: false` stays omitted from router metadata

Run:

```text
pnpm vitest run test/unit/webview/model-editor/view-model.test.ts test/unit/runtime/model-editor-view.test.ts
```

Expected before implementation: failing import or missing export.

- [ ] **Step 3: Rewire runtime builder**

In `src/runtime/model-editor-view.ts`:

- remove interface declarations
- remove `toCatalogMetadata`
- import `ModelEditorRow`, `ModelEditorState`, and `ModelSettingsIssueCode` as types from `@/types/model-editor`
- keep state construction, validation, warning strings, and defaults unchanged

Runtime owns state creation. Contract owns shape only.

- [ ] **Step 4: Rewire browser imports**

Replace every `@/runtime/model-editor-view` import under `src/webview`:

- `ModelEditor.tsx`, `ModelForm.tsx`, `ModelList.tsx`, `view-model.ts`, `shared/protocol.ts` import types from `@/types/model-editor`
- `ModelForm.tsx` imports `toRouterModelMetadata` from local `view-model.ts`

Run:

```text
pnpm run build
pnpm run lint
pnpm vitest run test/unit/webview/model-editor test/unit/runtime/model-editor-view.test.ts
```

Expected: all pass.

- [ ] **Step 5: Add a boundary guard**

In `eslint.config.js`, extend webview `no-restricted-imports` patterns to reject `@/runtime/*` in addition to `node:*`.

Message: `Webview code must consume browser-safe contracts, not extension runtime modules.`

Run:

```text
pnpm run lint
```

Expected: pass with zero `@/runtime/` imports under `src/webview`.

- [ ] **Step 6: Commit**

```text
git add src/types/model-editor.ts src/config/model-settings.ts src/runtime/model-editor-view.ts src/webview/shared/protocol.ts src/webview/model-editor test/unit/runtime/model-editor-view.test.ts test/unit/webview/model-editor eslint.config.js
git commit -m "refactor: isolate the model editor webview contract"
```

---

### Task 2: Centralize shared webview controls in CSS

**Files:**
- Create: `src/webview/shared/controls.css`
- Modify: `src/webview/usage/usage.css`
- Modify: `src/webview/model-editor/model-editor.css`
- Modify: `src/webview/model-editor/ModelForm.tsx`
- Modify: `src/webview/model-editor/ModelList.tsx`
- Modify: `src/webview/usage/ConnectionCard.tsx`

**Shared classes:**

- `.ui-button`
- `.ui-button-primary`
- `.ui-field`
- `.ui-alert`
- `.ui-alert-warning`
- `.ui-alert-error`
- `.ui-chip`

Do not add layout classes to shared CSS. Flex/grid/gaps/widths remain Tailwind in panel components.

- [ ] **Step 1: Create shared control stylesheet**

Move browser-native normalization and control presentation from `model-editor.css` into `controls.css`:

- `button`, `input`, `select` font inheritance
- button cursor, border, radius, colors, padding, disabled state
- text/number/select field border, background, foreground, padding
- fieldset/legend defaults only if both panels can safely import them; otherwise keep model form fieldset rules local

Define semantic classes using VS Code variables already exposed through `theme.css`.

Rules:

- secondary button is default `.ui-button`
- primary action uses `.ui-button-primary`
- `.ui-field` applies only to text, number, and select controls
- alert variants own border/background/foreground, while callers own spacing
- chip owns radius and compact typography, while tone remains caller-selected
- retain native focus outlines; do not suppress `outline`

- [ ] **Step 2: Import shared controls once per panel**

Add to both panel entry CSS files after theme import:

```css
@import '../shared/controls.css';
```

Remove moved declarations from `model-editor.css`. Keep only model-editor-specific fieldset/label layout there.

- [ ] **Step 3: Replace repeated presentation strings**

In model editor components:

- all buttons use `.ui-button`
- Save/Add primary actions use `.ui-button-primary`
- text/number/select controls use `.ui-field`
- warnings/errors use `.ui-alert` plus variant
- chips use `.ui-chip` plus existing tone map

In usage components:

- status chips use `.ui-chip`
- keep usage-card-specific uppercase/tracking/border additions local
- keep refresh link icon-specific; do not force anchor into button abstraction

Do not change labels, order, handlers, ARIA roles, or state logic.

- [ ] **Step 4: Verify generated CSS and behavior**

Run:

```text
pnpm run build
pnpm run lint
```

Check generated files exist:

```text
dist/webview/usage/client.css
dist/webview/model-editor/client.css
```

Search built CSS for `.ui-button`, `.ui-field`, and `.ui-alert-error`. Each required class must survive Tailwind build.

Manual F5 check:

1. Open `9router: Show Usage`.
2. Open `9router: Manage Models`.
3. Confirm VS Code light and dark themes both retain readable controls.
4. Confirm keyboard focus remains visible.
5. Confirm disabled Up/Down controls remain visibly disabled.
6. Confirm warning and error colors use VS Code theme variables.

- [ ] **Step 5: Commit**

```text
git add src/webview/shared/controls.css src/webview/usage src/webview/model-editor
git commit -m "refactor: share webview control styles"
```

---

### Task 3: Reformat panel JSX for local changeability

**Files:**
- Modify: `src/webview/model-editor/ModelEditor.tsx`
- Modify: `src/webview/model-editor/ModelForm.tsx`
- Modify: `src/webview/model-editor/ModelList.tsx`
- Modify: `src/webview/model-editor/main.tsx`
- Modify: `src/webview/usage/UsagePanel.tsx`
- Modify: `src/webview/usage/ConnectionCard.tsx`
- Modify: `src/webview/usage/QuotaMeter.tsx`

**Non-goal:** No behavior change and no broad component extraction.

- [ ] **Step 1: Expand JSX and handlers**

Convert dense one-line JSX into multiline blocks. Use named local handlers when inline callbacks contain more than one statement:

- `handleMessage`
- `handleAdd`
- `handleEdit`
- `handleCancel`
- `handleSave`
- `patch`
- `prefill`
- `toggleEffort`
- `setFast`

Keep trivial one-expression callbacks inline.

- [ ] **Step 2: Add narrow prop interfaces**

Replace inline object types with local interfaces:

- `ModelEditorProps`
- `ModelListProps`
- existing `ModelFormProps` stays
- `UsagePanelProps`, `ConnectionCardProps`, and `QuotaMeterProps` only if they improve readability

Keep interfaces private unless another module needs them.

- [ ] **Step 3: Remove lint workarounds made unnecessary by readable types**

Remove file-level `eslint-disable no-unused-vars` comments from `ModelForm.tsx` and `ModelList.tsx` if named prop interfaces and current TypeScript ESLint config pass without them.

If ESLint core still reports callback type parameters, fix config specifically for `.tsx`; do not keep broad file-level suppression.

- [ ] **Step 4: Keep component boundaries boring**

After formatting, split only if either condition remains true:

- component exceeds roughly 150 readable lines
- one block has independent data input and repeated rendering

Allowed extraction: private `ModelRow` inside `ModelList.tsx`.

Do not create new files for one-use wrappers. Do not extract `FormField`, generic `Card`, generic `Alert`, or generic layout components.

- [ ] **Step 5: Verify behavior neutrality**

Run:

```text
pnpm run build
pnpm run lint
pnpm vitest run test/unit/webview test/unit/runtime/model-editor-panel.test.ts
```

Expected: all pass; generated JS behavior unchanged except formatting/minification effects from existing build config.

- [ ] **Step 6: Commit**

```text
git add src/webview/model-editor src/webview/usage eslint.config.js
git commit -m "refactor: make webview components easier to edit"
```

---

### Task 4: Document the maintainability boundary

**Files:**
- Modify: `CODE_CONVENTION.md`

- [ ] **Step 1: Add concise webview presentation rules**

Under `src/webview` boundary rules, record:

- shared VS Code tokens and native control presentation live in `src/webview/shared/*.css`
- panel layout and domain-specific visuals stay beside panel components
- host/webview message shapes use neutral contracts under `src/types`
- webview code must not import `src/runtime`, directly or transitively
- generic React UI primitives require at least two behaviorally identical consumers; CSS reuse is preferred first

Do not add design-system documentation or component catalogs.

- [ ] **Step 2: Verify documentation and imports**

Search:

```text
src/webview/**/* -> no @/runtime/ imports
src/webview/**/* -> no vscode or node:* imports
```

Run:

```text
pnpm run lint
```

- [ ] **Step 3: Commit**

```text
git add CODE_CONVENTION.md
git commit -m "docs: define reusable webview presentation rules"
```

---

### Task 5: Full verification and package inspection

**Files:** none expected.

- [ ] **Step 1: Run full gate**

```text
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

All commands must exit 0.

- [ ] **Step 2: Verify package contents**

Confirm VSIX includes:

```text
dist/webview/usage/index.html
dist/webview/usage/client.js
dist/webview/usage/client.css
dist/webview/model-editor/index.html
dist/webview/model-editor/client.js
dist/webview/model-editor/client.css
```

Confirm package excludes `scripts/`, `src/`, tests, and internal docs.

- [ ] **Step 3: Check package size regression**

Compare resulting VSIX size with a package built from the same Vite mode. Last production-minified package measured about `212 KB`; current user changes may intentionally disable minification. Investigate only unexpected growth from duplicated runtime or assets.

Current working-tree note: `scripts/vite-config.mjs` may intentionally use `minify: false`; do not overwrite user changes. Record actual package size and compare against matching build mode instead of forcing config changes.

- [ ] **Step 4: Final manual smoke test**

In Extension Development Host:

1. Usage panel renders cards, provider icons, quota meters, empty state, and refresh action.
2. Model editor renders warnings and configured rows.
3. Add opens form and catalog prefill still produces unique IDs.
4. Save validation errors remain beside form.
5. Delete confirmation remains modal.
6. Reorder controls preserve model order and disabled endpoints.
7. Light/dark/high-contrast themes keep controls readable.
8. Keyboard-only navigation reaches every actionable element with visible focus.

- [ ] **Step 5: Confirm clean worktree**

Run `git status --short`. Only known pre-existing user changes may remain.

## Deliberate Omissions

- No generic React component library: add only when two panels need identical behavior, not merely similar colors.
- No shared HTML shell: add when third panel creates real duplication.
- No shared React vendor chunk: add when measured package or load cost warrants CSP/build complexity.
- No visual redesign: this plan improves changeability while preserving current UI.
- No snapshot framework: existing pure view-model tests plus build/manual checks cover this refactor ceiling.
