# Dynamic Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `Daily`, `Agent`, and `Fallback` settings with one ordered array of arbitrary Copilot model ids, display names, and opaque `9router` `modelId` values, defaulting to one unpublished `agent` entry.

**Architecture:** Add a pure model-settings parser at the VS Code configuration boundary, then make the validated model object flow unchanged through snapshot creation, model publication, provider lookup, request adaptation, Vision proxying, and diagnostics. Keep the extension thin: the configured `modelId` is sent unchanged as OpenAI `request.model`; `9router` continues to own combo routing, fallback, quotas, and upstream execution.

**Tech Stack:** TypeScript 5.9 strict mode, VS Code Language Model API `^1.125.0`, OpenAI-compatible `/v1/chat/completions`, Vitest 4, pnpm, ESLint, `@vscode/vsce`

## Global Constraints

- Follow `AGENTS.md`, `CODE_CONVENTION.md`, and `docs/superpowers/specs/2026-07-17-dynamic-model-configuration-design.md`.
- This is an intentional breaking configuration change: do not read, merge, or migrate the old per-model settings.
- The final active extension contract must use `modelId`, `visionProxyModelId`, and `MODEL_MAPPING_ERROR`; do not retain active `comboId`, `visionProxyComboId`, or `COMBO_MAPPING_ERROR` names.
- `id` must match `[a-z0-9][a-z0-9._-]*` exactly; never lowercase, trim, or repair it.
- `name` and `modelId` are trimmed; `modelId` remains opaque and is never parsed into provider or routing policy.
- Preserve input-array order and reject every occurrence of a duplicated `id`.
- Keep capability defaults conservative for user-created entries: tools, Vision, and Thinking default to `off`; token limits default to `128000` input and `8192` output.
- The manifest default is exactly one `agent` object with `toolMode: "auto"`, `visionMode: "off"`, and empty `modelId`.
- Keep the API key in VS Code `SecretStorage`; never add secrets to model settings or diagnostics.
- Add no model-discovery request, migration command, separate UI, routing policy, fallback policy, or new dependency.
- Follow TDD for every behavior change: observe the focused test fail for the intended reason before editing production code.
- Preserve the user-defined worktree. Stage and commit only files named by the current task.

---

### Task 1: Add the pure dynamic-model parser and normalized types

**Files:**
- Create: `src/config/model-settings.ts`
- Create: `test/unit/config/model-settings.test.ts`
- Modify: `src/types/product-model.ts`
- Modify: `src/config/defaults.ts`

**Interfaces:**
- Consumes: raw `unknown` values read from `9router-copilot.models`
- Produces: `parseModelSettings(input: unknown): ParsedModelSettings`
- Produces: `ConfiguredModel`, `ModelSettingsIssue`, `RejectedModelSetting`, and `DEFAULT_MODELS`
- Preserves: the existing fixed-model exports until Task 2 cuts all consumers over in one compiling change

- [ ] **Step 1: Write failing parser tests**

Create `test/unit/config/model-settings.test.ts` with these concrete cases:

```ts
import { describe, expect, it } from 'vitest';
import { parseModelSettings } from '../../../src/config/model-settings';

describe('parseModelSettings', () => {
  it('parses arbitrary model ids in array order and applies conservative defaults', () => {
    const result = parseModelSettings([
      { id: 'coder', name: '  Coding Pro  ', modelId: '  router/coder  ' },
      {
        id: 'research-v2',
        name: 'Research',
        modelId: 'router/research',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        maxInputTokens: 64_000,
        maxOutputTokens: 4_096
      }
    ]);

    expect(result.models).toEqual([
      {
        sourceIndex: 0,
        id: 'coder',
        name: 'Coding Pro',
        modelId: 'router/coder',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        sourceIndex: 1,
        id: 'research-v2',
        name: 'Research',
        modelId: 'router/research',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        maxInputTokens: 64_000,
        maxOutputTokens: 4_096
      }
    ]);
    expect(result.rejectedModels).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('rejects every duplicate id while preserving unrelated models', () => {
    const result = parseModelSettings([
      { id: 'agent', name: 'First', modelId: 'router/first' },
      { id: 'coder', name: 'Coder', modelId: 'router/coder' },
      { id: 'agent', name: 'Second', modelId: 'router/second' }
    ]);

    expect(result.models.map((model) => model.id)).toEqual(['coder']);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, id: 'agent', code: 'DUPLICATE_MODEL_ID' }),
      expect.objectContaining({ sourceIndex: 2, id: 'agent', code: 'DUPLICATE_MODEL_ID' })
    ]);
  });

  it.each([
    ['uppercase id', { id: 'Agent', name: 'Agent', modelId: 'router/agent' }, 'INVALID_MODEL_ID'],
    ['trimmed id', { id: ' agent ', name: 'Agent', modelId: 'router/agent' }, 'INVALID_MODEL_ID'],
    ['empty name', { id: 'agent', name: '   ', modelId: 'router/agent' }, 'INVALID_MODEL_NAME'],
    ['empty model id', { id: 'agent', name: 'Agent', modelId: '   ' }, 'INVALID_MODEL_MAPPING'],
    ['unknown field', { id: 'agent', name: 'Agent', modelId: 'router/agent', typo: true }, 'UNKNOWN_MODEL_FIELD'],
    ['thinking suffix', { id: 'agent', name: 'Agent', modelId: 'router/agent(high)' }, 'INVALID_MODEL_MAPPING'],
    ['invalid tools', { id: 'agent', name: 'Agent', modelId: 'router/agent', toolMode: 'yes' }, 'INVALID_TOOL_MODE'],
    ['invalid vision', { id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'yes' }, 'INVALID_VISION_MODE'],
    ['invalid thinking', { id: 'agent', name: 'Agent', modelId: 'router/agent', thinkingMode: 'turbo' }, 'INVALID_THINKING_MODE'],
    ['invalid input tokens', { id: 'agent', name: 'Agent', modelId: 'router/agent', maxInputTokens: 0 }, 'INVALID_MAX_INPUT_TOKENS'],
    ['invalid output tokens', { id: 'agent', name: 'Agent', modelId: 'router/agent', maxOutputTokens: 1.5 }, 'INVALID_MAX_OUTPUT_TOKENS']
  ])('rejects %s with a field-scoped issue', (_label, model, code) => {
    const result = parseModelSettings([model]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([expect.objectContaining({ sourceIndex: 0, code })]);
    expect(result.issues).toEqual([expect.objectContaining({ scope: 'model', sourceIndex: 0, code })]);
  });

  it('rejects a non-array setting', () => {
    const result = parseModelSettings({ id: 'agent' });

    expect(result.models).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'INVALID_MODELS_SETTING', path: '9router-copilot.models' })
    ]);
  });

  it.each([[null], [[]], [new Date()]])('rejects a non-plain model entry', (entry) => {
    const result = parseModelSettings([entry]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, code: 'INVALID_MODEL_ENTRY' })
    ]);
  });
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/config/model-settings.test.ts
```

