# Per-Model Thinking Efforts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each curated model define ordered supported thinking efforts, publish only those native picker choices, and reject or fall back safely when configuration is invalid or stale.

**Architecture:** Validate `thinkingEfforts` beside existing model settings and store normalized values on `ConfiguredModel`. Build each published model's `configurationSchema` from that allowlist, omit schema for an empty list, and validate host-selected effort against selected model before existing request adapter sets `reasoning_effort`.

**Tech Stack:** TypeScript strict mode, VS Code Language Model Chat provider compatibility types, Vitest, pnpm.

## Global Constraints

- Preserve thin-provider adapter architecture and native Copilot Chat UI.
- Keep configured opaque `modelId` unchanged; `9router` remains routing and provider-compatibility authority.
- Accepted configured efforts are exactly `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- `None` is host-only, always maps to internal `off`, and is prepended only when picker exists.
- Missing or empty `thinkingEfforts` means `off` only and omits `configurationSchema`.
- Non-`off` `thinkingMode` must appear in `thinkingEfforts`; invalid entry rejects only affected model.
- Stale or invalid host selection falls back to selected model's validated `thinkingMode`.
- No new dependencies, backend discovery, custom UI, routing logic, or `RouterChatCompletionRequest` changes.
- Follow test-first development and run full repository verification gate.

---

### Task 1: Validate Per-Model Effort Configuration

**Files:**
- Modify: `src/types/product-model.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/model-settings.ts`
- Test: `test/unit/config/model-settings.test.ts`
- Test: `test/unit/config/settings.test.ts`
- Fixture update: `test/unit/debug/output-channel.test.ts`
- Fixture update: `test/unit/provider/model-catalog.test.ts`
- Fixture update: `test/unit/provider/request-adapter.test.ts`
- Fixture update: `test/unit/provider/tool-adapter.test.ts`
- Fixture update: `test/unit/provider/vision-proxy.test.ts`
- Fixture update: `test/integration/extension/text-stream-roundtrip.test.ts`

**Interfaces:**
- Consumes: existing `ThinkingMode`, `parseModelSettings(input: unknown): ParsedModelSettings`.
- Produces: `ENABLED_THINKING_MODES`, `EnabledThinkingMode`, and required `ConfiguredModel.thinkingEfforts: EnabledThinkingMode[]`.
- Produces: model issue code `INVALID_THINKING_EFFORTS` with field path `9router-copilot.models[index].thinkingEfforts`.

- [ ] **Step 1: Write failing parser tests**

In `test/unit/config/model-settings.test.ts`, update valid expected models to include normalized effort lists and add focused cases:

```typescript
it('preserves ordered enabled thinking efforts', () => {
  const result = parseModelSettings([
    {
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      thinkingMode: 'medium',
      thinkingEfforts: ['high', 'minimal', 'medium']
    }
  ]);

  expect(result.models[0]).toMatchObject({
    thinkingMode: 'medium',
    thinkingEfforts: ['high', 'minimal', 'medium']
  });
});

it.each([
  ['null', null],
  ['non-array', 'high'],
  ['unsupported value', ['turbo']],
  ['non-string value', ['low', 42]],
  ['duplicate value', ['low', 'low']]
])('rejects %s thinkingEfforts', (_label, thinkingEfforts) => {
  const result = parseModelSettings([
    { id: 'agent', name: 'Agent', modelId: 'router/agent', thinkingEfforts }
  ]);

  expect(result.models).toEqual([]);
  expect(result.rejectedModels).toEqual([
    expect.objectContaining({
      sourceIndex: 0,
      id: 'agent',
      code: 'INVALID_THINKING_EFFORTS',
      path: '9router-copilot.models[0].thinkingEfforts'
    })
  ]);
});

it('rejects a non-off default outside thinkingEfforts', () => {
  const result = parseModelSettings([
    {
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      thinkingMode: 'high',
      thinkingEfforts: ['low', 'medium']
    },
    { id: 'daily', name: 'Daily', modelId: 'router/daily' }
  ]);

  expect(result.models.map((model) => model.id)).toEqual(['daily']);
  expect(result.rejectedModels[0]).toMatchObject({
    id: 'agent',
    code: 'INVALID_THINKING_EFFORTS',
    path: '9router-copilot.models[0].thinkingEfforts'
  });
});

