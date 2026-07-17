# Per-Model Context Window Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish independently configurable input and output token limits for `Daily`, `Agent`, and `Fallback` so Copilot Chat can render native Context Window information.

**Architecture:** Read and validate six per-model VS Code settings into `DisplayModelSetting`, then pass those values through `createPublishedModel` as native `LanguageModelChatInformation` metadata. Invalid limits reject only the affected curated model; the existing global request `maxTokens` and heuristic `provideTokenCount` behavior remain unchanged.

**Tech Stack:** TypeScript 5, VS Code `LanguageModelChatProvider`, JSON contribution settings, Vitest 4, pnpm.

## Global Constraints

- Preserve the thin provider adapter architecture and native Copilot Chat UI.
- Add `maxInputTokens` and `maxOutputTokens` settings independently for `daily`, `agent`, and `fallback`.
- Every per-model token limit must be a finite positive integer.
- Default `maxInputTokens` to `128000` and `maxOutputTokens` to `8192` for all three models.
- Reject only the curated model whose input or output limit is invalid.
- Keep `9router-copilot.maxTokens` independent and do not change the outgoing `max_tokens` request behavior.
- Keep the existing heuristic `provideTokenCount` implementation unchanged.
- Do not add a custom Session Info UI, backend model discovery, tokenizer dependency, or routing logic.
- Follow `CODE_CONVENTION.md` and the approved production design.
- Before claiming completion, run `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, and `pnpm run package`.

## File Structure

- Modify `src/config/defaults.ts`: own typed default input/output limits by curated model key.
- Modify `src/types/product-model.ts`: require validated token limits on `DisplayModelSetting`.
- Modify `src/config/settings.ts`: load defaults/overrides, validate raw values, and degrade one invalid model.
- Modify `src/provider/model-catalog.ts`: publish validated per-model limits to VS Code.
- Modify `package.json`: contribute the six user-facing integer settings.
- Modify `README.md`: show configuration and explain metadata versus request limits.
- Modify `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`: record the production configuration contract.
- Modify `test/unit/config/settings.test.ts`: cover defaults, overrides, and invalid per-model limits.
- Modify `test/unit/provider/model-catalog.test.ts`: cover published metadata.
- Modify `test/integration/extension/settings-refresh.test.ts`: cover refreshed token metadata.
- Modify `test/integration/extension/release-guardrails.test.ts`: lock manifest and documentation behavior.
- Modify `test/unit/provider/request-adapter.test.ts`, `test/unit/provider/tool-adapter.test.ts`, and `test/unit/provider/vision-proxy.test.ts`: keep typed `DisplayModelSetting` fixtures complete after the interface change.

---

### Task 1: Load and Validate Per-Model Token Limits

**Files:**
- Modify: `test/unit/config/settings.test.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/types/product-model.ts`
- Modify: `src/config/settings.ts`

**Interfaces:**
- Produces: `DEFAULT_MAX_INPUT_TOKENS: Record<ProductModelKey, number>`.
- Produces: `DEFAULT_MAX_OUTPUT_TOKENS: Record<ProductModelKey, number>`.
- Produces: required `DisplayModelSetting.maxInputTokens: number` and `DisplayModelSetting.maxOutputTokens: number`.
- Produces: `SettingsIssue` and `RejectedModelSetting` codes `INVALID_MAX_INPUT_TOKENS` and `INVALID_MAX_OUTPUT_TOKENS`.
- Preserves: `loadDisplayModelSettings(configuration): DisplayModelSetting[]` and `buildSettingsSnapshot(configuration): SettingsSnapshot` signatures.

- [ ] **Step 1: Add failing loader tests for defaults and per-model overrides**

Add this test inside `describe('loadDisplayModelSettings', ...)` in `test/unit/config/settings.test.ts`:

```ts
it('loads the approved default token limits for every curated model', () => {
  const models = loadDisplayModelSettings({ get: () => undefined } as never);

  expect(
    models.map(({ key, maxInputTokens, maxOutputTokens }) => ({
      key,
      maxInputTokens,
      maxOutputTokens
    }))
  ).toEqual([
    { key: 'daily', maxInputTokens: 128_000, maxOutputTokens: 8_192 },
    { key: 'agent', maxInputTokens: 128_000, maxOutputTokens: 8_192 },
    { key: 'fallback', maxInputTokens: 128_000, maxOutputTokens: 8_192 }
  ]);
});

