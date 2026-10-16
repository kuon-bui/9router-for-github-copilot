# 9router ACP Coding Agent (`9router-acp`)

`9router-acp` is a standalone coding agent implementing [Agent Client Protocol (ACP)](https://agentclientprotocol.com) v1, powered by [9router](https://github.com/9router/9router)'s `/v1/responses` API.

It allows you to use 9router's models and combo routing directly inside editors that support ACP, including:
- **Zed** (native ACP support)
- **JetBrains IDEs** (via ACP plugin / `acp.json`)
- **VS Code** (via third-party ACP client extensions such as `formulahendry.acp-client`)

---

## Quick Start

You can run the agent directly using `npx`:

```bash
export NINEROUTER_API_KEY="your-9router-api-key"
export NINEROUTER_BASE_URL="http://127.0.0.1:20128" # optional, default 127.0.0.1:20128
npx -y 9router-acp
```

> **Tip:** If you use the `9router Copilot Chat Provider` VS Code extension, you can run the command `9router: Set Up ACP Agent` to generate configuration snippets for your editor.

---

## Editor Configuration

### 1. Zed (`settings.json`)

Add to your Zed configuration (`~/.config/zed/settings.json` or `%APPDATA%\Zed\settings.json`):

```json
{
  "agent_servers": {
    "9router": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "9router-acp"],
      "env": {
        "NINEROUTER_API_KEY": "your-9router-api-key",
        "NINEROUTER_BASE_URL": "http://127.0.0.1:20128"
      }
    }
  }
}
```

### 2. JetBrains IDEs (`~/.jetbrains/acp.json`)

Add to `~/.jetbrains/acp.json`:

```json
{
  "agent_servers": {
    "9router": {
      "command": "npx",
      "args": ["-y", "9router-acp"],
      "env": {
        "NINEROUTER_API_KEY": "your-9router-api-key",
        "NINEROUTER_BASE_URL": "http://127.0.0.1:20128"
      }
    }
  }
}
```

### 3. VS Code (`settings.json` with ACP Client Extension)

```json
{
  "acp.agents": {
    "9router": {
      "command": "npx",
      "args": ["-y", "9router-acp"],
      "env": {
        "NINEROUTER_API_KEY": "your-9router-api-key",
        "NINEROUTER_BASE_URL": "http://127.0.0.1:20128"
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NINEROUTER_API_KEY` | Required API key for 9router authentication. | `undefined` |
| `NINEROUTER_BASE_URL` | Base URL of the 9router service. | `http://127.0.0.1:20128` |
| `NINEROUTER_MODEL` | Default model ID from 9router catalog. | First available model |
| `NINEROUTER_MODE` | Initial operating mode: `ask`, `auto-edit`, or `read-only`. | `ask` |
| `NINEROUTER_REASONING_EFFORT` | Reasoning effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. | `off` |
| `NINEROUTER_TIMEOUT_MS` | Request timeout in milliseconds (0 to disable). | `300000` (5 minutes) |
| `NINEROUTER_DEBUG` | Logging verbosity to `stderr`: `minimal`, `metadata`, `verbose`. | `minimal` |
| `NINEROUTER_MAX_TURN_REQUESTS`| Maximum model loop iterations per turn (max 500). | `50` |

---

## Features

- **Workspace File Tools:** `read_file`, `list_directory`, `search_files`, `edit_file` (with diff preview), `write_file`.
- **Command Execution:** Runs shell commands in the workspace with automatic tree-killing on timeout or cancellation, and environment sanitization to protect credentials.
- **Permission Matrix & Modes:**
  - `ask`: Asks permission for file edits and terminal commands.
  - `auto-edit`: Automatically applies workspace file modifications; asks permission for terminal commands.
  - `read-only`: Disables file modifications and command execution entirely.
- **MCP Server Integration:** Connects to stdio and HTTP Model Context Protocol (MCP) servers configured by the ACP client.
- **Real-time Plan Updates:** Emits progress steps via ACP `plan` protocol updates.

---

## License

MIT
