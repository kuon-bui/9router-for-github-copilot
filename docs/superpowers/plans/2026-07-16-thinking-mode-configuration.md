# Thinking Mode Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add validated per-display-model thinking configuration and send the selected level to `9router` through its model-name suffix contract.

**Architecture:** Extend the curated display-model configuration with a typed `thinkingMode`, validate it while building the settings snapshot, and keep failures isolated to the affected model. The request adapter converts a valid non-`off` mode into `<combo-id>(<level>)`; provider-specific reasoning translation remains entirely inside `9router`.

**Tech Stack:** TypeScript 5.6, VS Code Language Model API, Vitest 4, ESLint 10, pnpm, VS Code extension manifest JSON.

## Global Constraints

- Preserve the thin provider adapter architecture.
- Keep `9router` as the single routing and provider-compatibility authority.
- Configure thinking independently for `daily`, `agent`, and `fallback`.
- Accepted values are exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Default all three display models to `off`.
- Reject only the model with an invalid thinking value or a combo mapping that already contains a recognized thinking suffix.
- Do not send `thinking`, `reasoning`, `reasoning_effort`, or provider-specific token-budget fields.
- Do not change cancellation, tools, vision, response streaming, or reasoning-delta rendering.
- Follow TDD: observe each new behavior test fail before implementing it.
- Before completion, run `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, and `pnpm run package`.

## File Structure

- Modify `src/types/product-model.ts` to own the accepted thinking-mode values, `ThinkingMode` type, and required `DisplayModelSetting.thinkingMode`.
- Modify `src/config/defaults.ts` to own per-display-model thinking defaults.
- Modify `src/config/settings.ts` to load, validate, diagnose, and degrade thinking configuration.
- Modify `src/provider/request-adapter.ts` to resolve the effective suffixed router model name.
- Modify `src/provider/provider.ts` to include the selected thinking mode in safe request metadata.
- Modify `src/debug/output-channel.ts` to expose validated thinking modes in settings diagnostics.
- Modify `package.json` to contribute the three VS Code settings.
- Modify `README.md` and `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md` to document the setting and ownership boundary.
- Modify focused unit and integration tests under `test/`; do not modify `src/provider/stream-adapter.ts`.

---

### Task 1: Add the typed configuration model and per-model validation

**Files:**

- Modify: `src/types/product-model.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/settings.ts`
- Test: `test/unit/config/settings.test.ts`
- Modify fixtures: `test/unit/provider/model-catalog.test.ts`
- Modify fixtures: `test/unit/provider/request-adapter.test.ts`
- Modify fixtures: `test/unit/provider/tool-adapter.test.ts`
- Modify fixtures: `test/unit/provider/vision-proxy.test.ts`

**Interfaces:**

- Produces: `THINKING_MODES`
- Produces: `ThinkingMode`
- Produces: `DEFAULT_THINKING_MODES: Record<ProductModelKey, ThinkingMode>`
- Produces: required `DisplayModelSetting.thinkingMode: ThinkingMode`
- Produces: `SettingsIssue.code` and `RejectedModelSetting.code` support for `INVALID_THINKING_MODE`
- Consumes: existing `ProductModelKey`, `DisplayModelSetting`, and settings snapshot publication flow

- [ ] **Step 1: Write failing settings tests**

Add these cases to `test/unit/config/settings.test.ts`:

```typescript
it('loads a thinking mode for each curated display model', () => {
  const configuration = {
    get: (key: string) => {
      if (key === 'displayModels') {
        return ['daily', 'agent'];
      }

      if (key === 'modelMappings.daily') {
        return 'combo/daily';
      }

      if (key === 'modelMappings.agent') {
        return 'combo/agent';
      }

      if (key === 'thinkingMode.agent') {
        return 'high';
      }

      return undefined;
    }
  };

  expect(
    loadDisplayModelSettings(configuration as never).map(({ key, thinkingMode }) => ({
      key,
      thinkingMode
    }))
  ).toEqual([
    { key: 'daily', thinkingMode: 'off' },
    { key: 'agent', thinkingMode: 'high' }
  ]);
});

it('degrades only the model with an unsupported thinking mode', () => {
  const configuration = {
    get: (key: string) => {
      if (key === 'displayModels') {
        return ['daily', 'agent'];
      }

      if (key === 'modelMappings.daily') {
        return 'combo/daily';
      }

      if (key === 'modelMappings.agent') {
        return 'combo/agent';
      }

      if (key === 'thinkingMode.agent') {
        return 'turbo';
      }

      return undefined;
    }
  };

  const snapshot = buildSettingsSnapshot(configuration as never);

  expect(snapshot.state).toBe('degraded');
  expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['daily']);
  expect(snapshot.rejectedModels).toEqual([
    expect.objectContaining({ key: 'agent', code: 'INVALID_THINKING_MODE' })
  ]);
  expect(snapshot.issues).toEqual([
    expect.objectContaining({
      modelKey: 'agent',
      code: 'INVALID_THINKING_MODE',
      message: expect.stringContaining('9router-copilot.thinkingMode.agent')
    })
  ]);
});