it('keeps off valid with an enabled effort allowlist', () => {
  const result = parseModelSettings([
    {
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      thinkingMode: 'off',
      thinkingEfforts: ['max']
    }
  ]);

  expect(result.models[0]).toMatchObject({
    thinkingMode: 'off',
    thinkingEfforts: ['max']
  });
});
```

Update first existing parser test so missing list expects `thinkingEfforts: []`, while model with `thinkingMode: 'high'` supplies and expects `thinkingEfforts: ['high']`.

In `test/unit/config/settings.test.ts`, change model using `thinkingMode: 'xhigh'` to include:

```typescript
thinkingMode: 'xhigh',
thinkingEfforts: ['low', 'xhigh']
```

Then assert normalized list:

```typescript
expect(snapshot.models[0]?.thinkingEfforts).toEqual(['low', 'xhigh']);
```

Update every direct `ConfiguredModel` fixture with required normalized property:

```typescript
thinkingMode: 'off',
thinkingEfforts: [],
```

For direct non-`off` fixtures, use matching values:

```typescript
thinkingMode: 'high',
thinkingEfforts: ['high'],
```

Update settings-based non-`off` fixtures in `test/unit/debug/output-channel.test.ts` and `test/integration/extension/text-stream-roundtrip.test.ts` with matching lists. Use `['xhigh', 'max']` for picker override, `['high']` for `None` and Vision cases, and `['low', 'high']` for metadata override.

- [ ] **Step 2: Run parser tests and verify RED**

Run: `pnpm exec vitest run test/unit/config/model-settings.test.ts test/unit/config/settings.test.ts`

Expected: FAIL because `thinkingEfforts` is unknown, absent from normalized models, and `INVALID_THINKING_EFFORTS` does not exist.

- [ ] **Step 3: Add normalized type and defaults**

In `src/types/product-model.ts`, define enabled values once and derive full modes:

```typescript
export const ENABLED_THINKING_MODES = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export const THINKING_MODES = ['off', ...ENABLED_THINKING_MODES] as const;

export type EnabledThinkingMode = (typeof ENABLED_THINKING_MODES)[number];
export type ThinkingMode = (typeof THINKING_MODES)[number];
```

Add required normalized property:

```typescript
export interface ConfiguredModel {
  sourceIndex: number;
  id: string;
  name: string;
  modelId: string;
  toolMode: ToolMode;
  visionMode: VisionMode;
  thinkingMode: ThinkingMode;
  thinkingEfforts: EnabledThinkingMode[];
  maxInputTokens: number;
  maxOutputTokens: number;
}
```

In `src/config/defaults.ts`, make default intent explicit:

```typescript
export const DEFAULT_MODELS = [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    thinkingEfforts: []
  }
] as const;
```

- [ ] **Step 4: Implement trust-boundary validation**

In `src/config/model-settings.ts`:

1. Import `ENABLED_THINKING_MODES` and `EnabledThinkingMode`.
2. Add `thinkingEfforts` to `ALLOWED_FIELDS`.
3. Add `INVALID_THINKING_EFFORTS` to `ModelSettingsIssueCode`.
4. Add enabled-value set:

```typescript
const ENABLED_THINKING_MODE_SET = new Set<string>(ENABLED_THINKING_MODES);
```

After validating `thinkingMode`, normalize and validate list before token fields:

```typescript
const thinkingEfforts = item.thinkingEfforts === undefined ? [] : item.thinkingEfforts;
if (
  !Array.isArray(thinkingEfforts) ||
  thinkingEfforts.some(
    (effort) => typeof effort !== 'string' || !ENABLED_THINKING_MODE_SET.has(effort)
  ) ||
  new Set(thinkingEfforts).size !== thinkingEfforts.length
) {
  reject(
    sourceIndex,
    id,
    'INVALID_THINKING_EFFORTS',
    'thinkingEfforts',
    'thinkingEfforts must be an array of unique supported non-off thinking modes.'
  );
  return;
}
if (thinkingMode !== 'off' && !thinkingEfforts.includes(thinkingMode)) {
  reject(
    sourceIndex,
    id,
    'INVALID_THINKING_EFFORTS',
    'thinkingEfforts',
    'thinkingEfforts must include the configured non-off thinkingMode.'
  );
  return;
}
```

Store normalized list without mutating user input:

```typescript
thinkingMode: thinkingMode as ThinkingMode,
thinkingEfforts: [...thinkingEfforts] as EnabledThinkingMode[],
```

- [ ] **Step 5: Run parser tests and verify GREEN**

Run: `pnpm exec vitest run test/unit/config/model-settings.test.ts test/unit/config/settings.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify normalized type across repository**

