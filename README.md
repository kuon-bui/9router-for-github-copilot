# 9router Copilot Chat Provider

Expose `9router` as a custom provider inside GitHub Copilot Chat while keeping the native VS Code and Copilot Chat experience.

This extension publishes curated product models in the Copilot Chat model picker and maps each model to a configured `9router` combo id. The extension stays intentionally thin: VS Code owns the chat UI, this extension adapts requests and streams responses, and `9router` owns routing, fallback, quotas, and upstream execution.

## Status

- Package version: `0.1.0`
- License policy: `UNLICENSED`
- Runtime target: VS Code `^1.125.0`
- Backend contract: OpenAI-compatible `9router` `/v1/chat/completions`

## Product Models

The extension exposes up to three curated display models:

- `Daily`
- `Agent`
- `Fallback`

These are not raw upstream provider ids. Each display model maps to a `9router` combo id through local per-user VS Code settings.

## Installation

Build the local VSIX:

```bash
pnpm run package
```

Install the generated package from VS Code:

```bash
code --install-extension 9router-copilot-chat-provider-0.1.0.vsix
```

After installation, reload VS Code if the provider does not appear immediately in the Copilot Chat model picker.

## API Key Setup

Store the `9router` API key through VS Code SecretStorage:

1. Open the Command Palette.
2. Run `9router: Set API Key`.
3. Paste the API key.

To remove the stored key, run:

```text
9router: Clear API Key
```

Do not place API keys in `settings.json`, `.env`, logs, or documentation.

## Configuration

Configuration is local per user under the `9router-copilot` namespace.

Example `settings.json`:

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:3456/v1",
  "9router-copilot.displayModels": ["daily", "agent", "fallback"],
  "9router-copilot.labels.daily": "Daily",
  "9router-copilot.labels.agent": "Agent",
  "9router-copilot.labels.fallback": "Fallback",
  "9router-copilot.modelMappings.daily": "replace-with-existing-daily-combo-id",
  "9router-copilot.modelMappings.agent": "replace-with-existing-agent-combo-id",
  "9router-copilot.modelMappings.fallback": "replace-with-existing-fallback-combo-id",
  "9router-copilot.toolMode.daily": "off",
  "9router-copilot.toolMode.agent": "auto",
  "9router-copilot.toolMode.fallback": "off",
  "9router-copilot.visionMode.daily": "off",
  "9router-copilot.visionMode.agent": "proxy",
  "9router-copilot.visionMode.fallback": "off",
  "9router-copilot.thinkingMode.daily": "off",
  "9router-copilot.thinkingMode.agent": "high",
  "9router-copilot.thinkingMode.fallback": "off",
  "9router-copilot.maxTokens": 4096,
  "9router-copilot.requestTimeoutMs": 60000,
  "9router-copilot.debugMode": "minimal"
}
```

### Model Mapping

Use `9router-copilot.modelMappings.<model>` to map a display model to a `9router` combo id.

The extension does not create or guess combo ids. Each non-empty value must already exist in the connected `9router` instance. Models with empty mappings stay out of the picker.

Invalid or empty mappings are degraded per model. One broken model mapping should not disable every other configured model.

### Tool Mode

`toolMode` controls whether the extension exposes host tools for a display model.

- `auto`: Convert supported host tool definitions into the router request.
- `off`: Do not expose tools for that model.

Use `auto` only for combos that are expected to support tool calling through `9router`.

### Vision Mode

`visionMode` controls how image inputs are handled.

- `native`: Send image inputs directly to `9router`. Use only when the mapped combo can accept image inputs.
- `proxy`: Convert image inputs into textual context before sending to a text-only combo.
- `off`: Block image inputs for that model.

Proxy mode is intended for text-only combos. Native vision should be configured only for combos that can handle image inputs directly.

### Thinking Mode

`thinkingMode` controls the reasoning effort requested for each display model.

- `off`: Send the base combo id unchanged.
- `minimal`, `low`, `medium`, `high`, `xhigh`, `max`: Send the level through the `9router` model suffix contract.

Configure `modelMappings.<model>` with a base combo id such as `combo/agent`, not a suffixed value such as `combo/agent(high)`. The extension selects the requested level, while `9router` remains responsible for provider-specific reasoning translation and provider limits.

### Debug Mode

`debugMode` controls extension diagnostics:

- `minimal`: Safe default.
- `metadata`: Adds operational metadata without prompt bodies or secrets.
- `verbose`: Reserved for deeper diagnostics. Avoid using it with sensitive prompts.

## Diagnostics

Run:

```text
9router: Show Diagnostics
```

Diagnostics include snapshot state, runtime settings, published models, rejected models, and configuration issues. Sensitive values are redacted before logging.

Common issues:

- Missing API key: run `9router: Set API Key`.
- Invalid base URL: configure an `http` or `https` URL ending at, or normalizable to, `/v1`.
- Empty combo mapping: configure the relevant `9router-copilot.modelMappings.<model>` setting with an existing combo id.
- Combo not found: the configured id no longer exists in `9router`; recreate the backend combo or update the setting.
- Image input blocked: set the selected model's `visionMode` to `native` or `proxy` when appropriate.
- Invalid thinking mode: select `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- Suffixed combo mapping: remove the `(level)` suffix from `modelMappings.<model>` and set `thinkingMode.<model>` instead.

## Debug in VS Code

Use `F5` to start the default `Watch and Debug Extension` flow. VS Code starts the TypeScript watch task, opens an `Extension Development Host`, and attaches the debugger to the extension automatically.

If you want a clean one-shot startup instead of watch mode, open the Run and Debug panel and choose `Build Once and Debug Extension`.

The workspace also exposes VS Code tasks for `build`, `test:unit`, `test:integration`, and `package`, so you can run the same project commands without leaving the editor.

For extension-side diagnostics while debugging, inspect the `9router Copilot` output channel.

## Verification

Before treating the extension as release-ready, run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

The package command creates a local `.vsix` artifact and excludes source, tests, and internal docs through `.vscodeignore`.

## Security Notes

- API keys are stored only in VS Code SecretStorage.
- Local settings must contain only non-secret configuration.
- Logs and diagnostics must not include API keys or authorization headers.
- Prompt content should not be persisted unless explicitly required for a controlled diagnostic session.

## Architecture Boundary

The extension is a thin provider adapter.

The extension owns:

- VS Code provider registration
- curated model publication
- local display-model-to-combo mapping
- request adaptation
- streaming response adaptation
- safe diagnostics

`9router` owns:

- routing logic
- combo definitions
- fallback policy
- quota-aware provider switching
- upstream model execution

Do not move router business logic into the extension.
