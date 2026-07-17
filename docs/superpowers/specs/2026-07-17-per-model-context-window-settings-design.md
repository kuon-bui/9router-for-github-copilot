# Per-Model Context Window Settings Design

## Status

- Date: 2026-07-17
- Status: Approved for implementation planning
- Scope: Native Copilot Chat context-window metadata for curated `9router` models

## Objective

Make Copilot Chat's native Session Info surface show context-window information
for each curated `9router` model using user-configurable input and output token
limits.

The extension will continue to use the native Copilot Chat UI. It will not add a
custom context-window component or a separate chat surface.

## Current Behavior

Every published model currently reports hard-coded metadata:

- `maxInputTokens: 128000`
- `maxOutputTokens: 8192`

The provider also implements `provideTokenCount` using the existing heuristic.
VS Code 1.129 uses the published limits for the Context Window denominator, but
uses response usage metadata—not `provideTokenCount`—for the used-token
numerator in its native Session Info UI.

The hard-coded metadata cannot describe different token limits for `Daily`,
`Agent`, and `Fallback`.

## Configuration Contract

Add six per-user VS Code settings:

- `9router-copilot.maxInputTokens.daily`
- `9router-copilot.maxInputTokens.agent`
- `9router-copilot.maxInputTokens.fallback`
- `9router-copilot.maxOutputTokens.daily`
- `9router-copilot.maxOutputTokens.agent`
- `9router-copilot.maxOutputTokens.fallback`

Each setting is a positive integer. The defaults for every curated model are:

- `maxInputTokens`: `128000`
- `maxOutputTokens`: `8192`

These defaults preserve the currently published metadata.

The existing `9router-copilot.maxTokens` setting remains independent. It is the
requested `max_tokens` value sent to `9router`; it does not override the model's
published capability metadata. This feature does not change outgoing request
limits.

## Architecture and Data Flow

`DisplayModelSetting` will own the validated `maxInputTokens` and
`maxOutputTokens` values for one curated model.

The settings flow is:

```text
VS Code user settings
    -> settings loader and per-model validation
    -> DisplayModelSetting
    -> createPublishedModel
    -> LanguageModelChatInformation
    -> native Copilot Chat Session Info UI
```

`createPublishedModel` will stop using hard-coded token limits and will publish
the values from its `DisplayModelSetting`. The host remains responsible for the
exact Session Info rendering and context-usage calculation.

The existing `provideTokenCount` implementation remains unchanged. Primary
requests additionally set `stream_options.include_usage`; the router SSE parser
validates and normalizes the final OpenAI-compatible usage chunk, and the
provider emits it through a `LanguageModelDataPart` with MIME type `usage`.
Malformed or absent usage degrades to no numerator update without breaking the
response stream.

## Validation and Degradation

A configured token limit is valid only when it is a finite positive integer.
Validation occurs independently for every curated model.

If either token limit for one model is invalid:

- add a model-scoped settings issue identifying the invalid setting;
- add that model to `rejectedModels`;
- omit that model from `publishedModels`; and
- continue publishing other valid models.

The new issue and rejection codes will distinguish invalid input-token and
output-token settings. A bad per-model token limit must not make runtime
settings invalid and must not disable the entire provider.

Diagnostics may include the model key, setting name, and validation message.
No prompt content, credentials, or other sensitive request data is involved.

## Components Changed

### Manifest

`package.json` will declare the six integer settings with a minimum of `1` and
the approved defaults.

### Defaults

`src/config/defaults.ts` will expose typed per-model defaults for input and
output token limits.

### Product model type

`src/types/product-model.ts` will add `maxInputTokens` and `maxOutputTokens` to
`DisplayModelSetting`.

### Settings snapshot

`src/config/settings.ts` will read, validate, and attach both limits while
building display-model settings and the validated settings snapshot. Invalid
limits will follow the per-model rejection behavior described above.

### Model publication

`src/provider/model-catalog.ts` will publish the validated per-model values as
`LanguageModelChatInformation.maxInputTokens` and
`LanguageModelChatInformation.maxOutputTokens`.

No changes are required in cancellation, transport, request adaptation,
streaming, tools, or vision modules.

## Testing

Focused tests will cover:

- default limits for all three curated models;
- distinct configured limits for `Daily`, `Agent`, and `Fallback`;
- publication of configured limits by `createPublishedModel`;
- rejection of zero, negative, fractional, non-finite, and non-number values;
- degradation of only the model with an invalid limit;
- preservation of valid models in the same snapshot;
- refreshed model metadata after a relevant VS Code settings change; and
- manifest and documentation guardrails for all six settings.

The existing token-count heuristic tests and request `max_tokens` behavior will
remain unchanged.

## Documentation

Update the README configuration example and the production design's per-user
settings list. Document explicitly that per-model `maxOutputTokens` is published
model capability metadata, while the global `maxTokens` controls the request
field sent to `9router`.

## Non-Goals

- Adding a custom Session Info UI
- Discovering limits from `GET /v1/models`
- Changing the outgoing `max_tokens` selection policy
- Replacing the heuristic token counter
- Adding model-specific tokenizer implementations
- Moving routing or capability policy into the extension

## Acceptance Criteria

- Users can configure input and output token limits independently for each
  curated model.
- Published model metadata reflects the validated values.
- Copilot Chat can render its native Context Window information from that
  metadata and valid OpenAI-compatible response usage.
- Defaults preserve the current `128000` input and `8192` output metadata.
- One invalid model limit does not prevent other valid models from being
  published.
- The global request `maxTokens` behavior is unchanged.