Run: `pnpm run build`

Expected: PASS with every direct `ConfiguredModel` fixture carrying `thinkingEfforts`.

Run: `pnpm run test:unit`

Expected: PASS.

Run: `pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts`

Expected: PASS; existing non-`off` settings remain valid under new allowlist rule.

- [ ] **Step 7: Commit configuration contract**

```bash
git add src/types/product-model.ts src/config/defaults.ts src/config/model-settings.ts test/unit test/integration/extension/text-stream-roundtrip.test.ts
git commit -m "feat: validate model thinking efforts"
```

---

### Task 2: Publish Model-Specific Picker and Enforce It

**Files:**
- Modify: `src/provider/thinking-effort.ts`
- Modify: `src/provider/model-catalog.ts`
- Modify: `src/provider/provider.ts`
- Test: `test/unit/provider/thinking-effort.test.ts`
- Test: `test/unit/provider/model-catalog.test.ts`
- Test: `test/integration/extension/text-stream-roundtrip.test.ts`
- Test: `test/integration/extension/settings-refresh.test.ts`

**Interfaces:**
- Consumes: `ConfiguredModel.thinkingEfforts: EnabledThinkingMode[]` from Task 1.
- Changes: `createThinkingEffortConfigurationSchema(defaultMode, enabledModes)` builds ordered model-specific schema.
- Changes: `resolveEffectiveThinkingMode(options, configuredMode, enabledModes)` accepts `none` plus selected model's allowlist only.
- Produces: published models omit `configurationSchema` when `thinkingEfforts.length === 0`.

- [ ] **Step 1: Write failing schema and resolver tests**

Replace broad-schema expectations in `test/unit/provider/thinking-effort.test.ts` with model-specific behavior:

```typescript
it('publishes None followed by configured efforts in configured order', () => {
  const schema = createThinkingEffortConfigurationSchema('xhigh', [
    'high',
    'minimal',
    'xhigh'
  ]);

  expect(schema.properties.reasoningEffort).toEqual({
    type: 'string',
    title: 'Thinking Effort',
    enum: ['none', 'high', 'minimal', 'xhigh'],
    enumItemLabels: ['None', 'High', 'Minimal', 'XHigh'],
    enumDescriptions: [
      'Disable thinking for faster responses',
      'Use high reasoning effort',
      'Use minimal reasoning effort',
      'Use extra-high reasoning effort'
    ],
    default: 'xhigh',
    group: 'navigation'
  });
});

it('maps off default to none for a non-empty picker', () => {
  const schema = createThinkingEffortConfigurationSchema('off', ['max']);

  expect(schema.properties.reasoningEffort.default).toBe('none');
});

it('accepts None regardless of enabled efforts', () => {
  expect(
    resolveEffectiveThinkingMode(
      { modelConfiguration: { reasoningEffort: 'none' } },
      'high',
      ['high']
    )
  ).toEqual({ thinkingMode: 'off', source: 'modelConfiguration' });
});

it('falls back when modelConfiguration contains a stale effort', () => {
  expect(
    resolveEffectiveThinkingMode(
      { modelConfiguration: { reasoningEffort: 'max' } },
      'low',
      ['low', 'medium']
    )
  ).toEqual({ thinkingMode: 'low', source: 'settings' });
});

it('applies the same allowlist to compatibility configuration', () => {
  expect(
    resolveEffectiveThinkingMode(
      { configuration: { reasoningEffort: 'medium' } },
      'low',
      ['low', 'medium']
    )
  ).toEqual({ thinkingMode: 'medium', source: 'configuration' });
});
```

Update existing resolver parameter calls. Keep `none` as its own test. Table-test six enabled values with each value allowed:

```typescript
it.each([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const)('maps enabled picker value %s directly', (pickerValue) => {
  expect(
    resolveEffectiveThinkingMode(
      { modelConfiguration: { reasoningEffort: pickerValue } },
      'low',
      [pickerValue]
    )
  ).toEqual({
    thinkingMode: pickerValue,
    source: 'modelConfiguration'
  });
});
```

In `test/unit/provider/model-catalog.test.ts`, add `thinkingEfforts` to every model fixture and assert publication behavior:

```typescript
it('publishes an independent allowlisted thinking schema for each model', () => {
  const models = resolvePublishedModels([
    {
      sourceIndex: 0,
      id: 'daily',
      name: 'Daily',
      modelId: 'router/daily',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192
    },
    {
      sourceIndex: 1,
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      toolMode: 'auto',
      visionMode: 'proxy',
      thinkingMode: 'max',
      thinkingEfforts: ['low', 'max'],
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192
    }
  ]);

  expect(models[0]?.configurationSchema).toBeUndefined();
  expect(models[1]?.configurationSchema?.properties.reasoningEffort).toMatchObject({
    enum: ['none', 'low', 'max'],
    default: 'max'
  });
});
```

- [ ] **Step 2: Write failing integration behavior tests**

In `test/integration/extension/text-stream-roundtrip.test.ts`, add stale-selection case:

```typescript
it('falls back to the model default when the host sends a stale thinking effort', async () => {
  __setConfigurationValues({
    models: [
      {
        id: 'daily',
        name: 'Daily',
        modelId: 'combo/daily',
        thinkingMode: 'low',
        thinkingEfforts: ['low', 'medium']
      }
    ],
    baseUrl: 'https://router.example.com/v1',
    maxTokens: 128,
    requestTimeoutMs: 5000,
    debugMode: 'minimal'
  });

  let submittedRequest: RouterChatCompletionRequest | undefined;
  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => 'token' } } as never,
    {
      async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
        submittedRequest = input.request;
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
    { modelConfiguration: { reasoningEffort: 'max' } } as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  expect(submittedRequest).toMatchObject({
    model: 'combo/daily',
    reasoning_effort: 'low'
  });
});
```

In `test/integration/extension/settings-refresh.test.ts`, add picker refresh coverage:

```typescript
it('refreshes each model thinking effort schema from settings', async () => {
  const provider = new NineRouterChatProvider(
    context,
    routerClient,
    createSnapshot([
      {
        id: 'coder',
        name: 'Coder',
        modelId: 'router/coder',
        thinkingMode: 'low',
        thinkingEfforts: ['low']
      }
    ])
  );

  const initial = await provider.provideLanguageModelChatInformation({} as never, {} as never);
  expect(initial[0]?.configurationSchema?.properties.reasoningEffort.enum).toEqual([
    'none',
    'low'
  ]);

  provider.refreshFromSnapshot(
    createSnapshot([
      {
        id: 'coder',
        name: 'Coder',
        modelId: 'router/coder',
        thinkingMode: 'off',
        thinkingEfforts: ['high', 'max']
      }
    ])
  );

  const refreshed = await provider.provideLanguageModelChatInformation({} as never, {} as never);
  expect(refreshed[0]?.configurationSchema?.properties.reasoningEffort).toMatchObject({
    enum: ['none', 'high', 'max'],
    default: 'none'
  });
});
```

Add model-level degradation coverage in same file:

```typescript
it('keeps valid models when one thinking effort configuration is invalid', async () => {
  const provider = new NineRouterChatProvider(
    context,
    routerClient,
    createSnapshot([
      {
        id: 'broken',
        name: 'Broken',
        modelId: 'router/broken',
        thinkingMode: 'high',
        thinkingEfforts: ['low']
      },
      { id: 'coder', name: 'Coder', modelId: 'router/coder' }
    ])
  );

  const models = await provider.provideLanguageModelChatInformation({} as never, {} as never);
  expect(models.map((model) => model.id)).toEqual(['coder']);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/unit/provider/thinking-effort.test.ts test/unit/provider/model-catalog.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts`

Expected: FAIL because schema still exposes all values, empty lists still publish schema, and stale `max` is still accepted.

- [ ] **Step 4: Build ordered schema from selected model allowlist**

In `src/provider/thinking-effort.ts`, import `EnabledThinkingMode`. Keep host type `ThinkingEffort` as `none` plus enabled modes. Replace parallel fixed arrays with one metadata record:

```typescript
const THINKING_EFFORT_METADATA: Record<ThinkingEffort, {
  label: string;
  description: string;
}> = {
  none: {
    label: 'None',
    description: 'Disable thinking for faster responses'
  },
  minimal: {
    label: 'Minimal',
    description: 'Use minimal reasoning effort'
  },
  low: { label: 'Low', description: 'Use low reasoning effort' },
  medium: { label: 'Medium', description: 'Use medium reasoning effort' },
  high: { label: 'High', description: 'Use high reasoning effort' },
  xhigh: {
    label: 'XHigh',
    description: 'Use extra-high reasoning effort'
  },
  max: { label: 'Max', description: 'Use maximum reasoning depth' }
};
```