it('loads configured token limits independently for each model', () => {
  const models = loadDisplayModelSettings({
    get: (key: string) => {
      const values: Record<string, unknown> = {
        displayModels: ['daily', 'agent', 'fallback'],
        'maxInputTokens.daily': 32_000,
        'maxOutputTokens.daily': 2_048,
        'maxInputTokens.agent': 64_000,
        'maxOutputTokens.agent': 4_096,
        'maxInputTokens.fallback': 96_000,
        'maxOutputTokens.fallback': 6_144
      };

      return values[key];
    }
  } as never);

  expect(
    models.map(({ key, maxInputTokens, maxOutputTokens }) => ({
      key,
      maxInputTokens,
      maxOutputTokens
    }))
  ).toEqual([
    { key: 'daily', maxInputTokens: 32_000, maxOutputTokens: 2_048 },
    { key: 'agent', maxInputTokens: 64_000, maxOutputTokens: 4_096 },
    { key: 'fallback', maxInputTokens: 96_000, maxOutputTokens: 6_144 }
  ]);
});
```

- [ ] **Step 2: Run the loader test and verify it fails**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts -t "token limits"
```

Expected: both new tests FAIL because the returned display models do not have `maxInputTokens` or `maxOutputTokens`.

- [ ] **Step 3: Add typed defaults and required display-model fields**

In `src/config/defaults.ts`, add these constants after `DEFAULT_MODEL_MAPPINGS`:

```ts
export const DEFAULT_MAX_INPUT_TOKENS: Record<ProductModelKey, number> = {
  daily: 128_000,
  agent: 128_000,
  fallback: 128_000
};

export const DEFAULT_MAX_OUTPUT_TOKENS: Record<ProductModelKey, number> = {
  daily: 8_192,
  agent: 8_192,
  fallback: 8_192
};
```

In `DisplayModelSetting` in `src/types/product-model.ts`, add:

```ts
maxInputTokens: number;
maxOutputTokens: number;
```

- [ ] **Step 4: Load valid overrides and fall back safely in the non-validating loader**

Extend the defaults import in `src/config/settings.ts` with:

```ts
DEFAULT_MAX_INPUT_TOKENS,
DEFAULT_MAX_OUTPUT_TOKENS,
```

Add these focused helpers after `getConfiguredThinkingMode`:

```ts
type ModelTokenLimitSetting = 'maxInputTokens' | 'maxOutputTokens';

function getConfiguredModelTokenLimit(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  setting: ModelTokenLimitSetting,
  key: ProductModelKey
): unknown {
  const configured = configuration.get<unknown>(`${setting}.${key}`);
  if (configured !== undefined) {
    return configured;
  }

  return setting === 'maxInputTokens'
    ? DEFAULT_MAX_INPUT_TOKENS[key]
    : DEFAULT_MAX_OUTPUT_TOKENS[key];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
```

Inside the `configuredKeys.map` callback in `loadDisplayModelSettings`, read both raw limits:

```ts
const configuredMaxInputTokens = getConfiguredModelTokenLimit(
  configuration,
  'maxInputTokens',
  key
);
const configuredMaxOutputTokens = getConfiguredModelTokenLimit(
  configuration,
  'maxOutputTokens',
  key
);
```

Add these properties to the returned `DisplayModelSetting` object:

```ts
maxInputTokens: isPositiveInteger(configuredMaxInputTokens)
  ? configuredMaxInputTokens
  : DEFAULT_MAX_INPUT_TOKENS[key],
maxOutputTokens: isPositiveInteger(configuredMaxOutputTokens)
  ? configuredMaxOutputTokens
  : DEFAULT_MAX_OUTPUT_TOKENS[key],
```

This legacy loader remains total and falls back on malformed values. The validated snapshot added below is the provider publication boundary and must reject malformed model settings.

