# Model Manager Panel Design

## Document Status

- Status: Approved draft
- Date: 2026-08-31
- Scope: Guided add, edit, delete, and reorder of curated picker models from 9router catalog metadata
- Language: English

## Objective

Let users build and maintain `9router-copilot.models` from a dedicated webview panel instead of editing `settings.json` by hand. The panel lists every configured entry, exposes every supported model field as a form control, and seeds a new entry from authenticated `GET /v1/models` metadata so a working model can be added in a few clicks.

The feature preserves the thin-adapter architecture. 9router remains the source of truth for which models exist and what they support. The extension only reads declared catalog metadata, writes validated entries into user settings, and lets the existing configuration-change path republish the picker.

## Confirmed Decisions

- Surface is a single-page webview panel, not a Quick Pick wizard.
- Scope is a full manager: add, edit, delete, and reorder configured models.
- Selecting a catalog model prefills every derivable field, including token limits.
- The panel refuses to open when the catalog cannot be fetched; the failure is reported as an error message.
- Invalid entries already present in settings are listed with an error badge and remain byte-identical unless the user edits or deletes them.
- The add/edit form keeps a local draft with Save and Cancel; delete and reorder apply immediately.
- Writes target `ConfigurationTarget.Global`, matching `9router: Configure Vision Proxy`.
- Reordering uses up/down buttons, not drag and drop.
- Field validation rules are shared with `parseModelSettings` through one extracted rules module.

## Context

`9router-copilot.models` is an ordered array of curated display models. `parseModelSettings` in `src/config/model-settings.ts` validates ten fields per entry and silently drops any entry that fails, recording the reason in `rejectedModels` and `issues`. Users currently discover these failures only through `9router: Show Diagnostics`.

`src/router/model-catalog.ts` already parses catalog responses into `RouterModelMetadata` with `id`, `ownedBy`, `vision`, `contextWindow`, and `maxOutput`. `src/runtime/vision-configuration.ts` establishes the fetch-then-configure pattern: read the API key, validate runtime settings, call `routerClient.listModels`, then write the selection with `settings.update(..., ConfigurationTarget.Global)`.

`handleConfigurationChange` in `src/runtime/activate.ts` rebuilds the settings snapshot and refreshes the provider whenever any `9router-copilot` setting changes, so a settings write is sufficient to republish the Copilot picker. No provider API changes are required.

The shipped default `models` value contains one entry with `modelId: ""`, which `parseModelSettings` rejects as `INVALID_MODEL_MAPPING`. A fresh install therefore opens the panel to exactly one error-badged row, which is the primary use case this feature serves.

## Non-Goals

- Editing runtime settings, Vision proxy settings, or the API key from this panel
- Creating, editing, or reordering 9router combos or upstream models
- Guessing tool or thinking support from model names when the catalog omits it
- Drag-and-drop reordering
- Writing to workspace or folder settings scopes
- Migrating or rewriting existing valid entries
- Offline operation or a persisted catalog cache
- A bundled webview asset pipeline

## Architecture

A new command `9routerCopilot.manageModels` ("9router: Manage Models") is contributed in `package.json`, registered in `src/runtime/commands.ts`, and wired in `src/runtime/activate.ts` next to `configureVisionProxy`.

Five modules are added. Logic lives in pure modules; the panel module stays thin.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `src/config/model-field-rules.ts` | Single source of truth for field rules: `MODEL_ID_PATTERN`, `THINKING_SUFFIX_PATTERN`, tool/vision/thinking mode sets | none |
| `src/config/model-draft.ts` | `createDraftFromCatalog`, `sanitizeModelId`, `suggestDisplayName`, `validateDraft`, `toSettingsEntry` | field rules, `RouterModelMetadata` |
| `src/config/models-writer.ts` | `addModelEntry`, `updateModelEntry`, `removeModelEntry`, `moveModelEntry` over the raw settings array | none |
| `src/runtime/model-manager-view.ts` | Builds `ModelManagerViewState` from raw entries, `parseModelSettings` issues, catalog metadata, and scope warnings | model settings, model catalog |
| `src/runtime/model-manager-panel.ts` and `src/runtime/model-manager-html.ts` | Panel lifecycle, message dispatch, settings writes; static HTML shell with a nonced inline script | vscode |

`src/config/model-settings.ts` is refactored to import from `model-field-rules.ts` instead of declaring the same constants locally. Behavior is unchanged and existing tests must stay green.

The HTML shell is static: it contains the layout, the form controls, and the inline script, but no user data. The list is built in the webview from the state message. A full re-render of the document is not possible without destroying an open draft, so rendering the list client-side is what keeps the Save/Cancel form workable. The testable logic therefore lives in `model-manager-view.ts`, not in the HTML module.

