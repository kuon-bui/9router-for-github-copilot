# 9router ACP Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `9router-acp` npm CLI package implementing Agent Client Protocol (ACP) v1 to serve as a coding agent in editors such as Zed, JetBrains IDEs, and VS Code, powered by 9router's `/v1/responses` API, accompanied by a VS Code configuration helper command.

**Architecture:** An independent Node.js executable spawned over stdio by ACP clients. It maintains in-memory session history and config, mediates permissions and tools (file operations, command execution, MCP servers), and runs a multi-turn tool-calling loop using 9router's streaming responses. A VS Code command generates target configuration snippets with safe credential handling.

**Tech Stack:** Node.js (>=20), TypeScript (ESNext/Bundler for ACP), `@agentclientprotocol/sdk@1.8.0`, `@modelcontextprotocol/client`, `zod@^4`, `picomatch`, Vite (SSR bundle mode).

**Spec:** `docs/superpowers/specs/2026-10-16-9router-acp-agent-design.md`

## Global Constraints

- 9router is the sole routing backend; no local fallback or provider routing logic in the agent.
- Model IDs are opaque and retrieved dynamically from 9router `GET /v1/models`.
- Standard output (`stdout`) is strictly reserved for ACP JSON-RPC framing (NDJSON); all logging and diagnostics go to `stderr` with secret redaction.
- The VS Code extension host does not bundle or run the ACP agent; `src/acp/` must not import `vscode`, `@/runtime`, `@/provider`, `@/webview`, or `@/config/*` (except constants from `@/config/defaults` and `@/debug/debug-level`).
- Code outside `src/acp` must not import `@/acp` or ACP/MCP SDKs.
- Secrets are read solely from environment variables (`NINEROUTER_API_KEY`); never written to disk or settings.
- Real API keys generated for client snippets must be placed strictly in clipboard with a modal confirmation, never in an unsaved editor buffer.

## Review Focus

1. **Path Traversal via Symlinks or Relative Paths:** `path-guard.ts` must resolve symlinks with `fs.realpath` and enforce containment strictly inside session `cwd`, handling Windows case-insensitivity.
2. **Cancellation and Dangling Tool Calls:** When a turn is aborted via `session/cancel` or signal, all in-flight tools and terminals must be killed, and orphan tool calls in session history must be finalized with a synthetic `Cancelled by user` output.
3. **Child Process Environment Sanitization:** `run_command` execution must strip all `NINEROUTER_*` environment variables so child processes cannot leak or tamper with credentials.
4. **Buffer Truncation and Output Caps:** Oversized tool results or command outputs must be truncated to 64 KiB preserving head and tail to prevent token exhaustion.
5. **Session Isolation and Fault Tolerance:** Individual tool failures, rejected permissions, or failed MCP servers must not crash the session or the RPC connection.

---

### Task 1: Setup Workspace, Package Manifest, Build Pipeline, and Toolchain Spike (Phase 0)

**Files:**
- Create: `packages/acp-agent/package.json`
- Create: `src/acp/tsconfig.json`
- Create: `src/acp/raw-imports.d.ts`
- Create: `src/acp/main.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`
- Modify: `.vscodeignore`
- Modify: `.gitignore`
- Modify: `scripts/vite-config.mjs`
- Modify: `scripts/build.mjs`
- Modify: `scripts/watch.mjs`
- Test: `test/unit/acp/spike.test.ts`

**Interfaces:**
- Consumes: `@agentclientprotocol/sdk@1.8.0`
- Produces: `packages/acp-agent/dist/index.cjs` bundled executable responding to ACP `initialize`.

- [ ] **Step 1: Write the failing spike test**

```typescript
// test/unit/acp/spike.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ACP Agent Bundle Spike', () => {
  it('has package manifest and bundled executable with shebang', () => {
    const pkgPath = resolve(__dirname, '../../../packages/acp-agent/package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toBe('9router-acp');
    expect(pkg.bin['9router-acp']).toBe('./dist/index.cjs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/acp/spike.test.ts`
