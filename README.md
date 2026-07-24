<h1 align="center">9router Copilot Chat Provider</h1>

**Use curated `9router` models inside GitHub Copilot Chat without replacing Copilot's native interface.**

This extension connects Copilot Chat's model picker to one OpenAI-compatible `9router` endpoint. Copilot keeps the chat experience, tools, streaming, Vision input, Thinking Effort, and Context Window presentation; `9router` keeps ownership of routing, fallback, quotas, and upstream execution.

## Why this extension?

- **Stay inside Copilot Chat.** No separate chat UI or patched Copilot traffic.
- **Publish only models you choose.** Stable display names map to opaque `9router` model IDs, in your preferred picker order.
- **Keep agent workflows.** Enable supported host tools per display model with `toolMode: "auto"`.
- **Bridge model capabilities.** Use native Vision, a shared Vision proxy, or fail closed; select Thinking Effort from Copilot's native picker.
- **Keep secrets out of settings.** The API key is stored only in VS Code `SecretStorage`.

## Features

| Capability | Behavior |
|---|---|
| Curated model picker | User-defined display models, names, membership, and order |
| Streaming | Streaming-first OpenAI-compatible `/v1/chat/completions` adapter |
| Tools | Per-model `auto` or `off` exposure |
| Vision | Per-model `native`, `proxy`, or `off` mode |
| Thinking Effort | `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max` |
| Context Window | Per-model input and output metadata published to VS Code |
| Diagnostics | Safe `minimal`, `metadata`, and `verbose` levels |

## Getting Started

### Prerequisites

- VS Code `1.125.0` or later
- GitHub Copilot Chat
- A reachable `9router` OpenAI-compatible `/v1` endpoint
- A `9router` API key and at least one existing model ID
- Node.js and pnpm for local packaging

### Install local VSIX

```bash
pnpm install
pnpm run package
code --install-extension 9router-copilot-chat-provider-0.3.0.vsix
```

Reload VS Code if `9router` does not appear in Copilot Chat.

### Configure

1. Run `9router: Set API Key` from the Command Palette.
2. Open user `settings.json` and add a display model:

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
      "thinkingMode": "off"
    }
  ]
}
```

3. Open Copilot Chat and select `Agent` from the model picker.
4. For image support through another model, set `visionMode` to `proxy` and run `9router: Configure Vision Proxy`.

Array order controls picker order. Empty or invalid `modelId` values leave only the affected entry unpublished.

## Documentation

- [Configuration, Vision, diagnostics, troubleshooting, and development](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/configuration.md)
- [System design](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/9router-copilot-chat-provider-system-design.md)
- [Code conventions](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/CODE_CONVENTION.md)

## Security

Never put API keys in `settings.json`, `.env`, logs, or documentation. Use `9router: Set API Key`; the extension stores the value in VS Code `SecretStorage`.

Vision proxy diagnostics exclude image data, prompt content, source message text, API keys, raw response bodies, and proxy summaries.

## License

[UNLICENSED](LICENSE). Copying, modification, distribution, sublicensing, and production use require explicit written permission from the copyright holder.