## Open Flow

1. `getApiKey` returns nothing: throw `NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured')`.
2. Runtime settings fail `isValidRuntime`: throw `NineRouterError('CONFIGURATION_ERROR', ...)`.
3. Call `routerClient.listModels` with a `CancellationTokenSource` and `createAbortSignalFromToken`.
4. Any failure in steps 1 to 3 leaves the panel closed. The command handler reports it with `showErrorMessage`, including the request id when the error is a `NineRouterError`, matching the `testConnection` handler.
5. On success, create or reveal the module-level singleton panel with `enableScripts: true`, `retainContextWhenHidden: true`, `localResourceRoots: []`, and `enableCommandUris` left off.

## Data Flow

Every mutation follows the same path:

```
webview postMessage
  -> host re-reads the raw models array from configuration
  -> models-writer applies the mutation by sourceIndex
  -> settings.update('models', next, ConfigurationTarget.Global)
  -> onDidChangeConfiguration fires
  -> host builds view state and posts { type: 'state' }
```

The host never trusts webview-held state as the write base; it re-reads configuration for each mutation. State is pushed from exactly one place, the configuration listener, so the panel stays consistent with `settings.json` even when the file is edited externally. The same write also triggers the existing provider refresh, so the Copilot picker updates immediately.

## View State

```ts
interface CatalogEntry {
  modelId: string;
  ownedBy?: string;
  vision: boolean;
  contextWindow?: number;
  maxOutput?: number;
  inUse: boolean;
}

interface ModelRow {
  sourceIndex: number;
  valid: boolean;
  id?: string;
  name?: string;
  modelId?: string;
  serviceTier?: 'fast';
  toolMode?: ToolMode;
  visionMode?: VisionMode;
  thinkingMode?: ThinkingMode;
  thinkingEfforts?: EnabledThinkingMode[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  issue?: { code: ModelSettingsIssueCode; message: string };
  catalogStatus: 'matched' | 'missing';
}

interface ModelManagerViewState {
  models: ModelRow[];
  catalog: CatalogEntry[];
  warnings: string[];
}
```

Rejected entries still produce a row. Every readable field is carried through so the user can repair the entry in the form. `catalogStatus` is `missing` when `modelId` has no exact catalog match. `warnings` carries the workspace-override notice described under Settings Scope.

## Message Contract

Webview to host. The host revalidates every message: shape, `sourceIndex` bounds, and `validateDraft` on the payload before any write.

| Message | Behavior |
| --- | --- |
| `{ type: 'ready' }` | Host replies with the first `state` message |
| `{ type: 'saveModel', sourceIndex: number \| null, draft }` | `null` appends a new entry; a number overwrites that entry |
| `{ type: 'removeModel', sourceIndex }` | Confirm through `showWarningMessage(..., { modal: true }, 'Delete')`, then remove |
| `{ type: 'moveModel', sourceIndex, direction: 'up' \| 'down' }` | Swap with the adjacent entry; no-op at the boundaries |
| `{ type: 'refreshCatalog' }` | Re-run `listModels`; on failure post `error` and keep the previous catalog |

Host to webview: `{ type: 'state', state }` and `{ type: 'error', message }`.

## Panel Layout

One list column. Each row shows the display name, `id`, `modelId`, and chips for fast tier, tool mode, vision mode, and thinking mode, plus a red badge carrying the issue message when the entry is invalid and an amber badge when `catalogStatus` is `missing`. Row actions are Edit, Delete, and up/down.

An `Add model` button opens the draft form below the list. The form contains a catalog dropdown, `id`, `name`, `modelId`, a Fast tier checkbox, tool mode radios, vision mode radios, a thinking mode select, a thinking efforts checkbox group, and numeric inputs for `maxInputTokens` and `maxOutputTokens`. Validation errors render inline under the offending field and block Save. Only one form is open at a time. Catalog entries already referenced by a configured model are marked in use but remain selectable, because one catalog model may back several display entries.

## Prefill Rules

When a catalog model is selected in the form:

- `modelId` is the catalog id verbatim.
- `id` is the sanitized catalog id: lowercased, `/` and any character outside `[a-z0-9._-]` replaced with `-`, runs of `-` collapsed, leading characters outside `[a-z0-9]` trimmed. A collision with an existing id appends `-2`, `-3`, and so on.
- `name` drops the owner prefix and keeps the remainder verbatim, so `cx/gpt-5.6-sol` becomes `gpt-5.6-sol`. Title casing is deliberately not applied because model names carry digits and abbreviations that it would mangle.
- `visionMode` is `native` when `capabilities.vision` is true, otherwise `off`.
- `toolMode` is `auto`.
- `thinkingMode` is `off` and `thinkingEfforts` is empty; the catalog carries no thinking metadata.
- `maxOutputTokens` is `maxOutput` when present, otherwise `264000`.
- `maxInputTokens` is `contextWindow - maxOutput` when that value is positive, otherwise `264000`.

