# Copilot Thinking Effort Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent native `Thinking Effort` submenu to every published `Daily`, `Agent`, and `Fallback` model in Copilot Chat, with request-time selections overriding each model's local default.

**Architecture:** Add one pure provider compatibility module that owns the seven picker values, JSON schema construction, host-option validation, and effective-mode resolution. Model publication attaches the schema using each validated model's `thinkingMode` as its default; request handling creates a request-scoped model copy with the picker override and reuses the existing request adapter to apply the `9router` suffix.

**Tech Stack:** TypeScript 5, VS Code `LanguageModelChatProvider`, Vitest, pnpm, OpenAI-compatible `9router` chat-completions streaming.

## Global Constraints

- Keep `9router` as the single authority for routing, upstream provider selection, fallback, and provider-specific reasoning translation.
- Picker choices are exactly `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max`.
- Picker state is independent per published model.
- Resolution priority is valid `modelConfiguration.reasoningEffort`, valid compatibility `configuration.reasoningEffort`, then the validated local `thinkingMode`.
- Map picker `none` to internal `off`; all other values map directly.
- Invalid or missing host values fall back safely and never mutate the settings snapshot.
- Do not add proposed APIs to `enabledApiProposals`.
- Do not send provider-specific reasoning fields; continue using the `9router` model suffix contract.
- Do not render reasoning deltas.
- Preserve per-model degradation for invalid local configuration.
- Use narrow compatibility types without broad `any` casts.

---

## File Structure

- Create `src/types/vscode-chat-compat.ts`: narrow structural types for `configurationSchema`, `modelConfiguration`, and the legacy `configuration` option.
- Create `src/provider/thinking-effort.ts`: pure schema construction and request-option resolution.
- Create `test/unit/provider/thinking-effort.test.ts`: exhaustive picker schema and validation tests.
- Modify `src/types/product-model.ts`: allow published models to carry the narrow configuration schema.
- Modify `src/provider/model-catalog.ts`: centralize published-model construction and attach a per-model schema.
- Modify `src/config/settings.ts`: use the centralized publication function after existing validation.
- Modify `test/unit/provider/model-catalog.test.ts`: verify per-model schemas and independent defaults.
- Modify `test/unit/config/settings.test.ts`: verify snapshot publication exposes defaults derived from settings.
- Modify `src/provider/provider.ts`: resolve request-scoped effective thinking mode and report safe metadata.
- Modify `test/integration/extension/text-stream-roundtrip.test.ts`: verify picker overrides, `None`, and diagnostics.
- Modify `test/unit/router/sse-parser.test.ts`: assert reasoning-only deltas remain unexposed.
- Modify `README.md`: document native picker use and settings fallback.
- Modify `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`: record the native picker contract in the production design.
- Modify `test/integration/extension/release-guardrails.test.ts`: keep the documentation contract release-tested.

---

### Task 1: Publish a Native Per-Model Thinking Effort Schema

**Files:**

- Create: `src/types/vscode-chat-compat.ts`
- Create: `src/provider/thinking-effort.ts`
- Create: `test/unit/provider/thinking-effort.test.ts`
- Modify: `src/types/product-model.ts:1-30`
- Modify: `src/provider/model-catalog.ts:1-23`
- Modify: `src/config/settings.ts:183-253,343-359`
- Modify: `test/unit/provider/model-catalog.test.ts:1-31`
- Modify: `test/unit/config/settings.test.ts:95-240`

**Interfaces:**

- Produces: `ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`.
- Produces: `createThinkingEffortConfigurationSchema(defaultMode: ThinkingMode): LanguageModelConfigurationSchema`.
- Produces: `resolveEffectiveThinkingMode(options: unknown, configuredMode: ThinkingMode): EffectiveThinkingMode`.
- Produces: `createPublishedModel(setting: DisplayModelSetting): PublishedModel`.
- `EffectiveThinkingMode` contains `{ thinkingMode: ThinkingMode; source: 'modelConfiguration' | 'configuration' | 'settings' }`.

- [ ] **Step 1: Write failing unit tests for schema construction and option validation**