it('rejects a combo mapping that already contains a thinking suffix', () => {
  const configuration = {
    get: (key: string) => {
      if (key === 'displayModels') {
        return ['daily'];
      }

      if (key === 'modelMappings.daily') {
        return 'combo/daily(high)';
      }

      return undefined;
    }
  };

  const snapshot = buildSettingsSnapshot(configuration as never);

  expect(snapshot.state).toBe('empty');
  expect(snapshot.rejectedModels).toEqual([
    expect.objectContaining({
      key: 'daily',
      code: 'INVALID_COMBO_MAPPING',
      message: expect.stringContaining('9router-copilot.thinkingMode.daily')
    })
  ]);
});
```

- [ ] **Step 2: Run the settings tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts
```

Expected: FAIL because loaded models do not expose `thinkingMode`, invalid thinking values are accepted, and suffixed combo mappings are published.

- [ ] **Step 3: Add the thinking type and defaults**

Update `src/types/product-model.ts`:

```typescript
export const PRODUCT_MODEL_KEYS = ['daily', 'agent', 'fallback'] as const;
export const THINKING_MODES = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export type ProductModelKey = (typeof PRODUCT_MODEL_KEYS)[number];
export type ThinkingMode = (typeof THINKING_MODES)[number];

export interface DisplayModelSetting {
  key: ProductModelKey;
  label: string;
  comboId: string;
  enabled: boolean;
  toolMode: 'auto' | 'off';
  visionMode: 'native' | 'proxy' | 'off';
  thinkingMode: ThinkingMode;
}
```

Update the type import and add this default to `src/config/defaults.ts`:

```typescript
import type { ProductModelKey, ThinkingMode } from '../types/product-model';

export const DEFAULT_THINKING_MODES: Record<ProductModelKey, ThinkingMode> = {
  daily: 'off',
  agent: 'off',
  fallback: 'off'
};
```

- [ ] **Step 4: Implement strict thinking validation and suffix-conflict detection**

Update imports and constants in `src/config/settings.ts`:

```typescript
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEBUG_MODE,
  DEFAULT_DISPLAY_MODELS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_LABELS,
  DEFAULT_MODEL_MAPPINGS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_THINKING_MODES,
  DEFAULT_TOOL_MODES,
  DEFAULT_VISION_MODES
} from './defaults';
import { PRODUCT_MODEL_KEYS, THINKING_MODES } from '../types/product-model';
import type {
  DisplayModelSetting,
  ProductModelKey,
  PublishedModel,
  ThinkingMode
} from '../types/product-model';

const THINKING_MODE_SET = new Set<string>(THINKING_MODES);
const THINKING_SUFFIX_PATTERN = new RegExp(`\\((?:${THINKING_MODES.join('|')})\\)$`, 'i');
```

Expand the issue and rejection unions:

```typescript
export interface SettingsIssue {
  scope: 'runtime' | 'model';
  code:
    | 'INVALID_BASE_URL'
    | 'INVALID_REQUEST_TIMEOUT'
    | 'INVALID_MAX_TOKENS'
    | 'INVALID_DISPLAY_MODEL_KEY'
    | 'INVALID_COMBO_MAPPING'
    | 'INVALID_THINKING_MODE';
  message: string;
  modelKey?: string;
}

export interface RejectedModelSetting {
  key: string;
  code: 'INVALID_COMBO_MAPPING' | 'INVALID_THINKING_MODE';
  message: string;
}
```

Add focused helpers:

```typescript
function getConfiguredThinkingMode(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  key: ProductModelKey
): unknown {
  const configured = configuration.get<unknown>(`thinkingMode.${key}`);
  return configured === undefined ? DEFAULT_THINKING_MODES[key] : configured;
}

function isThinkingMode(value: unknown): value is ThinkingMode {
  return typeof value === 'string' && THINKING_MODE_SET.has(value);
}

function hasThinkingSuffix(comboId: string): boolean {
  return THINKING_SUFFIX_PATTERN.test(comboId);
}
```

Add `thinkingMode` to `loadDisplayModelSettings`; invalid values fall back only in this non-validating convenience loader:

```typescript
return configuredKeys.map((key) => {
  const configuredThinkingMode = getConfiguredThinkingMode(configuration, key);

  return {
    key,
    label: configuration.get<string>(`labels.${key}`)?.trim() || DEFAULT_MODEL_LABELS[key],
    comboId: configuration.get<string>(`modelMappings.${key}`)?.trim() || DEFAULT_MODEL_MAPPINGS[key],
    enabled: true,
    toolMode: configuration.get<'auto' | 'off'>(`toolMode.${key}`) ?? DEFAULT_TOOL_MODES[key],
    visionMode:
      configuration.get<'native' | 'proxy' | 'off'>(`visionMode.${key}`) ??
      DEFAULT_VISION_MODES[key],
    thinkingMode: isThinkingMode(configuredThinkingMode)
      ? configuredThinkingMode
      : DEFAULT_THINKING_MODES[key]
  };
});
```

In the `buildSettingsSnapshot` model loop, validate before constructing `DisplayModelSetting`:

```typescript
const comboId = configuration.get<string>(`modelMappings.${key}`)?.trim() || '';

if (comboId.length === 0) {
  const message = `Display model "${key}" is missing a valid 9router combo mapping.`;
  issues.push({
    scope: 'model',
    code: 'INVALID_COMBO_MAPPING',
    message,
    modelKey: key
  });
  rejectedModels.push({
    key,
    code: 'INVALID_COMBO_MAPPING',
    message
  });
  continue;
}

if (hasThinkingSuffix(comboId)) {
  const message = `Display model "${key}" must use a base combo id without a thinking suffix. Remove the suffix from 9router-copilot.modelMappings.${key} and configure 9router-copilot.thinkingMode.${key}.`;
  issues.push({
    scope: 'model',
    code: 'INVALID_COMBO_MAPPING',
    message,
    modelKey: key
  });
  rejectedModels.push({
    key,
    code: 'INVALID_COMBO_MAPPING',
    message
  });
  continue;
}

const configuredThinkingMode = getConfiguredThinkingMode(configuration, key);
if (!isThinkingMode(configuredThinkingMode)) {
  const message = `Display model "${key}" has an unsupported thinking mode. Update 9router-copilot.thinkingMode.${key} to off, minimal, low, medium, high, xhigh, or max.`;
  issues.push({
    scope: 'model',
    code: 'INVALID_THINKING_MODE',
    message,
    modelKey: key
  });
  rejectedModels.push({
    key,
    code: 'INVALID_THINKING_MODE',
    message
  });
  continue;
}

const setting: DisplayModelSetting = {
  key,
  label: configuration.get<string>(`labels.${key}`)?.trim() || DEFAULT_MODEL_LABELS[key],
  comboId,
  enabled: true,
  toolMode: configuration.get<'auto' | 'off'>(`toolMode.${key}`) ?? DEFAULT_TOOL_MODES[key],
  visionMode:
    configuration.get<'native' | 'proxy' | 'off'>(`visionMode.${key}`) ??
    DEFAULT_VISION_MODES[key],
  thinkingMode: configuredThinkingMode
};
```

- [ ] **Step 5: Update existing model-setting fixtures**

Add this property to every existing `DisplayModelSetting` literal in:

- `test/unit/provider/model-catalog.test.ts`
- `test/unit/provider/request-adapter.test.ts`
- `test/unit/provider/tool-adapter.test.ts`
- `test/unit/provider/vision-proxy.test.ts`

Use the neutral value unless a later test explicitly covers thinking:

```typescript
thinkingMode: 'off'
```