- [ ] **Step 5: Run the loader test and verify it passes**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts -t "token limits"
```

Expected: both loader tests PASS with stable defaults and three distinct configured model limits.

- [ ] **Step 6: Add failing snapshot tests for every invalid input shape and invalid output limits**

Add these tests inside `describe('buildSettingsSnapshot', ...)`:

```ts
it.each([
  ['zero', 0],
  ['negative', -1],
  ['fractional', 1.5],
  ['non-finite', Number.POSITIVE_INFINITY],
  ['non-number', '128000']
])('degrades only the model with a %s max input token limit', (_label, invalidValue) => {
  const snapshot = buildSettingsSnapshot({
    get: (key: string) => {
      const values: Record<string, unknown> = {
        displayModels: ['daily', 'fallback'],
        'modelMappings.daily': 'combo/daily',
        'modelMappings.fallback': 'combo/fallback',
        'maxInputTokens.daily': invalidValue
      };

      return values[key];
    }
  } as never);

  expect(snapshot.state).toBe('degraded');
  expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['fallback']);
  expect(snapshot.rejectedModels).toContainEqual(
    expect.objectContaining({ key: 'daily', code: 'INVALID_MAX_INPUT_TOKENS' })
  );
  expect(snapshot.issues).toContainEqual(
    expect.objectContaining({
      scope: 'model',
      modelKey: 'daily',
      code: 'INVALID_MAX_INPUT_TOKENS',
      message: expect.stringContaining('9router-copilot.maxInputTokens.daily')
    })
  );
});

it('degrades only the model with an invalid max output token limit', () => {
  const snapshot = buildSettingsSnapshot({
    get: (key: string) => {
      const values: Record<string, unknown> = {
        displayModels: ['daily', 'fallback'],
        'modelMappings.daily': 'combo/daily',
        'modelMappings.fallback': 'combo/fallback',
        'maxOutputTokens.daily': 0
      };

      return values[key];
    }
  } as never);

  expect(snapshot.state).toBe('degraded');
  expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['fallback']);
  expect(snapshot.rejectedModels).toContainEqual(
    expect.objectContaining({ key: 'daily', code: 'INVALID_MAX_OUTPUT_TOKENS' })
  );
  expect(snapshot.issues).toContainEqual(
    expect.objectContaining({
      scope: 'model',
      modelKey: 'daily',
      code: 'INVALID_MAX_OUTPUT_TOKENS',
      message: expect.stringContaining('9router-copilot.maxOutputTokens.daily')
    })
  );
});
```

- [ ] **Step 7: Run the snapshot tests and verify they fail**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts -t "token limit"
```

Expected: FAIL because invalid limits are not rejected and the new issue codes do not exist.

- [ ] **Step 8: Add per-model issue codes and snapshot validation**

Extend `SettingsIssue['code']` in `src/config/settings.ts` with:

```ts
| 'INVALID_MAX_INPUT_TOKENS'
| 'INVALID_MAX_OUTPUT_TOKENS'
```

Extend `RejectedModelSetting['code']` to:

```ts
code:
  | 'INVALID_COMBO_MAPPING'
  | 'INVALID_THINKING_MODE'
  | 'INVALID_MAX_INPUT_TOKENS'
  | 'INVALID_MAX_OUTPUT_TOKENS';
```

Inside the `for (const key of validKeys)` loop in `buildSettingsSnapshot`, after thinking-mode validation and before constructing `setting`, add:

```ts
const maxInputTokens = getConfiguredModelTokenLimit(configuration, 'maxInputTokens', key);
if (!isPositiveInteger(maxInputTokens)) {
  const message = `Display model "${key}" must configure 9router-copilot.maxInputTokens.${key} as a positive integer.`;
  issues.push({
    scope: 'model',
    code: 'INVALID_MAX_INPUT_TOKENS',
    message,
    modelKey: key
  });
  rejectedModels.push({
    key,
    code: 'INVALID_MAX_INPUT_TOKENS',
    message
  });
  continue;
}

const maxOutputTokens = getConfiguredModelTokenLimit(configuration, 'maxOutputTokens', key);
if (!isPositiveInteger(maxOutputTokens)) {
  const message = `Display model "${key}" must configure 9router-copilot.maxOutputTokens.${key} as a positive integer.`;
  issues.push({
    scope: 'model',
    code: 'INVALID_MAX_OUTPUT_TOKENS',
    message,
    modelKey: key
  });
  rejectedModels.push({
    key,
    code: 'INVALID_MAX_OUTPUT_TOKENS',
    message
  });
  continue;
}
```

