# Dynamic Model Configuration Design

## Document Status

- Date: 2026-07-17
- Status: Approved for implementation planning
- Scope: User-defined Copilot display models backed by configured `9router` model ids

## Objective

Replace the fixed `Daily`, `Agent`, and `Fallback` configuration surface with
one ordered `9router-copilot.models` array. Users can define any valid Copilot
model id, display name, and `9router` model id while the extension remains a
thin provider adapter and `9router` remains responsible for combo routing,
fallback, quotas, and upstream execution.

The default configuration contains one `agent` entry. Its `modelId` is empty,
so the extension does not guess a backend model and does not publish the entry
until the user configures it.

## Approved Decisions

- Use one ordered array of model objects rather than an object map or parallel
  per-model settings.
- Make this a breaking configuration change. Do not read or migrate the old
  `displayModels`, `labels.*`, `modelMappings.*`, `toolMode.*`, `visionMode.*`,
  `thinkingMode.*`, `maxInputTokens.*`, or `maxOutputTokens.*` settings.
- Rename the extension-facing backend identifier from `comboId` to `modelId`
  across configuration, types, diagnostics, adapters, tests, and documentation.
- Rename `visionProxyComboId` to `visionProxyModelId` for the same terminology.
- Keep `9router` as the only routing authority. A configured `modelId` may
  identify a `9router` combo, but the extension treats it as an opaque model
  identifier and sends it unchanged in the OpenAI-compatible `model` field.
- Preserve array order in the Copilot model picker.
- Omit an `enabled` field. Users disable a model by removing its object from the
  array.

## Configuration Contract

The manifest contributes one model collection:

```json
{
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192
    }
  ]
}
```

Each array item accepts these fields:

| Field | Required | Contract |
| --- | --- | --- |
| `id` | Yes | Unique lowercase Copilot model id matching `[a-z0-9][a-z0-9._-]*` |
| `name` | Yes | Non-empty display name after trimming |
| `modelId` | Yes | Opaque `9router` model id after trimming; an empty value keeps the entry unpublished |
| `toolMode` | No | `auto` or `off`; omitted custom values default to `off` |
| `visionMode` | No | `native`, `proxy`, or `off`; omitted custom values default to `off` |
| `thinkingMode` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; omitted custom values default to `off` |
| `maxInputTokens` | No | Positive integer; omitted custom values default to `128000` |
| `maxOutputTokens` | No | Positive integer; omitted custom values default to `8192` |

The manifest schema uses `additionalProperties: false`. The default `agent`
object declares `toolMode: auto` explicitly; the generic optional-field
defaults remain conservative for user-created objects.

The separate shared Vision setting becomes:

```json
{
  "9router-copilot.visionProxyModelId": ""
}
```

All non-secret settings remain local per-user VS Code settings. The API key
continues to use `SecretStorage` only.

## Identifier Semantics

`id`, `name`, and `modelId` have separate responsibilities:

- `id` is the stable Copilot-facing model id and published model family.
- `name` is the user-visible picker label.
- `modelId` is the opaque backend identifier placed in the router request's
  OpenAI-compatible `model` field.

The extension does not lowercase, trim, or otherwise repair `id`. An invalid id
is rejected so two user inputs cannot silently normalize to the same published
identity. `name` and `modelId` are trimmed before validation and use.

## Validation and Degradation

The model parser treats the setting value as untrusted `unknown` input.

- `models` must be an array. A non-array value produces an empty model snapshot
  with a configuration issue.
- Each item must be a non-null plain object with no unknown properties.
- Missing or invalid `id`, `name`, or `modelId` fields reject that item.
- Invalid capability modes or token limits reject that item.
- A thinking suffix such as `(high)` in `modelId` is rejected; thinking remains
  a separate `thinkingMode` value and request field.
- Every occurrence of a duplicated `id` is rejected. The parser does not keep
  the first or last duplicate because either choice would make behavior depend
  on an ambiguous configuration order.
- Errors identify the array location and field, for example
  `9router-copilot.models[2].modelId`.
- A broken item does not prevent unrelated valid items from being published.
- An item with an empty `modelId` is retained in rejected-model diagnostics but
  omitted from the picker.
- Runtime-setting failures still invalidate the provider runtime as they do
  today.

Configuration and transport terminology uses model mapping rather than combo
mapping. Existing combo-specific configuration error names and messages become
model-mapping equivalents. Raw backend response bodies remain redacted.

## Architecture

### Model types

`src/types/product-model.ts` removes the fixed `ProductModelKey` union and the
`PRODUCT_MODEL_KEYS` list. The validated model type uses string `id`, `name`,
and `modelId` properties. Published model `family` becomes `string` and is set
to the configured `id`.

The internal model type no longer contains `enabled`; presence in the validated
array represents enablement.

### Model settings parser

Create `src/config/model-settings.ts` as the focused boundary for:

- recognizing model objects from `unknown` input;
- validating required fields and optional capability fields;
- applying conservative optional-field defaults;
- detecting duplicates across the complete input array; and
- returning validated models, rejected models, and model-scoped issues in input
  order.

This extraction prevents the existing `src/config/settings.ts` module from
growing further and keeps dynamic-object validation directly testable.

### Settings snapshot

`src/config/settings.ts` reads `configuration.get<unknown>('models')`, delegates
to the model parser, validates runtime settings, and assembles the snapshot.
The snapshot contains validated configured models and their published model
metadata. It continues to degrade per model and continues to expose issues to
diagnostics.

