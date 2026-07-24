# Per-Model Thinking Efforts Design

## Problem

Every published model currently exposes all six router thinking efforts plus `None` in Copilot Chat. `thinkingMode` configures only that model's default. It cannot limit picker choices to levels supported by the mapped `9router` model.

Users need an explicit per-model allowlist. Extension must keep `9router` as routing and provider-compatibility authority, preserve native Copilot Chat UI, and degrade one invalid model without affecting others.

## Decision

Add optional `thinkingEfforts` to each object in `9router-copilot.models`.

```json
{
  "id": "agent",
  "name": "Agent",
  "modelId": "router/agent",
  "thinkingMode": "medium",
  "thinkingEfforts": ["minimal", "low", "medium", "high"]
}
```

Accepted entries are:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

`thinkingEfforts` contains only non-`off` values sent through `reasoning_effort`. Extension always makes `None` available when a thinking picker exists; `None` maps to internal `off` and omits `reasoning_effort`.

Array order controls picker order after `None`.

## Configuration Contract

`ConfiguredModel` gains a validated `thinkingEfforts` array.

Rules:

- Missing `thinkingEfforts` normalizes to an empty array.
- Empty `thinkingEfforts` means model supports only `off`.
- Explicit `null`, non-array values, unsupported strings, non-string entries, and duplicate entries reject that model.
- `thinkingMode: "off"` is always valid regardless of list contents.
- Any non-`off` `thinkingMode` must appear in `thinkingEfforts`; otherwise model is rejected.
- Unknown fields remain rejected.
- One rejected model does not hide unrelated valid models.

This is an accepted breaking configuration change. Existing model objects with non-`off` `thinkingMode` must add a matching `thinkingEfforts` entry. Existing objects with missing `thinkingEfforts` and `thinkingMode: "off"` remain valid but no longer expose a Thinking Effort picker.

The manifest schema documents `thinkingEfforts` as an array with unique enum items. Runtime validation remains authoritative because settings and host request options are trust boundaries.

## Picker Publication

Each model receives its own schema.

When `thinkingEfforts` contains at least one value, `configurationSchema.properties.reasoningEffort` uses:

- `enum`: `none`, then configured efforts in array order
- labels and descriptions corresponding to those values
- default: `none` for `thinkingMode: "off"`, otherwise configured `thinkingMode`
- group: `navigation`

When `thinkingEfforts` is empty, model publication omits `configurationSchema`. Copilot Chat therefore hides the Thinking Effort picker instead of showing a one-option `None` control.

No custom UI, Quick Pick, duplicate model entry, or proposed API opt-in is added.

## Effective Thinking Mode

For each request, provider resolves effective mode in this order:

1. Valid `modelConfiguration.reasoningEffort` allowed for selected model.
2. Valid compatibility `configuration.reasoningEffort` allowed for selected model.
3. Selected model's validated `thinkingMode`.

`none` is always accepted and maps to `off`. Other host values are accepted only when present in selected model's `thinkingEfforts`.

Missing, malformed, unsupported, or stale host values fall back to `thinkingMode`. This handles a persisted picker selection after user narrows `thinkingEfforts` without failing request or mutating settings snapshot.

Request adapter behavior remains unchanged:

- `off`: omit `reasoning_effort`
- enabled mode: send mode through `reasoning_effort`
- keep configured opaque `modelId` unchanged

No change is needed in `RouterChatCompletionRequest` or transport contract.

## Data Flow

1. Read each configured model object.
2. Validate and normalize `thinkingEfforts` with other model fields.
3. Reject only entries with invalid effort configuration.
4. Publish valid models; attach model-specific schema only when list is non-empty.
5. Copilot Chat persists picker selection per published model.
6. Validate request selection against selected model's allowlist.
7. Fall back to `thinkingMode` when host value is invalid or stale.
8. Send existing OpenAI-compatible request through `9router`.

Existing settings-change refresh rebuilds catalog and picker schemas. No backend discovery, cache, migration, or routing behavior is added.

## Errors and Diagnostics

Add model-level validation issue for invalid `thinkingEfforts`. Messages identify source model and field path without logging prompts, secrets, or raw host configuration.

Default-not-in-list errors remain model-level configuration errors. Invalid host selections are runtime fallback outcomes, not user-facing request failures.

Diagnostics may report configured default, allowed effort names, effective mode, and source using existing safe metadata behavior.

## Testing

Follow test-first development.

Unit coverage:

- missing and empty lists normalize to empty
- valid lists preserve configured order
- unsupported, non-string, duplicate, `null`, and non-array values reject only affected model
- non-`off` default outside list rejects model
- `off` remains valid with any valid list
- schema enum, labels, descriptions, and default are model-specific
- empty list omits schema
- allowed picker override wins
- `none` maps to `off`
- malformed, unsupported, and stale host selections fall back to default
- compatibility `configuration` follows same allowlist

Integration coverage:

- settings refresh updates model schema
- selected allowed effort sends matching `reasoning_effort`
- `None` omits `reasoning_effort`
- stale selection falls back to configured default
- one invalid model does not block valid models

Run full verification gate:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run package`

## Documentation

Update:

- `package.json` configuration schema and default model example
- `README.md` model fields, example, breaking behavior, and Thinking Effort section
- canonical production design's Native thinking effort picker section

## Non-Goals

- Discover supported efforts from `GET /v1/models`
- Infer effort support from model ids or upstream providers
- Move provider compatibility or fallback policy into extension
- Render reasoning deltas
- Add custom chat UI
- Change `router-contract.ts`, endpoint behavior, stream parsing, tools, or vision