Expected: FAIL because `src/config/model-settings.ts` does not exist.

- [ ] **Step 3: Add the normalized model type and defaults**

Append the final dynamic type to `src/types/product-model.ts` while leaving the old fixed exports temporarily available for existing consumers:

```ts
export type ToolMode = 'auto' | 'off';
export type VisionMode = 'native' | 'proxy' | 'off';

export interface ConfiguredModel {
  sourceIndex: number;
  id: string;
  name: string;
  modelId: string;
  toolMode: ToolMode;
  visionMode: VisionMode;
  thinkingMode: ThinkingMode;
  maxInputTokens: number;
  maxOutputTokens: number;
}
```

Add these constants to `src/config/defaults.ts` without removing the old fixed constants until Task 2:

```ts
export const DEFAULT_MODEL_TOOL_MODE = 'off' as const;
export const DEFAULT_MODEL_VISION_MODE = 'off' as const;
export const DEFAULT_MODEL_THINKING_MODE = 'off' as const;
export const DEFAULT_MODEL_MAX_INPUT_TOKENS = 128_000;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_VISION_PROXY_MODEL_ID = '';

export const DEFAULT_MODELS = [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    maxInputTokens: DEFAULT_MODEL_MAX_INPUT_TOKENS,
    maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS
  }
] as const;
```

- [ ] **Step 4: Implement the pure parser**

Create `src/config/model-settings.ts` with this public contract and validation order:

```ts
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL_THINKING_MODE,
  DEFAULT_MODEL_TOOL_MODE,
  DEFAULT_MODEL_VISION_MODE
} from './defaults';
import { THINKING_MODES } from '../types/product-model';
import type {
  ConfiguredModel,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '../types/product-model';

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const THINKING_SUFFIX_PATTERN = new RegExp(`\\((?:${THINKING_MODES.join('|')})\\)$`, 'i');
const ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'modelId',
  'toolMode',
  'visionMode',
  'thinkingMode',
  'maxInputTokens',
  'maxOutputTokens'
]);
const TOOL_MODES = new Set<ToolMode>(['auto', 'off']);
const VISION_MODES = new Set<VisionMode>(['native', 'proxy', 'off']);
const THINKING_MODE_SET = new Set<string>(THINKING_MODES);

export type ModelSettingsIssueCode =
  | 'INVALID_MODELS_SETTING'
  | 'INVALID_MODEL_ENTRY'
  | 'UNKNOWN_MODEL_FIELD'
  | 'INVALID_MODEL_ID'
  | 'DUPLICATE_MODEL_ID'
  | 'INVALID_MODEL_NAME'
  | 'INVALID_MODEL_MAPPING'
  | 'INVALID_TOOL_MODE'
  | 'INVALID_VISION_MODE'
  | 'INVALID_THINKING_MODE'
  | 'INVALID_MAX_INPUT_TOKENS'
  | 'INVALID_MAX_OUTPUT_TOKENS';

export interface ModelSettingsIssue {
  scope: 'model';
  code: ModelSettingsIssueCode;
  message: string;
  path: string;
  sourceIndex?: number;
  displayModelId?: string;
}

export interface RejectedModelSetting {
  sourceIndex?: number;
  id?: string;
  code: ModelSettingsIssueCode;
  message: string;
  path: string;
}

export interface ParsedModelSettings {
  models: ConfiguredModel[];
  rejectedModels: RejectedModelSetting[];
  issues: ModelSettingsIssue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function countCandidateIds(input: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of input) {
    if (isPlainObject(item) && typeof item.id === 'string') {
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    }
  }
  return counts;
}

export function parseModelSettings(input: unknown): ParsedModelSettings {
  if (!Array.isArray(input)) {
    const issue: ModelSettingsIssue = {
      scope: 'model',
      code: 'INVALID_MODELS_SETTING',
      message: '9router-copilot.models must be an array of model objects.',
      path: '9router-copilot.models'
    };
    return {
      models: [],
      rejectedModels: [{ code: issue.code, message: issue.message, path: issue.path }],
      issues: [issue]
    };
  }

  const idCounts = countCandidateIds(input);
  const models: ConfiguredModel[] = [];
  const rejectedModels: RejectedModelSetting[] = [];
  const issues: ModelSettingsIssue[] = [];

  const reject = (
    sourceIndex: number,
    id: string | undefined,
    code: ModelSettingsIssueCode,
    field: string | undefined,
    message: string
  ): void => {
    const path = `9router-copilot.models[${sourceIndex}]${field ? `.${field}` : ''}`;
    rejectedModels.push({ sourceIndex, ...(id ? { id } : {}), code, message, path });
    issues.push({
      scope: 'model',
      sourceIndex,
      ...(id ? { displayModelId: id } : {}),
      code,
      message,
      path
    });
  };

  input.forEach((item, sourceIndex) => {
    if (!isPlainObject(item)) {
      reject(sourceIndex, undefined, 'INVALID_MODEL_ENTRY', undefined, 'Model entry must be an object.');
      return;
    }

    const id = typeof item.id === 'string' ? item.id : undefined;
    const unknownField = Object.keys(item).find((field) => !ALLOWED_FIELDS.has(field));
    if (unknownField) {
      reject(sourceIndex, id, 'UNKNOWN_MODEL_FIELD', unknownField, `Unsupported model field: ${unknownField}.`);
      return;
    }
    if (!id || !MODEL_ID_PATTERN.test(id)) {
      reject(sourceIndex, id, 'INVALID_MODEL_ID', 'id', 'Model id must match [a-z0-9][a-z0-9._-]*.');
      return;
    }
    if ((idCounts.get(id) ?? 0) > 1) {
      reject(sourceIndex, id, 'DUPLICATE_MODEL_ID', 'id', `Model id "${id}" is duplicated.`);
      return;
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      reject(sourceIndex, id, 'INVALID_MODEL_NAME', 'name', 'Model name must be a non-empty string.');
      return;
    }

    const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : '';
    if (!modelId || THINKING_SUFFIX_PATTERN.test(modelId)) {
      reject(sourceIndex, id, 'INVALID_MODEL_MAPPING', 'modelId', 'modelId must be a non-empty base 9router model id without a thinking suffix.');
      return;
    }

    const toolMode = item.toolMode ?? DEFAULT_MODEL_TOOL_MODE;
    if (typeof toolMode !== 'string' || !TOOL_MODES.has(toolMode as ToolMode)) {
      reject(sourceIndex, id, 'INVALID_TOOL_MODE', 'toolMode', 'toolMode must be auto or off.');
      return;
    }
    const visionMode = item.visionMode ?? DEFAULT_MODEL_VISION_MODE;
    if (typeof visionMode !== 'string' || !VISION_MODES.has(visionMode as VisionMode)) {
      reject(sourceIndex, id, 'INVALID_VISION_MODE', 'visionMode', 'visionMode must be native, proxy, or off.');
      return;
    }
    const thinkingMode = item.thinkingMode ?? DEFAULT_MODEL_THINKING_MODE;
    if (typeof thinkingMode !== 'string' || !THINKING_MODE_SET.has(thinkingMode)) {
      reject(sourceIndex, id, 'INVALID_THINKING_MODE', 'thinkingMode', 'thinkingMode is unsupported.');
      return;
    }
    const maxInputTokens = item.maxInputTokens ?? DEFAULT_MODEL_MAX_INPUT_TOKENS;
    if (!isPositiveInteger(maxInputTokens)) {
      reject(sourceIndex, id, 'INVALID_MAX_INPUT_TOKENS', 'maxInputTokens', 'maxInputTokens must be a positive integer.');
      return;
    }
    const maxOutputTokens = item.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
    if (!isPositiveInteger(maxOutputTokens)) {
      reject(sourceIndex, id, 'INVALID_MAX_OUTPUT_TOKENS', 'maxOutputTokens', 'maxOutputTokens must be a positive integer.');
      return;
    }

    models.push({
      sourceIndex,
      id,
      name,
      modelId,
      toolMode: toolMode as ToolMode,
      visionMode: visionMode as VisionMode,
      thinkingMode: thinkingMode as ThinkingMode,
      maxInputTokens,
      maxOutputTokens
    });
  });

  return { models, rejectedModels, issues };
}
```

- [ ] **Step 5: Run focused tests, type checking, and lint**

Run:

```bash
pnpm exec vitest run test/unit/config/model-settings.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands PASS with no TypeScript or ESLint diagnostics.

- [ ] **Step 6: Commit the parser foundation**

```bash
git add src/config/model-settings.ts src/types/product-model.ts src/config/defaults.ts test/unit/config/model-settings.test.ts
git commit -m "feat: validate dynamic model settings"
```

---

### Task 2: Cut the manifest and settings snapshot over to the dynamic array

**Files:**
- Modify: `package.json:42-260`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/types/product-model.ts`
- Modify: `src/provider/model-catalog.ts`
- Modify: `src/provider/provider.ts`
- Modify: `src/provider/request-adapter.ts`
- Modify: `src/provider/tool-adapter.ts`
- Modify: `src/provider/vision-proxy.ts`
- Modify: `src/debug/output-channel.ts`
- Modify: `test/unit/config/settings.test.ts`
- Modify: `test/unit/provider/model-catalog.test.ts`
- Modify: `test/unit/provider/request-adapter.test.ts`
- Modify: `test/unit/provider/tool-adapter.test.ts`
- Modify: `test/unit/provider/vision-proxy.test.ts`
- Modify: `test/unit/debug/output-channel.test.ts`
- Modify: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: `parseModelSettings`, `ConfiguredModel`, and `DEFAULT_MODELS` from Task 1
- Produces: `SettingsSnapshot.models: ConfiguredModel[]`
- Produces: `RuntimeSettings.visionProxyModelId: string`
- Produces: manifest settings `9router-copilot.models` and `9router-copilot.visionProxyModelId`
- Removes: all legacy per-model manifest properties and fixed-model types/default maps