Create `test/unit/provider/thinking-effort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createThinkingEffortConfigurationSchema,
  resolveEffectiveThinkingMode
} from '../../../src/provider/thinking-effort';

describe('createThinkingEffortConfigurationSchema', () => {
  it('publishes all seven picker choices with the configured model default', () => {
    const schema = createThinkingEffortConfigurationSchema('xhigh');

    expect(schema.properties.reasoningEffort).toEqual({
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      enumItemLabels: ['None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'],
      enumDescriptions: [
        'Disable thinking for faster responses',
        'Use minimal reasoning effort',
        'Use low reasoning effort',
        'Use medium reasoning effort',
        'Use high reasoning effort',
        'Use extra-high reasoning effort',
        'Use maximum reasoning depth'
      ],
      default: 'xhigh',
      group: 'navigation'
    });
  });

  it('maps the local off default to the picker none value', () => {
    const schema = createThinkingEffortConfigurationSchema('off');

    expect(schema.properties.reasoningEffort.default).toBe('none');
  });
});

describe('resolveEffectiveThinkingMode', () => {
  it.each([
    ['none', 'off'],
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max']
  ] as const)('maps picker value %s to internal mode %s', (pickerValue, expectedMode) => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: pickerValue
          }
        },
        'low'
      )
    ).toEqual({
      thinkingMode: expectedMode,
      source: 'modelConfiguration'
    });
  });

  it('uses the compatibility configuration field when modelConfiguration is absent', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          configuration: {
            reasoningEffort: 'max'
          }
        },
        'low'
      )
    ).toEqual({
      thinkingMode: 'max',
      source: 'configuration'
    });
  });

  it('falls back to the validated local setting for malformed host values', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: 'turbo'
          },
          configuration: {
            reasoningEffort: 42
          }
        },
        'medium'
      )
    ).toEqual({
      thinkingMode: 'medium',
      source: 'settings'
    });
  });
});
```

- [ ] **Step 2: Run the new unit test and verify it fails**

Run:

```bash
pnpm exec vitest run test/unit/provider/thinking-effort.test.ts
```

Expected: FAIL because `src/provider/thinking-effort.ts` does not exist.

- [ ] **Step 3: Add narrow VS Code compatibility types**

Create `src/types/vscode-chat-compat.ts`:

```ts
import type * as vscode from 'vscode';

export interface LanguageModelConfigurationProperty {
  readonly type: 'string';
  readonly title: string;
  readonly enum: readonly string[];
  readonly enumItemLabels: readonly string[];
  readonly enumDescriptions?: readonly string[];
  readonly default: string;
  readonly group: 'navigation';
}

export interface LanguageModelConfigurationSchema {
  readonly properties: {
    readonly reasoningEffort: LanguageModelConfigurationProperty;
  };
}

export interface ModelConfigurationResponseOptions
  extends vscode.ProvideLanguageModelChatResponseOptions {
  readonly modelConfiguration?: Readonly<Record<string, unknown>>;
  readonly configuration?: Readonly<Record<string, unknown>>;
}
```

Update `src/types/product-model.ts` so `PublishedModel` structurally exposes the picker schema:

```ts
import type * as vscode from 'vscode';
import type { LanguageModelConfigurationSchema } from './vscode-chat-compat';

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

export interface PublishedModel extends vscode.LanguageModelChatInformation {
  vendor: '9router';
  family: 'daily' | 'agent' | 'fallback';
  configurationSchema?: LanguageModelConfigurationSchema;
}
```

- [ ] **Step 4: Implement the pure thinking-effort adapter**

Create `src/provider/thinking-effort.ts`:

