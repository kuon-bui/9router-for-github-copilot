# 9router Copilot Chat Provider

Expose `9router` as a custom provider inside GitHub Copilot Chat while preserving the native VS Code model picker, tools, Thinking Effort, Vision input, streaming, and Context Window experience.

The extension is a thin adapter. Users publish an ordered set of user-defined curated models, while `9router` remains responsible for routing, fallback, quotas, and upstream execution.

## Status

- Package version: `0.1.0`
- License policy: `UNLICENSED`
- Runtime target: VS Code `^1.125.0`
- Backend contract: OpenAI-compatible `9router` `/v1/chat/completions`

## Installation

Build and install the local VSIX:

```bash
pnpm run package
code --install-extension 9router-copilot-chat-provider-0.1.0.vsix
```

Reload VS Code if the provider does not immediately appear in Copilot Chat.

## API Key Setup

Run `9router: Set API Key` from the Command Palette. The key is stored only in VS Code `SecretStorage`. Run `9router: Clear API Key` to remove it.

Never put API keys in `settings.json`, `.env`, logs, or documentation.

## Configuration

Configuration is local per user under the `9router-copilot` namespace. Array order controls picker order; removing an object removes that model from the picker.

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:3456/v1",
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "replace-with-existing-9router-model-id",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "medium",
      "thinkingEfforts": ["minimal", "low", "medium", "high"]
    }
  ],
  "9router-copilot.visionProxySource": "9router",
  "9router-copilot.visionProxyModelId": "provider/vision-model",
  "9router-copilot.visionProxyPrompt": "Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.",
  "9router-copilot.maxTokens": 0,
  "9router-copilot.requestTimeoutMs": 60000,
  "9router-copilot.debugMode": "minimal"
}
```

### Breaking configuration change

This release replaces the old fixed-model settings. They are not read or migrated. Recreate each desired picker entry manually as an object in `9router-copilot.models`.

Existing model objects with a non-`off` `thinkingMode` must add that value to `thinkingEfforts`. Invalid or duplicate entries reject only that model.

### Model fields

- `id`: Stable Copilot-facing id matching `[a-z0-9][a-z0-9._-]*`.
- `name`: Display name shown in the picker.
- `modelId`: Opaque backend model id sent unchanged as the OpenAI-compatible `model` field. It must refer to an existing 9router model; an empty or invalid value leaves only that entry unpublished.
- `toolMode`: `auto` exposes supported host tools; `off` disables tools.
- `visionMode`: `native`, `proxy`, or `off`.
- `thinkingMode`: Default Thinking Effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- `thinkingEfforts`: Ordered non-`off` picker choices: `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Array order controls picker order after `None`. Missing or empty lists support only `off` and omit `configurationSchema`, hiding the picker. A non-`off` `thinkingMode` must appear in this list.
- `maxInputTokens` and `maxOutputTokens`: Optional compatibility fallbacks for Context Window metadata. Normal operation reads `capabilities.contextWindow` and `capabilities.maxOutput` from authenticated `GET /v1/models` results.

Unknown fields, duplicate ids, invalid values, and empty mappings are rejected per model. One broken entry does not hide unrelated valid entries. The default configuration contains one unpublished `agent` entry until its `modelId` is set.

Before returning picker models, the provider attempts one authenticated `GET /v1/models` refresh. Exact `modelId` matches use `capabilities.contextWindow` and `capabilities.maxOutput`. The latest successful catalog stays in RAM; a failed refresh keeps that cache. Missing or invalid metadata falls back per field to the model object's optional compatibility fallback, then `264000`.

`9router-copilot.maxTokens` remains independent of Context Window metadata. Its default is `0`. A positive safe integer is sent as `max_tokens`; `0` or a malformed value omits `max_tokens`, applying no extension-level response limit. `9router` or an upstream provider may still enforce its own limit. Streaming requests continue to set `stream_options.include_usage`.

### Tools

Models default to `toolMode: "off"`; the manifest's initial `agent` example explicitly uses `auto`. Tool definitions are translated to the OpenAI-compatible request only when enabled. Routing and tool compatibility policy remain in `9router`.