The runtime shared Vision property is renamed to `visionProxyModelId`.

### Model publication

`src/provider/model-catalog.ts` publishes every valid model in array order:

- `id` from the configured `id`;
- `name` from the configured `name`;
- `family` from the configured `id`;
- token limits from the validated model; and
- conservative tool and image capabilities from the validated modes.

An empty or otherwise invalid `modelId` never reaches model publication.

### Request resolution

`src/provider/provider.ts` resolves the Copilot-selected `model.id` against the
current validated snapshot. Request adapters receive the resolved model and set
the router request's `model` field to its `modelId` unchanged.

The same `modelId` terminology is used by request adaptation, Vision proxy
inputs, safe diagnostics, missing-model errors, and tests. Router response
classification may still recognize that a backend model is missing, but it no
longer exposes an extension configuration field named `comboId`.

### Refresh behavior

The existing namespace-level `onDidChangeConfiguration` listener already
refreshes for changes under `9router-copilot`. Adding, removing, renaming, or
reordering model objects rebuilds the snapshot and fires
`onDidChangeLanguageModelChatInformation`, allowing Copilot Chat to refresh its
native picker.

## Data Flow

```text
VS Code user setting: 9router-copilot.models
    -> model-settings parser and per-item validation
    -> validated configured models in array order
    -> model catalog publication
    -> native Copilot Chat model picker
    -> selected Copilot model id
    -> current snapshot lookup by id
    -> configured modelId
    -> OpenAI-compatible request.model
    -> 9router routing and upstream execution
```

No backend discovery, routing, fallback, or provider selection is added to the
extension.

## Error Handling and Diagnostics

Diagnostics include only safe configuration metadata:

- configured and published model ids;
- rejected array index and model id when safely available;
- stable validation code;
- field path and concise validation message; and
- capability degradation such as a missing shared Vision model id.

Diagnostics must not include prompt content, API keys, authorization headers,
or raw backend response bodies. A missing backend `modelId` returned by
`9router` is mapped to a concise configuration error that points users to the
matching `9router-copilot.models[index].modelId` field.

## Compatibility and Migration

This is an intentional breaking configuration change. The implementation:

- removes legacy settings from `package.json`;
- does not inspect legacy settings at runtime;
- does not merge legacy values into `models`;
- does not add a migration command; and
- documents the replacement JSON shape in the README.

Users upgrading from the fixed model configuration must manually create model
objects. Removing the old settings avoids two sources of truth and keeps model
ordering, identity, capabilities, and backend mapping atomic.

## Testing Strategy

### Unit tests

- Parse arbitrary ids such as `coder`, `research`, and `fast-v2`.
- Preserve model array order.
- Verify the single default `agent` object and empty default `modelId`.
- Apply conservative defaults to omitted optional fields.
- Trim `name` and `modelId` without normalizing `id`.
- Reject malformed arrays, non-object items, unknown fields, missing required
  fields, invalid ids, empty names, empty model ids, invalid modes, invalid
  token limits, thinking-suffixed model ids, and all duplicated ids.
- Preserve unrelated valid models when one item is rejected.
- Publish arbitrary ids, names, capabilities, and token limits.
- Resolve a selected custom id to its configured `modelId` in outgoing requests.

### Integration tests

- Refresh the picker after adding, removing, renaming, and reordering models.
- Preserve model-scoped degradation in diagnostics.
- Exercise text streaming with a custom model id and backend `modelId`.
- Retain tools, Vision, Thinking Effort, cancellation, and context-window usage
  behavior for dynamically configured models.
- Assert the manifest contributes `models` and `visionProxyModelId`, contains the
  single default `agent`, and no longer contributes legacy per-model settings.
- Assert packaged documentation describes the breaking configuration shape.

### Verification gate

Before completion, run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

## Documentation and Guidance Updates

Implementation updates:

- `README.md` with the new array example and manual migration notice;
- the canonical production design with user-defined curated display models;
- `AGENTS.md` so repository guidance no longer fixes the product model list to
  `Daily`, `Agent`, and `Fallback`;
- `CODE_CONVENTION.md` so product naming permits user-defined curated labels
  while keeping Copilot ids separate from `9router` model ids; and
- release guardrails so removed legacy settings cannot silently return.

Historical feature-specific specs remain historical records. The canonical
production design and this approved spec define the new architecture.

## Non-Goals

- Discovering models from `GET /v1/models`
- Validating that a configured `modelId` exists before publication
- Creating or editing `9router` combos from the extension
- Migrating legacy configuration automatically
- Adding a separate model-management UI
- Adding local routing or fallback policy
- Allowing secrets inside model objects

## Acceptance Criteria

- Users can configure any valid model `id`, display `name`, and backend
  `modelId` in one ordered array.
- The manifest defaults to exactly one `agent` object with an empty `modelId`.
- The default model remains unpublished until its backend `modelId` is set.
- Picker order matches array order.
- A selected custom id resolves to the configured `modelId` and sends that value
  unchanged as the router request's `model`.
- Optional fields use documented conservative defaults.
- Invalid or duplicate entries do not remove unrelated valid models.
- The old fixed per-model settings and `comboId` terminology are absent from the
  active configuration contract.
- Tools, Vision, Thinking Effort, streaming, cancellation, diagnostics, and
  context-window behavior continue to work for dynamic models.
- The extension remains a thin adapter and `9router` remains the sole routing
  authority.
