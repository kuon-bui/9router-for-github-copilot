# 9router Copilot Configuration

This guide covers advanced setup, model fields, Vision proxy behavior, diagnostics, development, and the extension's architecture boundary.

## Settings

Configuration is local per user under the `9router-copilot` namespace. Array order controls model-picker order. Removing an object removes that display model.

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:20128/v1",
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "replace-with-existing-9router-model-id",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off",
      "maxInputTokens": 264000,
      "maxOutputTokens": 264000
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

### Runtime settings

| Setting | Default | Purpose |
|---|---:|---|
| `9router-copilot.baseUrl` | `http://127.0.0.1:20128/v1` | OpenAI-compatible `9router` API base URL. |
| `9router-copilot.models` | One unpublished `agent` entry | Ordered curated models exposed in Copilot Chat. |
| `9router-copilot.maxTokens` | `0` | Positive values send `max_tokens`; `0` omits the field. |
| `9router-copilot.requestTimeoutMs` | `60000` | Request timeout in milliseconds. |
| `9router-copilot.debugMode` | `minimal` | Diagnostic level: `minimal`, `metadata`, or `verbose`. |
| `9router-copilot.visionProxySource` | unset | Shared Vision analyzer source: `9router` or `copilot`. |
| `9router-copilot.visionProxyModelId` | empty | Opaque analyzer model ID from the selected source. |
| `9router-copilot.visionProxyPrompt` | built in | Complete instruction used to describe images. |

`9router-copilot.maxTokens` controls request output limits. It is independent from each display model's Context Window metadata. A malformed value or `0` omits `max_tokens`; `9router` or an upstream provider may still enforce its own limit.

## Model fields

| Field | Values | Purpose |
|---|---|---|
| `id` | `[a-z0-9][a-z0-9._-]*` | Stable Copilot-facing ID. |
| `name` | Non-empty string | Name shown in the model picker. |
| `modelId` | Existing `9router` model ID | Opaque backend ID sent unchanged as the OpenAI-compatible `model` field. |
| `toolMode` | `auto`, `off` | Expose supported host tools or disable tools. |
| `visionMode` | `native`, `proxy`, `off` | Send images directly, describe them through a proxy, or reject them. |
| `thinkingMode` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | Default Thinking Effort when the host supplies no valid selection. |
| `maxInputTokens` | Positive safe integer | Input Context Window metadata published to VS Code. |
| `maxOutputTokens` | Positive safe integer | Output Context Window metadata published to VS Code. |

Unknown fields, duplicate display IDs, invalid values, and empty mappings reject only the affected model. One broken entry does not hide unrelated valid entries. The default `agent` entry remains unpublished until `modelId` names an existing `9router` model.

The old fixed-model settings are not read or migrated. Recreate desired picker entries as objects in `9router-copilot.models`.

## Tools

Models default to `toolMode: "off"`; the manifest's initial `agent` example uses `auto`. When enabled, the extension converts supported Copilot host tool definitions to the OpenAI-compatible request format. `9router` remains responsible for routing and upstream tool compatibility.

## Vision

- `native`: send image input directly to the selected model.
- `proxy`: summarize image-bearing messages with one shared analyzer, replace raw images with `[Vision proxy summary]`, then call the selected model.
- `off`: reject image input.

Run `9router: Configure Vision Proxy` to choose source and model. The extension also opens the same setup flow when a proxy request needs missing configuration.

For source `9router`, authenticated `GET /v1/models` discovery keeps models where `capabilities.vision === true`. For source `copilot`, selection uses native VS Code language models; compatibility is enforced at runtime rather than guessed from model names.

Proxy mode is fail-closed. Discovery errors, missing or stale analyzer IDs, consent or quota rejection, timeout, cancellation, malformed streams, and upstream failures stop the request before the primary model runs.

Diagnostics never include image data, prompts, source message text, API keys, raw response bodies, or proxy summaries.

## Thinking Effort

Each configured display model uses Copilot Chat's native Thinking Effort picker. `None` omits a reasoning override. `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max` send the selected value as `reasoning_effort` while leaving `modelId` unchanged.

The model object's `thinkingMode` is the fallback when the host supplies no valid selection. `9router` owns provider-specific reasoning translation.

## API key and diagnostics

Run these commands from the Command Palette:

- `9router: Set API Key`: save the key in VS Code `SecretStorage`.
- `9router: Clear API Key`: delete the stored key.
- `9router: Show Diagnostics`: report runtime settings, published models, rejected entries, and validation issues with sensitive values redacted.
- `9router: Configure Vision Proxy`: select the shared analyzer source and model.

Never place API keys in `settings.json`, `.env`, logs, or documentation.

Debug levels:

- `minimal`: safe default.
- `metadata`: operational metadata without prompt bodies or secrets.
- `verbose`: deeper diagnostics; avoid with sensitive prompts.

## Troubleshooting

- Missing API key: run `9router: Set API Key`.
- Invalid base URL: use an `http` or `https` URL ending at, or normalizable to, `/v1`.
- Missing model: set the affected object's `modelId` to an existing `9router` model.
- Image input blocked: use `visionMode: "native"` or `"proxy"` only when the selected path supports it.
- Missing Vision proxy: run `9router: Configure Vision Proxy`; proxy mode stays fail-closed until setup completes.
- Invalid thinking mode: use `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- Suffixed model ID: remove the `(level)` suffix and set `thinkingMode` separately.

## Development

Press `F5` and choose `Watch and Debug Extension` to start the TypeScript watcher and open an Extension Development Host. Choose `Build Once and Debug Extension` for a clean one-shot build. Runtime diagnostics appear in the `9router Copilot` output channel.

Before release, run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

The VSIX excludes source, tests, and internal docs through `.vscodeignore`.

## Architecture boundary

The extension owns provider registration, curated display-model publication, secure local configuration, request and stream adaptation, compatibility layers, and safe diagnostics.

`9router` owns model definitions, routing, fallback, quota-aware provider switching, and upstream execution. Configured `modelId` values are opaque to the extension; router business logic does not belong here.