- [ ] **Step 1: Strengthen the release guardrail and observe RED**

Delete the manifest tests named `does not contribute placeholder combo ids as
executable defaults`, `contributes per-model thinking settings with safe
defaults`, `contributes per-model context window settings with stable defaults`,
and `contributes one empty shared Vision proxy combo setting` from
`test/integration/extension/release-guardrails.test.ts`. Replace them with:

```ts
it('contributes one ordered dynamic model setting with a safe agent default', () => {
  const properties = manifest.contributes.configuration.properties as Record<string, unknown>;
  const models = properties['9router-copilot.models'] as {
    type: string;
    default: unknown[];
    items: { type: string; additionalProperties: boolean; required: string[] };
  };

  expect(models).toMatchObject({
    type: 'array',
    default: [
      {
        id: 'agent',
        name: 'Agent',
        modelId: '',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'modelId']
    }
  });
  expect(properties['9router-copilot.visionProxyModelId']).toMatchObject({
    type: 'string',
    default: ''
  });
});

it('does not contribute legacy fixed-model settings', () => {
  const properties = manifest.contributes.configuration.properties as Record<string, unknown>;
  const legacyKeys = [
    '9router-copilot.displayModels',
    '9router-copilot.labels.daily',
    '9router-copilot.modelMappings.agent',
    '9router-copilot.toolMode.agent',
    '9router-copilot.visionMode.agent',
    '9router-copilot.visionProxyComboId',
    '9router-copilot.thinkingMode.agent',
    '9router-copilot.maxInputTokens.agent',
    '9router-copilot.maxOutputTokens.agent'
  ];

  for (const key of legacyKeys) {
    expect(properties).not.toHaveProperty(key);
  }
});
```

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because the manifest still contributes fixed-model settings.

- [ ] **Step 2: Replace the manifest model schema**

Delete the old model-related properties from `package.json` and add this schema after `baseUrl`:

```json
"9router-copilot.models": {
  "type": "array",
  "default": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192
    }
  ],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["id", "name", "modelId"],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-z0-9][a-z0-9._-]*$",
        "description": "Stable Copilot-facing model id."
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "description": "Display name shown in the Copilot Chat model picker."
      },
      "modelId": {
        "type": "string",
        "description": "Opaque 9router model id sent in the OpenAI-compatible model field. Empty values stay unpublished."
      },
      "toolMode": { "type": "string", "enum": ["auto", "off"], "default": "off" },
      "visionMode": { "type": "string", "enum": ["native", "proxy", "off"], "default": "off" },
      "thinkingMode": {
        "type": "string",
        "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        "default": "off"
      },
      "maxInputTokens": { "type": "integer", "minimum": 1, "default": 128000 },
      "maxOutputTokens": { "type": "integer", "minimum": 1, "default": 8192 }
    }
  },
  "description": "Ordered curated models exposed in the Copilot Chat model picker."
},
"9router-copilot.visionProxyModelId": {
  "type": "string",
  "default": "",
  "description": "Opaque 9router model id used to summarize image-bearing messages for models configured with visionMode proxy."
}
```

- [ ] **Step 3: Rewrite snapshot tests for the new setting**

Replace fixed-key lookups in `test/unit/config/settings.test.ts` with raw `models` arrays. Add these core assertions before editing `settings.ts`:

```ts
it('defaults to one rejected agent until its modelId is configured', () => {
  const snapshot = buildSettingsSnapshot({ get: () => undefined } as never);

  expect(snapshot.state).toBe('empty');
  expect(snapshot.models).toEqual([]);
  expect(snapshot.publishedModels).toEqual([]);
  expect(snapshot.rejectedModels).toEqual([
    expect.objectContaining({ sourceIndex: 0, id: 'agent', code: 'INVALID_MODEL_MAPPING' })
  ]);
});

it('publishes arbitrary configured models in array order', () => {
  const snapshot = buildSettingsSnapshot({
    get: (key: string) =>
      key === 'models'
        ? [
            { id: 'research', name: 'Research', modelId: 'router/research' },
            { id: 'coder', name: 'Coder', modelId: 'router/coder', toolMode: 'auto' }
          ]
        : undefined
  } as never);

  expect(snapshot.models.map((model) => model.id)).toEqual(['research', 'coder']);
  expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['research', 'coder']);
});

it('loads and trims the shared Vision proxy model id', () => {
  const runtime = loadRuntimeSettings({
    get: (key: string) => (key === 'visionProxyModelId' ? '  router/vision  ' : undefined)
  } as never);

  expect(runtime.visionProxyModelId).toBe('router/vision');
});
```

Convert the remaining settings tests with this exact behavior mapping:

```text
Old loadDisplayModelSettings tests
  -> remove; Task 1 parser tests own raw model loading and per-field defaults

Thinking defaults and picker defaults
  -> models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder', thinkingMode: 'xhigh' }]
  -> expect snapshot.models[0].thinkingMode and published configurationSchema default to be xhigh

Configured context limits
  -> put maxInputTokens and maxOutputTokens on each model object
  -> expect both snapshot.models and publishedModels to preserve the numbers

Invalid runtime settings
  -> keep baseUrl/requestTimeoutMs inputs and add one valid models array
  -> expect invalid-runtime and no published models

Invalid thinking/token/model mapping
  -> put the invalid value on one object beside one valid object
  -> expect only the valid object published and the rejected sourceIndex/path reported

Thinking suffix
  -> modelId: 'router/coder(high)'
  -> expect INVALID_MODEL_MAPPING at 9router-copilot.models[0].modelId

Vision proxy capability
  -> set visionMode: 'proxy' on the model object
  -> read shared configuration only from visionProxyModelId
```

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts
```

Expected: FAIL because `SettingsSnapshot.models` and `visionProxyModelId` do not exist.

- [ ] **Step 4: Cut settings and model publication over to dynamic models**

Make these exact type changes:

```ts
// src/types/product-model.ts
export interface PublishedModel extends vscode.LanguageModelChatInformation {
  vendor: '9router';
  family: string;
  configurationSchema?: LanguageModelConfigurationSchema;
}
```

Remove `PRODUCT_MODEL_KEYS`, `ProductModelKey`, and `DisplayModelSetting`. Keep
`THINKING_MODES`, `ThinkingMode`, `ToolMode`, `VisionMode`, and
`ConfiguredModel`.

In `src/config/defaults.ts`, remove `DEFAULT_DISPLAY_MODELS`,
`DEFAULT_MODEL_LABELS`, `DEFAULT_MODEL_MAPPINGS`, the per-key token/mode maps,
and `DEFAULT_VISION_PROXY_COMBO_ID`. Keep the scalar defaults and
`DEFAULT_MODELS` from Task 1.

Reshape `src/config/settings.ts` around the parser:

```ts
import { parseModelSettings } from './model-settings';
import { DEFAULT_MODELS, DEFAULT_VISION_PROXY_MODEL_ID } from './defaults';
import { createPublishedModel } from '../provider/model-catalog';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';
import type { ModelSettingsIssue, RejectedModelSetting } from './model-settings';

export interface RuntimeSettings {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
  visionProxyModelId: string;
}

export type SettingsIssue =
  | ModelSettingsIssue
  | {
      scope: 'runtime' | 'capability';
      code:
        | 'INVALID_BASE_URL'
        | 'INVALID_REQUEST_TIMEOUT'
        | 'INVALID_MAX_TOKENS'
        | 'MISSING_VISION_PROXY_MODEL';
      message: string;
      path?: string;
    };

export interface SettingsSnapshot {
  state: 'valid' | 'degraded' | 'empty' | 'invalid-runtime';
  runtime: RuntimeSettings | undefined;
  models: ConfiguredModel[];
  publishedModels: PublishedModel[];
  rejectedModels: RejectedModelSetting[];
  issues: SettingsIssue[];
}
```

Replace `loadDisplayModelSettings` and the fixed-key loop in
`buildSettingsSnapshot` with:

```ts
const rawModels = configuration.get<unknown>('models') ?? DEFAULT_MODELS;
const parsedModels = parseModelSettings(rawModels);
const visionProxyModelId =
  configuration.get<string>('visionProxyModelId')?.trim() ?? DEFAULT_VISION_PROXY_MODEL_ID;
const issues: SettingsIssue[] = [...parsedModels.issues];
const runtime = validateRuntimeSettings(configuration, issues);
const publishedModels = parsedModels.models.map((model) =>
  createPublishedModel(model, { visionProxyConfigured: visionProxyModelId.length > 0 })
);

if (
  visionProxyModelId.length === 0 &&
  parsedModels.models.some((model) => model.visionMode === 'proxy')
) {
  issues.push({
    scope: 'capability',
    code: 'MISSING_VISION_PROXY_MODEL',
    message:
      'Proxy Vision is disabled until 9router-copilot.visionProxyModelId references an existing 9router model.',
    path: '9router-copilot.visionProxyModelId'
  });
}
```

Every snapshot return uses `models: parsedModels.models` and
`rejectedModels: parsedModels.rejectedModels`. `validateRuntimeSettings` and
`loadRuntimeSettings` read and return `visionProxyModelId`.

Update `src/provider/model-catalog.ts` to consume `ConfiguredModel` and publish
without a second filtering layer:

```ts
export function createPublishedModel(
  model: ConfiguredModel,
  options: PublishedModelOptions = {}
): PublishedModel {
  const exposesImageInput =
    model.visionMode === 'native' ||
    (model.visionMode === 'proxy' && options.visionProxyConfigured === true);

  return {
    id: model.id,
    name: model.name,
    vendor: '9router',
    family: model.id,
    version: '1',
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: {
      ...(model.toolMode === 'auto' ? { toolCalling: 32 } : {}),
      ...(exposesImageInput ? { imageInput: true } : {})
    },
    configurationSchema: createThinkingEffortConfigurationSchema(model.thinkingMode)
  };
}

export function resolvePublishedModels(
  models: ConfiguredModel[],
  options: PublishedModelOptions = {}
): PublishedModel[] {
  return models.map((model) => createPublishedModel(model, options));
}
```

- [ ] **Step 5: Rename normalized model fields across provider adapters**

Apply this exact source mapping in the named files; do not touch historical
specs or plans:

```text
src/provider/provider.ts
  DisplayModelSetting -> ConfiguredModel
  snapshot.displayModels -> snapshot.models
  setting.key / selectedModel.key -> setting.id / selectedModel.id
  selectedModel.comboId -> selectedModel.modelId
  runtime.visionProxyComboId -> runtime.visionProxyModelId
  VisionProxyInput.visionProxyComboId -> VisionProxyInput.visionProxyModelId

src/provider/request-adapter.ts
  DisplayModelSetting -> ConfiguredModel
  selectedModel.comboId -> selectedModel.modelId

src/provider/tool-adapter.ts
  DisplayModelSetting -> ConfiguredModel
  selectedModel.key -> selectedModel.id