```ts
import type { ThinkingMode } from '../types/product-model';
import type { LanguageModelConfigurationSchema } from '../types/vscode-chat-compat';

export const THINKING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];
export type ThinkingModeSource = 'modelConfiguration' | 'configuration' | 'settings';

export interface EffectiveThinkingMode {
  thinkingMode: ThinkingMode;
  source: ThinkingModeSource;
}

const THINKING_EFFORT_SET = new Set<string>(THINKING_EFFORTS);

export function createThinkingEffortConfigurationSchema(
  defaultMode: ThinkingMode
): LanguageModelConfigurationSchema {
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: THINKING_EFFORTS,
        enumItemLabels: ['None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'],
        enumDescriptions: [
          'Disable thinking for faster responses',
          'Use minimal reasoning effort',
          'Use low reasoning effort',
          'Use medium reasoning effort',
          'Use high reasoning effort',
          'Use extra-high reasoning effort',
          'Use maximum reasoning depth'
        ],
        default: defaultMode === 'off' ? 'none' : defaultMode,
        group: 'navigation'
      }
    }
  };
}

export function resolveEffectiveThinkingMode(
  options: unknown,
  configuredMode: ThinkingMode
): EffectiveThinkingMode {
  const modelConfigurationValue = readReasoningEffort(options, 'modelConfiguration');
  if (modelConfigurationValue) {
    return {
      thinkingMode: toThinkingMode(modelConfigurationValue),
      source: 'modelConfiguration'
    };
  }

  const compatibilityValue = readReasoningEffort(options, 'configuration');
  if (compatibilityValue) {
    return {
      thinkingMode: toThinkingMode(compatibilityValue),
      source: 'configuration'
    };
  }

  return {
    thinkingMode: configuredMode,
    source: 'settings'
  };
}

function readReasoningEffort(
  options: unknown,
  property: 'modelConfiguration' | 'configuration'
): ThinkingEffort | undefined {
  if (typeof options !== 'object' || options === null || !(property in options)) {
    return undefined;
  }

  const configuration = options[property];
  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('reasoningEffort' in configuration)
  ) {
    return undefined;
  }

  const value = configuration.reasoningEffort;
  return typeof value === 'string' && THINKING_EFFORT_SET.has(value)
    ? (value as ThinkingEffort)
    : undefined;
}

function toThinkingMode(effort: ThinkingEffort): ThinkingMode {
  return effort === 'none' ? 'off' : effort;
}
```

- [ ] **Step 5: Run the pure unit test and verify it passes**

Run:

```bash
pnpm exec vitest run test/unit/provider/thinking-effort.test.ts
```

Expected: PASS with 11 tests.

- [ ] **Step 6: Write failing publication tests for independent model defaults**

Extend `test/unit/provider/model-catalog.test.ts` with:

```ts
it('publishes an independent thinking effort schema for each model', () => {
  const models = resolvePublishedModels([
    {
      key: 'daily',
      label: 'Daily',
      comboId: 'combo/daily',
      enabled: true,
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off'
    },
    {
      key: 'agent',
      label: 'Agent',
      comboId: 'combo/agent',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'proxy',
      thinkingMode: 'max'
    }
  ]);

  expect(models[0]?.configurationSchema?.properties.reasoningEffort.default).toBe('none');
  expect(models[1]?.configurationSchema?.properties.reasoningEffort.default).toBe('max');
  expect(models[0]?.configurationSchema).not.toBe(models[1]?.configurationSchema);
});
```

Extend `test/unit/config/settings.test.ts` inside `describe('buildSettingsSnapshot')` with:

```ts
it('derives each published picker default from that model thinking setting', () => {
  const snapshot = buildSettingsSnapshot(
    {
      get: (key: string) => {
        const values: Record<string, unknown> = {
          displayModels: ['daily', 'agent'],
          'modelMappings.daily': 'combo/daily',
          'modelMappings.agent': 'combo/agent',
          'thinkingMode.daily': 'low',
          'thinkingMode.agent': 'xhigh'
        };

        return values[key];
      }
    } as never
  );

  expect(
    snapshot.publishedModels.map((model) => ({
      id: model.id,
      defaultEffort: model.configurationSchema?.properties.reasoningEffort.default
    }))
  ).toEqual([
    { id: 'daily', defaultEffort: 'low' },
    { id: 'agent', defaultEffort: 'xhigh' }
  ]);
});
```

- [ ] **Step 7: Run the publication tests and verify they fail**

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts test/unit/config/settings.test.ts
```

Expected: FAIL because published models do not yet contain `configurationSchema`.

- [ ] **Step 8: Centralize model publication and attach the schema**

Replace `src/provider/model-catalog.ts` with:

```ts
import { createThinkingEffortConfigurationSchema } from './thinking-effort';
import type { DisplayModelSetting, PublishedModel } from '../types/product-model';

