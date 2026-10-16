# 9router ACP Agent (`9router-acp`) Design

## Document Status

- Status: Approved draft
- Date: 2026-10-16
- Scope: Standalone ACP coding agent CLI (`9router-acp`) and VS Code configuration helper
- Language: English

## Objective

Build a standalone npm CLI package `9router-acp` (`npx -y 9router-acp`) that implements Agent Client Protocol (ACP) v1 to serve as a coding agent in editors such as Zed, JetBrains IDEs, and VS Code (via third-party ACP client extensions such as `formulahendry.acp-client`).

The ACP agent connects to 9router's OpenAI-compatible `/v1/responses` API, reusing existing router client, streaming, and error classification logic. In addition, the VS Code extension provides a helper command (`9routerCopilot.setupAcpAgent`) to generate client configuration snippets.

## Confirmed Decisions

| Area | Decision |
|---|---|
| Role | ACP **Agent** powered by 9router |
| Target Clients | Zed, JetBrains IDEs, and VS Code via ACP client extension |
| Scope v1 | Full coding agent: multi-turn tool loop, workspace file tools, terminal execution, permissions, modes, and MCP server integration |
| Implementation | TypeScript native using `@agentclientprotocol/sdk@1.8.0` (ACP protocol v1) |
| Distribution | Standalone npm package `9router-acp` plus VS Code command "9router: Set Up ACP Agent" |
| Authentication | Environment variable `NINEROUTER_API_KEY`. Configuration snippets default to a placeholder; opt-in real key is copied **strictly to clipboard** with a modal warning (never opened in an unsaved document to prevent disk backups) |

## Invariants & Architecture Boundaries

1. **9router as Single Routing Backend**: The agent contains no fallback or provider routing logic. Model identifiers are opaque strings obtained from `GET /v1/models`.
2. **Standard I/O Separation**: `stdout` is reserved exclusively for ACP JSON-RPC framing (NDJSON). All diagnostic, lifecycle, and debug messages must be emitted to `stderr` with secret redaction.
3. **Process Isolation**: The VS Code extension does not bundle or run the ACP agent in the extension host. ACP clients spawn `9router-acp` as a separate child process.
4. **Clean Code Boundaries**: `src/acp/` must never import `vscode`, `@/runtime`, `@/provider`, `@/webview`, or `@/config/*` (except constants from `@/config/defaults` and `@/debug/debug-level`). Code outside `src/acp` must not import `@/acp` or ACP/MCP SDKs.

## Architecture & Reusability

```text
ACP Client (Zed / JetBrains / VS Code ACP Client extension)
   │ spawn: npx -y 9router-acp@<version> (stdio, env: NINEROUTER_*)
   ▼ JSON-RPC NDJSON over stdio
src/acp/main.ts → AgentApp (acp.agent().onRequest...)
   ├─ SessionStore (cwd, history: RouterResponseInputItem[], config, activeTurn, grants, MCP hub)
   ├─ TurnRunner: request → src/router/client.streamResponse → session/update notifications
   │              → tool calls → permission check → tools/* | mcp/* → function_call_output → loop
   └─ Client FS / Terminal (when client advertises capability), fallback to node:fs / child_process
   ▼
9router /v1/responses (combo routing & upstream execution)
```

### Shared Code & Refactoring

- **Reused without changes**:
  - `src/router/client.ts` (`createRouterClient`, `streamResponse`, `listModels`)
  - `src/router/sse-parser.ts`
  - `src/router/errors.ts` (`NineRouterError`, `classifyError`)
  - `src/router/model-catalog.ts`
  - `src/types/router-contract.ts`
  - `src/types/error.ts`
  - `src/debug/redaction.ts`
- **Extracted / Refactored**:
  - Move `normalizeBaseUrl` from `src/config/settings.ts` to `src/router/url.ts` (+ `isHttpBaseUrl`); `settings.ts` re-imports it.
  - Extract tool-call accumulator and `text-done` parsing from `src/provider/stream-adapter.ts` into `src/router/response-assembler.ts` (pure function returning `{ ok: true, input } | { ok: false, reason }`). `stream-adapter.ts` retains existing throw semantics for regression safety.
  - Extract `DebugMode` ranking into `src/debug/debug-level.ts` for reuse between `OutputChannel` and ACP `stderr` logger.
  - Define shared ACP environment contracts in `src/types/acp-agent-contract.ts`.

### SDK 1.8.0 Technical Considerations