- [ ] **Step 6: Run focused and full unit tests**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/unit/provider
```

Expected: PASS with zero failed tests.

- [ ] **Step 7: Commit the typed configuration boundary**

```bash
git add src/types/product-model.ts src/config/defaults.ts src/config/settings.ts test/unit/config/settings.test.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/vision-proxy.test.ts
git commit -m "feat: add thinking mode configuration"
```

---

### Task 2: Apply thinking mode to requests and diagnostics

**Files:**

- Modify: `src/provider/request-adapter.ts`
- Modify: `src/provider/provider.ts`
- Modify: `src/debug/output-channel.ts`
- Test: `test/unit/provider/request-adapter.test.ts`
- Test: `test/unit/debug/output-channel.test.ts`
- Test: `test/integration/extension/text-stream-roundtrip.test.ts`

**Interfaces:**

- Consumes: `DisplayModelSetting.thinkingMode`
- Produces: router request `model` equal to the base combo id for `off`
- Produces: router request `model` equal to `<combo-id>(<thinking-mode>)` for enabled levels
- Produces: settings diagnostics line `Thinking modes: <model>=<mode>`

- [ ] **Step 1: Write failing request-adapter tests**

Keep the existing base-combo test explicit by adding `thinkingMode: 'off'`, then add:

```typescript
it('appends the configured thinking mode to the router model name', () => {
  const request = adaptMessagesToRouterRequest({
    selectedModel: {
      key: 'agent',
      label: 'Agent',
      comboId: 'combo/agent',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'high'
    },
    messages: [{ role: 1, content: 'Solve this carefully' }]
  });

  expect(request.model).toBe('combo/agent(high)');
});
```

- [ ] **Step 2: Write failing diagnostics and integration tests**

In `test/unit/debug/output-channel.test.ts`, add a configured thinking mode for `daily` and assert:

```typescript
if (key === 'thinkingMode.daily') {
  return 'high';
}
```

```typescript
expect(lines).toContain('Thinking modes: daily=high');
```

In `test/integration/extension/text-stream-roundtrip.test.ts`, add:

```typescript
it('sends the selected display model thinking mode to 9router', async () => {
  __setConfigurationValues({
    displayModels: ['daily'],
    'modelMappings.daily': 'combo/daily',
    'thinkingMode.daily': 'xhigh',
    baseUrl: 'https://router.example.com/v1',
    maxTokens: 128,
    requestTimeoutMs: 5000,
    debugMode: 'minimal'
  });

  let submittedModel: string | undefined;
  const provider = new NineRouterChatProvider(
    {
      secrets: {
        get: async () => 'token'
      }
    } as never,
    {
      async *streamChatCompletion(input: { request: { model: string } }) {
        submittedModel = input.request.model;
        yield { type: 'response-complete' };
      }
    } as never
  );

  await provider.provideLanguageModelChatResponse(
    {
      id: 'daily',
      name: 'Daily',
      vendor: '9router',
      family: 'daily',
      version: '1',
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      capabilities: {}
    },
    [{ role: 1, content: 'Think deeply' }] as never,
    {} as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  expect(submittedModel).toBe('combo/daily(xhigh)');
});
```

- [ ] **Step 3: Run the new behavior tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts test/unit/debug/output-channel.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: FAIL because the request still contains the unsuffixed combo id and diagnostics do not include thinking modes.

- [ ] **Step 4: Implement request model resolution**

Add this focused helper in `src/provider/request-adapter.ts`:

```typescript
function resolveRouterModelName(selectedModel: DisplayModelSetting): string {
  if (selectedModel.thinkingMode === 'off') {
    return selectedModel.comboId;
  }

  return `${selectedModel.comboId}(${selectedModel.thinkingMode})`;
}
```

Use it in `adaptMessagesToRouterRequest`:

```typescript
const request: RouterChatCompletionRequest = {
  model: resolveRouterModelName(input.selectedModel),
  stream: true,
  messages
};
```

- [ ] **Step 5: Add safe thinking metadata to provider diagnostics**

Update the request-submission metadata in `src/provider/provider.ts`:

```typescript
logDebugEvent(this.snapshot.runtime.debugMode, 'Submitting request to 9router', {
  displayModel: selectedModel.key,
  comboId: selectedModel.comboId,
  thinkingMode: selectedModel.thinkingMode,
  baseUrl: this.snapshot.runtime.baseUrl,
  snapshotState: this.snapshot.state,
  issueCount: this.snapshot.issues.length
});
```

Update `formatSettingsSnapshotDiagnostics` in `src/debug/output-channel.ts`:

```typescript
const thinkingModes =
  snapshot.displayModels.map((model) => `${model.key}=${model.thinkingMode}`).join(', ') || 'none';
```

Return the additional line:

```typescript
return [
  `Snapshot state: ${snapshot.state}`,
  runtimeLine,
  `Published models: ${publishedModels}`,
  `Thinking modes: ${thinkingModes}`,
  `Rejected models: ${rejectedModels}`,
  `Issues: ${issues}`
];
```

- [ ] **Step 6: Run focused request and diagnostics tests**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts test/unit/debug/output-channel.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 7: Commit request mapping and diagnostics**

```bash
git add src/provider/request-adapter.ts src/provider/provider.ts src/debug/output-channel.ts test/unit/provider/request-adapter.test.ts test/unit/debug/output-channel.test.ts test/integration/extension/text-stream-roundtrip.test.ts
git commit -m "feat: forward thinking mode to 9router"
```

---

### Task 3: Contribute VS Code settings and document the behavior

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**

- Consumes: accepted `ThinkingMode` values and per-model defaults from Task 1
- Produces: public settings `9router-copilot.thinkingMode.daily`, `.agent`, and `.fallback`
- Produces: user guidance that combo mappings contain base ids and `9router` owns reasoning translation

- [ ] **Step 1: Write failing manifest and documentation guardrails**

Add to `test/integration/extension/release-guardrails.test.ts`:

```typescript
it('contributes per-model thinking settings with safe defaults', () => {
  const properties = manifest.contributes.configuration.properties as Record<
    string,
    { default?: unknown; enum?: unknown[] }
  >;
  const acceptedModes = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  for (const modelKey of ['daily', 'agent', 'fallback'] as const) {
    const setting = properties[`9router-copilot.thinkingMode.${modelKey}`];
    expect(setting).toMatchObject({
      default: 'off',
      enum: acceptedModes
    });
  }
});

it('documents thinking configuration without moving reasoning policy into the extension', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(
    resolve(
      process.cwd(),
      'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
    ),
    'utf8'
  );

  expect(readme).toContain('### Thinking Mode');
  expect(readme).toContain('9router-copilot.thinkingMode.agent');
  expect(readme).toContain('base combo id');
  expect(productionDesign).toContain('9router-copilot.thinkingMode.daily');
  expect(productionDesign).toContain('provider-specific reasoning translation');
});
```

- [ ] **Step 2: Run release guardrails and verify RED**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because the manifest and documentation do not contain thinking settings.

- [ ] **Step 3: Add the three manifest settings**

Add these properties to `package.json` after the `visionMode` settings:

```json
"9router-copilot.thinkingMode.daily": {
  "type": "string",
  "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "default": "off",
  "description": "Thinking level for Daily. Non-off values are forwarded through the 9router model suffix contract."
},
"9router-copilot.thinkingMode.agent": {
  "type": "string",
  "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "default": "off",
  "description": "Thinking level for Agent. Non-off values are forwarded through the 9router model suffix contract."
},
"9router-copilot.thinkingMode.fallback": {
  "type": "string",
  "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "default": "off",
  "description": "Thinking level for Fallback. Non-off values are forwarded through the 9router model suffix contract."
},
```

- [ ] **Step 4: Update README configuration and troubleshooting**

Add these entries to the example settings:

```json
"9router-copilot.thinkingMode.daily": "off",
"9router-copilot.thinkingMode.agent": "high",
"9router-copilot.thinkingMode.fallback": "off",
```

Add this section after Vision Mode:

```markdown
### Thinking Mode