Add the validated values to the `setting: DisplayModelSetting` object:

```ts
maxInputTokens,
maxOutputTokens,
```

- [ ] **Step 9: Run the complete settings unit suite**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts
```

Expected: all settings tests PASS, including per-model degradation and existing runtime validation.

- [ ] **Step 10: Commit the settings boundary**

```bash
git add src/config/defaults.ts src/types/product-model.ts src/config/settings.ts test/unit/config/settings.test.ts
git commit -m "feat: validate per-model context window settings"
```

---

### Task 2: Publish and Refresh Native Context Window Metadata

**Files:**
- Modify: `test/unit/provider/model-catalog.test.ts`
- Modify: `test/integration/extension/settings-refresh.test.ts`
- Modify: `src/provider/model-catalog.ts`
- Modify: `test/unit/provider/request-adapter.test.ts`
- Modify: `test/unit/provider/tool-adapter.test.ts`
- Modify: `test/unit/provider/vision-proxy.test.ts`

**Interfaces:**
- Consumes: required validated `DisplayModelSetting.maxInputTokens` and `DisplayModelSetting.maxOutputTokens` from Task 1.
- Produces: `createPublishedModel(setting, options)` copies both values into `PublishedModel`.
- Preserves: `NineRouterChatProvider.refreshFromSnapshot(snapshot): void` and the existing provider change event.

- [ ] **Step 1: Complete model-catalog fixtures and add a failing metadata assertion**

In every `DisplayModelSetting` fixture in `test/unit/provider/model-catalog.test.ts`, add the approved defaults:

```ts
maxInputTokens: 128_000,
maxOutputTokens: 8_192,
```

Then add this test:

```ts
it('publishes configured input and output token limits', () => {
  const model = createPublishedModel({
    key: 'daily',
    label: 'Daily',
    comboId: 'combo/daily',
    enabled: true,
    toolMode: 'off',
    visionMode: 'off',
    thinkingMode: 'off',
    maxInputTokens: 64_000,
    maxOutputTokens: 4_096
  });

  expect(model).toMatchObject({
    maxInputTokens: 64_000,
    maxOutputTokens: 4_096
  });
});
```

- [ ] **Step 2: Run the catalog test and verify the new assertion fails**

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts -t "publishes configured input and output token limits"
```

Expected: FAIL because `createPublishedModel` still returns `128000` and `8192`.

- [ ] **Step 3: Publish the validated values instead of constants**

In `src/provider/model-catalog.ts`, replace:

```ts
maxInputTokens: 128_000,
maxOutputTokens: 8_192,
```

with:

```ts
maxInputTokens: setting.maxInputTokens,
maxOutputTokens: setting.maxOutputTokens,
```

