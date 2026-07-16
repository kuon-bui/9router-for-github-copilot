# Combo Thinking Request Contract Design

## Problem

The extension currently applies a selected Thinking Effort by appending a
suffix to the configured model mapping. A display model mapped to combo `123`
therefore sends values such as `123(high)`.

The installed `9router` release looks up combos using the request's exact
`model` value before its single-model thinking normalization runs. Combo `123`
exists, but combo `123(high)` does not, so the request fails before the suffix
can be interpreted. The extension then classifies the resulting HTTP 404 as a
missing combo mapping even though the configured combo is valid.

## Decision

The extension will express thinking through the OpenAI-compatible request body
instead of changing the combo identifier.

- `model` will always contain the configured base combo id unchanged.
- A non-`off` Thinking Effort will be sent as `reasoning_effort`.
- `off` will omit `reasoning_effort`, preserving the existing base request.
- `9router` remains responsible for translating the effort into the selected
  combo member's provider-native thinking format.

This keeps combo resolution and thinking configuration as separate concerns.

## Error Classification

HTTP status alone cannot prove that a combo mapping is missing because
`9router` can also return 404 for missing provider credentials or other
downstream resources.

The router client will preserve 404 as a transport failure unless the response
body explicitly identifies the requested model or combo as missing. Only an
explicit missing-model response will become `COMBO_MAPPING_ERROR` and receive
the display-model-specific configuration guidance.

## Data Flow

1. Resolve the selected curated display model to its validated combo id.
2. Resolve the effective Thinking Effort from Copilot model configuration or
   the local per-model default.
3. Build the OpenAI-compatible request with the bare combo id in `model`.
4. Add `reasoning_effort` only when the effective mode is not `off`.
5. Submit the request to `9router`, which resolves the combo before translating
   reasoning settings for the chosen upstream model.

## Testing

- Add a request-adapter regression test proving combo `123` plus `high` becomes
  `model: "123"` and `reasoning_effort: "high"`.
- Keep coverage proving `off` sends the bare combo without a reasoning field.
- Add router-client error-classification tests for:
  - an explicit missing-model 404 becoming `COMBO_MAPPING_ERROR`
  - an unrelated 404 remaining `TRANSPORT_ERROR`
- Keep the provider integration test that enriches a real
  `COMBO_MAPPING_ERROR` with the relevant display model and settings key.

## Non-Goals

- Changing combo definitions in `9router`
- Adding local routing or fallback policy
- Disabling Thinking Effort for combo-backed display models
- Discovering or creating combos from the extension
