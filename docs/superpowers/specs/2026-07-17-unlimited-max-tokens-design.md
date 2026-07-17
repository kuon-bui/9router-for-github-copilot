# Unlimited Max Tokens Design

## Status

- Date: 2026-07-17
- Status: Approved for implementation planning
- Scope: Global response-token request limit

## Goal

Allow `9router-copilot.maxTokens` to represent no extension-imposed response-token limit. The default value is `0`, and the extension omits the OpenAI-compatible `max_tokens` field whenever the configured value is not a positive integer.

This applies consistently to the selected model request and the shared Vision proxy request.

## Configuration Contract

The manifest contribution for `9router-copilot.maxTokens` uses:

```json
{
  "type": "integer",
  "minimum": 0,
  "default": 0
}
```

The setting has these semantics:

| Configured value | Normalized runtime value | Outgoing `max_tokens` |
| --- | --- | --- |
| Positive integer | Same positive integer | Included |
| `0` | `undefined` | Omitted |
| Negative number | `undefined` | Omitted |
| Decimal number | `undefined` | Omitted |
| `NaN` or infinity | `undefined` | Omitted |
| String, `null`, object, or other invalid type | `undefined` | Omitted |
| Missing setting | `undefined` through the default `0` policy | Omitted |

Omitting `max_tokens` means unlimited by the extension. `9router`, its configured routing model, or an upstream provider may still enforce its own response-token limit.

## Runtime Normalization

The configuration boundary owns the sentinel behavior. A focused normalizer accepts `unknown` and returns the input only when it is a positive safe integer; every other value returns `undefined`.

`RuntimeSettings.maxTokens` remains optional. Snapshot construction does not create an `INVALID_MAX_TOKENS` issue for a malformed value, because malformed values intentionally degrade to the unlimited behavior rather than invalidating the runtime.

The request adapters do not interpret configuration sentinels. They continue to include `max_tokens` only when they receive a numeric normalized limit. This keeps configuration policy out of request conversion and ensures future consumers share one normalized value.

## Request Flow

```text
VS Code setting
  -> normalize maxTokens at configuration boundary
  -> positive integer or undefined
  -> provider passes the normalized value
  -> primary request and Vision proxy request
  -> include max_tokens only for a positive integer
```

With the default `0`, neither request contains `max_tokens`.

## Error Handling

Invalid `maxTokens` values are not configuration errors. They silently normalize to unlimited behavior as explicitly requested.

Other runtime validation remains unchanged:

- invalid base URL still invalidates runtime settings
- non-positive request timeout still invalidates runtime settings
- model configuration issues still degrade only the affected model

## Documentation

The README must state that:

- the default is `0`
- `0` and malformed values omit `max_tokens`
- this is unlimited only from the extension's perspective
- backend or upstream limits can still apply

The canonical production design must describe the same policy and must not claim that `maxTokens` is always sent.

## Testing

Focused tests will prove:

1. the manifest default and minimum are `0`
2. missing, zero, negative, decimal, non-finite, and non-number inputs normalize to `undefined`
3. positive integers remain unchanged
4. malformed `maxTokens` does not make a settings snapshot invalid
5. `maxTokens = 0` omits `max_tokens` from both the primary and Vision proxy requests
6. positive values are still forwarded to both paths
7. active documentation describes the unlimited semantics

The full build, lint, unit, integration, and package release gate remains required.

## Non-Goals

- Discovering or calculating an upstream provider's actual token ceiling
- Dynamically deriving a limit from `maxOutputTokens`
- Adding a per-model request limit
- Changing Context Window publication
- Adding local truncation or retry behavior