- [ ] **Step 4: Run the complete model-catalog unit suite**

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts
```

Expected: all model-catalog tests PASS.

- [ ] **Step 5: Add a failing provider-refresh integration test**

Add this test inside `describe('NineRouterChatProvider snapshot refresh', ...)` in `test/integration/extension/settings-refresh.test.ts`:

```ts
it('refreshes published context window metadata from per-model settings', async () => {
  const createSnapshot = (maxInputTokens: number, maxOutputTokens: number) =>
    buildSettingsSnapshot({
      get: (key: string) => {
        const values: Record<string, unknown> = {
          displayModels: ['daily'],
          'modelMappings.daily': 'combo/daily',
          'maxInputTokens.daily': maxInputTokens,
          'maxOutputTokens.daily': maxOutputTokens
        };

        return values[key];
      }
    } as never);

  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => 'token' } } as never,
    {
      async *streamChatCompletion() {
        yield { type: 'response-complete' };
      }
    } as never,
    createSnapshot(32_000, 2_048)
  );

  const initialModels = await provider.provideLanguageModelChatInformation(
    {} as never,
    {} as never
  );
  expect(initialModels[0]).toMatchObject({
    maxInputTokens: 32_000,
    maxOutputTokens: 2_048
  });

  provider.refreshFromSnapshot(createSnapshot(64_000, 4_096));

  const refreshedModels = await provider.provideLanguageModelChatInformation(
    {} as never,
    {} as never
  );
  expect(refreshedModels[0]).toMatchObject({
    maxInputTokens: 64_000,
    maxOutputTokens: 4_096
  });
});
```

- [ ] **Step 6: Run the refresh integration test**

Run:

```bash
pnpm exec vitest run test/integration/extension/settings-refresh.test.ts -t "refreshes published context window metadata"
```

Expected: PASS because `buildSettingsSnapshot` and `createPublishedModel` now carry the configured values through the existing refresh path. If it fails, fix only the token-metadata propagation; do not add new refresh infrastructure.

- [ ] **Step 7: Update typed display-model fixtures in adapter tests**

Add these two fields to every object used as a `DisplayModelSetting` or `selectedModel` in the following files:

- `test/unit/provider/request-adapter.test.ts`
- `test/unit/provider/tool-adapter.test.ts`
- `test/unit/provider/vision-proxy.test.ts`

Use the stable defaults unless a test specifically exercises another limit:

```ts
maxInputTokens: 128_000,
maxOutputTokens: 8_192,
```

Do not add these fields to thinking-effort result objects or `PublishedModel` fixtures that already contain `maxInputTokens` and `maxOutputTokens`.

- [ ] **Step 8: Run type checking and focused provider tests**

Run:

```bash
pnpm run build
```

Expected: PASS with no missing `DisplayModelSetting` properties.

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/settings-refresh.test.ts
```

Expected: all selected unit and integration tests PASS.

- [ ] **Step 9: Commit model publication and fixture updates**

```bash
git add src/provider/model-catalog.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/settings-refresh.test.ts
git commit -m "feat: publish per-model context window metadata"
```

---

### Task 3: Contribute and Document the Six Settings

**Files:**
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`

**Interfaces:**
- Consumes: setting names `maxInputTokens.<model>` and `maxOutputTokens.<model>` from Task 1.
- Produces: six VS Code configuration properties with integer type, minimum `1`, and stable defaults.
- Produces: user documentation that distinguishes model capability metadata from request `maxTokens`.

- [ ] **Step 1: Add failing manifest and documentation guardrails**

Add these tests to `test/integration/extension/release-guardrails.test.ts`:

```ts
it('contributes per-model context window settings with stable defaults', () => {
  const properties = manifest.contributes.configuration.properties as Record<
    string,
    { type?: string; minimum?: number; default?: unknown }
  >;

  for (const modelKey of ['daily', 'agent', 'fallback'] as const) {
    expect(properties[`9router-copilot.maxInputTokens.${modelKey}`]).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 128_000
    });
    expect(properties[`9router-copilot.maxOutputTokens.${modelKey}`]).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 8_192
    });
  }
});

it('documents context window metadata separately from request max tokens', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(
    resolve(
      process.cwd(),
      'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
    ),
    'utf8'
  );

  for (const document of [readme, productionDesign]) {
    expect(document).toContain('9router-copilot.maxInputTokens.daily');
    expect(document).toContain('9router-copilot.maxOutputTokens.fallback');
    expect(document).toContain('9router-copilot.maxTokens');
    expect(document).toContain('independent');
  }
});
```

- [ ] **Step 2: Run the guardrails and verify they fail**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts -t "context window"
```

Expected: FAIL because the six manifest properties and documentation copy do not exist.

- [ ] **Step 3: Contribute all six integer settings in the manifest**

In `package.json`, insert these properties before the existing `9router-copilot.maxTokens` property:

```json
"9router-copilot.maxInputTokens.daily": {
  "type": "integer",
  "minimum": 1,
  "default": 128000,
  "description": "Maximum input tokens published for the Daily model in Copilot Chat."
},
"9router-copilot.maxInputTokens.agent": {
  "type": "integer",
  "minimum": 1,
  "default": 128000,
  "description": "Maximum input tokens published for the Agent model in Copilot Chat."
},
"9router-copilot.maxInputTokens.fallback": {
  "type": "integer",
  "minimum": 1,
  "default": 128000,
  "description": "Maximum input tokens published for the Fallback model in Copilot Chat."
},
"9router-copilot.maxOutputTokens.daily": {
  "type": "integer",
  "minimum": 1,
  "default": 8192,
  "description": "Maximum output tokens published for the Daily model in Copilot Chat."
},
"9router-copilot.maxOutputTokens.agent": {
  "type": "integer",
  "minimum": 1,
  "default": 8192,
  "description": "Maximum output tokens published for the Agent model in Copilot Chat."
},
"9router-copilot.maxOutputTokens.fallback": {
  "type": "integer",
  "minimum": 1,
  "default": 8192,
  "description": "Maximum output tokens published for the Fallback model in Copilot Chat."
},
```