### Vision

- `native`: Send image input directly to the selected model.
- `proxy`: Summarize each image-bearing message with one shared analyzer, replace the raw image with a `[Vision proxy summary]`, then call the selected model.
- `off`: Reject image input.

Shared analyzer settings:

- `9router-copilot.visionProxySource`: `9router` or `copilot`
- `9router-copilot.visionProxyModelId`: opaque model id selected from the chosen source
- `9router-copilot.visionProxyPrompt`: complete analyzer instruction (default prompt is editable in Settings)

Use `9router: Configure Vision Proxy` to configure source and model with Quick Pick, or let the extension run the same wizard automatically when a `visionMode: "proxy"` request arrives with missing source or model id.

When source is `9router`, the wizard uses authenticated `GET /v1/models` discovery and keeps only models where `capabilities.vision === true`, then deduplicates and sorts by `id`.

When source is native `GitHub Copilot`, the wizard uses `vscode.lm.selectChatModels({ vendor: 'copilot' })`. The stable selector does not expose capability metadata, so the extension does not guess by model name and enforces compatibility at runtime.

Legacy migration is fail-safe: if `9router-copilot.visionProxySource` is unset but `9router-copilot.visionProxyModelId` is already populated, runtime interprets it as `9router`.

Proxy mode is fail-closed: discovery errors, missing/stale analyzer ids, consent/quota rejection, timeout, cancellation, malformed stream, or upstream failures stop the request before the primary model is called. Privacy exclusions are strict: diagnostics contain safe counts and timing only, never image data, prompt content, source message text, API keys, raw response bodies, or proxy summaries.

### Thinking Effort

Each model with at least one configured `thinkingEfforts` value gets the native Copilot Chat Thinking Effort picker. `None` is always first, then configured values in array order. `None` omits `reasoning_effort`; allowed values send the selected value while keeping `modelId` unchanged. Missing, malformed, unsupported, or stale host selections fall back to that model's validated `thinkingMode`. An empty list omits `configurationSchema` and hides the picker. `9router` owns provider-specific reasoning translation.

### Debug Mode

- `minimal`: Safe default.
- `metadata`: Operational metadata without prompt bodies or secrets.
- `verbose`: Deeper diagnostics; avoid it with sensitive prompts.

## Diagnostics

Run `9router: Show Diagnostics`. The output reports snapshot state, runtime settings, published models, rejected entries, and validation issues with sensitive values redacted.

Common fixes:

- Missing API key: run `9router: Set API Key`.
- Invalid base URL: use an `http` or `https` URL that ends at, or can normalize to, `/v1`.
- Missing model: update the affected object's `modelId` to an existing 9router model.
- Image input blocked: set that object's `visionMode` to `native` or `proxy` only when supported.
- Missing Vision proxy: run `9router: Configure Vision Proxy` (or set `9router-copilot.visionProxySource`, `9router-copilot.visionProxyModelId`, and optionally `9router-copilot.visionProxyPrompt` directly); proxy mode remains fail-closed until configuration is complete.
- Invalid thinking mode or effort list: use supported values and include every non-`off` `thinkingMode` in that model's unique `thinkingEfforts` list.
- Suffixed model id: remove the `(level)` suffix and set `thinkingMode` separately.

## Debug in VS Code

Press `F5` to use `Watch and Debug Extension`, which starts the TypeScript watcher and opens an Extension Development Host. Choose `Build Once and Debug Extension` for a clean one-shot build. Extension diagnostics appear in the `9router Copilot` output channel.

## Verification

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

The package excludes source, tests, and internal docs through `.vscodeignore`.

## Architecture Boundary

The extension owns provider registration, publication of user-defined curated picker models, secure local configuration, request/stream adaptation, compatibility layers, and safe diagnostics.

`9router` owns combo definitions, routing, fallback, quota-aware provider switching, and upstream execution. Configured `modelId` values are opaque to the extension; do not move router business logic into it.