export function createPublishedModel(setting: DisplayModelSetting): PublishedModel {
  const capabilities: PublishedModel['capabilities'] = {
    ...(setting.toolMode === 'auto' ? { toolCalling: 32 } : {}),
    ...(setting.visionMode === 'native' ? { imageInput: true } : {})
  };

  return {
    id: setting.key,
    name: setting.label,
    vendor: '9router',
    family: setting.key,
    version: '1',
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    capabilities,
    configurationSchema: createThinkingEffortConfigurationSchema(setting.thinkingMode)
  };
}

export function resolvePublishedModels(settings: DisplayModelSetting[]): PublishedModel[] {
  return settings
    .filter((setting) => setting.enabled && setting.comboId.trim().length > 0)
    .map(createPublishedModel);
}
```

In `src/config/settings.ts`, import the centralized function:

```ts
import { createPublishedModel } from '../provider/model-catalog';
```

Keep the existing call at model validation success:

```ts
displayModels.push(setting);
publishedModels.push(createPublishedModel(setting));
```

Delete the private `createPublishedModel` function from the bottom of `src/config/settings.ts`.

- [ ] **Step 9: Run all Task 1 tests**

Run:

```bash
pnpm exec vitest run test/unit/provider/thinking-effort.test.ts test/unit/provider/model-catalog.test.ts test/unit/config/settings.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run type-checking and lint for the compatibility boundary**

Run:

```bash
pnpm exec tsc -p tsconfig.json
pnpm exec eslint src/types/vscode-chat-compat.ts src/types/product-model.ts src/provider/thinking-effort.ts src/provider/model-catalog.ts src/config/settings.ts test/unit/provider/thinking-effort.test.ts test/unit/provider/model-catalog.test.ts test/unit/config/settings.test.ts
```

Expected: both commands exit 0 with no diagnostics.

- [ ] **Step 11: Commit Task 1**

```bash
git add src/types/vscode-chat-compat.ts src/types/product-model.ts src/provider/thinking-effort.ts src/provider/model-catalog.ts src/config/settings.ts test/unit/provider/thinking-effort.test.ts test/unit/provider/model-catalog.test.ts test/unit/config/settings.test.ts
git commit -m "feat: publish thinking effort picker schema"
```

---

### Task 2: Apply Picker Selections to Request-Scoped Router Models

**Files:**

- Modify: `src/provider/provider.ts:1-193`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts:1-112`
- Modify: `test/unit/router/sse-parser.test.ts`

**Interfaces:**

- Consumes: `resolveEffectiveThinkingMode(options: unknown, configuredMode: ThinkingMode): EffectiveThinkingMode`.
- Consumes: existing `adaptMessagesToRouterRequest` suffix behavior.
- Produces: safe request metadata fields `configuredThinkingMode`, `effectiveThinkingMode`, and `thinkingModeSource`.

- [ ] **Step 1: Write failing integration tests for picker override and None**

Replace the existing thinking-mode integration test in
`test/integration/extension/text-stream-roundtrip.test.ts` with:

```ts
it('lets the Copilot picker override the selected model thinking default', async () => {
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
    {
      modelConfiguration: {
        reasoningEffort: 'max'
      }
    } as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  expect(submittedModel).toBe('combo/daily(max)');
});