Prefilled values are ordinary form values. The user may overwrite any of them before saving.

## Validation

`validateDraft` enforces exactly the rules `parseModelSettings` enforces, through the shared rules module: id pattern, non-empty name, non-empty `modelId` without a thinking suffix, `serviceTier` limited to `fast`, tool and vision and thinking mode membership, unique supported thinking efforts, thinking efforts containing a non-off `thinkingMode`, and positive safe integers for both token fields. It adds one rule the parser expresses differently: the draft id must not collide with another entry's id, excluding the entry being edited.

`toSettingsEntry` omits `serviceTier` when the tier is not `fast` and writes the remaining nine fields explicitly, so saved entries are stable and diff-friendly.

## Settings Scope

The panel writes to `ConfigurationTarget.Global`. When `inspect().workspaceValue` is present, a workspace value overrides what the panel writes; the panel surfaces this through a warning banner and still writes to the user scope. Automatically switching scopes is rejected because it would modify files shared through the repository.

## Webview Security

- CSP meta: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<nonce>';`. No `img-src`, because this panel loads no images.
- A fresh nonce is generated per shell render.
- `localResourceRoots` is empty and `enableCommandUris` is off.
- The webview script builds DOM through `createElement` and `textContent`. `innerHTML` is never used with settings or catalog values.
- The HTML shell embeds no user data, so there is no template-string injection path. All data arrives through `postMessage` after `ready`.

## Error Handling

| Situation | Behavior |
| --- | --- |
| Missing API key, invalid runtime, or catalog failure at open time | Panel stays closed; `showErrorMessage` with the request id when available |
| `refreshCatalog` failure | Panel stays open; post `error`; keep the previous catalog |
| `settings.update` rejection | Raise `CONFIGURATION_ERROR` as in `vision-configuration.ts`; post `error`; state unchanged |
| Malformed message, out-of-range `sourceIndex`, or invalid draft | No write; post `error` |
| Configured `models` value is not an array | Show a warning; treat the mutation base as an empty array |

## Testing

Test-driven, run through `pnpm test`.

- `test/unit/config/model-draft.test.ts`: prefill from catalog, including vision to native, `contextWindow - maxOutput`, and the `264000` fallbacks; id sanitization such as `cx/gpt-5.6-sol` to `cx-gpt-5.6-sol`; collision suffixes; one case per validation failure.
- `test/unit/config/models-writer.test.ts`: add, update, remove, and move preserve unrelated entries byte-for-byte, including rejected ones; boundary moves are no-ops; non-array input.
- `test/unit/runtime/model-manager-view.test.ts`: issues map onto the correct row by `sourceIndex`; `catalogStatus`; `inUse`; workspace-override warning.
- `test/unit/runtime/model-manager-html.test.ts`: CSP present, nonce matches the script tag, no settings data embedded.
- `test/unit/runtime/model-manager-panel.test.ts`: each message produces the expected `settings.update` payload; catalog failure creates no panel; a second open reveals the singleton.
- `test/integration/extension/manage-models-command.test.ts`: the command is registered and opens the panel.
- `test/integration/extension/release-guardrails.test.ts`: assert `9routerCopilot.manageModels` is contributed.

`test/support/vscode.ts` gains `webview.onDidReceiveMessage` and `webview.postMessage`, `window.showWarningMessage`, `getConfiguration().inspect()`, and a real listener registry for `onDidChangeConfiguration`, which currently discards its listener.

## Files Touched

- Added: `src/config/model-field-rules.ts`, `src/config/model-draft.ts`, `src/config/models-writer.ts`, `src/runtime/model-manager-view.ts`, `src/runtime/model-manager-panel.ts`, `src/runtime/model-manager-html.ts`
- Modified: `package.json` (command contribution), `src/config/model-settings.ts` (import shared rules), `src/runtime/commands.ts`, `src/runtime/activate.ts`, `test/support/vscode.ts`, `README.md`

## Risks

- The inline webview script is the largest untested surface in the design. It is kept deliberately thin: dispatch messages, build rows from state, hold the draft. Anything that decides something moves into `model-manager-view.ts` or `model-draft.ts`.
- Extracting shared field rules touches validated production code. The existing `model-settings` tests are the guardrail and must pass unchanged.
- Refusing to open without a catalog means the panel cannot repair settings while 9router is unreachable. `settings.json` remains the fallback, and this trade was chosen deliberately for a simpler first version.