Change schema function:

```typescript
export function createThinkingEffortConfigurationSchema(
  defaultMode: ThinkingMode,
  enabledModes: readonly EnabledThinkingMode[]
): LanguageModelConfigurationSchema {
  const efforts: ThinkingEffort[] = ['none', ...enabledModes];

  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: efforts,
        enumItemLabels: efforts.map((effort) => THINKING_EFFORT_METADATA[effort].label),
        enumDescriptions: efforts.map(
          (effort) => THINKING_EFFORT_METADATA[effort].description
        ),
        default: defaultMode === 'off' ? 'none' : defaultMode,
        group: 'navigation'
      }
    }
  };
}
```

Change resolver and reader signatures so validation is model-specific:

```typescript
export function resolveEffectiveThinkingMode(
  options: unknown,
  configuredMode: ThinkingMode,
  enabledModes: readonly EnabledThinkingMode[]
): EffectiveThinkingMode {
  const allowedEfforts = new Set<string>(['none', ...enabledModes]);
  const modelConfigurationValue = readReasoningEffort(
    options,
    'modelConfiguration',
    allowedEfforts
  );
  if (modelConfigurationValue) {
    return {
      thinkingMode: toThinkingMode(modelConfigurationValue),
      source: 'modelConfiguration'
    };
  }

  const compatibilityValue = readReasoningEffort(
    options,
    'configuration',
    allowedEfforts
  );
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
  property: 'modelConfiguration' | 'configuration',
  allowedEfforts: ReadonlySet<string>
): ThinkingEffort | undefined {
  if (typeof options !== 'object' || options === null || !(property in options)) {
    return undefined;
  }

  const configuration = (options as Record<string, unknown>)[property];
  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('reasoningEffort' in configuration)
  ) {
    return undefined;
  }

  const value = configuration.reasoningEffort;
  return typeof value === 'string' && allowedEfforts.has(value)
    ? (value as ThinkingEffort)
    : undefined;
}

function toThinkingMode(effort: ThinkingEffort): ThinkingMode {
  return effort === 'none' ? 'off' : effort;
}
```

Delete global `THINKING_EFFORT_SET`; it would incorrectly accept values unsupported by selected model.

- [ ] **Step 5: Omit empty picker schema and enforce allowlist in provider**

In `src/provider/model-catalog.ts`, conditionally attach schema:

```typescript
return {
  id: setting.id,
  name: setting.name,
  vendor: '9router',
  family: setting.id,
  version: '1',
  maxInputTokens: options.routerModel?.contextWindow ?? setting.maxInputTokens,
  maxOutputTokens: options.routerModel?.maxOutput ?? setting.maxOutputTokens,
  capabilities,
  ...(setting.thinkingEfforts.length > 0
    ? {
        configurationSchema: createThinkingEffortConfigurationSchema(
          setting.thinkingMode,
          setting.thinkingEfforts
        )
      }
    : {})
};
```

In `src/provider/provider.ts`, pass selected model allowlist:

```typescript
const effectiveThinking = resolveEffectiveThinkingMode(
  options,
  selectedModel.thinkingMode,
  selectedModel.thinkingEfforts
);
```

Keep request-scoped model copy and request adapter unchanged.

- [ ] **Step 6: Run focused tests and TypeScript build; verify GREEN**

Run: `pnpm exec vitest run test/unit/config/model-settings.test.ts test/unit/config/settings.test.ts test/unit/provider/thinking-effort.test.ts test/unit/provider/model-catalog.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts`

Expected: PASS.

Run: `pnpm run build`

Expected: PASS. If strict TypeScript reports another direct `ConfiguredModel` literal missing `thinkingEfforts`, add `[]` for `off` or matching list for enabled mode, then rerun build.

- [ ] **Step 7: Commit picker and runtime enforcement**

```bash
git add src/provider/thinking-effort.ts src/provider/model-catalog.ts src/provider/provider.ts test/unit test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts
git commit -m "feat: limit thinking picker per model"
```

---

### Task 3: Publish Configuration Contract and Documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: runtime contract from Tasks 1-2.
- Produces: VS Code setting schema for unique ordered `thinkingEfforts` and user-facing migration instructions.

- [ ] **Step 1: Write failing manifest and documentation guardrails**

