# Valid Combo Mapping Defaults Design

## Problem

The extension currently contributes `combo/daily`, `combo/agent`, and
`combo/fallback` as default settings. These values are examples rather than
guaranteed backend resources. VS Code therefore publishes the corresponding
display models even when the connected `9router` instance has no matching
combos, and the first request fails with `COMBO_MAPPING_ERROR`.

## Decision

Combo mappings will be explicit user configuration. The extension will not
ship executable placeholder combo ids.

- The contributed defaults for all three `modelMappings` settings will be
  empty strings.
- The internal default mappings will also be empty strings so every settings
  loading path has the same behavior.
- `buildSettingsSnapshot` will continue rejecting only the unmapped display
  models. A valid mapping for one display model will still be published even
  when the other mappings are empty.
- The extension will not discover, create, or guess backend combos. `9router`
  remains the source of truth for combo definitions.

## Runtime Behavior

On a fresh installation, no curated model is published until the user maps at
least one display model to an existing `9router` combo id. After a setting is
changed, the existing configuration refresh path republishes the validated
models without requiring extension-side routing logic.

If a configured combo is later removed from `9router`, the backend error will
remain an actionable configuration error naming the display model, configured
combo id, and relevant VS Code setting.

## Documentation

The README configuration example will use clearly marked user-supplied combo
ids and explain that the values must already exist in the connected `9router`
instance. Diagnostics guidance will distinguish an empty local mapping from a
stale mapping that references a removed backend combo.

## Testing

- Add a unit regression test proving an unconfigured snapshot does not publish
  placeholder models.
- Keep the existing per-model degradation tests.
- Update release guardrails if they assert contributed placeholder defaults.
- Run the full repository verification gate because configuration and
  packaging behavior change.

## Non-Goals

- Remote combo discovery
- Automatic combo creation
- Local fallback or routing policy
- Changes to the current cancellation and provider error-mapping work