src/provider/vision-proxy.ts
  DisplayModelSetting -> ConfiguredModel
  selectedModel.key -> selectedModel.id
  comboId parameters/locals -> modelId
  visionProxyComboId -> visionProxyModelId
  request.model receives modelId

src/debug/output-channel.ts
  snapshot.displayModels -> snapshot.models
  model.key -> model.id
  runtime.visionProxyComboId -> runtime.visionProxyModelId
```

At this step, leave `COMBO_MAPPING_ERROR` itself for Task 3, but all data fields
and setting paths must already use `modelId` and `visionProxyModelId`.

- [ ] **Step 6: Update focused unit fixtures and verify GREEN**

In the six unit-test files named by this task, replace model fixtures with this
shape, varying only values relevant to each test:

```ts
const model = {
  sourceIndex: 0,
  id: 'coder',
  name: 'Coder',
  modelId: 'router/coder',
  toolMode: 'auto',
  visionMode: 'off',
  thinkingMode: 'off',
  maxInputTokens: 128_000,
  maxOutputTokens: 8_192
} as const;
```

Update diagnostic expectations to use `models`, arbitrary ids, and
`visionProxyConfigured`; remove expectations for `key`, `label`, `enabled`, or
`comboId`.

Run:

```bash
pnpm exec vitest run test/unit/config/model-settings.test.ts test/unit/config/settings.test.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/unit/debug/output-channel.test.ts test/integration/extension/release-guardrails.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the dynamic configuration cutover**

```bash
git add package.json src/config/defaults.ts src/config/settings.ts src/types/product-model.ts src/provider/model-catalog.ts src/provider/provider.ts src/provider/request-adapter.ts src/provider/tool-adapter.ts src/provider/vision-proxy.ts src/debug/output-channel.ts test/unit/config/settings.test.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/unit/debug/output-channel.test.ts test/integration/extension/release-guardrails.test.ts
git commit -m "feat: configure arbitrary display models"
```

---

### Task 3: Rename missing-backend classification and safe mapping diagnostics

**Files:**
- Modify: `src/types/error.ts`
- Modify: `src/router/client.ts`
- Modify: `src/provider/provider.ts`
- Modify: `src/provider/vision-proxy.ts`
- Modify: `test/unit/router/client.test.ts`
- Modify: `test/unit/provider/vision-proxy.test.ts`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`

**Interfaces:**
- Consumes: `ConfiguredModel.sourceIndex`, `ConfiguredModel.id`, and `ConfiguredModel.modelId`
- Produces: stable `MODEL_MAPPING_ERROR` transport classification
- Produces: safe settings paths `9router-copilot.models[index].modelId` and `9router-copilot.visionProxyModelId`

- [ ] **Step 1: Change tests to the approved error terminology and observe RED**

In `test/unit/router/client.test.ts`, replace the explicit missing-combo case with:

```ts
it('classifies an explicit missing model 404 as a model mapping error', async () => {
  const client = createRouterClient({
    fetch: vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'x-request-id': 'req-missing-model' }),
      text: async () => '{"error":{"message":"Model router/missing not found"}}'
    }) as never
  });

  const consume = async (): Promise<void> => {
    for await (const event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'router/missing', messages: [], stream: true },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      void event;
    }
  };

  await expect(consume()).rejects.toMatchObject({
    code: 'MODEL_MAPPING_ERROR',
    requestId: 'req-missing-model'
  });
});
```

In the provider/roundtrip tests, assert the selected model error contains:

```ts
expect(error).toMatchObject({
  code: 'CONFIGURATION_ERROR',
  details: {
    displayModel: 'coder',
    modelId: 'router/missing',
    settingsKey: '9router-copilot.models[1].modelId'
  }
});
```

For Vision proxy mapping errors, assert:

```ts
expect(error).toMatchObject({
  code: 'CONFIGURATION_ERROR',
  details: {
    phase: 'vision-proxy',
    settingsKey: '9router-copilot.visionProxyModelId'
  }
});
```

Run:

```bash
pnpm exec vitest run test/unit/router/client.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: FAIL because production still emits `COMBO_MAPPING_ERROR` or old settings metadata.

- [ ] **Step 2: Rename the stable error code and provider mapping**

Replace `'COMBO_MAPPING_ERROR'` with `'MODEL_MAPPING_ERROR'` in
`src/types/error.ts` and `src/router/client.ts`.

Replace the provider mapping helpers with:

```ts
function mapProviderError(error: unknown, selectedModel: ConfiguredModel): NineRouterError {
  if (!(error instanceof NineRouterError) || error.code !== 'MODEL_MAPPING_ERROR') {
    if (error instanceof NineRouterError) {
      return error;
    }
    throw error;
  }

  const settingsKey = `9router-copilot.models[${selectedModel.sourceIndex}].modelId`;
  return new NineRouterError(
    'CONFIGURATION_ERROR',
    `9router model mapping for display model "${selectedModel.id}" was not found. Update ${settingsKey}.`,
    {
      ...(error.requestId ? { requestId: error.requestId } : {}),
      details: {
        ...(typeof error.details?.status === 'number' ? { status: error.details.status } : {}),
        displayModel: selectedModel.id,
        modelId: selectedModel.modelId,
        settingsKey
      }
    }
  );
}
```

In `src/provider/vision-proxy.ts`, map `MODEL_MAPPING_ERROR` to a
`CONFIGURATION_ERROR` whose safe details include only:

```ts
{
  phase: 'vision-proxy',
  settingsKey: '9router-copilot.visionProxyModelId'
}
```

The message must be:

```text
The configured 9router Vision proxy model was not found. Update 9router-copilot.visionProxyModelId to a valid model id.
```

