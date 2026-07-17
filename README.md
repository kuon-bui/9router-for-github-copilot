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
      "thinkingMode": "off",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192
    }
  ],
  "9router-copilot.visionProxyModelId": "",
  "9router-copilot.maxTokens": 4096,
  "9router-copilot.requestTimeoutMs": 60000,
  "9router-copilot.debugMode": "minimal"
}
```

### Breaking configuration change

This release replaces the old fixed-model settings. They are not read or migrated. Recreate each desired picker entry manually as an object in `9router-copilot.models`.

### Model fields

- `id`: Stable Copilot-facing id matching `[a-z0-9][a-z0-9._-]*`.
- `name`: Display name shown in the picker.
- `modelId`: Opaque backend model id sent unchanged as the OpenAI-compatible `model` field. It must refer to an existing 9router model; an empty or invalid value leaves only that entry unpublished.
- `toolMode`: `auto` exposes supported host tools; `off` disables tools.
- `visionMode`: `native`, `proxy`, or `off`.
- `thinkingMode`: Default Thinking Effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- `maxInputTokens` and `maxOutputTokens`: Per-model Context Window metadata published to VS Code.

Unknown fields, duplicate ids, invalid values, and empty mappings are rejected per model. One broken entry does not hide unrelated valid entries. The default configuration contains one unpublished `agent` entry until its `modelId` is set.

`9router-copilot.maxTokens` is independent of per-model Context Window metadata. It controls the `max_tokens` request value. Streaming requests set `stream_options.include_usage`, and valid final usage is forwarded to Copilot Chat.

### Tools

Models default to `toolMode: "off"`; the manifest's initial `agent` example explicitly uses `auto`. Tool definitions are translated to the OpenAI-compatible request only when enabled. Routing and tool compatibility policy remain in `9router`.

### Vision

- `native`: Send image input directly to the selected model.
- `proxy`: Summarize each image-bearing message with the shared model configured by `9router-copilot.visionProxyModelId`, replace the raw image with a `[Vision proxy summary]`, then call the selected model.
- `off`: Reject image input.

The proxy model must accept OpenAI-compatible `image_url` data URLs. Proxy mode is fail-closed: a missing model, 404, timeout, cancellation, malformed stream, or upstream error stops the request before the primary model is called. Diagnostics contain safe counts and timing only, never image data, prompts, API keys, raw response bodies, or proxy summaries.

### Thinking Effort

Each configured model gets the native Copilot Chat Thinking Effort picker. `None` omits a reasoning override; `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max` send the selected value through `reasoning_effort` while keeping `modelId` unchanged. The model object's `thinkingMode` is the fallback when the host supplies no valid selection. `9router` owns provider-specific reasoning translation.

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
- Missing Vision proxy: configure `9router-copilot.visionProxyModelId`; proxy mode remains fail-closed until then.
- Invalid thinking mode: use `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
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
