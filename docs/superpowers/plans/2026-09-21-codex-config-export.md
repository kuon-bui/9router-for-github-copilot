# Codex Config Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Command Palette action that exports validated 9router models into Codex `model_catalog_json` plus a profile TOML or a merged `config.toml`, without writing secrets.

**Architecture:** Keep a pure adapter in `src/config/codex-export.ts` for catalog JSON, profile TOML, `/v1` base URL, and merge upserts. Keep destination prompts, overwrite confirms, and filesystem writes in `src/runtime/export-codex-config.ts`. Wire the command like `testConnection` / `showUsage`. Bundle `smol-toml` only for merge parse/stringify; hand-render the controlled profile document.

**Tech Stack:** TypeScript 5.9 strict, VS Code Extension API, Vitest 4, pnpm, Vite extension bundle, `smol-toml` (first production dependency; bundled, not externalized)

**Spec:** `docs/superpowers/specs/2026-09-21-codex-config-export-design.md`

## Global Constraints

- Follow `AGENTS.md`, `CODE_CONVENTION.md`, and the approved Codex export design spec exactly.
- Never call `getApiKey` / `SecretStorage` from this feature. Never write tokens into TOML, JSON, messages, or logs.
- Export `snapshot.models` only (already validated publishable entries). Rejected / unpublished entries stay out.
- Duplicate `modelId` keep-first; warn with skipped display ids.
- Default Codex `model` is the first exported slug after dedupe.
- Reattach a single trailing `/v1` when building Codex `base_url` from normalized runtime `baseUrl`.
- Provider auth is always `env_key = "NINE_ROUTER_API_KEY"` with setup instructions text from the spec.
- Profile mode writes `9router.config.toml`; merge mode upserts into existing `config.toml` and may rewrite formatting/comments.
- Fail closed on invalid runtime, empty exportable models, cancel, declined overwrite, mkdir/write failure, or merge parse failure.
- Add no webview, no continuous sync, no Vision-proxy export, no project-local `.codex/config.toml` write target.
- `smol-toml` is allowed only for merge parse/stringify. Do not add any other dependency.
- Follow TDD for every behavior change: observe the focused test fail for the intended reason before editing production code.
- Preserve the user-defined worktree. Stage and commit only files named by the current task.
- Before claiming done, run `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run package`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/config/codex-export.ts` | Pure adapter: dedupe, catalog JSON, Codex base URL, profile TOML text, merge upsert |
| `src/runtime/export-codex-config.ts` | Destination Quick Pick, Codex home resolution, profile/merge choice, overwrite, writes, messages |
| `src/runtime/commands.ts` | Register `9routerCopilot.exportCodexConfig` |
| `src/runtime/activate.ts` | Construct exporter and pass into `registerCommands` |
| `package.json` | Contribute command title; add `smol-toml` dependency |
| `test/support/vscode.ts` | Mock `showOpenDialog`, `workspace.fs` write/stat/createDirectory helpers used by exporter tests |
| `test/unit/config/codex-export.test.ts` | Pure adapter unit tests |
| `test/unit/runtime/export-codex-config.test.ts` | Runtime flow unit tests with mocked FS / prompts |
| `test/integration/extension/export-codex-config-command.test.ts` | Command registration + cancel/error surfacing |
| `test/integration/extension/release-guardrails.test.ts` | Assert command is contributed |
| `README.md` | Everyday commands + env-key / profile hint |

## Review Focus

- Empty `CODEX_HOME` after trim must fall back to `os.homedir()/.codex`, not treat whitespace as a path.
- Normalized base URL that already lacks `/v1` must gain exactly one `/v1`; values ending with `/v1/` must not become `/v1/v1`.
- Folder destination must never mutate a destination `config.toml`; it always writes profile-shaped `9router.config.toml`.
- Merge must preserve unrelated top-level keys and unrelated `model_providers.*` tables while replacing only `9router` provider fields plus `model` / `model_provider` / `model_catalog_json`.
- Cancel or declined overwrite must leave zero files written, including no partial catalog write.

---

### Task 1: Pure catalog adapter, `/v1` base URL, and duplicate `modelId` policy

**Files:**
- Create: `src/config/codex-export.ts`
- Create: `test/unit/config/codex-export.test.ts`

**Interfaces:**
- Consumes: `ConfiguredModel`, `SettingsSnapshot` from `@/config/settings` / `@/types/product-model`
- Produces:
  - `toCodexBaseUrl(normalizedBaseUrl: string): string`
  - `selectExportModels(models: readonly ConfiguredModel[]): { models: ConfiguredModel[]; skippedDisplayIds: string[] }`
  - `buildCodexCatalogModels(models: readonly ConfiguredModel[]): CodexCatalogModel[]`
  - `buildCodexExport(input: { models: readonly ConfiguredModel[]; normalizedBaseUrl: string; catalogAbsolutePath: string }): CodexExportResult`
- `CodexExportResult` shape:
  - `models: ConfiguredModel[]`
  - `catalog: { models: CodexCatalogModel[] }`
  - `catalogJson: string`
  - `profileToml: string`
  - `defaultModel: string`
  - `codexBaseUrl: string`
  - `warnings: string[]`

- [ ] **Step 1: Write the failing unit tests**

Create `test/unit/config/codex-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCodexCatalogModels,
  buildCodexExport,
  selectExportModels,
  toCodexBaseUrl
} from '@/config/codex-export';
import type { ConfiguredModel } from '@/types/product-model';