- [ ] **Step 3: Verify focused error and redaction tests**

Run:

```bash
pnpm exec vitest run test/unit/router/client.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/unit/debug/redaction.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands PASS; mapped provider errors may preserve numeric `status`
but never preserve `responseText` or another raw router error-body field.

- [ ] **Step 4: Prove active source terminology is clean**

Run:

```bash
rg -n -g '!**/release-guardrails.test.ts' "comboId|visionProxyComboId|COMBO_MAPPING_ERROR" src test package.json
```

Expected: no matches. The release guardrail is excluded because it intentionally
names forbidden legacy keys to prove they are absent from the manifest.

- [ ] **Step 5: Commit the model-mapping terminology**

```bash
git add src/types/error.ts src/router/client.ts src/provider/provider.ts src/provider/vision-proxy.ts test/unit/router/client.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/text-stream-roundtrip.test.ts
git commit -m "refactor: use model mapping terminology"
```

---

### Task 4: Refresh, round-trip, diagnostics, and regression integration coverage

**Files:**
- Modify: `test/integration/extension/settings-refresh.test.ts`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`
- Modify: `test/integration/extension/timeout-cancellation.test.ts`
- Modify: `test/integration/extension/diagnostics-command.test.ts`
- Modify: `test/unit/debug/output-channel.test.ts`

**Interfaces:**
- Consumes: dynamic `SettingsSnapshot.models` and namespace-level refresh wiring
- Produces: regression evidence for arbitrary ids across picker, request, diagnostics, tools, Vision, Thinking, usage, timeout, and cancellation

- [ ] **Step 1: Add a failing picker refresh test for add/remove/rename/reorder**

Replace the fixed `daily`/`fallback` refresh setup in
`test/integration/extension/settings-refresh.test.ts` with:

```ts
const createSnapshot = (models: unknown[]) =>
  buildSettingsSnapshot({
    get: (key: string) => (key === 'models' ? models : undefined)
  } as never);

const provider = new NineRouterChatProvider(context, routerClient, createSnapshot([
  { id: 'research', name: 'Research', modelId: 'router/research' },
  { id: 'coder', name: 'Coder', modelId: 'router/coder' }
]));

expect((await provider.provideLanguageModelChatInformation({} as never, {} as never)).map(
  ({ id, name }) => ({ id, name })
)).toEqual([
  { id: 'research', name: 'Research' },
  { id: 'coder', name: 'Coder' }
]);

provider.refreshFromSnapshot(createSnapshot([
  { id: 'coder', name: 'Coding Pro', modelId: 'router/coder' },
  { id: 'fast', name: 'Fast', modelId: 'router/fast' }
]));

expect((await provider.provideLanguageModelChatInformation({} as never, {} as never)).map(
  ({ id, name }) => ({ id, name })
)).toEqual([
  { id: 'coder', name: 'Coding Pro' },
  { id: 'fast', name: 'Fast' }
]);
```

Run:

```bash
pnpm exec vitest run test/integration/extension/settings-refresh.test.ts
```

Expected: FAIL until every old fixture and assertion in the file uses the new
`models` contract.

- [ ] **Step 2: Convert all integration fixtures to model arrays**

For every `buildSettingsSnapshot` mock in the files named by this task, return a
`models` array instead of fixed per-key settings. Use this baseline and override
only fields relevant to the test:

```ts
const configuredModels = [
  {
    id: 'coder',
    name: 'Coder',
    modelId: 'router/coder',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192
  }
];
```

Update request assertions to expect `request.model === 'router/coder'`. Update
published model assertions to expect `id === 'coder'`, `name === 'Coder'`, and
`family === 'coder'`. Update diagnostics to expect model ids and
`visionProxyConfigured` without prompt bodies, API keys, or raw response text.

- [ ] **Step 3: Add model-scoped degradation coverage**

Add this case to `test/integration/extension/diagnostics-command.test.ts`:

```ts
const snapshot = buildSettingsSnapshot({
  get: (key: string) =>
    key === 'models'
      ? [
          { id: 'broken', name: 'Broken', modelId: '' },
          { id: 'coder', name: 'Coder', modelId: 'router/coder' }
        ]
      : undefined
} as never);

expect(snapshot.state).toBe('degraded');
expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['coder']);
expect(formatSettingsSnapshotDiagnostics(snapshot)).toEqual(
  expect.arrayContaining([
    expect.stringContaining('Published models: coder'),
    expect.stringContaining('INVALID_MODEL_MAPPING')
  ])
);
```

- [ ] **Step 4: Run integration and focused unit coverage**

Run:

```bash
pnpm exec vitest run test/integration/extension/settings-refresh.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts test/integration/extension/diagnostics-command.test.ts test/unit/debug/output-channel.test.ts
```

Expected: all commands PASS, including existing tool, Vision, Thinking Effort,
usage, timeout, and cancellation assertions after fixture conversion.

- [ ] **Step 5: Commit dynamic-model integration coverage**

```bash
git add test/integration/extension/settings-refresh.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts test/integration/extension/diagnostics-command.test.ts test/unit/debug/output-channel.test.ts
git commit -m "test: cover dynamic model workflows"
```

---

### Task 5: Align active documentation and repository guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Modify: `AGENTS.md`
- Modify: `CODE_CONVENTION.md`
- Modify: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: the implemented manifest contract from Task 2
- Produces: one canonical user-facing configuration example and architecture guidance that permits user-defined curated model ids
- Preserves: historical feature-specific specs and plans as historical records

- [ ] **Step 1: Add failing documentation guardrails**