Expected: FAIL due to missing `packages/acp-agent/package.json`

- [ ] **Step 3: Implement package configuration, dependencies, and Vite SSR build**

1. Install dependencies: add `@agentclientprotocol/sdk: "1.8.0"` and `zod: "^4.6.0"` to root `devDependencies`.
2. Update `pnpm-workspace.yaml` to include `packages: ['.']`.
3. Create `packages/acp-agent/package.json` with `name: "9router-acp"`, `version: "0.15.0"`, `bin: { "9router-acp": "./dist/index.cjs" }`, `engines: { "node": ">=20.0.0" }`, and MIT license.
4. Create `src/acp/tsconfig.json` configured for `module: ESNext`, `moduleResolution: Bundler`, excluding webview/test, pointing to root node_modules.
5. Update root `tsconfig.json` to exclude `src/acp/**`.
6. Update `eslint.config.js` to enforce boundary rules for `src/acp` and add `packages/*/dist/**` to ignores.
7. Update `scripts/vite-config.mjs` to add `createAcpAgentConfig` with `ssr.noExternal: true`, banner `#!/usr/bin/env node`, outputting to `packages/acp-agent/dist/index.cjs`.
8. Update `scripts/build.mjs` and `scripts/watch.mjs` to build the ACP agent bundle.
9. Implement a minimal `src/acp/main.ts` that initializes an ACP agent using `@agentclientprotocol/sdk`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/acp/spike.test.ts && pnpm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json eslint.config.js .vscodeignore .gitignore scripts/ packages/ src/acp/ test/unit/acp/
git commit -m "feat(acp): setup package manifest, build pipeline, and toolchain spike"
```

---

### Task 2: Refactor Shared Modules (Phase 1)

**Files:**
- Create: `src/router/url.ts`
- Create: `src/router/response-assembler.ts`
- Create: `src/debug/debug-level.ts`
- Create: `src/types/acp-agent-contract.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/provider/stream-adapter.ts`
- Modify: `src/debug/output-channel.ts`
- Test: `test/unit/router/url.test.ts`
- Test: `test/unit/router/response-assembler.test.ts`
- Test: `test/unit/debug/debug-level.test.ts`

**Interfaces:**
- Consumes: Existing regex and string helpers
- Produces:
  - `normalizeBaseUrl(raw: string): string` and `isHttpBaseUrl(url: string): boolean`
  - `assembleToolCalls(events: RouterStreamEvent[]): { ok: true; items: RouterResponseInputItem[] } | { ok: false; reason: string }`
  - `DebugLevel` ranking helpers (`shouldLog(configured: DebugMode, level: DebugMode): boolean`)
  - `AcpAgentEnvConfig` and constant definitions in `src/types/acp-agent-contract.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/router/url.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, isHttpBaseUrl } from '../../../src/router/url.js';