Do not rename or change the existing global `9router-copilot.maxTokens` property.

- [ ] **Step 4: Update the README configuration example and behavior explanation**

In the `settings.json` example in `README.md`, add:

```json
"9router-copilot.maxInputTokens.daily": 128000,
"9router-copilot.maxInputTokens.agent": 128000,
"9router-copilot.maxInputTokens.fallback": 128000,
"9router-copilot.maxOutputTokens.daily": 8192,
"9router-copilot.maxOutputTokens.agent": 8192,
"9router-copilot.maxOutputTokens.fallback": 8192,
```

Add this subsection after the model-mapping explanation:

```markdown
### Context Window

Use `9router-copilot.maxInputTokens.<model>` and
`9router-copilot.maxOutputTokens.<model>` to publish each curated model's token
limits to VS Code. Copilot Chat consumes this metadata together with the
provider's token counter to render its native Context Window information.

These per-model capability values are independent from
`9router-copilot.maxTokens`. The global `maxTokens` setting remains the
requested `max_tokens` value sent to `9router` and does not override the
published Context Window metadata.
```

- [ ] **Step 5: Update the approved production design**

In the per-user settings list in `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`, add all six exact setting keys:

```markdown
- `9router-copilot.maxInputTokens.daily`
- `9router-copilot.maxInputTokens.agent`
- `9router-copilot.maxInputTokens.fallback`
- `9router-copilot.maxOutputTokens.daily`
- `9router-copilot.maxOutputTokens.agent`
- `9router-copilot.maxOutputTokens.fallback`
```

Add this subsection before the existing native thinking-effort section:

```markdown
### Native context window metadata

Every valid published model exposes its validated per-model
`maxInputTokens` and `maxOutputTokens` values through
`LanguageModelChatInformation`. VS Code combines this metadata with the
provider's token counting implementation to render native Context Window
information in Copilot Chat.

The per-model metadata is independent from `9router-copilot.maxTokens`. The
global setting continues to control the requested `max_tokens` field sent to
`9router`; context-window publication does not change request limits.
```

- [ ] **Step 6: Run release guardrails and verify they pass**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: all release guardrail tests PASS.

- [ ] **Step 7: Commit the public configuration contract and docs**

```bash
git add package.json README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: expose per-model context window configuration"
```

---

### Task 4: Run the Full Verification Gate

**Files:**
- Verify only; do not change implementation unless a command exposes a regression caused by Tasks 1-3.

**Interfaces:**
- Consumes: the complete per-model context-window implementation.
- Produces: build, lint, unit, integration, and package evidence required by `AGENTS.md`.

- [ ] **Step 1: Build the extension**

Run:

```bash
pnpm run build
```

Expected: TypeScript exits with code `0` and emits no diagnostics.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm run lint
```

Expected: ESLint exits with code `0` and reports no errors.

- [ ] **Step 3: Run all unit tests**

Run:

```bash
pnpm run test:unit
```

Expected: every unit test file passes with zero failures.

- [ ] **Step 4: Run all integration tests**

Run:

```bash
pnpm run test:integration
```

Expected: every integration test file passes with zero failures.

- [ ] **Step 5: Package the extension**

Run:

```bash
pnpm run package
```

Expected: VSCE exits with code `0` and produces `9router-copilot-chat-provider-0.1.0.vsix`.

- [ ] **Step 6: Confirm the worktree contains no accidental changes**

Run:

```bash
git status --short
```

Expected: no tracked source or documentation changes remain uncommitted. A generated VSIX may appear only if repository ignore rules do not already exclude it; do not commit the package artifact.