`thinkingMode` controls the reasoning effort requested for each display model.

- `off`: Send the base combo id unchanged.
- `minimal`, `low`, `medium`, `high`, `xhigh`, `max`: Send the level through the `9router` model suffix contract.

Configure `modelMappings.<model>` with a base combo id such as `combo/agent`, not a suffixed value such as `combo/agent(high)`. The extension selects the requested level, while `9router` remains responsible for provider-specific reasoning translation and provider limits.
```

Add these diagnostics bullets:

```markdown
- Invalid thinking mode: select `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- Suffixed combo mapping: remove the `(level)` suffix from `modelMappings.<model>` and set `thinkingMode.<model>` instead.
```

- [ ] **Step 5: Update the production design**

Add the three keys to the per-user settings list:

```markdown
- `9router-copilot.thinkingMode.daily`
- `9router-copilot.thinkingMode.agent`
- `9router-copilot.thinkingMode.fallback`
```

Add this behavior under the model execution contract:

```markdown
Thinking preferences are configured per curated display model. The extension appends a validated non-`off` level to the resolved combo id using the `model(level)` contract. `9router` owns provider-specific reasoning translation, normalization, limits, and upstream compatibility.
```

- [ ] **Step 6: Run release guardrails**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 7: Commit settings and documentation**

```bash
git add package.json README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: expose thinking mode settings"
```

---

### Task 4: Run the full verification gate

**Files:**

- Verify: all source, tests, configuration, documentation, and packaging changes

**Interfaces:**

- Consumes: completed Tasks 1-3
- Produces: fresh evidence that the extension builds, lints, tests, and packages successfully

- [ ] **Step 1: Run the TypeScript build**

Run:

```bash
pnpm run build
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm run lint
```

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Run unit tests**

Run:

```bash
pnpm run test:unit
```

Expected: exit code 0 with zero failed unit tests.

- [ ] **Step 4: Run integration tests**

Run:

```bash
pnpm run test:integration
```

Expected: exit code 0 with zero failed integration tests.

- [ ] **Step 5: Build the VSIX package**

Run:

```bash
pnpm run package
```

Expected: exit code 0 and a generated `.vsix` package.

- [ ] **Step 6: Inspect the final diff and status**

Run:

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors and no uncommitted source, test, configuration, or documentation changes.