function model(partial: Partial<ConfiguredModel> & Pick<ConfiguredModel, 'id' | 'name' | 'modelId'>): ConfiguredModel {
  return {
    sourceIndex: partial.sourceIndex ?? 0,
    id: partial.id,
    name: partial.name,
    modelId: partial.modelId,
    toolMode: partial.toolMode ?? 'off',
    visionMode: partial.visionMode ?? 'off',
    thinkingMode: partial.thinkingMode ?? 'off',
    thinkingEfforts: partial.thinkingEfforts ?? [],
    maxInputTokens: partial.maxInputTokens ?? 128_000,
    maxOutputTokens: partial.maxOutputTokens ?? 8_192,
    ...(partial.serviceTier ? { serviceTier: partial.serviceTier } : {})
  };
}

describe('toCodexBaseUrl', () => {
  it('appends a single /v1 to a normalized base URL', () => {
    expect(toCodexBaseUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128/v1');
  });

  it('does not duplicate /v1 when the normalized value somehow still ends with it', () => {
    expect(toCodexBaseUrl('http://127.0.0.1:20128/v1')).toBe('http://127.0.0.1:20128/v1');
    expect(toCodexBaseUrl('http://127.0.0.1:20128/v1/')).toBe('http://127.0.0.1:20128/v1');
  });
});

describe('selectExportModels', () => {
  it('keeps the first modelId and warns about later duplicates', () => {
    const result = selectExportModels([
      model({ sourceIndex: 0, id: 'agent', name: 'Agent', modelId: 'router/shared' }),
      model({ sourceIndex: 1, id: 'coder', name: 'Coder', modelId: 'router/coder' }),
      model({ sourceIndex: 2, id: 'agent-fast', name: 'Agent Fast', modelId: 'router/shared', serviceTier: 'fast' })
    ]);

    expect(result.models.map((entry) => entry.id)).toEqual(['agent', 'coder']);
    expect(result.skippedDisplayIds).toEqual(['agent-fast']);
  });
});

describe('buildCodexCatalogModels', () => {
  it('maps reasoning, vision, and fast-tier fields', () => {
    const catalog = buildCodexCatalogModels([
      model({
        id: 'vision',
        name: 'Vision',
        modelId: 'router/vision',
        visionMode: 'native',
        thinkingMode: 'high',
        thinkingEfforts: ['low', 'high'],
        serviceTier: 'fast',
        maxInputTokens: 1000,
        maxOutputTokens: 200
      }),
      model({
        id: 'plain',
        name: 'Plain',
        modelId: 'router/plain',
        thinkingMode: 'off',
        thinkingEfforts: []
      })
    ]);

    expect(catalog[0]).toMatchObject({
      slug: 'router/vision',
      display_name: 'Vision',
      description: '9router model exported from VS Code',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [
        { effort: 'low', description: 'low' },
        { effort: 'high', description: 'high' }
      ],
      shell_type: 'unified_exec',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      additional_speed_tiers: ['fast'],
      service_tiers: [{ id: 'priority', name: 'Fast', description: 'Faster tier' }],
      availability_nux: null,
      upgrade: null,
      model_messages: {
        instructions_template: 'You are a coding agent connected through 9router.'
      },
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'tokens', limit: 10000 },
      context_window: 1200,
      input_modalities: ['text', 'image']
    });
    expect(catalog[1]).toMatchObject({
      slug: 'router/plain',
      priority: 2,
      additional_speed_tiers: [],
      service_tiers: [],
      input_modalities: ['text']
    });
    expect(catalog[1]).not.toHaveProperty('default_reasoning_level');
  });
});

