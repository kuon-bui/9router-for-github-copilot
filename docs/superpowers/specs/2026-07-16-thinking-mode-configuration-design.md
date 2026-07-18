# Thinking Mode Configuration Design

## Problem

The extension currently sends the configured `9router` combo id without a
reasoning preference. Users cannot choose a different thinking depth for the
curated `Daily`, `Agent`, and `Fallback` display models.

Thinking controls vary across upstream providers. Sending provider-specific
fields such as `thinking`, `reasoning`, or `reasoning_effort` from the extension
would move compatibility policy into the adapter and conflict with the
thin-provider architecture.

Current `9router` releases support forcing a thinking level by appending a
`(level)` suffix to the requested model name. `9router` owns translation of
that level into the format supported by the selected upstream provider.

## Decision

Add a local thinking-mode setting for each curated display model:

- `9router-copilot.thinkingMode.daily`
- `9router-copilot.thinkingMode.agent`
- `9router-copilot.thinkingMode.fallback`

Accepted values:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

All three settings default to `off`. Thinking mode is presentation and request
configuration only; it does not affect combo selection or fallback policy.

## Configuration Model

`DisplayModelSetting` will include the validated thinking mode. The setting is
per display model rather than global because the curated models may map to
combos with different latency, cost, and reasoning capabilities.

The contributed VS Code settings will use string enums so supported values are
discoverable in the Settings UI. The README configuration example will show a
representative setup with thinking disabled for `Daily` and `Fallback`, and a
non-default level for `Agent`.

## Validation and Degradation

An unsupported thinking-mode value is a model-level configuration error.

- Reject only the affected display model from publication.
- Keep other valid display models available.
- Add an `INVALID_THINKING_MODE` issue naming the display model and setting.
- Include the rejection in existing configuration diagnostics.

Because `thinkingMode` is the single local source of truth, a combo mapping
ending in a recognized thinking suffix is also rejected for that model. The
diagnostic will instruct the user to remove the suffix from
`modelMappings.<model>` and select the level through `thinkingMode.<model>`.
This prevents double suffixes and ensures `off` actually disables forced
thinking.

Runtime settings remain valid when one model has an invalid thinking mode.
This preserves the existing per-model degradation behavior used for invalid
combo mappings.

## Request Mapping

The request adapter will resolve the effective router model name immediately
before building the OpenAI-compatible chat-completions payload.

- `off`: send the configured combo id unchanged.
- Any other accepted mode: send `<combo-id>(<thinking-mode>)`.

For example, an `Agent` mapping of `combo/agent` with `high` thinking produces:

```json
{
  "model": "combo/agent(high)"
}
```

The extension will not send `thinking`, `reasoning`, `reasoning_effort`, or
provider-specific token-budget fields. `9router` remains responsible for
normalizing the requested level, applying provider limits, and stripping the
suffix before upstream execution.

Combo mappings are expected to contain the base combo id without a thinking
suffix. The separate `thinkingMode` setting is the single local source of truth
for the suffix. The extension will not silently strip or replace a suffix from
the configured combo mapping.

## Data Flow

1. Load each display model's combo mapping and thinking mode.
2. Validate both values while building the settings snapshot.
3. Publish only models whose model-level configuration is valid.
4. Resolve the selected display model for a request.
5. Apply its thinking suffix while adapting the router request.
6. Send the streamed chat-completions request through the existing router
   client.

No routing intelligence or provider detection is added to the extension.

## Diagnostics

Settings snapshot diagnostics will include the configured thinking mode for
published display models without logging prompt content or secrets.

Request-submission metadata may include the selected thinking mode at existing
safe debug levels. The effective model suffix is not treated as sensitive, but
diagnostics should continue preferring the curated display model, combo id, and
thinking mode as separate fields for readability.

## Error Handling

- Invalid local values are rejected before publication and never reach
  `9router`.
- A valid level unsupported by a particular combo or upstream remains a
  backend compatibility outcome owned by `9router`.
- Existing router errors continue through the current error-classification
  path.
- One failed request or invalid model setting does not poison provider state.

## Testing

- Unit-test default and configured thinking-mode loading.
- Unit-test model-level degradation for an unsupported value.
- Unit-test rejection of a combo mapping that already contains a recognized
  thinking suffix.
- Unit-test request mapping for `off` and an enabled thinking level.
- Assert package configuration exposes the complete accepted enum and defaults
  to `off`.
- Update diagnostics tests to cover thinking-mode metadata.
- Add or update an integration test proving the provider sends the effective
  suffixed model to the router client.
- Run the full repository verification gate because source, configuration,
  transport payload, documentation, and packaging behavior change.

## Documentation

Update the production design's configuration section to include the three
thinking-mode settings and document that `9router` owns provider-specific
reasoning translation.

Update the README with:

- the new settings
- accepted values
- the base-combo-id requirement
- a note that unsupported upstream levels are handled by `9router`

## Non-Goals

> **Superseding note (2026-07-18):**
> `2026-07-18-reasoning-detail-streaming-design.md` supersedes only the first
> non-goal below. Router-provided reasoning may now be rendered through the
> runtime-gated native thinking-part surface; every other non-goal and all
> request-mapping decisions in this document remain in force.

- Rendering reasoning or chain-of-thought deltas in Copilot Chat
- Exposing provider-specific reasoning token budgets
- Detecting thinking capabilities for individual combo members
- Selecting or reordering combo members based on thinking mode
- Implementing local fallback when an upstream rejects a thinking level
- Changing cancellation, tool-call, vision, or stream parsing behavior
