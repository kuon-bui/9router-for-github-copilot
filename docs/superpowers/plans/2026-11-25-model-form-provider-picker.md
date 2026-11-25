# Model Form Provider Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "9router model" `<select>` in the Add/Edit model form with two searchable pickers: Provider, then Model.

**Architecture:** Webview-only change. Pure grouping helpers in the model-editor view model, a pure combobox model (filtering + keyboard state) in `src/webview/shared`, and a thin Preact `Combobox` component over it. `ModelForm` derives the provider from the catalog and reuses its existing `prefill()`.

**Tech Stack:** TypeScript, Preact (via `react` alias), Tailwind + SCSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-model-form-provider-picker-design.md`

## Global Constraints

- No changes to host code (`src/runtime/**`), router client, settings schema, or `src/webview/shared/protocol.ts`.
- Keep the manual "9router model id" text field and the Fast tier checkbox unchanged.
- Provider resolution order: non-empty `ownedBy` → `modelId` text before the first `/` → group `Other`.
- `Other` sorts last; other providers sort by `localeCompare`.
- Follow `CODE_CONVENTION.md`; `exactOptionalPropertyTypes` is on (spread optional props from narrowed locals).
- Provider icons come from `resolveProviderIcon` (`src/webview/shared/provider-icons.ts`); CSP already allows `https://unpkg.com` images.
- Commits use conventional prefixes (`feat(webview): …`, `test(webview): …`).

## Review Focus

1. Pressing Enter in an open picker must select the option, not submit the form (pinned by `handleComboboxKey` test in Task 2).
2. Enter in an open picker with zero matches must not submit the form (pinned in Task 2).
3. `ownedBy` that disagrees with the id prefix (`ownedBy: 'router'`, id `cx/gpt`) groups by `ownedBy` (pinned in Task 1).
4. Edit of a row whose `modelId` is not in the catalog leaves both pickers empty without crashing (pinned by `findCatalogProvider` returning `undefined` in Task 1).
5. Queries with surrounding spaces, mixed case, or regex characters (`" GPT "`, `"("`) filter by plain substring and never throw (pinned in Task 2).

---

### Task 1: Provider grouping helpers

**Files:**
- Modify: `src/webview/model-editor/view-model.ts`
- Test: `test/unit/webview/model-editor/view-model.test.ts`

**Interfaces:**
- Consumes: `ModelEditorCatalogEntry` from `@/types/model-editor`; `resolveProviderIcon` from `@/webview/shared/provider-icons`.
- Produces (all exported from `view-model.ts`):
  - `OTHER_PROVIDER = 'Other'`
  - `resolveCatalogProvider(entry: ModelEditorCatalogEntry): string`
  - `findCatalogProvider(catalog: readonly ModelEditorCatalogEntry[], modelId: string): string | undefined`
  - `buildProviderOptions(catalog: readonly ModelEditorCatalogEntry[]): PickerOption[]`
  - `buildModelOptions(catalog: readonly ModelEditorCatalogEntry[], provider: string): PickerOption[]`

`PickerOption` lives in `src/webview/shared/combobox-model.ts` (created in this task with only the type, filled out in Task 2):

```ts
export interface PickerOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly iconUrl?: string;
}
```

- [ ] **Step 1: Write the failing tests** in `view-model.test.ts` (catalog entry helper: `{ modelId, vision: false, inUse: false, ...overrides }`):

```ts
describe('resolveCatalogProvider', () => {
  it('prefers ownedBy', () => expect(resolveCatalogProvider(entry({ modelId: 'cx/gpt', ownedBy: 'router' }))).toBe('router'));
  it('falls back to the id prefix', () => expect(resolveCatalogProvider(entry({ modelId: 'cx/gpt-5' }))).toBe('cx'));
  it('uses Other when neither exists', () => expect(resolveCatalogProvider(entry({ modelId: 'my-combo' }))).toBe(OTHER_PROVIDER));
  it('treats a leading slash as no prefix', () => expect(resolveCatalogProvider(entry({ modelId: '/x' }))).toBe(OTHER_PROVIDER));
});

describe('findCatalogProvider', () => {
  it('returns the provider of a catalog model', () => expect(findCatalogProvider([entry({ modelId: 'cx/a', ownedBy: 'cx' })], 'cx/a')).toBe('cx'));
  it('returns undefined for unknown or empty ids', () => {
    expect(findCatalogProvider([entry({ modelId: 'cx/a' })], 'gone/model')).toBeUndefined();
    expect(findCatalogProvider([entry({ modelId: 'cx/a' })], '')).toBeUndefined();
  });
});

describe('buildProviderOptions', () => {
  it('groups, counts, sorts, and puts Other last', () => {
    const options = buildProviderOptions([
      entry({ modelId: 'zz-combo' }), entry({ modelId: 'gc/b', ownedBy: 'gc' }),
      entry({ modelId: 'cx/a', ownedBy: 'cx' }), entry({ modelId: 'cx/b', ownedBy: 'cx' })
    ]);
    expect(options.map((o) => [o.value, o.detail])).toEqual([
      ['cx', '2 models'], ['gc', '1 model'], [OTHER_PROVIDER, '1 model']
    ]);
    expect(options[0]?.iconUrl).toContain('/codex-color.svg');
    expect(options[2]?.iconUrl).toBeUndefined();
  });
  it('returns [] for an empty catalog', () => expect(buildProviderOptions([])).toEqual([]));
});

describe('buildModelOptions', () => {
  it('keeps catalog order for one provider with in use / vision detail', () => {
    const options = buildModelOptions([
      entry({ modelId: 'cx/b', ownedBy: 'cx', inUse: true, vision: true }),
      entry({ modelId: 'gc/x', ownedBy: 'gc' }),
      entry({ modelId: 'cx/a', ownedBy: 'cx' })
    ], 'cx');
    expect(options).toEqual([
      { value: 'cx/b', label: 'cx/b', detail: 'in use · vision' },
      { value: 'cx/a', label: 'cx/a' }
    ]);
  });
  it('returns [] for an unknown provider', () => expect(buildModelOptions([entry({ modelId: 'cx/a' })], 'nope')).toEqual([]));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/unit/webview/model-editor/view-model.test.ts`
Expected: FAIL — `resolveCatalogProvider` (and the others) are not exported.

- [ ] **Step 3: Implement** the five exports in `view-model.ts` and the `PickerOption` type in `src/webview/shared/combobox-model.ts`. Detail strings: `"1 model"` / `"N models"`; model detail joins present flags (`in use`, `vision`) with `' · '` and is omitted when none. Omit `iconUrl` when `resolveProviderIcon` returns `undefined`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/unit/webview/model-editor/view-model.test.ts`
Expected: PASS (existing tests in the file still pass).

- [ ] **Step 5: Commit**

```bash
git add src/webview/model-editor/view-model.ts src/webview/shared/combobox-model.ts test/unit/webview/model-editor/view-model.test.ts
git commit -m "feat(webview): group model catalog by provider for pickers"
```

---

### Task 2: Combobox model and component

**Files:**
- Modify: `src/webview/shared/combobox-model.ts`
- Create: `src/webview/shared/Combobox.tsx`
- Modify: `src/webview/shared/controls.scss` (popup styles)
- Test: `test/unit/webview/shared/combobox-model.test.ts`

**Interfaces:**
- Consumes: `PickerOption` (Task 1).
- Produces:
  - `filterPickerOptions(options: readonly PickerOption[], query: string): PickerOption[]`
  - `interface ComboboxNav { readonly open: boolean; readonly activeIndex: number }` (`-1` = none)
  - `interface ComboboxKeyResult { readonly nav: ComboboxNav; readonly selectIndex?: number; readonly preventDefault: boolean; readonly restoreLabel?: true }`
  - `handleComboboxKey(nav: ComboboxNav, key: string, optionCount: number): ComboboxKeyResult`
  - `Combobox(props: ComboboxProps): JSX.Element` with
    `ComboboxProps { id: string; label: string; options: readonly PickerOption[]; value: string; placeholder: string; disabled?: boolean; onChange: (value: string) => void }`

- [ ] **Step 1: Write the failing tests** in `combobox-model.test.ts`:

```ts
const opts = [
  { value: 'cx/gpt-5', label: 'cx/gpt-5' },
  { value: 'gc/gemini', label: 'gc/gemini', detail: 'vision' },
  { value: 'x(1)', label: 'Paren (1)' }
];

describe('filterPickerOptions', () => {
  it('returns all options for an empty or blank query', () => {
    expect(filterPickerOptions(opts, '')).toEqual(opts);
    expect(filterPickerOptions(opts, '   ')).toEqual(opts);
  });
  it('matches label or value, trimmed and case-insensitive', () => {
    expect(filterPickerOptions(opts, ' GPT ').map((o) => o.value)).toEqual(['cx/gpt-5']);
    expect(filterPickerOptions(opts, 'x(1')).toHaveLength(1);
  });
  it('treats regex characters literally', () => expect(filterPickerOptions(opts, '(')).toHaveLength(1));
  it('returns [] when nothing matches', () => expect(filterPickerOptions(opts, 'zzz')).toEqual([]));
});

describe('handleComboboxKey', () => {
  const closed = { open: false, activeIndex: -1 };
  it('ArrowDown opens on the first option', () =>
    expect(handleComboboxKey(closed, 'ArrowDown', 3)).toEqual({ nav: { open: true, activeIndex: 0 }, preventDefault: true }));
  it('ArrowDown/ArrowUp clamp to the list', () => {
    expect(handleComboboxKey({ open: true, activeIndex: 2 }, 'ArrowDown', 3).nav.activeIndex).toBe(2);
    expect(handleComboboxKey({ open: true, activeIndex: 0 }, 'ArrowUp', 3).nav.activeIndex).toBe(0);
  });
  it('Enter on an open list selects, closes, and blocks form submit', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'Enter', 3)).toEqual({ nav: { open: false, activeIndex: -1 }, selectIndex: 1, preventDefault: true }));
  it('Enter on an open list with no matches blocks submit without selecting', () => {
    const result = handleComboboxKey({ open: true, activeIndex: -1 }, 'Enter', 0);
    expect(result.preventDefault).toBe(true);
    expect(result.selectIndex).toBeUndefined();
  });
  it('Enter on a closed list is left to the form', () =>
    expect(handleComboboxKey(closed, 'Enter', 3).preventDefault).toBe(false));
  it('Escape closes and restores the selected label', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'Escape', 3)).toEqual({ nav: { open: false, activeIndex: -1 }, preventDefault: true, restoreLabel: true }));
  it('other keys pass through', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'a', 3)).toEqual({ nav: { open: true, activeIndex: 1 }, preventDefault: false }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run test/unit/webview/shared/combobox-model.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** `filterPickerOptions` (plain `includes` on lowercased trimmed query against `label` and `value`) and `handleComboboxKey` in `combobox-model.ts`. When `optionCount` is 0, any opened state uses `activeIndex: -1`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run test/unit/webview/shared/combobox-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `Combobox.tsx`**

Thin over the model: local `query` and `nav` state; the input shows `query` while open, otherwise the label of the option whose `value === props.value` (or empty). Typing sets `query`, opens, sets `activeIndex` to 0 (or -1 if no matches). `onKeyDown` calls `handleComboboxKey` on the filtered list, calls `event.preventDefault()` when asked, `props.onChange(filtered[selectIndex].value)` on select, and clears `query` on select/restore. Option `onMouseDown` selects (use `mousedown` + `preventDefault` so blur does not close first). Blur closes without changing the value. Focus opens with an empty query.
ARIA: input `role="combobox"`, `aria-expanded`, `aria-controls={`${id}-listbox`}`, `aria-autocomplete="list"`, `aria-activedescendant={`${id}-option-${activeIndex}`}` when active; list `role="listbox"`; items `role="option"`, `aria-selected`. Empty filtered list renders a single non-option row "No matches". Options render `<img src={iconUrl} alt="" width={16} height={16}>` when present, the label, and `detail` in muted text. Input uses `className="ui-field"`.

- [ ] **Step 6: Add styles** in `controls.scss`: `.ui-combobox` (relative wrapper), `.ui-combobox-list` (absolute, full width, `max-height: 260px`, `overflow-y: auto`, `z-index: 10`, background `var(--vscode-dropdown-background)`, border `var(--vscode-dropdown-border, var(--vscode-widget-border))`, radius 6px), `.ui-combobox-option` (flex row, gap 8px, padding 4px 8px), `.ui-combobox-option-active` (background `var(--vscode-list-activeSelectionBackground)`, color `var(--vscode-list-activeSelectionForeground)`), `.ui-combobox-detail` (muted, `margin-left: auto`).

- [ ] **Step 7: Type-check and lint**

Run: `pnpm run build && pnpm run lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/webview/shared/combobox-model.ts src/webview/shared/Combobox.tsx src/webview/shared/controls.scss test/unit/webview/shared/combobox-model.test.ts
git commit -m "feat(webview): add searchable combobox component"
```

---

### Task 3: Wire pickers into the model form

**Files:**
- Modify: `src/webview/model-editor/ModelForm.tsx:106-121`

**Interfaces:**
- Consumes: `buildProviderOptions`, `buildModelOptions`, `findCatalogProvider` (Task 1); `Combobox` (Task 2); existing `prefill(modelId)`.

- [ ] **Step 1: Replace the `<select id="field-catalog">` block** with two `Combobox`es inside the same grid style as the id/name row (`grid-cols-1 min-[480px]:grid-cols-2`):
  - Provider: `id="field-provider"`, `label="Provider"`, `placeholder="Search providers"`, options `buildProviderOptions(props.state.catalog)`, value = local `provider` state, `onChange={setProvider}`.
  - Model: `id="field-catalog"`, `label="9router model"`, `placeholder={provider ? 'Search models' : 'Select a provider first'}`, `disabled={!provider}`, options `buildModelOptions(props.state.catalog, provider)`, value = `draft.modelId` if it is one of those options' values else `''`, `onChange={prefill}`.
  - `provider` state initial value: `findCatalogProvider(props.state.catalog, initialDraft.modelId) ?? ''`. Changing provider touches only `provider`; the draft is untouched (the model picker shows empty because its value is derived).

- [ ] **Step 2: Build, lint, unit tests**

Run: `pnpm run build && pnpm run lint && pnpm run test:unit`
Expected: all exit 0.

- [ ] **Step 3: Manual check in the Extension Development Host** (F5), via `9router: Add Model`:
  - Provider list shows icons and counts; typing filters; `Other` is last.
  - Model picker is disabled until a provider is picked; typing filters; selecting fills id/name/tokens as before.
  - Enter inside an open picker selects and does **not** submit the form; Escape restores the previous label.
  - Edit an existing catalog model: both pickers pre-selected. Edit a model not in the catalog: both empty, manual id field still shows the id.
  - "Refresh catalog" while the form is open does not crash it.

- [ ] **Step 4: Full verification gate**

Run: `pnpm run build && pnpm run lint && pnpm run test:unit && pnpm run test:integration && pnpm run package`
Expected: all exit 0; a `.vsix` is produced.

- [ ] **Step 5: Commit**

```bash
git add src/webview/model-editor/ModelForm.tsx
git commit -m "feat(webview): pick provider then model in the model form"
```