describe('router/url', () => {
  it('normalizes base URLs without vscode dependency', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:20128/')).toBe('http://127.0.0.1:20128/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:20128/v1')).toBe('http://127.0.0.1:20128/v1');
    expect(isHttpBaseUrl('http://localhost:20128/v1')).toBe(true);
    expect(isHttpBaseUrl('ftp://invalid')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/router/url.test.ts`
Expected: FAIL due to missing `src/router/url.ts`

- [ ] **Step 3: Implement shared utility extractions**

1. Create `src/router/url.ts` with `normalizeBaseUrl` and `isHttpBaseUrl`. Update `src/config/settings.ts` to re-export or import from `src/router/url.ts`.
2. Create `src/router/response-assembler.ts` to aggregate tool-call arguments and text outputs from `RouterStreamEvent`.
3. Create `src/debug/debug-level.ts` with debug verbosity comparison functions.
4. Create `src/types/acp-agent-contract.ts` defining environment variable names (`NINEROUTER_API_KEY`, etc.) and default values.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/router/ test/unit/debug/ && pnpm run test:unit`
Expected: PASS (all existing unit tests continue to pass without regression)

- [ ] **Step 5: Commit**

```bash
git add src/router/url.ts src/router/response-assembler.ts src/debug/debug-level.ts src/types/acp-agent-contract.ts src/config/settings.ts src/provider/stream-adapter.ts src/debug/output-channel.ts test/unit/
git commit -m "refactor(router): extract url normalizer, response assembler, and debug level helpers"
```

---

### Task 3: Core ACP Agent Skeleton, Settings, Stderr Logger, and Capabilities (Phase 1)

**Files:**
- Create: `src/acp/agent-settings.ts`
- Create: `src/acp/stderr-logger.ts`
- Create: `src/acp/capabilities.ts`
- Create: `src/acp/errors.ts`
- Create: `src/acp/abort.ts`
- Create: `src/acp/agent-app.ts`
- Test: `test/unit/acp/agent-settings.test.ts`
- Test: `test/unit/acp/stderr-logger.test.ts`
- Test: `test/unit/acp/abort.test.ts`

**Interfaces:**
- Consumes: `@agentclientprotocol/sdk`, `src/types/acp-agent-contract.ts`, `src/debug/redaction.ts`
- Produces:
  - `loadAgentSettings(env: NodeJS.ProcessEnv): AgentSettings`
  - `createStderrLogger(debugMode: DebugMode): StderrLogger`
  - `createAgentCapabilities(): AgentCapabilities`
  - `raceAbort(signals: AbortSignal[]): AbortSignal`
  - `createAgentApp(deps): AcpAgentApp`

- [ ] **Step 1: Write failing tests for settings parsing and redaction**

```typescript
// test/unit/acp/agent-settings.test.ts
import { describe, it, expect } from 'vitest';
import { loadAgentSettings } from '../../../src/acp/agent-settings.js';

describe('loadAgentSettings', () => {
  it('treats placeholder API keys as missing', () => {
    const settings = loadAgentSettings({ NINEROUTER_API_KEY: '<your-key-here>' });
    expect(settings.apiKey).toBeUndefined();
  });

  it('parses valid settings with defaults', () => {
    const settings = loadAgentSettings({
      NINEROUTER_API_KEY: 'sk-real-key',
      NINEROUTER_BASE_URL: 'http://localhost:20128'
    });
    expect(settings.apiKey).toBe('sk-real-key');
    expect(settings.baseUrl).toBe('http://localhost:20128/v1');
    expect(settings.timeoutMs).toBe(300000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/agent-settings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement settings, logger, capabilities, and abort handler**

1. Implement `src/acp/agent-settings.ts` parsing environment variables with safe boundaries.
2. Implement `src/acp/stderr-logger.ts` with secret redaction using `redactSensitiveText`.
3. Implement `src/acp/abort.ts` with `raceAbort` and controller linking.
4. Implement `src/acp/capabilities.ts` declaring protocol version 1 and agent features.
5. Implement `src/acp/agent-app.ts` connecting `@agentclientprotocol/sdk` hooks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/acp/ test/unit/acp/
git commit -m "feat(acp): implement agent settings, capabilities, stderr logger, and abort mechanics"
```

---

### Task 4: Session Store, Config Options, Model Catalog Cache, and Turn Runner (Phase 1 Chat-Only)

**Files:**
- Create: `src/acp/session-store.ts`
- Create: `src/acp/config-options.ts`
- Create: `src/acp/model-catalog-cache.ts`
- Create: `src/acp/prompt-content.ts`
- Create: `src/acp/system-prompt.ts`
- Create: `prompts/acp/system-prompt.md`
- Create: `src/acp/router-turn.ts`
- Create: `src/acp/turn-runner.ts`
- Create: `test/support/fake-router-client.ts`
- Test: `test/unit/acp/config-options.test.ts`
- Test: `test/unit/acp/session-store.test.ts`
- Test: `test/unit/acp/turn-runner.test.ts`
- Test: `test/integration/acp/agent-stdio.test.ts`

**Interfaces:**
- Consumes: `src/router/client.ts`, `src/acp/agent-settings.ts`
- Produces:
  - Multi-session store managing message history and active turns
  - Dynamic `configOptions` generation with 5-minute catalog caching
  - Streaming turn runner sending text chunks and handling cancellation

- [ ] **Step 1: Write failing tests for chat-only turn runner and cancellation**

```typescript
// test/unit/acp/turn-runner.test.ts
import { describe, it, expect } from 'vitest';
import { runChatTurn } from '../../../src/acp/turn-runner.js';
import { FakeRouterClient } from '../../support/fake-router-client.js';

describe('runChatTurn', () => {
  it('streams response text and completes with end_turn', async () => {
    const fakeClient = new FakeRouterClient({ responseText: 'Hello from 9router!' });
    const updates: string[] = [];
    const result = await runChatTurn({
      client: fakeClient,
      messages: [{ role: 'user', content: 'Hi' }],
      onChunk: (text) => updates.push(text)
    });
    expect(result.stopReason).toBe('end_turn');
    expect(updates.join('')).toBe('Hello from 9router!');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/turn-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement session management, config options, and streaming turn runner**

1. Create `test/support/fake-router-client.ts` to simulate 9router SSE streams.
2. Implement `src/acp/model-catalog-cache.ts` with 5-minute TTL.
3. Implement `src/acp/config-options.ts` synchronizing `configOptions` and `modes`.
4. Implement `src/acp/prompt-content.ts` mapping ACP prompt elements to 9router input items.
5. Implement `src/acp/system-prompt.ts` embedding the base prompt from `prompts/acp/system-prompt.md`.
6. Implement `src/acp/session-store.ts` handling up to 32 active sessions.
7. Implement `src/acp/turn-runner.ts` managing the streaming lifecycle, emitting `session/update`, handling cancellation, and updating history.
8. Wire stdio in `src/acp/main.ts` and add integration test `test/integration/acp/agent-stdio.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/ test/integration/acp/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/acp/ prompts/acp/ test/unit/acp/ test/support/ test/integration/acp/
git commit -m "feat(acp): implement session store, config options, and streaming chat turn runner"
```

---

### Task 5: Permissions Matrix, Path Guard, and Workspace FS (Phase 2)

**Files:**
- Create: `src/acp/permissions.ts`
- Create: `src/acp/tools/path-guard.ts`
- Create: `src/acp/tools/workspace-fs.ts`
- Test: `test/unit/acp/path-guard.test.ts`
- Test: `test/unit/acp/permissions.test.ts`
- Test: `test/unit/acp/workspace-fs.test.ts`

**Interfaces:**
- Consumes: Node `fs/promises`, `path`
- Produces:
  - `assertPathWithinCwd(targetPath: string, cwd: string, allowGit?: boolean): string`
  - `checkToolPermission(session: Session, toolCall: ToolCall): Promise<PermissionDecision>`
  - `WorkspaceFs`: Unified interface delegating to client `fs/*` or local `node:fs`

- [ ] **Step 1: Write failing tests for path traversal guard and permission matrix**

```typescript
// test/unit/acp/path-guard.test.ts
import { describe, it, expect } from 'vitest';
import { assertPathWithinCwd } from '../../../src/acp/tools/path-guard.js';

describe('assertPathWithinCwd', () => {
  it('rejects traversal outside cwd', () => {
    expect(() => assertPathWithinCwd('../secret.txt', 'C:/repo')).toThrow(/outside workspace/);
  });

  it('rejects modifications into .git folder', () => {
    expect(() => assertPathWithinCwd('.git/config', 'C:/repo', false)).toThrow(/protected/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/path-guard.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement path-guard, permissions, and workspace FS**

1. Implement `src/acp/tools/path-guard.ts` with realpath symlink verification and Windows case normalization.
2. Implement `src/acp/permissions.ts` enforcing the mode matrix (`ask`, `auto-edit`, `read-only`), session grants (`allow_always`), and prompt formatting with diff preview.
3. Implement `src/acp/tools/workspace-fs.ts` abstracting editor buffer reading/writing with local disk fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/path-guard.test.ts test/unit/acp/permissions.test.ts test/unit/acp/workspace-fs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/acp/permissions.ts src/acp/tools/path-guard.ts src/acp/tools/workspace-fs.ts test/unit/acp/
git commit -m "feat(acp): implement permissions matrix, path guard, and workspace fs abstraction"
```

---

### Task 6: Read, List, Search, Edit, Write, and Plan Tools (Phase 2)

**Files:**
- Create: `src/acp/tools/output-limits.ts`
- Create: `src/acp/tools/read-file.ts`
- Create: `src/acp/tools/list-directory.ts`
- Create: `src/acp/tools/search-files.ts`
- Create: `src/acp/tools/edit-file.ts`
- Create: `src/acp/tools/write-file.ts`
- Create: `src/acp/tools/update-plan.ts`
- Create: `src/acp/tools/registry.ts`
- Create: `src/acp/tools/tool-executor.ts`
- Modify: `package.json` (add `picomatch` devDep)
- Modify: `src/acp/turn-runner.ts` (expand to multi-turn tool-calling loop)
- Test: `test/unit/acp/tools.test.ts`
- Test: `test/unit/acp/tool-loop.test.ts`

**Interfaces:**
- Consumes: `src/acp/tools/workspace-fs.ts`, `src/acp/permissions.ts`, `picomatch`
- Produces:
  - Built-in tool definitions schemas for 9router Responses format
  - `executeTool(name, args, context): Promise<ToolResult>`
  - Multi-turn tool execution loop feeding `function_call_output` back to 9router

- [ ] **Step 1: Write failing tests for file editing, search, and tool execution loop**

```typescript
// test/unit/acp/tools.test.ts
import { describe, it, expect } from 'vitest';
import { executeEditFile } from '../../../src/acp/tools/edit-file.js';

describe('executeEditFile', () => {
  it('replaces exact text match and returns diff', async () => {
    const fsMock = { readText: async () => 'hello world', writeText: async () => {} };
    const res = await executeEditFile({ path: 'a.txt', oldString: 'world', newString: 'there' }, fsMock);
    expect(res.ok).toBe(true);
    expect(res.diff).toContain('-hello world\n+hello there');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement file tools, plan tool, output limits, and full turn loop**

1. Add `picomatch` devDependency.
2. Implement `output-limits.ts` enforcing 64 KiB model response caps and 2,000 line / 256 KiB file limits.
3. Implement `read-file.ts`, `list-directory.ts`, `search-files.ts`, `edit-file.ts`, `write-file.ts`, and `update-plan.ts`.
4. Implement `registry.ts` and `tool-executor.ts`.
5. Update `turn-runner.ts` to execute tools sequentially, check permissions, handle user rejection cleanly, and loop until `end_turn` or limits reached.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/tools.test.ts test/unit/acp/tool-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/acp/tools/ src/acp/turn-runner.ts test/unit/acp/
git commit -m "feat(acp): implement workspace file tools, update plan, and full tool execution loop"
```

---

### Task 7: Command Runner & Terminal Execution (Phase 3)

**Files:**
- Create: `src/acp/tools/run-command.ts`
- Create: `src/acp/tools/command-runner.ts`
- Create: `src/acp/tools/client-terminal-runner.ts`
- Create: `src/acp/tools/local-process-runner.ts`
- Modify: `src/acp/tools/registry.ts`
- Test: `test/unit/acp/command-runner.test.ts`

**Interfaces:**
- Consumes: Node `child_process`, ACP client terminal notifications
- Produces:
  - `runCommand(command, options): Promise<CommandResult>`
  - Tree-kill on abort / timeout
  - Environment stripping of `NINEROUTER_*`

- [ ] **Step 1: Write failing tests for command runner environment stripping and timeout**

```typescript
// test/unit/acp/command-runner.test.ts
import { describe, it, expect } from 'vitest';
import { runLocalCommand } from '../../../src/acp/tools/local-process-runner.js';

describe('runLocalCommand', () => {
  it('strips NINEROUTER_* environment variables from child process', async () => {
    process.env.NINEROUTER_API_KEY = 'secret';
    const res = await runLocalCommand('node -e "console.log(process.env.NINEROUTER_API_KEY)"', { cwd: process.cwd() });
    expect(res.stdout.trim()).toBe('undefined');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/command-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement client terminal and local process command runners**

1. Implement `local-process-runner.ts` with cross-platform shell selection (POSIX `/bin/sh -c`, Windows PowerShell) and tree-killing.
2. Implement `client-terminal-runner.ts` delegating to ACP client `terminal/*` requests.
3. Wire command runner into `registry.ts` and `permissions.ts` requiring confirmation on each unique command string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/command-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/acp/tools/run-command.ts src/acp/tools/command-runner.ts src/acp/tools/client-terminal-runner.ts src/acp/tools/local-process-runner.ts src/acp/tools/registry.ts test/unit/acp/command-runner.test.ts
git commit -m "feat(acp): implement command execution with terminal streaming and environment sanitization"
```

---

### Task 8: MCP Server Client Hub & Tool Integration (Phase 4)

**Files:**
- Create: `src/acp/mcp/mcp-hub.ts`
- Create: `src/acp/mcp/mcp-tool-names.ts`
- Create: `src/acp/mcp/mcp-result.ts`
- Modify: `package.json` (add `@modelcontextprotocol/client` devDep)
- Modify: `src/acp/session-store.ts`
- Modify: `src/acp/turn-runner.ts`
- Test: `test/unit/acp/mcp-hub.test.ts`

**Interfaces:**
- Consumes: `@modelcontextprotocol/client`
- Produces:
  - `McpHub`: Manages stdio / http connections configured by the client in `session/new`
  - Tool name sanitization and collision disambiguation (`mcp__<server>__<tool>`)
  - Integration into turn runner tool registry

- [ ] **Step 1: Write failing tests for MCP tool name sanitization and result conversion**

```typescript
// test/unit/acp/mcp-hub.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeMcpToolName } from '../../../src/acp/mcp/mcp-tool-names.js';

describe('sanitizeMcpToolName', () => {
  it('formats server and tool names safely within length limits', () => {
    const name = sanitizeMcpToolName('my-server', 'query_db');
    expect(name).toBe('mcp__my_server__query_db');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/acp/mcp-hub.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MCP client connection hub and tool bridging**

1. Install `@modelcontextprotocol/client`.
2. Implement `mcp-tool-names.ts` with collision hashing and truncation.
3. Implement `mcp-result.ts` converting MCP text/image results to 9router function outputs.
4. Implement `mcp-hub.ts` managing client connections, lifecycle, and safe timeout handling.
5. Wire MCP tools into the session tool catalog.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/acp/mcp-hub.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/acp/mcp/ test/unit/acp/mcp-hub.test.ts
git commit -m "feat(acp): implement MCP server client hub and tool integration"
```

---

### Task 9: VS Code ACP Client Snippet Generator & Setup Command (Phase 5)

**Files:**
- Create: `src/runtime/acp-client-snippets.ts`
- Create: `src/runtime/acp-setup.ts`
- Modify: `package.json` (contribute command `9routerCopilot.setupAcpAgent`)
- Modify: `src/runtime/commands.ts`
- Modify: `src/runtime/activate.ts`
- Modify: `test/support/vscode.ts`
- Test: `test/unit/runtime/acp-client-snippets.test.ts`
- Test: `test/unit/runtime/acp-setup.test.ts`

**Interfaces:**
- Consumes: `src/config/settings.ts`, `src/config/secret-store.ts`
- Produces:
  - Pure snippet generator for Zed, JetBrains, and VS Code ACP Client
  - Interactive setup command `9routerCopilot.setupAcpAgent` with modal clipboard confirmation

- [ ] **Step 1: Write failing tests for snippet formatting and clipboard safety**

```typescript
// test/unit/runtime/acp-client-snippets.test.ts
import { describe, it, expect } from 'vitest';
import { generateAcpSnippet } from '../../../src/runtime/acp-client-snippets.js';

describe('generateAcpSnippet', () => {
  it('generates valid Zed agent configuration', () => {
    const json = generateAcpSnippet({
      target: 'zed',
      version: '0.15.0',
      baseUrl: 'http://127.0.0.1:20128/v1',
      modelId: 'gh/gpt-5',
      apiKey: '<your-key-here>'
    });
    const parsed = JSON.parse(json);
    expect(parsed.agent_servers['9router'].command).toBe('npx');
    expect(parsed.agent_servers['9router'].args).toEqual(['-y', '9router-acp@0.15.0']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/unit/runtime/acp-client-snippets.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement snippet generator, setup command, and clipboard modal flow**

1. Implement `src/runtime/acp-client-snippets.ts` producing JSON for Zed, JetBrains, and VS Code ACP Client.
2. Implement `src/runtime/acp-setup.ts` with target editor selection, default model selection, and secure clipboard copying with modal warning.
3. Register command in `package.json`, `src/runtime/commands.ts`, and `src/runtime/activate.ts`.
4. Update `test/support/vscode.ts` mock environment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit/runtime/acp-client-snippets.test.ts test/unit/runtime/acp-setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/runtime/acp-client-snippets.ts src/runtime/acp-setup.ts src/runtime/commands.ts src/runtime/activate.ts test/
git commit -m "feat(runtime): add ACP agent setup command and client snippet generator"
```

---

### Task 10: Packaging, Documentation, and Integration Guardrails (Phase 5)

**Files:**
- Create: `packages/acp-agent/README.md`
- Create: `test/integration/acp/release-guardrails.test.ts`
- Modify: `README.md`
- Modify: `.github/workflows/tag-build.yml`
- Modify: `.github/release-please-config.json`
- Test: `test/integration/acp/release-guardrails.test.ts`

**Interfaces:**
- Consumes: Built artifacts and manifests
- Produces:
  - Complete documentation for standalone ACP agent usage
  - Release pipeline syncing `packages/acp-agent/package.json`
  - Integration guardrails ensuring no cross-contamination between extension and CLI package

- [ ] **Step 1: Write failing tests for release guardrails**

```typescript
// test/integration/acp/release-guardrails.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ACP Release Guardrails', () => {
  it('synchronizes extension and agent versions', () => {
    const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    const agentPkg = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/acp-agent/package.json'), 'utf8'));
    expect(agentPkg.version).toBe(rootPkg.version);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/integration/acp/release-guardrails.test.ts`
Expected: FAIL

- [ ] **Step 3: Update documentation, release workflows, and packaging checks**

1. Create `packages/acp-agent/README.md` and update root `README.md`.
2. Update `.github/workflows/tag-build.yml` to run `npm pack ./packages/acp-agent --dry-run`.
3. Update `.github/release-please-config.json` to include `packages/acp-agent/package.json` in extra-files.

- [ ] **Step 4: Run full verification suite**

Run:
```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
npm pack ./packages/acp-agent --dry-run
```
Expected: All pass with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add README.md packages/acp-agent/README.md .github/ test/integration/acp/release-guardrails.test.ts
git commit -m "docs(acp): document 9router-acp CLI and add release verification guardrails"
```