- `@agentclientprotocol/sdk@1.8.0` is ESM-only. `src/acp/` requires its own `tsconfig.json` (`module: ESNext`, `moduleResolution: Bundler`).
- Bundled into a standalone CommonJS executable `packages/acp-agent/dist/index.cjs` via Vite in SSR mode (`ssr.noExternal: true`, externalizing Node builtins and prepending `#!/usr/bin/env node`).
- API surface: `acp.agent({ name, version }).onRequest(...)`, `ctx.client.notify(...)`, and `ctx.client.request(...)`.
- Cancellation: `session/cancel` does not trigger `ctx.signal`. Each turn creates an `AbortController` linked to `session/cancel`, `ctx.signal`, and connection drop via `raceAbort`.
- Supports both `configOptions` and legacy `modes`, synchronized via `current_mode_update` and `config_option_update`.
- Context usage: gauge updates `{ used, size }` are sent only when catalog metadata includes a known context window.
- MCP client: stdio and http transports supported (`mcpCapabilities { http: true, sse: false }`).
- Router request timeout defaults to 300,000 ms (5 minutes) for long-running streaming turns.

## Agent Protocol Contract

### `initialize`
- `protocolVersion`: 1
- `agentInfo`: `{ name: '9router-acp', title: '9router', version: '<packageVersion>' }`
- `authMethods`: `[]`
- `loadSession`: `false`
- `promptCapabilities`: `{ image: false, audio: false, embeddedContext: true }`
- `mcpCapabilities`: `{ http: true, sse: false }`
- `sessionCapabilities`: `{ close: {} }`

### Environment Configuration

Defined in `src/types/acp-agent-contract.ts`:
- `NINEROUTER_API_KEY`: Required. Values matching `<...>` are treated as missing.
- `NINEROUTER_BASE_URL`: Optional, defaults to `http://127.0.0.1:20128`.
- `NINEROUTER_MODEL`: Optional, defaults to the first available model from 9router catalog.
- `NINEROUTER_REASONING_EFFORT`: Optional, defaults to `off`.
- `NINEROUTER_MODE`: Optional (`ask`, `auto-edit`, `read-only`), defaults to `ask`.
- `NINEROUTER_TIMEOUT_MS`: Optional, defaults to `300000` (0 disables timeout).
- `NINEROUTER_DEBUG`: Optional (`minimal`, `metadata`, `verbose`), defaults to `minimal`.
- `NINEROUTER_MAX_TURN_REQUESTS`: Optional, defaults to `50` (maximum 500).

Invalid values do not crash the agent; they log warnings to `stderr` and cause `session/new` to return a descriptive RPC error.

### Config Options

Exposed in `session/new` (order is significant):
1. `model`: Category `model`. Options dynamically populated from `GET /v1/models` (cached for 5 minutes). Defaults to `NINEROUTER_MODEL` or the first catalog model.
2. `reasoning_effort`: Category `thought_level`. Options: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Defaults to `off`.
3. `mode`: Category `mode` (synchronized with legacy `modes`). Options: `ask`, `auto-edit`, `read-only`. Defaults to `ask`.

### Tools & Permissions Matrix

| Tool | Kind | `ask` Mode | `auto-edit` Mode | `read-only` Mode |
|---|---|---|---|---|
| `read_file` (path, offset?, limit?) | read | allow | allow | allow |
| `list_directory` (path?, depth?) | read | allow | allow | allow |
| `search_files` (query, regex?, glob?, path?) | search | allow | allow | allow |
| `edit_file` (path, old_string, new_string, replace_all?) | edit | **ask** | allow | hidden |
| `write_file` (path, content) | edit | **ask** | allow | hidden |
| `run_command` (command, timeout_ms?) | execute | **ask** | **ask** | hidden |
| `update_plan` (tasks) | think | allow | allow | allow |
| `mcp__<server>__<tool>` | other | **ask** | **ask** | hidden |

#### Path & Security Guard
- Reading outside `cwd` requires explicit permission prompt.
- Writing outside `cwd` or writing to `.git/` is strictly forbidden.
- Path containment algorithm: `path.resolve` followed by relative containment check and `fs.realpath` resolution to prevent symlink traversal. Case-insensitive comparison on Windows.
- `allow_always` grants are session-scoped (keyed by tool name; for `run_command`, keyed by exact command string).
- Rejection results in `tool_call_update failed` and `function_call_output` returning "User rejected this action", allowing the model loop to recover.

#### File I/O Adaptations
- If client advertises `fs` capability, use `fs/read_text_file` and `fs/write_text_file` to leverage unsaved editor buffers. Otherwise, use `node:fs` with atomic writes.
- For `edit_file` and `write_file`, send diff preview content `{ type: 'diff', path, oldText, newText }` in both the tool call update and permission request.