it('sends the base combo id when the Copilot picker selects None', async () => {
  __setConfigurationValues({
    displayModels: ['daily'],
    'modelMappings.daily': 'combo/daily',
    'thinkingMode.daily': 'high',
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
    [{ role: 1, content: 'Answer quickly' }] as never,
    {
      modelConfiguration: {
        reasoningEffort: 'none'
      }
    } as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  expect(submittedModel).toBe('combo/daily');
});
```

- [ ] **Step 2: Run the integration test and verify the override fails**

Run:

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: FAIL because the provider still uses only `selectedModel.thinkingMode`.

- [ ] **Step 3: Resolve a request-scoped selected model in the provider**

Import the resolver in `src/provider/provider.ts`:

```ts
import { resolveEffectiveThinkingMode } from './thinking-effort';
import type { ModelConfigurationResponseOptions } from '../types/vscode-chat-compat';
```

Narrow the provider method's response options parameter structurally:

```ts
options: ModelConfigurationResponseOptions,
```

Immediately after validating `selectedModel`, add:

```ts
const effectiveThinking = resolveEffectiveThinkingMode(options, selectedModel.thinkingMode);
const requestSelectedModel: DisplayModelSetting = {
  ...selectedModel,
  thinkingMode: effectiveThinking.thinkingMode
};
```

Use `requestSelectedModel` for vision preparation, request adaptation, and tool adaptation:

```ts
const visionResult = await prepareVisionCompatibleMessages({
  selectedModel: requestSelectedModel,
  messages: messages as readonly HostChatRequestMessage[]
});
```

```ts
const requestInput: Parameters<typeof adaptMessagesToRouterRequest>[0] = {
  selectedModel: requestSelectedModel,
  messages: visionResult.messages
};
```

```ts
const toolOptions = adaptToolOptionsForRouter({
  selectedModel: requestSelectedModel,
  tools: requestTools,
  hostToolMode: getRequestToolMode(options)
});
```

Replace the request-submission thinking metadata with:

```ts
logDebugEvent(this.snapshot.runtime.debugMode, 'Submitting request to 9router', {
  displayModel: selectedModel.key,
  comboId: selectedModel.comboId,
  configuredThinkingMode: selectedModel.thinkingMode,
  effectiveThinkingMode: effectiveThinking.thinkingMode,
  thinkingModeSource: effectiveThinking.source,
  baseUrl: this.snapshot.runtime.baseUrl,
  snapshotState: this.snapshot.state,
  issueCount: this.snapshot.issues.length
});
```

Keep error mapping based on the validated `selectedModel`, because combo mapping
errors and settings keys belong to the configured model rather than its
request-scoped copy.

- [ ] **Step 4: Run integration and existing adapter tests**

Run:

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/unit/provider/request-adapter.test.ts
```

Expected: PASS; existing suffix tests continue to prove the adapter contract.

- [ ] **Step 5: Write a failing diagnostics integration test**

Add `__getOutputLines` to the support imports in
`test/integration/extension/text-stream-roundtrip.test.ts`, then add:

```ts
it('logs configured and effective thinking metadata without dumping host configuration', async () => {
  __setConfigurationValues({
    displayModels: ['daily'],
    'modelMappings.daily': 'combo/daily',
    'thinkingMode.daily': 'low',
    baseUrl: 'https://router.example.com/v1',
    maxTokens: 128,
    requestTimeoutMs: 5000,
    debugMode: 'metadata'
  });

  const provider = new NineRouterChatProvider(
    {
      secrets: {
        get: async () => 'token'
      }
    } as never,
    {
      async *streamChatCompletion() {
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
    [{ role: 1, content: 'Think' }] as never,
    {
      modelConfiguration: {
        reasoningEffort: 'high',
        unrelatedSensitiveValue: 'do-not-log'
      }
    } as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  const submissionLine = __getOutputLines().find((line) =>
    line.startsWith('Submitting request to 9router')
  );

  expect(submissionLine).toContain('"configuredThinkingMode":"low"');
  expect(submissionLine).toContain('"effectiveThinkingMode":"high"');
  expect(submissionLine).toContain('"thinkingModeSource":"modelConfiguration"');
  expect(submissionLine).not.toContain('do-not-log');
});
```

- [ ] **Step 6: Run the diagnostics integration test**

Run:

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: PASS after Step 3 metadata changes.

- [ ] **Step 7: Add the reasoning-delta regression test at the SSE boundary**

Extend `test/unit/router/sse-parser.test.ts` with:

```ts
it('does not expose reasoning-only deltas as response events', () => {
  const events = parseSseChunk(
    'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n'
  );

  expect(events).toEqual([]);
});

it('emits visible content without exposing a sibling reasoning delta', () => {
  const events = parseSseChunk(
    'data: {"choices":[{"delta":{"content":"Visible","reasoning_content":"private reasoning"}}]}\n\n'
  );

  expect(events).toEqual([{ type: 'text-delta', text: 'Visible' }]);
});
```

Do not add `reasoning_content` to `RouterSsePayload`; unknown JSON properties are
intentionally ignored by the existing parser.

- [ ] **Step 8: Run all Task 2 tests**

Run:

```bash
pnpm exec vitest run test/unit/provider/thinking-effort.test.ts test/unit/provider/request-adapter.test.ts test/unit/router/sse-parser.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run build and lint for request integration**

Run:

```bash
pnpm run build
pnpm run lint
```

Expected: both commands exit 0.

- [ ] **Step 10: Commit Task 2**

```bash
git add src/provider/provider.ts test/integration/extension/text-stream-roundtrip.test.ts test/unit/router/sse-parser.test.ts
git commit -m "feat: apply Copilot thinking effort selections"
```

---

### Task 3: Document the Picker Contract and Run Release Verification

**Files:**

- Modify: `README.md:114-121`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md:191-213`
- Modify: `test/integration/extension/release-guardrails.test.ts:32-47`

**Interfaces:**

- Documents: local `thinkingMode.<model>` is the per-model default and fallback.
- Documents: the native Copilot picker independently overrides the selected model per request.
- Preserves: suffix mapping and `9router` ownership of provider-specific translation.

- [ ] **Step 1: Strengthen the release guardrail before changing docs**

Replace the documentation guardrail in
`test/integration/extension/release-guardrails.test.ts` with:

```ts
it('documents the native picker without moving reasoning policy into the extension', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(
    resolve(
      process.cwd(),
      'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
    ),
    'utf8'
  );

  expect(readme).toContain('Thinking Effort');
  expect(readme).toContain('None');
  expect(readme).toContain('XHigh');
  expect(readme).toContain('9router-copilot.thinkingMode.agent');
  expect(readme).toContain('default and fallback');
  expect(readme).toContain('base combo id');
  expect(productionDesign).toContain('configurationSchema');
  expect(productionDesign).toContain('modelConfiguration.reasoningEffort');
  expect(productionDesign).toContain('provider-specific reasoning translation');
  expect(productionDesign).toContain('Reasoning deltas remain hidden');
});
```

- [ ] **Step 2: Run the release guardrail and verify it fails**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because the current docs do not describe the native picker contract.

- [ ] **Step 3: Update the README user instructions**

Replace `README.md`'s `### Thinking Mode` section with:

```md
### Thinking Effort

Each published `Daily`, `Agent`, and `Fallback` model has its own **Thinking Effort** submenu in the Copilot Chat model picker:

- `None`: Send the base combo id unchanged.
- `Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`: Send the selected level through the `9router` model suffix contract.

The choice is stored independently for each model. For example, `Daily` can use `None` while `Agent` uses `Max`.

The `9router-copilot.thinkingMode.<model>` setting remains the per-model default and fallback when Copilot Chat does not provide a valid picker value. A picker selection overrides that default for the request.

Configure `modelMappings.<model>` with a base combo id such as `combo/agent`, not a suffixed value such as `combo/agent(high)`. The extension selects the requested level, while `9router` remains responsible for provider-specific reasoning translation and provider limits.

Reasoning deltas remain hidden; only normal response text and supported tool calls are displayed.
```

- [ ] **Step 4: Update the production design**

Add this subsection after the per-user thinking settings in
`docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`:

```md
### Native thinking effort picker

Every valid published model exposes a `configurationSchema` navigation property named `reasoningEffort`. Copilot Chat renders the property as an independent per-model **Thinking Effort** submenu with `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max`.

The validated `9router-copilot.thinkingMode.<model>` value supplies that model's schema default and request fallback. A valid `modelConfiguration.reasoningEffort` value overrides the local default for the current request; `none` maps to internal `off`, while the remaining values map directly.

The extension continues to express the effective level only through the `9router` model suffix. `9router` owns provider-specific reasoning translation and compatibility policy. Reasoning deltas remain hidden.
```

- [ ] **Step 5: Run documentation guardrails**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: document Copilot thinking effort picker"
```

- [ ] **Step 7: Run the full verification gate**

Run each command separately:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected:

- Build exits 0.
- Lint exits 0.
- All unit tests pass.
- All integration tests pass.
- Packaging exits 0 and produces `9router-copilot-chat-provider-0.1.0.vsix`.

- [ ] **Step 8: Inspect final repository state**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: clean worktree, with the three feature commits after the design and plan commits.
