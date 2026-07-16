# Copilot Thinking Effort Picker Design

## Problem

The extension currently configures thinking depth through per-model VS Code
settings:

- `9router-copilot.thinkingMode.daily`
- `9router-copilot.thinkingMode.agent`
- `9router-copilot.thinkingMode.fallback`

This supports different defaults for the curated models, but changing the level
requires leaving Copilot Chat. Users should be able to choose the thinking
effort from each model's native configuration submenu in the Copilot Chat model
picker.

The existing request contract remains correct: the extension sends the selected
level to `9router` through the model suffix, and `9router` owns translation to
provider-specific reasoning fields.

## Decision

Publish a model configuration schema for every valid curated model. Copilot Chat
will render a `Thinking Effort` navigation control with these choices:

- `None`
- `Minimal`
- `Low`
- `Medium`
- `High`
- `XHigh`
- `Max`

The selection is stored by the host per published model. Selecting a level for
`Daily` does not change `Agent` or `Fallback`.

The existing `thinkingMode.<model>` setting remains supported. It supplies the
schema default and acts as the request fallback when the host does not provide a
valid picker selection.

## VS Code Compatibility Boundary

The picker uses the `configurationSchema` model metadata and the
`modelConfiguration` response option currently consumed by Copilot Chat.
These fields are present in VS Code's chat-provider proposal but are not yet in
the stable `@types/vscode` interfaces used by this repository.

The extension will define narrow local compatibility types that extend:

- `vscode.LanguageModelChatInformation` with `configurationSchema`
- `vscode.ProvideLanguageModelChatResponseOptions` with
  `modelConfiguration`

The compatibility types will describe only the fields used by this feature.
They will not introduce broad `any` casts or copy unrelated proposed APIs.

No proposed API is added to `enabledApiProposals`. This follows the structural
metadata approach used by existing Marketplace extensions: return the extra
model metadata at runtime and validate the untrusted response option before use.

For host-version compatibility, request resolution may also read the legacy
`configuration` field when `modelConfiguration` is absent. The stable
`modelOptions` field is not used for the native picker because Copilot Chat
delivers picker values through the model-configuration contract.

## Configuration Schema

Each published model receives an independent schema with one property named
`reasoningEffort`:

```json
{
  "properties": {
    "reasoningEffort": {
      "type": "string",
      "title": "Thinking Effort",
      "enum": [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "enumItemLabels": [
        "None",
        "Minimal",
        "Low",
        "Medium",
        "High",
        "XHigh",
        "Max"
      ],
      "default": "none",
      "group": "navigation"
    }
  }
}
```

The example shows the default for a model configured with `off`. The actual
default is derived independently from each validated model setting:

- `off` becomes `none`
- every other thinking mode keeps the same value

Because schemas are attached to individual published models, each model can
have a different default and a separately persisted selection.

## Effective Thinking Mode

For every request, the provider resolves an effective thinking mode in this
order:

1. A valid `modelConfiguration.reasoningEffort` value.
2. A valid compatibility `configuration.reasoningEffort` value.
3. The validated `thinkingMode` value from the selected display model.

Picker value mapping:

- `none` becomes internal mode `off`
- `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` map directly

Missing, malformed, or unsupported host values are ignored and fall back to the
validated display-model setting. Host-supplied configuration never mutates the
settings snapshot.

The provider creates a request-scoped copy of the selected display model with
the effective mode. This keeps the existing request adapter as the single place
that applies the `9router` suffix:

- `off`: send the base combo id unchanged
- any other mode: send `<combo-id>(<mode>)`

No provider-specific `thinking`, `reasoning`, `reasoning_effort`, or token-budget
field is added to the OpenAI-compatible payload.

## Data Flow

1. Load and validate each curated model and its configured default thinking
   mode.
2. Build that model's `Thinking Effort` configuration schema.
3. Publish the model to Copilot Chat with the schema.
4. Copilot Chat stores the user's picker selection per model.
5. On a request, read and validate the selected `reasoningEffort`.
6. Resolve the request-scoped effective thinking mode.
7. Let the existing request adapter apply the corresponding `9router` model
   suffix.
8. Stream the response through the existing stream adapter.

The stream adapter is unchanged. Reasoning deltas remain hidden.

## Errors and Degradation

- Invalid local `thinkingMode` settings continue to reject only the affected
  display model during snapshot validation.
- Invalid host picker values do not reject the model or request; they fall back
  to the validated local default.
- A host that does not understand `configurationSchema` continues to show and
  invoke the models without the submenu, using local settings as before.
- A valid effort unsupported by a routed upstream remains a backend
  compatibility outcome owned by `9router`.
- One model's selection or failure does not affect the other curated models.

## Diagnostics

Safe request metadata will distinguish:

- the model's configured default thinking mode
- the request's effective thinking mode
- whether the effective value came from the picker or local settings

Diagnostics will not log prompt content, secrets, or the raw
`modelConfiguration` object. Unknown picker values may be represented only as
an invalid-value outcome, without serializing unrelated host configuration.

## Testing

Add focused tests for:

- schema publication for every valid display model
- all seven picker values and labels
- per-model schema defaults derived from local settings
- `none` to `off` conversion
- direct conversion of the other six values
- picker selection overriding the local model default
- independent selections for different models
- fallback when model configuration is missing or invalid
- compatibility fallback from `configuration`
- request mapping with no suffix for `None`
- request mapping with the selected suffix for enabled levels
- diagnostics reporting configured and effective modes safely
- unchanged stream behavior with reasoning deltas still hidden

Run the complete repository verification gate:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run package`

## Documentation

Update the existing thinking-mode documentation to explain:

- local settings define per-model defaults
- the Copilot Chat picker can override the default per model
- the seven available UI levels
- `9router` remains responsible for provider-specific reasoning translation
- reasoning deltas are not displayed

## Out of Scope

- Rendering reasoning or thinking deltas
- Adding a custom chat UI or separate Quick Pick command
- Creating separate model entries for each thinking level
- Detecting upstream providers in the extension
- Implementing provider-specific reasoning payloads
- Moving routing, fallback, or effort-compatibility policy out of `9router`
