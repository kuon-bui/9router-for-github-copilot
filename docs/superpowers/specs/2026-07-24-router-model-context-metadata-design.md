# 9router Model Context Metadata Design

## Status

- Date: 2026-07-24
- Status: Approved for implementation planning
- Scope: Resolve Copilot context-window metadata from the 9router model catalog

## Objective

Stop requiring users to maintain context-window values manually for normal
operation. Before returning models to VS Code, the extension will read
`capabilities.contextWindow` and `capabilities.maxOutput` from authenticated
`GET /v1/models` results. `contextWindow` is total context size, while
`maxOutput` is output budget. The extension publishes the output budget and
derives input capacity from their difference as native Copilot Chat model
metadata.

Existing per-model `maxInputTokens` and `maxOutputTokens` settings remain as
compatibility fallbacks. If neither catalog metadata nor a configured fallback
is usable, the extension publishes `264000` for the affected field.

## Confirmed 9router Contract

The authenticated `GET /v1/models` response contains model entries shaped like:

```json
{
  "id": "cx/gpt-5.6-sol",
  "object": "model",
  "owned_by": "cx",
  "capabilities": {
    "contextWindow": 400000,
    "maxOutput": 128000
  }
}
```

Other capability fields may be present. This feature consumes only:

- `id`
- `capabilities.contextWindow`
- `capabilities.maxOutput`

`GET /v1/models/info?id=<modelId>` is not used because its observed response
does not include context-window metadata.

## Resolution Rules

Catalog entries are matched to configured models by exact
`catalogItem.id === configuredModel.modelId` equality. The extension does not
derive ids, inspect provider prefixes, or resolve combo routing locally.

Published limits are resolved in this order:

1. Resolve `maxOutputTokens` from valid catalog `capabilities.maxOutput`, then
   configured `models[].maxOutputTokens`, then built-in `264000`.
2. When valid catalog `capabilities.contextWindow` exceeds resolved
   `maxOutputTokens`, publish
   `maxInputTokens = contextWindow - maxOutputTokens`.
3. Otherwise resolve `maxInputTokens` from configured
   `models[].maxInputTokens`, then built-in `264000`.

A token limit is valid only when it is a positive safe integer. A missing or
invalid `maxOutput` uses its configured or built-in fallback before input is
calculated. A missing `contextWindow`, or one less than or equal to resolved
output, cannot produce a positive input limit and therefore uses configured or
built-in input fallback.

A configured model absent from the catalog remains published using fallback
values. Catalog data never changes `modelId`, routing, ordering, display ids,
or display names.

## Fetch and Cache Behavior

Every `provideLanguageModelChatInformation` call attempts one authenticated
`GET /v1/models` request using current runtime URL, API key, timeout, and
cancellation state.

The provider keeps the latest successfully parsed catalog in RAM:

- a successful fetch replaces the complete cached catalog;
- a failed fetch or malformed root keeps the previous successful catalog;
- when no successful catalog exists, configured and built-in fallbacks apply;
- cache is not persisted and disappears when the extension host stops;
- no timer, background refresh loop, or new dependency is added.

A structurally valid catalog root is a successful catalog even when individual
entries are malformed. Invalid entries are skipped. Valid entries preserve each
valid token field independently. An empty valid list replaces the cache with an
empty catalog.

Missing API credentials skip remote discovery and use the cache or fallbacks.
Catalog failure must not hide models or fail the model picker.

## Architecture and Data Flow

```text
VS Code requests model information
    -> provider attempts RouterClient GET /v1/models
    -> router boundary validates untrusted catalog JSON
    -> successful parsed catalog replaces provider RAM cache
    -> provider resolves catalog/config/default token limits
    -> createPublishedModel publishes LanguageModelChatInformation
    -> Copilot Chat renders native Context Window metadata
```

### Router boundary

`src/router/model-catalog.ts` will parse general model metadata instead of
limiting the catalog contract to Vision discovery. It will continue to expose a
Vision-filtered view for the existing setup flow.

`src/router/client.ts` will expose one authenticated catalog-list operation.
HTTP status handling, timeout, cancellation, JSON parsing, and malformed-root
classification remain transport concerns.

### Provider boundary

`NineRouterChatProvider` owns the in-memory last-successful catalog because it
controls model publication lifetime. It attempts refresh inside
`provideLanguageModelChatInformation`, then resolves published metadata from
the newest usable catalog.

`src/provider/model-catalog.ts` remains the pure publication and resolution
boundary. It accepts validated router metadata, resolves output precedence,
derives input capacity from total context, and applies input fallback without
adding routing policy.

### Configuration boundary

`models[].maxInputTokens` and `models[].maxOutputTokens` stay optional in the
manifest and parser. They are no longer the primary metadata source. Existing
configured values remain valid and become fallback values.

Default and README model examples omit both fields so users do not need to set
them manually. Schema descriptions identify them as optional fallbacks.

## Error Handling and Diagnostics

Catalog discovery is best-effort for model publication:

- authentication, transport, timeout, cancellation, non-success HTTP, invalid
  JSON, and malformed catalog roots retain the previous cache;
- no discovery error escapes from
  `provideLanguageModelChatInformation` or empties the picker;
- diagnostics may record safe metadata such as outcome, entry count, skipped
  count, duration, and request id;
- diagnostics must not contain API keys, authorization headers, prompt content,
  or raw response bodies.

Primary chat request behavior remains unchanged. A missing API key still fails
chat execution through the existing authentication error path.

## Testing

Focused tests will cover:

- parsing valid `contextWindow` and `maxOutput` metadata;
- rejecting malformed catalog roots;
- skipping malformed entries while preserving valid entries;
- preserving one valid token field when the other is invalid;
- exact `modelId` matching;
- catalog values overriding configured fallback values;
- deriving `maxInputTokens` by subtracting resolved output from total context;
- configured input fallback when total context does not exceed output;
- configured fallback values when catalog metadata is absent or invalid;
- built-in `264000` fallback when configured values are absent;
- a successful fetch replacing the RAM cache;
- a failed fetch retaining the last successful cache;
- first-fetch failure publishing configured or built-in fallbacks;
- one catalog request per model-information call;
- missing API credentials skipping discovery without hiding models;
- existing Vision model discovery behavior;
- settings and documentation guardrails removing manual values from examples.

## Documentation Updates

Implementation will update:

- `README.md` configuration and Context Window explanation;
- `package.json` field descriptions and default model example;
- production system design context-window metadata section;
- prior per-model context-window design where needed to mark catalog metadata as
  the new primary source.

## Non-Goals

- Using `GET /v1/models/info`
- Persisting catalog metadata
- Periodic refresh
- Fetching before each chat completion
- Deriving combo limits from combo members
- Reimplementing 9router routing or fallback behavior
- Removing compatibility fallback fields in this change
- Changing request `max_tokens` behavior
- Changing usage-token reporting or `provideTokenCount`

## Acceptance Criteria

- Copilot model metadata uses exact matching 9router catalog values when valid.
- Published input and output limits sum to catalog `contextWindow` when it can
  produce a positive input limit.
- Users do not need to set context-window fields for normal operation.
- Existing configured token fields remain compatible fallbacks.
- Missing or invalid metadata follows output-first resolution and ends at
  configured or built-in `264000` fallbacks.
- Catalog failures retain the latest successful RAM cache.
- First-fetch failure still publishes configured models.
- Model publication performs at most one catalog request per host information
  call and adds no timer or persisted cache.
- Vision discovery and chat request behavior remain unchanged.
