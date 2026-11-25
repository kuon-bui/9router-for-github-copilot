# Model Form: Provider-then-Model Picker

Date: 2026-11-25
Status: Draft (awaiting approval)
Size: small change (webview only)

## Intent

The Add/Edit model form picks a 9router model from one flat `<select>` holding the
whole `/v1/models` catalog. The list is long and hard to scan. Split it into two
searchable pickers: choose a **provider** first, then a **model** from that
provider.

## Goals

- Two pickers in the form's Identity section: Provider, then Model.
- Both pickers filter as the user types; mouse and keyboard (Up/Down/Enter/Escape) selection.
- Selecting a model keeps today's behaviour: `prefill()` fills id, name, vision and token limits from the catalog entry.

## Non-goals

- No host, router client, settings schema or protocol changes. The webview already
  receives `ownedBy` and `modelId` for every catalog entry.
- No change to the manual "9router model id" text field; it stays for ids not in the catalog.
- No change to the model list view, the vision proxy QuickPicks or any command.

## Anti-goals

- A model in the catalog that cannot be reached through the pickers.
- Routing knowledge in the extension: providers are only a display grouping of what
  9router returns.

## Approaches

| Option | Trade-off |
|--------|-----------|
| **A. Custom shared combobox component (chosen)** | Search, icons, `in use`/`vision` labels, themed with VS Code tokens; ~150 lines plus ARIA/keyboard handling to own. |
| B. `<input list>` + `<datalist>` | Almost no code, but unstyleable in the webview, no icons or labels, allows free text. Keeps the list feeling messy. |
| C. Native `<select>` with a filter input above | Simple, but two interactions per pick and no icons. |

The user picked A.

## Design

### Provider grouping (pure, in `src/webview/model-editor/view-model.ts`)

- `resolveCatalogProvider(entry)`: `entry.ownedBy` if non-empty; else the part of
  `modelId` before the first `/` if there is one; else the constant group `Other`.
- `buildProviderOptions(catalog)`: one option per provider with model count, sorted
  by provider name with `Other` last.
- `buildModelOptions(catalog, provider)`: catalog entries for that provider, keeping
  catalog order, each carrying `in use` / `vision` flags.
- `filterPickerOptions(options, query)`: case-insensitive substring match on the
  option's label and value; empty query returns all.

### Combobox component (`src/webview/shared/Combobox.tsx`)

- Text input + popup listbox, WAI-ARIA combobox pattern (`role="combobox"`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`/`option`).
- Props: `id`, `label`, `options` (`value`, `label`, optional `detail`, optional
  `iconUrl`), `value`, `placeholder`, `disabled`, `onChange(value)`.
- Opens on focus or typing, filters with `filterPickerOptions`, Up/Down moves the
  active option, Enter selects, Escape closes and restores the selected label, blur
  closes without changing the value. Empty result shows "No matches".
- Styles in `src/webview/shared/ui.css`, using the existing theme tokens.

### Form behaviour (`src/webview/model-editor/ModelForm.tsx`)

- New local state `provider`. Initial value: the provider of the catalog entry whose
  `modelId` equals the draft's `modelId` (Edit, or an entry already filled), else empty.
- Provider picker shows provider icon via `resolveProviderIcon` and the model count.
- Model picker is disabled until a provider is selected and lists only that provider's
  models.
- Changing provider clears the selected catalog model in the picker; it does not wipe
  fields the user typed by hand.
- Selecting a model calls the existing `prefill(modelId)`.
- An Edit row whose `modelId` is not in the catalog leaves both pickers empty; the
  manual field still shows the id.

## Testing

- Unit tests in `test/unit/webview/model-editor/view-model.test.ts` for
  `resolveCatalogProvider`, `buildProviderOptions`, `buildModelOptions`, and
  `filterPickerOptions` (ownedBy present, prefix fallback, `Other` group, sort order,
  case-insensitive filtering, empty query).
- The webview has no DOM test environment; the combobox is kept thin over these pure
  helpers and checked by hand in the Extension Development Host.
- Full verification gate from `AGENTS.md` before calling it done.

## Left to the builder

- Exact markup and CSS of the popup, and max popup height.
- Whether `filterPickerOptions` lives in the shared folder or model-editor view model.