Delete the documentation tests named `documents context window metadata
separately from request max tokens`, `documents the native picker without
moving reasoning policy into the extension`, and `documents the shared
fail-closed 9router Vision proxy`. Replace them with:

```ts
it('documents the breaking dynamic model contract without legacy settings', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(
    resolve(
      process.cwd(),
      'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
    ),
    'utf8'
  );
  const agentGuidance = await readFile(resolve(process.cwd(), 'AGENTS.md'), 'utf8');
  const convention = await readFile(resolve(process.cwd(), 'CODE_CONVENTION.md'), 'utf8');

  for (const document of [readme, productionDesign, agentGuidance, convention]) {
    expect(document).toContain('user-defined curated');
  }
  expect(readme).toContain('9router-copilot.models');
  expect(readme).toContain('"modelId"');
  expect(readme).toContain('9router-copilot.visionProxyModelId');
  expect(readme).toContain('Breaking configuration change');
  expect(readme).toContain('toolMode');
  expect(readme).toContain('visionMode');
  expect(readme).toContain('thinkingMode');
  expect(readme).toContain('maxInputTokens');
  expect(readme).toContain('maxOutputTokens');
  expect(readme).toContain('reasoning_effort');
  expect(readme).toContain('fail-closed');
  expect(readme).toContain('stream_options.include_usage');
  expect(readme).not.toContain('9router-copilot.displayModels');
  expect(readme).not.toContain('9router-copilot.modelMappings.');
});
```

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because the active docs still describe fixed models.

- [ ] **Step 2: Rewrite the README configuration contract**

Replace the fixed `Product Models`, configuration example, model mapping,
Context Window, Tool Mode, Vision Mode, Thinking Effort, and troubleshooting
copy with the implemented array contract. The primary example must be exactly:

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:3456/v1",
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "replace-with-existing-9router-model-id",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192
    }
  ],
  "9router-copilot.visionProxyModelId": "",
  "9router-copilot.maxTokens": 4096,
  "9router-copilot.requestTimeoutMs": 60000,
  "9router-copilot.debugMode": "minimal"
}
```

Add a `### Breaking configuration change` subsection that explicitly says the
old fixed settings are not read or migrated and users must create model objects
manually.

- [ ] **Step 3: Update canonical architecture and conventions**

Make these exact policy changes:

```text
Production design:
  Replace the fixed Daily/Agent/Fallback product model list with an ordered
  user-defined curated model array.
  Define id, name, and modelId separately.
  Replace per-model setting lists with 9router-copilot.models.
  Replace visionProxyComboId with visionProxyModelId.
  Keep modelId opaque and 9router-owned routing unchanged.

AGENTS.md:
  Replace "Current product model: Daily, Agent, Fallback" with guidance that
  users define curated model ids/names locally and map each to a modelId.
  Replace every fixed per-model setting rule with the array-object contract.

CODE_CONVENTION.md:
  Replace "Primary product names: Daily, Agent, Fallback" with the rule that
  user-defined curated names are allowed and must remain separate from backend
  modelId values.
```

Do not rewrite historical feature specs or historical plans.

- [ ] **Step 4: Run documentation guardrails and terminology checks**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
rg -n "9router-copilot\.(displayModels|modelMappings|labels\.|toolMode\.|visionMode\.|thinkingMode\.|maxInputTokens\.|maxOutputTokens\.|visionProxyComboId)" README.md AGENTS.md CODE_CONVENTION.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
```

Expected: guardrail PASS and `rg` returns no matches in active documentation.

- [ ] **Step 5: Commit active documentation and guidance**

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md AGENTS.md CODE_CONVENTION.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: document dynamic model configuration"
```

---

### Task 6: Run the complete release gate and inspect the final diff

**Files:**
- Verify: all files changed by Tasks 1-5
- Generated artifact: `9router-copilot-chat-provider-0.1.0.vsix` (ignored or intentionally unstaged)

**Interfaces:**
- Consumes: the complete dynamic-model implementation
- Produces: fresh release-gate evidence and a clean intentional diff

- [ ] **Step 1: Run build and lint**

```bash
pnpm run build
pnpm run lint
```

Expected: both commands exit `0` with no TypeScript or ESLint errors.

- [ ] **Step 2: Run the complete test suites**

```bash
pnpm run test:unit
pnpm run test:integration
```

Expected: both suites exit `0`; no skipped dynamic-model regression remains.

- [ ] **Step 3: Build and inspect the VSIX**

```bash
pnpm run package
pnpm exec vsce ls --no-dependencies
```

Expected: package exits `0`; the VSIX contains compiled extension files,
manifest, README, and license while excluding `src/**`, `test/**`, `docs/**`,
`AGENTS.md`, and `CODE_CONVENTION.md`.

- [ ] **Step 4: Run final active-contract searches**

```bash
rg -n -g '!**/release-guardrails.test.ts' "comboId|visionProxyComboId|COMBO_MAPPING_ERROR" src test package.json README.md AGENTS.md CODE_CONVENTION.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
rg -n -g '!**/release-guardrails.test.ts' "9router-copilot\.(displayModels|modelMappings|labels\.|toolMode\.|visionMode\.|thinkingMode\.|maxInputTokens\.|maxOutputTokens\.)" src test package.json README.md AGENTS.md CODE_CONVENTION.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
```

Expected: both commands return no matches. Historical specs/plans are excluded
from these searches intentionally.

- [ ] **Step 5: Inspect status and diff quality**

```bash
git status --short
git diff --check
git diff --stat HEAD~5..HEAD
git log --oneline -6
```

Expected: no whitespace errors; only intentional dynamic-model changes and the
ignored/untracked VSIX artifact are present; the task commits are narrowly
scoped and ordered.