#### Terminal & Command Execution
- If client advertises `terminal` capability, use `terminal/create` with terminal output streaming and 64 KiB buffer cap. Otherwise, use `node:child_process.spawn`.
- Shell selection: POSIX `/bin/sh -c`, Windows `powershell.exe -NoProfile -NonInteractive -Command`.
- Process tree killing on timeout or cancellation.
- Sanitized environment: remove all `NINEROUTER_*` environment variables from spawned child processes.

#### MCP Integration
- Background connection during `session/new`.
- First prompt waits up to 30 seconds for pending MCP initializations.
- Server failures are isolated: logged to `stderr` and skipped without aborting the session.
- Tool names are sanitized, truncated to 64 chars, and hashed on collision (`mcp__<sanitized_server>__<sanitized_tool>`).

### Stop Reasons & Error Classification

| Condition | Outcome |
|---|---|
| Tool execution complete, no more tool calls | Stop reason `end_turn` |
| Incomplete response (`max_output_tokens` / `content_filter`) | Stop reason `max_tokens` / `refusal` |
| Turn request count exceeds `MAX_TURN_REQUESTS` | Stop reason `max_turn_requests` |
| Cancellation (any source) | Stop reason `cancelled` (never returned as an RPC error) |
| Missing API key / `AUTHENTICATION_ERROR` | RPC error `-32000` (`authRequired`) |
| Invalid session ID, invalid config, relative `cwd`, concurrent prompt on active turn | RPC error `-32602` (Invalid params) |
| Timeout, transport failure, router error, malformed stream | RPC error `-32603` (Internal error) with `{ code, requestId }` |
| Malformed tool arguments, tool failure, user rejection | Handled within loop: `tool_call_update failed` + error output fed back to model |

### Cancellation Protocol

1. Abort upstream 9router fetch via `AbortController`.
2. Resolve any pending permission requests (sending `$/cancel_request` where applicable).
3. Terminate running commands: `terminal/kill` + `release` for client terminals; tree-kill for local child processes.
4. Abort in-flight MCP tool calls.
5. Provide `function_call_output "Cancelled by user"` for all dangling tool calls in the conversation history (avoiding orphan function calls rejected by 9router).
6. Ensure all pending `tool_call_update` notifications are dispatched before returning `cancelled`.

### Safety Limits

- Maximum turn requests: 50 requests per turn default (configurable up to 500).
- Tool calls executed sequentially within each turn.
- Payload limits: arguments up to 1 MiB per call, 4 MiB total; tool output returned to model capped at 64 KiB (preserving head and tail).
- File reading: 2,000 lines or 256 KiB max.
- Directory listing: 1,000 entries max.
- File search: 200 matches max, 20,000 files scanned max; skip files > 1 MiB or binary; exclude `.git`, `node_modules`, `dist`, `out`, `build`, `target`, `.venv`.
- Maximum concurrent sessions per process: 32.

## VS Code Client Configuration Helper

Command: `9routerCopilot.setupAcpAgent` ("9router: Set Up ACP Agent").
- Prompt QuickPick: Select target editor (Zed / JetBrains / VS Code ACP Client).
- Select default model from configured `9router-copilot.models`.
- Choice: Default placeholder (`<your-9router-api-key>`) or current stored API key.
- If real API key is chosen: display a modal warning informing the user that the key will be placed in the clipboard. Copy strictly to clipboard; never open in an unsaved text editor.
- Snippet Formats:
  - **Zed** (`settings.json`): `"agent_servers": { "9router": { "type": "custom", "command": "npx", "args": ["-y", "9router-acp@<version>"], "env": { "NINEROUTER_API_KEY": "...", "NINEROUTER_BASE_URL": "...", "NINEROUTER_MODEL": "..." } } }`
  - **JetBrains** (`~/.jetbrains/acp.json`): `"agent_servers": { "9router": { "command": "npx", "args": ["-y", "9router-acp@<version>"], "env": { ... } } }`
  - **VS Code ACP Client**: `"acp.agents": { "9router": { "command": "npx", "args": ["-y", "9router-acp@<version>"], "env": { ... } } }`

## Release & Packaging Strategy

- Unified release unit: root extension version synchronizes with `packages/acp-agent/package.json`.
- `.github/workflows/tag-build.yml` verifies `npm pack ./packages/acp-agent --dry-run` on every build.
- Manifest `.vscodeignore` ignores `packages/**` and `prompts/acp/**` to avoid bloating the VSIX package.