describe('buildCodexExport', () => {
  it('builds catalog JSON, profile TOML, default model, and warnings together', () => {
    const result = buildCodexExport({
      models: [
        model({ id: 'agent', name: 'Agent', modelId: 'router/agent', thinkingMode: 'medium', thinkingEfforts: ['medium'] }),
        model({ id: 'dup', name: 'Dup', modelId: 'router/agent' })
      ],
      normalizedBaseUrl: 'http://127.0.0.1:20128',
      catalogAbsolutePath: 'C:/Users/me/.codex/9router-models.json'
    });

    expect(result.defaultModel).toBe('router/agent');
    expect(result.codexBaseUrl).toBe('http://127.0.0.1:20128/v1');
    expect(result.warnings).toEqual([
      'Skipped display models with duplicate modelId values: dup'
    ]);
    expect(JSON.parse(result.catalogJson)).toEqual({ models: result.catalog.models });
    expect(result.profileToml).toContain('model = "router/agent"');
    expect(result.profileToml).toContain('model_provider = "9router"');
    expect(result.profileToml).toContain(
      'model_catalog_json = "C:/Users/me/.codex/9router-models.json"'
    );
    expect(result.profileToml).toContain('[model_providers.9router]');
    expect(result.profileToml).toContain('base_url = "http://127.0.0.1:20128/v1"');
    expect(result.profileToml).toContain('env_key = "NINE_ROUTER_API_KEY"');
    expect(result.profileToml).toContain(
      'env_key_instructions = "Set NINE_ROUTER_API_KEY to your 9router API key."'
    );
    expect(result.profileToml).toContain('wire_api = "responses"');
    expect(result.profileToml).not.toMatch(/sk-|api[_-]?key\s*=\s*"[^"]+"/i);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/unit/config/codex-export.test.ts`

Expected: FAIL because `@/config/codex-export` does not exist.

- [ ] **Step 3: Implement the pure adapter**

Create `src/config/codex-export.ts` with the exports above.

Rules:
- `toCodexBaseUrl`: trim, strip trailing `/`, strip one trailing `/v1`, then append `/v1`.
- `selectExportModels`: iterate in array order; first `modelId` wins; collect later display `id`s into `skippedDisplayIds`.
- Catalog field mapping must match the design table exactly.
- Omit `default_reasoning_level` when `thinkingMode === 'off'`.
- `supported_reasoning_levels` uses `{ effort, description }` where `description` equals the effort string.
- `profileToml` is hand-rendered (no library). Escape Windows paths as literal TOML basic strings; if the absolute catalog path contains `\` or `"`, escape them as `\\` and `\"`.
- `catalogJson` is `JSON.stringify({ models }, null, 2)` plus trailing newline.
- Warning text exactly: `Skipped display models with duplicate modelId values: ${ids.join(', ')}` when any skips exist; otherwise `warnings` is `[]`.
- `buildCodexExport` throws nothing for empty models; callers reject empty. If models are empty after dedupe, still return empty catalog / empty defaultModel `''` so runtime can fail closed.

Minimal profile renderer sketch:

```ts
function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildCodexProfileToml(input: {
  defaultModel: string;
  catalogAbsolutePath: string;
  codexBaseUrl: string;
}): string {
  const model = escapeTomlBasicString(input.defaultModel);
  const catalog = escapeTomlBasicString(input.catalogAbsolutePath);
  const baseUrl = escapeTomlBasicString(input.codexBaseUrl);
  return [
    `model = "${model}"`,
    `model_provider = "9router"`,
    `model_catalog_json = "${catalog}"`,
    '',
    '[model_providers.9router]',
    'name = "9router"',
    `base_url = "${baseUrl}"`,
    'env_key = "NINE_ROUTER_API_KEY"',
    'env_key_instructions = "Set NINE_ROUTER_API_KEY to your 9router API key."',
    'wire_api = "responses"',
    ''
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/unit/config/codex-export.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/codex-export.ts test/unit/config/codex-export.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure Codex catalog and profile export adapter

EOF
)"
```

---

### Task 2: Merge existing Codex `config.toml` with `smol-toml`

**Files:**
- Modify: `package.json` (add `"smol-toml": "^1.8.0"` under a new top-level `"dependencies"` object)
- Modify: `pnpm-lock.yaml` via install
- Modify: `src/config/codex-export.ts`
- Modify: `test/unit/config/codex-export.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `smol-toml` `parse` / `stringify`
- Produces: `mergeCodexConfigToml(existingToml: string, input: { defaultModel: string; catalogAbsolutePath: string; codexBaseUrl: string }): string`
- Throws: `Error` with message starting `Failed to parse Codex config.toml` on parse failure

- [ ] **Step 1: Add dependency**

Run:

```bash
pnpm add smol-toml@^1.8.0
```

Confirm `package.json` has:

```json
"dependencies": {
  "smol-toml": "^1.8.0"
}
```

Do not mark `smol-toml` external in Vite; the extension bundle must include it (`scripts/vite-config.mjs` already externalizes only `vscode` and `node:`).

- [ ] **Step 2: Write failing merge tests**

Append to `test/unit/config/codex-export.test.ts`:

```ts
import { mergeCodexConfigToml } from '@/config/codex-export';

describe('mergeCodexConfigToml', () => {
  it('upserts 9router provider and top-level keys while preserving unrelated keys', () => {
    const existing = `
model = "other"
model_provider = "openai"
notice = "keep-me"

[model_providers.openai]
name = "OpenAI"
base_url = "https://example.invalid/v1"

[model_providers.9router]
name = "old"
base_url = "http://old.invalid/v1"
env_key = "OLD_KEY"
wire_api = "chat"
`;

    const merged = mergeCodexConfigToml(existing, {
      defaultModel: 'router/agent',
      catalogAbsolutePath: '/home/me/.codex/9router-models.json',
      codexBaseUrl: 'http://127.0.0.1:20128/v1'
    });

    expect(merged).toContain('model = "router/agent"');
    expect(merged).toContain('model_provider = "9router"');
    expect(merged).toContain('model_catalog_json = "/home/me/.codex/9router-models.json"');
    expect(merged).toContain('notice = "keep-me"');
    expect(merged).toContain('[model_providers.openai]');
    expect(merged).toContain('name = "OpenAI"');
    expect(merged).toContain('[model_providers.9router]');
    expect(merged).toContain('base_url = "http://127.0.0.1:20128/v1"');
    expect(merged).toContain('env_key = "NINE_ROUTER_API_KEY"');
    expect(merged).toContain('wire_api = "responses"');
    expect(merged).not.toContain('OLD_KEY');
    expect(merged).not.toMatch(/api[_-]?key\s*=/i);
  });

  it('fails closed on invalid TOML', () => {
    expect(() =>
      mergeCodexConfigToml('model = [', {
        defaultModel: 'router/agent',
        catalogAbsolutePath: '/tmp/9router-models.json',
        codexBaseUrl: 'http://127.0.0.1:20128/v1'
      })
    ).toThrow(/Failed to parse Codex config\.toml/);
  });
});
```

- [ ] **Step 3: Run merge tests to verify RED**

Run: `pnpm exec vitest run test/unit/config/codex-export.test.ts -t mergeCodexConfigToml`

Expected: FAIL because `mergeCodexConfigToml` is not exported.

- [ ] **Step 4: Implement merge**

In `src/config/codex-export.ts`:

```ts
import { parse, stringify } from 'smol-toml';

export function mergeCodexConfigToml(
  existingToml: string,
  input: {
    defaultModel: string;
    catalogAbsolutePath: string;
    codexBaseUrl: string;
  }
): string {
  let parsed: Record<string, unknown>;
  try {
    const value = parse(existingToml);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('root must be a table');
    }
    parsed = value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Failed to parse Codex config.toml: ${detail}`);
  }

  const providers =
    typeof parsed.model_providers === 'object' &&
    parsed.model_providers !== null &&
    !Array.isArray(parsed.model_providers)
      ? { ...(parsed.model_providers as Record<string, unknown>) }
      : {};

  providers['9router'] = {
    name: '9router',
    base_url: input.codexBaseUrl,
    env_key: 'NINE_ROUTER_API_KEY',
    env_key_instructions: 'Set NINE_ROUTER_API_KEY to your 9router API key.',
    wire_api: 'responses'
  };

  parsed.model = input.defaultModel;
  parsed.model_provider = '9router';
  parsed.model_catalog_json = input.catalogAbsolutePath;
  parsed.model_providers = providers;

  return `${stringify(parsed).trimEnd()}\n`;
}
```

- [ ] **Step 5: Run unit tests GREEN**

Run: `pnpm exec vitest run test/unit/config/codex-export.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/config/codex-export.ts test/unit/config/codex-export.test.ts
git commit -m "$(cat <<'EOF'
feat: merge Codex config.toml provider settings with smol-toml

EOF
)"
```

---

### Task 3: Runtime exporter flow

**Files:**
- Create: `src/runtime/export-codex-config.ts`
- Create: `test/unit/runtime/export-codex-config.test.ts`
- Modify: `test/support/vscode.ts`

**Interfaces:**
- Consumes: `buildCodexExport`, `mergeCodexConfigToml`, `SettingsSnapshot`, `NineRouterError`
- Produces:
  - `export type CodexExporter = () => Promise<CodexExportSummary | undefined>`
  - `createCodexExporter(dependencies: { getSettingsSnapshot: () => SettingsSnapshot | undefined; env?: NodeJS.ProcessEnv; homedir?: () => string; fs?: CodexExportFs }): CodexExporter`
  - `CodexExportSummary`: `{ mode: 'profile' | 'merge'; directory: string; catalogPath: string; configPath: string; warnings: string[] }`
- `CodexExportFs` minimal surface:

```ts
export interface CodexExportFs {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  access(path: string): Promise<void>;
}
```

Default `fs` uses `node:fs/promises`. Default `env` is `process.env`. Default `homedir` is `os.homedir`.

- [ ] **Step 1: Extend the VS Code test double for dialogs used by the exporter**

In `test/support/vscode.ts`:

1. Add module state:
   - `openDialogResults: MockUri[] | undefined`
   - track `openDialogCalls`
2. Add `window.showOpenDialog` that returns the queued URIs (or `undefined` when cancelled).
3. Add helpers:
   - `__setOpenDialogResult(uris: string[] | undefined): void`
   - `__getOpenDialogCalls(): unknown[]`
   - include them in `__resetVscodeState`

Keep existing QuickPick / warning helpers; exporter tests will use `__setQuickPickValues`, `__setWarningResponse`, `__getWarningMessages`, `__getInformationMessages`, `__getErrorMessages`.

- [ ] **Step 2: Write failing runtime tests**

Create `test/unit/runtime/export-codex-config.test.ts` covering:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodexExporter } from '@/runtime/export-codex-config';
import { NineRouterError } from '@/router/errors';
import type { SettingsSnapshot } from '@/config/settings';
import type { ConfiguredModel } from '@/types/product-model';
import {
  __resetVscodeState,
  __setOpenDialogResult,
  __setQuickPickValues,
  __setWarningResponse,
  __getErrorMessages,
  __getInformationMessages,
  __getWarningMessages
} from '@test/support/vscode';

function usableSnapshot(models: ConfiguredModel[]): SettingsSnapshot {
  return {
    state: 'valid',
    runtime: {
      baseUrl: 'http://127.0.0.1:20128',
      requestTimeoutMs: 60_000,
      debugMode: 'minimal',
      visionProxySource: undefined,
      visionProxyModelId: '',
      visionProxyPrompt: ''
    },
    models,
    publishedModels: [],
    rejectedModels: [],
    issues: []
  };
}

function memoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir(): Promise<string | undefined> {
      return undefined;
    },
    async readFile(path: string): Promise<string> {
      const value = files.get(path);
      if (value === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return value;
    },
    async writeFile(path: string, data: string): Promise<void> {
      files.set(path, data);
    },
    async access(path: string): Promise<void> {
      if (!files.has(path)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
    }
  };
}
```

Concrete cases:

1. `throws CONFIGURATION_ERROR when runtime is missing`
2. `throws CONFIGURATION_ERROR when no exportable models remain`
3. `returns undefined and writes nothing when destination Quick Pick is cancelled`
4. `writes catalog + profile into the chosen folder`
5. `installs a profile into Codex home when config.toml is absent`
6. `merges into config.toml when user chooses merge and confirms rewrite warning`
7. `trims blank CODEX_HOME and falls back to homedir/.codex`
8. `does not write anything when overwrite is declined`

For Quick Pick labels use exactly:

- Destination: `Choose folder…`, `Install into Codex home`
- Mode: `Create profile`, `Merge into config.toml`

Overwrite confirmation uses `showWarningMessage` with actions `Overwrite` / `Cancel`.
Merge rewrite warning uses `showWarningMessage` with actions `Continue` / `Cancel` and message containing `may not preserve comments`.

Success `showInformationMessage` must mention:
- written paths
- `NINE_ROUTER_API_KEY`
- for profile mode: `codex --profile 9router`

- [ ] **Step 3: Run runtime tests RED**

Run: `pnpm exec vitest run test/unit/runtime/export-codex-config.test.ts`

Expected: FAIL because module / helpers are missing.

- [ ] **Step 4: Implement runtime exporter**

Create `src/runtime/export-codex-config.ts` that:

1. Reads snapshot; if `!snapshot?.runtime` or `!isUsableRuntimeSettings(snapshot.runtime)` → `NineRouterError('CONFIGURATION_ERROR', ...)`.
2. Builds export via `buildCodexExport`; if `result.models.length === 0` → `NineRouterError('CONFIGURATION_ERROR', 'No publishable models available to export.')`.
3. Destination Quick Pick; cancel → `undefined`.
4. Folder path:
   - `showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Export here' })`
   - cancel → `undefined`
   - always profile mode into that folder
5. Codex home path:
   - `const configured = (env.CODEX_HOME ?? '').trim();`
   - `const directory = configured.length > 0 ? configured : path.join(homedir(), '.codex');`
   - `await fs.mkdir(directory, { recursive: true })`
   - if `config.toml` missing → profile mode
   - else Quick Pick Create profile / Merge; cancel → `undefined`
   - merge path: warn about comment/format loss; Cancel → `undefined`
6. Target paths:
   - catalog always `path.join(directory, '9router-models.json')`
   - profile config `path.join(directory, '9router.config.toml')`
   - merge config `path.join(directory, 'config.toml')`
7. Before any write, for each existing target file ask overwrite; any decline → `undefined` and write nothing.
8. Write catalog first, then config/profile content.
9. For merge: `readFile` existing `config.toml`, `mergeCodexConfigToml(...)`, write back.
10. Show information message. If `result.warnings.length > 0`, also `showWarningMessage` with joined warnings.
11. Return `CodexExportSummary`.

Do not import `secret-store`.

- [ ] **Step 5: Run runtime tests GREEN**

Run: `pnpm exec vitest run test/unit/runtime/export-codex-config.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/runtime/export-codex-config.ts test/unit/runtime/export-codex-config.test.ts test/support/vscode.ts
git commit -m "$(cat <<'EOF'
feat: add Codex config export runtime flow

EOF
)"
```

---

### Task 4: Wire command, activation, manifest, and README

**Files:**
- Modify: `package.json` (commands contribution only; dependency already added in Task 2)
- Modify: `src/runtime/commands.ts`
- Modify: `src/runtime/activate.ts`
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Create: `test/integration/extension/export-codex-config-command.test.ts`
- Modify: `README.md`
- Modify: `test/unit/runtime/activate.test.ts` only if it asserts the exact dependency object shape

**Interfaces:**
- Consumes: `createCodexExporter`, existing `registerCommands` pattern
- Produces: command id `9routerCopilot.exportCodexConfig`, title `9router: Export Codex Config`

- [ ] **Step 1: Write failing integration / guardrail expectations**

In `test/integration/extension/release-guardrails.test.ts`, extend the commands assertion:

```ts
expect.objectContaining({ command: '9routerCopilot.exportCodexConfig' })
```

Create `test/integration/extension/export-codex-config-command.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from '@/runtime/commands';
import { NineRouterError } from '@/router/errors';
import {
  __getCommandHandler,
  __getErrorMessages,
  __getInformationMessages,
  __resetVscodeState,
  Uri
} from '@test/support/vscode';

function createContext() {
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: Uri.file('/ext'),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined
    }
  } as never;
}

describe('9routerCopilot.exportCodexConfig', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('registers and invokes the exporter dependency', async () => {
    const exportCodexConfig = vi.fn(async () => ({
      mode: 'profile' as const,
      directory: '/tmp/codex',
      catalogPath: '/tmp/codex/9router-models.json',
      configPath: '/tmp/codex/9router.config.toml',
      warnings: []
    }));

    registerCommands(createContext(), { exportCodexConfig });
    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(exportCodexConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces configuration errors without writing guidance about secrets', async () => {
    registerCommands(createContext(), {
      exportCodexConfig: async () => {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          'No publishable models available to export.'
        );
      }
    });

    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(__getErrorMessages().join('\n')).toContain('No publishable models available to export.');
    expect(__getErrorMessages().join('\n')).not.toMatch(/sk-|api key value/i);
    expect(__getInformationMessages()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run test/integration/extension/export-codex-config-command.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL on missing command contribution / dependency wiring.

- [ ] **Step 3: Wire production code and docs**

1. `package.json` contributes:

```json
{
  "command": "9routerCopilot.exportCodexConfig",
  "title": "9router: Export Codex Config"
}
```

2. `commands.ts`:
   - extend `CommandDependencies` with `exportCodexConfig?: CodexExporter`
   - register handler that awaits the dependency and maps `NineRouterError` / unexpected errors through `showErrorMessage` like `testConnection` (no secret values)

3. `activate.ts`:

```ts
import { createCodexExporter } from './export-codex-config';

const exportCodexConfig = createCodexExporter({
  getSettingsSnapshot: () => provider?.getSnapshot()
});

registerRuntimeCommands(context, {
  getSettingsSnapshot: () => provider?.getSnapshot(),
  configureVisionProxy,
  manageModels,
  testConnection,
  showUsage,
  exportCodexConfig
});
```

4. README Everyday commands table: add row

| `9router: Export Codex Config` | Export models to Codex catalog/profile files |

Add a short note under Everyday commands or Advanced setup:

```md
Codex CLI export writes non-secret provider settings only. Set `NINE_ROUTER_API_KEY` in your environment before running Codex. Profile installs launch with `codex --profile 9router`.
```

- [ ] **Step 4: Run focused tests GREEN**

Run:

```bash
pnpm exec vitest run test/unit/config/codex-export.test.ts test/unit/runtime/export-codex-config.test.ts test/integration/extension/export-codex-config-command.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: PASS

- [ ] **Step 5: Full verification gate**

Run, in order:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: all succeed. Package step must still work with bundled `smol-toml`.

- [ ] **Step 6: Commit**

```bash
git add package.json src/runtime/commands.ts src/runtime/activate.ts test/integration/extension/export-codex-config-command.test.ts test/integration/extension/release-guardrails.test.ts README.md test/unit/runtime/activate.test.ts
git commit -m "$(cat <<'EOF'
feat: wire Codex config export command into the extension

EOF
)"
```

Only include `activate.test.ts` in the commit if it changed.

---

## Self-Review Checklist

1. **Spec coverage:** catalog fields, `/v1` reattach, destinations, profile vs merge, overwrite, fail-closed cases, security (no secrets), unit + command tests, README — each has a task.
2. **Placeholders:** none; tests and implementation sketches are concrete.
3. **Type consistency:** `CodexExporter`, `CodexExportSummary`, `CodexExportFs`, and `buildCodexExport` / `mergeCodexConfigToml` names match across tasks.
4. **Review Focus:** blank `CODEX_HOME`, `/v1` idempotency, folder-never-merges, unrelated TOML preservation, declined overwrite atomicity — each pinned by tests in Tasks 1–3.

## Execution Handoff

Plan complete after save. Do not implement until the user reviews the plan and chooses an execution method.