In `test/integration/extension/release-guardrails.test.ts`, expand manifest typing:

```typescript
properties: {
  thinkingEfforts: Record<string, unknown>;
  maxInputTokens: Record<string, unknown>;
  maxOutputTokens: Record<string, unknown>;
};
```

Update expected default model:

```typescript
{
  id: 'agent',
  name: 'Agent',
  modelId: '',
  toolMode: 'auto',
  visionMode: 'off',
  thinkingMode: 'off',
  thinkingEfforts: []
}
```

Add schema assertion:

```typescript
expect(models.items.properties.thinkingEfforts).toMatchObject({
  type: 'array',
  default: [],
  uniqueItems: true,
  items: {
    type: 'string',
    enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  }
});
```

Add documentation assertions:

```typescript
for (const document of [readme, productionDesign]) {
  expect(document).toContain('thinkingEfforts');
  expect(document).toContain('array order');
  expect(document).toContain('omits `configurationSchema`');
  expect(document).toContain('stale');
}
```

- [ ] **Step 2: Run release guardrail and verify RED**

Run: `pnpm exec vitest run test/integration/extension/release-guardrails.test.ts`

Expected: FAIL because manifest and docs do not expose `thinkingEfforts` semantics.

- [ ] **Step 3: Add manifest schema**

In `package.json`, add default list beside `thinkingMode`:

```json
"thinkingMode": "off",
"thinkingEfforts": []
```

Add field schema after `thinkingMode`:

```json
"thinkingEfforts": {
  "type": "array",
  "default": [],
  "uniqueItems": true,
  "items": {
    "type": "string",
    "enum": [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]
  },
  "description": "Ordered non-off Thinking Effort choices exposed for this model. Empty hides the Thinking Effort picker."
}
```

Do not include `off` in item enum; extension owns `None/off` behavior.

- [ ] **Step 4: Update README contract and migration guidance**

Update model example:

```json
"thinkingMode": "medium",
"thinkingEfforts": ["minimal", "low", "medium", "high"]
```

Add model-field text with exact semantics:

```markdown
- `thinkingEfforts`: Ordered non-`off` picker choices: `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Array order controls picker order after `None`. Missing or empty lists support only `off` and omit `configurationSchema`, hiding the picker. A non-`off` `thinkingMode` must appear in this list.
```

Extend breaking-change section:

```markdown
Existing model objects with a non-`off` `thinkingMode` must add that value to `thinkingEfforts`. Invalid or duplicate entries reject only that model.
```

Replace broad Thinking Effort statement with:

```markdown
Each model with at least one configured `thinkingEfforts` value gets the native Copilot Chat Thinking Effort picker. `None` is always first, then configured values in array order. `None` omits `reasoning_effort`; allowed values send the selected value while keeping `modelId` unchanged. Missing, malformed, unsupported, or stale host selections fall back to that model's validated `thinkingMode`. Models with an empty list omit `configurationSchema` and hide the picker. `9router` owns provider-specific reasoning translation.
```

Update diagnostics fix text to mention matching default and allowlist.

- [ ] **Step 5: Update canonical production design**

Replace Native thinking effort picker section in `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md` with contract matching README:

```markdown
### Native thinking effort picker

Each valid model configures ordered non-`off` choices through `thinkingEfforts`. Array order controls picker order after host-only `None`. Missing or empty lists mean `off` only and omit `configurationSchema`, hiding the picker.

A non-`off` `thinkingMode` must appear in that model's `thinkingEfforts`; invalid or duplicate lists reject only the affected model. A valid host selection overrides the default for the request. `none` maps to internal `off`; enabled values are accepted only when selected model allowlist contains them. Missing, malformed, unsupported, or stale host values fall back to validated `thinkingMode`.

Extension keeps configured `modelId` unchanged. Non-`off` effective levels set OpenAI-compatible `reasoning_effort`; `off` omits it. `9router` owns provider-specific reasoning translation and compatibility policy. Reasoning deltas remain hidden.
```

- [ ] **Step 6: Run release guardrail and verify GREEN**

Run: `pnpm exec vitest run test/integration/extension/release-guardrails.test.ts`

Expected: PASS.

- [ ] **Step 7: Run complete verification gate**

Run in order:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: every command exits `0`; no new warning or unhandled rejection appears; package command produces VSIX.

- [ ] **Step 8: Commit manifest and docs**

```bash
git add package.json README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: publish thinking effort allowlists"
```
