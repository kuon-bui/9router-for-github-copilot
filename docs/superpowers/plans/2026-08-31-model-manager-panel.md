# Model Manager Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `9router: Manage Models` webview panel that adds, edits, deletes, and reorders entries in `9router-copilot.models`, seeded from 9router catalog metadata.

**Architecture:** All decision logic lives in pure modules under `src/config` and `src/runtime` that take plain data and return plain data. The panel module is thin: it fetches the catalog, renders a static HTML shell with a nonced inline script, and translates webview messages into `settings.update` calls. State flows one way — settings change event to view state to `postMessage`.

**Tech Stack:** TypeScript (strict, Node16 module resolution), VS Code extension API, vitest, esbuild, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-31-model-manager-panel-design.md`

## Global Constraints

- Follow `CODE_CONVENTION.md`. Folder boundaries are enforced: `src/config` owns settings lookup and validation, `src/runtime` owns command and lifecycle wiring, `src/router` owns HTTP. No routing policy in the extension.
- TypeScript strict mode stays on. No `any`. Exported functions carry explicit input and return types.
- Treat every value from settings, the catalog, and the webview as untrusted. Validate before promoting to typed objects.
- Never store secrets in settings. The API key is read only through `getApiKey(secrets)`.
- Import paths use the `@/` alias for `src` (see `vitest.config.ts` and `tsconfig.json`).
- Command id: `9routerCopilot.manageModels`. Command title: `9router: Manage Models`.
- Settings key edited by this feature: `9router-copilot.models`. Write target: `vscode.ConfigurationTarget.Global`.
- The panel reads and writes `configuration.inspect('models').globalValue`, falling back to `defaultValue`, never the merged `get()` value.
- Token fallbacks are `DEFAULT_MODEL_MAX_INPUT_TOKENS` and `DEFAULT_MODEL_MAX_OUTPUT_TOKENS` from `src/config/defaults.ts` (both `264000`). Never hardcode the number.
- Validation messages must match the strings `parseModelSettings` already uses, so diagnostics and the panel agree word for word.
- Run `pnpm lint` before every commit; run `pnpm test` before every commit that touches `src` or `test`.
- Module names avoid the vague `manager` suffix per `CODE_CONVENTION.md`; the feature's files are named `model-editor-*` even though the user-facing command says "Manage Models".

---

### Task 1: Shared model field rules

Extract the validation constants `parseModelSettings` declares locally into one module so the panel's draft validation cannot drift from settings parsing.

**Files:**
- Create: `src/config/model-field-rules.ts`
- Modify: `src/config/model-settings.ts:18-36` (replace local constants with imports)
- Test: `test/unit/config/model-field-rules.test.ts`

**Interfaces:**
- Consumes: `ENABLED_THINKING_MODES`, `THINKING_MODES`, `ToolMode`, `VisionMode` from `@/types/product-model`
- Produces: `MODEL_ID_PATTERN`, `THINKING_SUFFIX_PATTERN`, `ALLOWED_MODEL_FIELDS`, `TOOL_MODES`, `VISION_MODES`, `THINKING_MODE_SET`, `ENABLED_THINKING_MODE_SET`, `isPositiveInteger(value: unknown): value is number`

- [ ] **Step 1: Write the failing test**

Create `test/unit/config/model-field-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MODEL_FIELDS,
  ENABLED_THINKING_MODE_SET,
  MODEL_ID_PATTERN,
  THINKING_MODE_SET,
  THINKING_SUFFIX_PATTERN,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from '@/config/model-field-rules';

describe('model field rules', () => {
  it('accepts settings-compatible model ids and rejects the rest', () => {
    expect(MODEL_ID_PATTERN.test('claude-opus-4.1')).toBe(true);
    expect(MODEL_ID_PATTERN.test('cx-gpt-5.6-sol')).toBe(true);
    expect(MODEL_ID_PATTERN.test('-leading-dash')).toBe(false);
    expect(MODEL_ID_PATTERN.test('Upper')).toBe(false);
    expect(MODEL_ID_PATTERN.test('has/slash')).toBe(false);
    expect(MODEL_ID_PATTERN.test('')).toBe(false);
  });

  it('detects thinking suffixes case-insensitively', () => {
    expect(THINKING_SUFFIX_PATTERN.test('model(high)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(HIGH)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(off)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(turbo)')).toBe(false);
    expect(THINKING_SUFFIX_PATTERN.test('model')).toBe(false);
  });

  it('exposes the ten supported model fields', () => {
    expect([...ALLOWED_MODEL_FIELDS].sort()).toEqual(
      [
        'id',
        'maxInputTokens',
        'maxOutputTokens',
        'modelId',
        'name',
        'serviceTier',
        'thinkingEfforts',
        'thinkingMode',
        'toolMode',
        'visionMode'
      ]
    );
  });

  it('exposes mode membership sets', () => {
    expect(TOOL_MODES.has('auto')).toBe(true);
    expect(TOOL_MODES.has('off')).toBe(true);
    expect(VISION_MODES.has('proxy')).toBe(true);
    expect(THINKING_MODE_SET.has('off')).toBe(true);
    expect(ENABLED_THINKING_MODE_SET.has('off')).toBe(false);
    expect(ENABLED_THINKING_MODE_SET.has('max')).toBe(true);
  });

  it('recognises positive safe integers only', () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(264_000)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger('1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/config/model-field-rules.test.ts`
Expected: FAIL — cannot resolve `@/config/model-field-rules`.

- [ ] **Step 3: Write the rules module**

Create `src/config/model-field-rules.ts`:

```ts
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';
import type { ToolMode, VisionMode } from '@/types/product-model';

export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const THINKING_SUFFIX_PATTERN = new RegExp(
  `\\((?:${THINKING_MODES.join('|')})\\)$`,
  'i'
);

export const MODEL_FIELDS = [
  'id',
  'name',
  'modelId',
  'serviceTier',
  'toolMode',
  'visionMode',
  'thinkingMode',
  'thinkingEfforts',
  'maxInputTokens',
  'maxOutputTokens'
] as const;

export const ALLOWED_MODEL_FIELDS: ReadonlySet<string> = new Set<string>(MODEL_FIELDS);
export const TOOL_MODES: ReadonlySet<ToolMode> = new Set<ToolMode>(['auto', 'off']);
export const VISION_MODES: ReadonlySet<VisionMode> = new Set<VisionMode>([
  'native',
  'proxy',
  'off'
]);
export const THINKING_MODE_SET: ReadonlySet<string> = new Set<string>(THINKING_MODES);
export const ENABLED_THINKING_MODE_SET: ReadonlySet<string> = new Set<string>(
  ENABLED_THINKING_MODES
);

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/config/model-field-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `model-settings.ts` to use the shared rules**

In `src/config/model-settings.ts`, delete the local declarations of `MODEL_ID_PATTERN`, `THINKING_SUFFIX_PATTERN`, `ALLOWED_FIELDS`, `TOOL_MODES`, `VISION_MODES`, `THINKING_MODE_SET`, `ENABLED_THINKING_MODE_SET`, and the local `isPositiveInteger`, then add the import:

```ts
import {
  ALLOWED_MODEL_FIELDS,
  ENABLED_THINKING_MODE_SET,
  MODEL_ID_PATTERN,
  THINKING_MODE_SET,
  THINKING_SUFFIX_PATTERN,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from './model-field-rules';
```

Replace the one usage site of the renamed set: `ALLOWED_FIELDS.has(field)` becomes `ALLOWED_MODEL_FIELDS.has(field)`. Leave every message string and control-flow branch untouched.

- [ ] **Step 6: Run the full suite to prove the refactor is behaviour-neutral**

Run: `pnpm test`
Expected: PASS, including the untouched `test/unit/config/model-settings.test.ts`.

- [ ] **Step 7: Lint and commit**

```bash
pnpm lint
git add src/config/model-field-rules.ts src/config/model-settings.ts test/unit/config/model-field-rules.test.ts
git commit -m "refactor(config): extract shared model field rules"
```

---

### Task 2: Draft prefill helpers

Turn a catalog model into a fully populated draft the form can render.

**Files:**
- Create: `src/config/model-draft.ts`
- Test: `test/unit/config/model-draft.test.ts`

**Interfaces:**
- Consumes: `RouterModelMetadata` from `@/router/model-catalog`; `DEFAULT_MODEL_MAX_INPUT_TOKENS`, `DEFAULT_MODEL_MAX_OUTPUT_TOKENS` from `./defaults`
- Produces:
  - `interface ModelDraft { id: string; name: string; modelId: string; serviceTier?: 'fast'; toolMode: ToolMode; visionMode: VisionMode; thinkingMode: ThinkingMode; thinkingEfforts: EnabledThinkingMode[]; maxInputTokens: number; maxOutputTokens: number }`
  - `sanitizeModelId(input: string): string`
  - `createUniqueModelId(candidate: string, takenIds: readonly string[]): string`
  - `suggestDisplayName(modelId: string): string`
  - `createDraftFromCatalog(model: RouterModelMetadata, options?: { takenIds?: readonly string[] }): ModelDraft`
  - `toSettingsEntry(draft: ModelDraft): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

Create `test/unit/config/model-draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  createDraftFromCatalog,
  createUniqueModelId,
  sanitizeModelId,
  suggestDisplayName,
  toSettingsEntry
} from '@/config/model-draft';

describe('sanitizeModelId', () => {
  it('maps catalog ids onto the settings id pattern', () => {
    expect(sanitizeModelId('cx/gpt-5.6-sol')).toBe('cx-gpt-5.6-sol');
    expect(sanitizeModelId('Anthropic/Claude Opus 4.1')).toBe('anthropic-claude-opus-4.1');
    expect(sanitizeModelId('  ---weird///id---  ')).toBe('weird-id');
    expect(sanitizeModelId('///')).toBe('');
  });
});

describe('createUniqueModelId', () => {
  it('suffixes colliding ids', () => {
    expect(createUniqueModelId('cx/gpt-5', [])).toBe('cx-gpt-5');
    expect(createUniqueModelId('cx/gpt-5', ['cx-gpt-5'])).toBe('cx-gpt-5-2');
    expect(createUniqueModelId('cx/gpt-5', ['cx-gpt-5', 'cx-gpt-5-2'])).toBe('cx-gpt-5-3');
  });

  it('returns an empty id when nothing survives sanitisation', () => {
    expect(createUniqueModelId('///', ['x'])).toBe('');
  });
});

describe('suggestDisplayName', () => {
  it('drops the owner prefix and keeps the remainder verbatim', () => {
    expect(suggestDisplayName('cx/gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(suggestDisplayName('router/combo')).toBe('combo');
    expect(suggestDisplayName('plain-model')).toBe('plain-model');
  });
});

describe('createDraftFromCatalog', () => {
  it('prefills every derivable field from catalog metadata', () => {
    expect(
      createDraftFromCatalog({
        id: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000
      })
    ).toEqual({
      id: 'cx-gpt-5.6-sol',
      name: 'gpt-5.6-sol',
      modelId: 'cx/gpt-5.6-sol',
      toolMode: 'auto',
      visionMode: 'native',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 272_000,
      maxOutputTokens: 128_000
    });
  });

  it('falls back to configured defaults when metadata is missing', () => {
    expect(createDraftFromCatalog({ id: 'router/combo' })).toEqual({
      id: 'router-combo',
      name: 'combo',
      modelId: 'router/combo',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 264_000,
      maxOutputTokens: 264_000
    });
  });

  it('falls back when the derived input budget is not positive', () => {
    const draft = createDraftFromCatalog({
      id: 'tiny/model',
      contextWindow: 8_000,
      maxOutput: 8_000
    });

    expect(draft.maxInputTokens).toBe(264_000);
    expect(draft.maxOutputTokens).toBe(8_000);
  });

  it('avoids ids already used by configured models', () => {
    expect(createDraftFromCatalog({ id: 'cx/gpt-5' }, { takenIds: ['cx-gpt-5'] }).id).toBe(
      'cx-gpt-5-2'
    );
  });
});

describe('toSettingsEntry', () => {
  it('writes the nine base fields and omits an unset service tier', () => {
    expect(
      toSettingsEntry({
        id: 'agent',
        name: 'Agent',
        modelId: 'router/combo',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000
      })
    ).toEqual({
      id: 'agent',
      name: 'Agent',
      modelId: 'router/combo',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 264_000,
      maxOutputTokens: 264_000
    });
  });

  it('writes the service tier when it is fast', () => {
    const entry = toSettingsEntry({
      id: 'agent',
      name: 'Agent',
      modelId: 'router/combo',
      serviceTier: 'fast',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'high',
      thinkingEfforts: ['low', 'high'],
      maxInputTokens: 1,
      maxOutputTokens: 2
    });

    expect(entry.serviceTier).toBe('fast');
    expect(entry.thinkingEfforts).toEqual(['low', 'high']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/config/model-draft.test.ts`
Expected: FAIL — cannot resolve `@/config/model-draft`.

- [ ] **Step 3: Write the implementation**

Create `src/config/model-draft.ts`:

```ts
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from './defaults';
import type { RouterModelMetadata } from '@/router/model-catalog';
import type {
  EnabledThinkingMode,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '@/types/product-model';

const MAX_ID_SUFFIX_ATTEMPTS = 100;

export interface ModelDraft {
  id: string;
  name: string;
  modelId: string;
  serviceTier?: 'fast';
  toolMode: ToolMode;
  visionMode: VisionMode;
  thinkingMode: ThinkingMode;
  thinkingEfforts: EnabledThinkingMode[];
  maxInputTokens: number;
  maxOutputTokens: number;
}

export function sanitizeModelId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-._]+$/, '');
}

export function createUniqueModelId(
  candidate: string,
  takenIds: readonly string[]
): string {
  const base = sanitizeModelId(candidate);
  if (base.length === 0) {
    return '';
  }

  const taken = new Set(takenIds);
  if (!taken.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix <= MAX_ID_SUFFIX_ATTEMPTS; suffix += 1) {
    const next = `${base}-${suffix}`;
    if (!taken.has(next)) {
      return next;
    }
  }

  // Bounded on purpose. Validation reports the duplicate instead of looping forever.
  return base;
}

export function suggestDisplayName(modelId: string): string {
  const trimmed = modelId.trim();
  const separator = trimmed.lastIndexOf('/');
  const withoutOwner = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
  return withoutOwner.length > 0 ? withoutOwner : trimmed;
}

export function createDraftFromCatalog(
  model: RouterModelMetadata,
  options: { takenIds?: readonly string[] } = {}
): ModelDraft {
  const maxOutputTokens = model.maxOutput ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  const derivedInputTokens =
    model.contextWindow === undefined ? 0 : model.contextWindow - maxOutputTokens;

  return {
    id: createUniqueModelId(model.id, options.takenIds ?? []),
    name: suggestDisplayName(model.id),
    modelId: model.id,
    toolMode: 'auto',
    visionMode: model.vision === true ? 'native' : 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens:
      derivedInputTokens > 0 ? derivedInputTokens : DEFAULT_MODEL_MAX_INPUT_TOKENS,
    maxOutputTokens
  };
}

export function toSettingsEntry(draft: ModelDraft): Record<string, unknown> {
  return {
    id: draft.id,
    name: draft.name,
    modelId: draft.modelId,
    ...(draft.serviceTier === 'fast' ? { serviceTier: 'fast' } : {}),
    toolMode: draft.toolMode,
    visionMode: draft.visionMode,
    thinkingMode: draft.thinkingMode,
    thinkingEfforts: [...draft.thinkingEfforts],
    maxInputTokens: draft.maxInputTokens,
    maxOutputTokens: draft.maxOutputTokens
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/config/model-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/config/model-draft.ts test/unit/config/model-draft.test.ts
git commit -m "feat(config): prefill model drafts from router catalog metadata"
```

---

### Task 3: Draft validation

Validate an untrusted draft coming from the webview using exactly the rules `parseModelSettings` enforces, collecting every error instead of stopping at the first.

**Files:**
- Modify: `src/config/model-draft.ts` (append)
- Test: `test/unit/config/model-draft.test.ts` (append a `validateDraft` describe block)

**Interfaces:**
- Consumes: the rules module from Task 1; `ModelDraft` from Task 2
- Produces:
  - `type ModelDraftField = 'draft' | 'id' | 'name' | 'modelId' | 'serviceTier' | 'toolMode' | 'visionMode' | 'thinkingMode' | 'thinkingEfforts' | 'maxInputTokens' | 'maxOutputTokens'`
  - `interface ModelDraftError { field: ModelDraftField; message: string }`
  - `interface ModelDraftValidation { draft?: ModelDraft; errors: ModelDraftError[] }`
  - `validateDraft(input: unknown, context: { takenIds: readonly string[] }): ModelDraftValidation`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/config/model-draft.test.ts`:

```ts
import { validateDraft } from '@/config/model-draft';

const validInput = {
  id: 'agent',
  name: 'Agent',
  modelId: 'router/combo',
  toolMode: 'auto',
  visionMode: 'off',
  thinkingMode: 'off',
  thinkingEfforts: [],
  maxInputTokens: 264_000,
  maxOutputTokens: 264_000
};

describe('validateDraft', () => {
  it('returns a typed draft when every field is valid', () => {
    const result = validateDraft(validInput, { takenIds: ['other'] });

    expect(result.errors).toEqual([]);
    expect(result.draft).toEqual(validInput);
  });

  it('keeps a fast service tier', () => {
    const result = validateDraft({ ...validInput, serviceTier: 'fast' }, { takenIds: [] });

    expect(result.errors).toEqual([]);
    expect(result.draft?.serviceTier).toBe('fast');
  });

  it('rejects a non-object payload', () => {
    expect(validateDraft(null, { takenIds: [] })).toEqual({
      errors: [{ field: 'draft', message: 'Model entry must be an object.' }]
    });
  });

  it('reports every invalid field at once', () => {
    const result = validateDraft(
      {
        id: 'Bad Id',
        name: '   ',
        modelId: 'router/combo(high)',
        serviceTier: 'slow',
        toolMode: 'maybe',
        visionMode: 'sometimes',
        thinkingMode: 'turbo',
        thinkingEfforts: ['low', 'low'],
        maxInputTokens: 0,
        maxOutputTokens: 1.5
      },
      { takenIds: [] }
    );

    expect(result.draft).toBeUndefined();
    expect(result.errors.map((error) => error.field).sort()).toEqual([
      'id',
      'maxInputTokens',
      'maxOutputTokens',
      'modelId',
      'name',
      'serviceTier',
      'thinkingEfforts',
      'thinkingMode',
      'toolMode',
      'visionMode'
    ]);
    expect(result.errors.find((error) => error.field === 'id')?.message).toBe(
      'Model id must match [a-z0-9][a-z0-9._-]*.'
    );
    expect(result.errors.find((error) => error.field === 'modelId')?.message).toBe(
      'modelId must be a non-empty base 9router model id without a thinking suffix.'
    );
  });

  it('rejects an id already used by another entry', () => {
    const result = validateDraft(validInput, { takenIds: ['agent'] });

    expect(result.errors).toEqual([
      { field: 'id', message: 'Model id "agent" is duplicated.' }
    ]);
  });

  it('requires thinking efforts to include a non-off thinking mode', () => {
    const result = validateDraft(
      { ...validInput, thinkingMode: 'high', thinkingEfforts: ['low'] },
      { takenIds: [] }
    );

    expect(result.errors).toEqual([
      {
        field: 'thinkingEfforts',
        message: 'thinkingEfforts must include the configured non-off thinkingMode.'
      }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/config/model-draft.test.ts`
Expected: FAIL — `validateDraft` is not exported.

- [ ] **Step 3: Implement `validateDraft`**

Append to `src/config/model-draft.ts` (and add the rules import at the top of the file):

```ts
import {
  ENABLED_THINKING_MODE_SET,
  MODEL_ID_PATTERN,
  THINKING_MODE_SET,
  THINKING_SUFFIX_PATTERN,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from './model-field-rules';

export type ModelDraftField =
  | 'draft'
  | 'id'
  | 'name'
  | 'modelId'
  | 'serviceTier'
  | 'toolMode'
  | 'visionMode'
  | 'thinkingMode'
  | 'thinkingEfforts'
  | 'maxInputTokens'
  | 'maxOutputTokens';

export interface ModelDraftError {
  field: ModelDraftField;
  message: string;
}

export interface ModelDraftValidation {
  draft?: ModelDraft;
  errors: ModelDraftError[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateDraft(
  input: unknown,
  context: { takenIds: readonly string[] }
): ModelDraftValidation {
  if (!isPlainObject(input)) {
    return { errors: [{ field: 'draft', message: 'Model entry must be an object.' }] };
  }

  const errors: ModelDraftError[] = [];
  const push = (field: ModelDraftField, message: string): void => {
    errors.push({ field, message });
  };

  const id = typeof input.id === 'string' ? input.id : '';
  if (!MODEL_ID_PATTERN.test(id)) {
    push('id', 'Model id must match [a-z0-9][a-z0-9._-]*.');
  } else if (context.takenIds.includes(id)) {
    push('id', `Model id "${id}" is duplicated.`);
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) {
    push('name', 'Model name must be a non-empty string.');
  }

  const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : '';
  if (modelId.length === 0 || THINKING_SUFFIX_PATTERN.test(modelId)) {
    push(
      'modelId',
      'modelId must be a non-empty base 9router model id without a thinking suffix.'
    );
  }

  const serviceTier = input.serviceTier;
  if (serviceTier !== undefined && serviceTier !== 'fast') {
    push('serviceTier', 'serviceTier must be fast when configured.');
  }

  const toolMode = input.toolMode;
  if (typeof toolMode !== 'string' || !TOOL_MODES.has(toolMode as ToolMode)) {
    push('toolMode', 'toolMode must be auto or off.');
  }

  const visionMode = input.visionMode;
  if (typeof visionMode !== 'string' || !VISION_MODES.has(visionMode as VisionMode)) {
    push('visionMode', 'visionMode must be native, proxy, or off.');
  }

  const thinkingMode = input.thinkingMode;
  const thinkingModeValid =
    typeof thinkingMode === 'string' && THINKING_MODE_SET.has(thinkingMode);
  if (!thinkingModeValid) {
    push('thinkingMode', 'thinkingMode is unsupported.');
  }

  const thinkingEfforts = Array.isArray(input.thinkingEfforts)
    ? (input.thinkingEfforts as unknown[])
    : undefined;
  const thinkingEffortsValid =
    thinkingEfforts !== undefined &&
    thinkingEfforts.every(
      (effort) => typeof effort === 'string' && ENABLED_THINKING_MODE_SET.has(effort)
    ) &&
    new Set(thinkingEfforts).size === thinkingEfforts.length;
  if (!thinkingEffortsValid) {
    push(
      'thinkingEfforts',
      'thinkingEfforts must be an array of unique supported non-off thinking modes.'
    );
  } else if (
    thinkingEfforts !== undefined &&
    thinkingModeValid &&
    thinkingMode !== 'off' &&
    !thinkingEfforts.includes(thinkingMode)
  ) {
    push(
      'thinkingEfforts',
      'thinkingEfforts must include the configured non-off thinkingMode.'
    );
  }

  const maxInputTokens = input.maxInputTokens;
  if (!isPositiveInteger(maxInputTokens)) {
    push('maxInputTokens', 'maxInputTokens must be a positive integer.');
  }

  const maxOutputTokens = input.maxOutputTokens;
  if (!isPositiveInteger(maxOutputTokens)) {
    push('maxOutputTokens', 'maxOutputTokens must be a positive integer.');
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    draft: {
      id,
      name,
      modelId,
      ...(serviceTier === 'fast' ? { serviceTier: 'fast' as const } : {}),
      toolMode: toolMode as ToolMode,
      visionMode: visionMode as VisionMode,
      thinkingMode: thinkingMode as ThinkingMode,
      thinkingEfforts: [...(thinkingEfforts ?? [])] as EnabledThinkingMode[],
      maxInputTokens: maxInputTokens as number,
      maxOutputTokens: maxOutputTokens as number
    },
    errors
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/config/model-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/config/model-draft.ts test/unit/config/model-draft.test.ts
git commit -m "feat(config): validate untrusted model drafts against settings rules"
```

---

### Task 4: Model entry edits

Pure array edits over the raw settings value. Entries that are not the target must survive untouched, including entries `parseModelSettings` rejects.

**Files:**
- Create: `src/config/model-entry-edits.ts`
- Test: `test/unit/config/model-entry-edits.test.ts`

**Interfaces:**
- Produces:
  - `readModelEntries(value: unknown): unknown[]`
  - `addModelEntry(value: unknown, entry: Record<string, unknown>): unknown[]`
  - `updateModelEntry(value: unknown, sourceIndex: number, entry: Record<string, unknown>): unknown[]`
  - `removeModelEntry(value: unknown, sourceIndex: number): unknown[]`
  - `moveModelEntry(value: unknown, sourceIndex: number, direction: 'up' | 'down'): unknown[]`

- [ ] **Step 1: Write the failing test**

Create `test/unit/config/model-entry-edits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addModelEntry,
  moveModelEntry,
  readModelEntries,
  removeModelEntry,
  updateModelEntry
} from '@/config/model-entry-edits';

const broken = { id: 'broken', name: 'Broken' };
const valid = { id: 'agent', name: 'Agent', modelId: 'router/combo' };

describe('readModelEntries', () => {
  it('copies arrays and replaces non-arrays with an empty list', () => {
    const source = [valid];
    const copy = readModelEntries(source);

    expect(copy).toEqual([valid]);
    expect(copy).not.toBe(source);
    expect(readModelEntries('nope')).toEqual([]);
    expect(readModelEntries(undefined)).toEqual([]);
  });
});

describe('addModelEntry', () => {
  it('appends without touching existing entries', () => {
    const next = addModelEntry([broken], valid);

    expect(next).toEqual([broken, valid]);
    expect(next[0]).toBe(broken);
  });
});

describe('updateModelEntry', () => {
  it('replaces one entry and keeps the rest by reference', () => {
    const next = updateModelEntry([broken, valid], 1, { ...valid, name: 'Renamed' });

    expect(next[0]).toBe(broken);
    expect(next[1]).toEqual({ ...valid, name: 'Renamed' });
  });

  it('leaves the list unchanged for an out-of-range index', () => {
    expect(updateModelEntry([valid], 5, broken)).toEqual([valid]);
    expect(updateModelEntry([valid], -1, broken)).toEqual([valid]);
  });
});

describe('removeModelEntry', () => {
  it('removes the target entry only', () => {
    expect(removeModelEntry([broken, valid], 0)).toEqual([valid]);
    expect(removeModelEntry([broken, valid], 9)).toEqual([broken, valid]);
  });
});

describe('moveModelEntry', () => {
  it('swaps with the adjacent entry', () => {
    expect(moveModelEntry([broken, valid], 1, 'up')).toEqual([valid, broken]);
    expect(moveModelEntry([broken, valid], 0, 'down')).toEqual([valid, broken]);
  });

  it('is a no-op at the boundaries and out of range', () => {
    expect(moveModelEntry([broken, valid], 0, 'up')).toEqual([broken, valid]);
    expect(moveModelEntry([broken, valid], 1, 'down')).toEqual([broken, valid]);
    expect(moveModelEntry([broken, valid], 7, 'up')).toEqual([broken, valid]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/config/model-entry-edits.test.ts`
Expected: FAIL — cannot resolve `@/config/model-entry-edits`.

- [ ] **Step 3: Write the implementation**

Create `src/config/model-entry-edits.ts`:

```ts
export function readModelEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function isInRange(entries: readonly unknown[], sourceIndex: number): boolean {
  return Number.isSafeInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < entries.length;
}

export function addModelEntry(value: unknown, entry: Record<string, unknown>): unknown[] {
  return [...readModelEntries(value), entry];
}

export function updateModelEntry(
  value: unknown,
  sourceIndex: number,
  entry: Record<string, unknown>
): unknown[] {
  const entries = readModelEntries(value);
  if (!isInRange(entries, sourceIndex)) {
    return entries;
  }

  entries[sourceIndex] = entry;
  return entries;
}

export function removeModelEntry(value: unknown, sourceIndex: number): unknown[] {
  const entries = readModelEntries(value);
  if (!isInRange(entries, sourceIndex)) {
    return entries;
  }

  entries.splice(sourceIndex, 1);
  return entries;
}

export function moveModelEntry(
  value: unknown,
  sourceIndex: number,
  direction: 'up' | 'down'
): unknown[] {
  const entries = readModelEntries(value);
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
  if (!isInRange(entries, sourceIndex) || !isInRange(entries, targetIndex)) {
    return entries;
  }

  const moved = entries[sourceIndex];
  entries[sourceIndex] = entries[targetIndex];
  entries[targetIndex] = moved;
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/config/model-entry-edits.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/config/model-entry-edits.ts test/unit/config/model-entry-edits.test.ts
git commit -m "feat(config): add pure edits for the model entry list"
```

---

### Task 5: Editor view state

Build everything the webview renders from raw entries, parser issues, and catalog metadata.

**Files:**
- Create: `src/runtime/model-editor-view.ts`
- Test: `test/unit/runtime/model-editor-view.test.ts`

**Interfaces:**
- Consumes: `parseModelSettings`, `ModelSettingsIssueCode` from `@/config/model-settings`; `RouterModelMetadata` from `@/router/model-catalog`; mode types from `@/types/product-model`
- Produces:
  - `interface ModelEditorRow { sourceIndex: number; valid: boolean; id?: string; name?: string; modelId?: string; serviceTier?: 'fast'; toolMode?: ToolMode; visionMode?: VisionMode; thinkingMode?: ThinkingMode; thinkingEfforts?: EnabledThinkingMode[]; maxInputTokens?: number; maxOutputTokens?: number; issue?: { code: ModelSettingsIssueCode; message: string }; catalogStatus: 'matched' | 'missing' }`
  - `interface ModelEditorCatalogEntry { modelId: string; ownedBy?: string; vision: boolean; contextWindow?: number; maxOutput?: number; inUse: boolean }`
  - `interface ModelEditorState { models: ModelEditorRow[]; catalog: ModelEditorCatalogEntry[]; warnings: string[] }`
  - `createModelEditorState(input: { entries: unknown; catalog: readonly RouterModelMetadata[]; workspaceOverride?: boolean }): ModelEditorState`

- [ ] **Step 1: Write the failing test**

Create `test/unit/runtime/model-editor-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createModelEditorState } from '@/runtime/model-editor-view';

const catalog = [
  { id: 'router/combo' },
  { id: 'cx/gpt-5.6-sol', ownedBy: 'cx', vision: true as const, contextWindow: 400_000, maxOutput: 128_000 }
];

describe('createModelEditorState', () => {
  it('renders valid rows with their configured fields', () => {
    const state = createModelEditorState({
      entries: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/combo',
          toolMode: 'auto',
          visionMode: 'off',
          thinkingMode: 'off',
          thinkingEfforts: [],
          maxInputTokens: 264_000,
          maxOutputTokens: 264_000
        }
      ],
      catalog
    });

    expect(state.models).toEqual([
      {
        sourceIndex: 0,
        valid: true,
        id: 'agent',
        name: 'Agent',
        modelId: 'router/combo',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000,
        catalogStatus: 'matched'
      }
    ]);
    expect(state.warnings).toEqual([]);
  });

  it('keeps rejected entries visible with their parser issue', () => {
    const state = createModelEditorState({
      entries: [{ id: 'agent', name: 'Agent', modelId: '' }],
      catalog
    });

    expect(state.models[0]).toMatchObject({
      sourceIndex: 0,
      valid: false,
      id: 'agent',
      name: 'Agent',
      catalogStatus: 'missing',
      issue: {
        code: 'INVALID_MODEL_MAPPING',
        message:
          'modelId must be a non-empty base 9router model id without a thinking suffix.'
      }
    });
  });

  it('flags configured models that no longer exist in the catalog', () => {
    const state = createModelEditorState({
      entries: [{ id: 'gone', name: 'Gone', modelId: 'retired/model' }],
      catalog
    });

    expect(state.models[0]?.catalogStatus).toBe('missing');
  });

  it('marks catalog entries already used by a configured model', () => {
    const state = createModelEditorState({
      entries: [{ id: 'agent', name: 'Agent', modelId: 'router/combo' }],
      catalog
    });

    expect(state.catalog).toEqual([
      { modelId: 'router/combo', vision: false, inUse: true },
      {
        modelId: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000,
        inUse: false
      }
    ]);
  });

  it('warns when the configured value is not an array', () => {
    const state = createModelEditorState({ entries: 'nope', catalog });

    expect(state.models).toEqual([]);
    expect(state.warnings).toEqual([
      '9router-copilot.models is not a list. Saving here replaces it with a new list.'
    ]);
  });

  it('warns when a workspace value overrides user settings', () => {
    const state = createModelEditorState({
      entries: [],
      catalog,
      workspaceOverride: true
    });

    expect(state.warnings).toEqual([
      'A workspace value for 9router-copilot.models overrides user settings. Changes saved here are written to user settings.'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-view.test.ts`
Expected: FAIL — cannot resolve `@/runtime/model-editor-view`.

- [ ] **Step 3: Write the implementation**

Create `src/runtime/model-editor-view.ts`:

```ts
import { parseModelSettings } from '@/config/model-settings';
import {
  ENABLED_THINKING_MODE_SET,
  THINKING_MODE_SET,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from '@/config/model-field-rules';
import type { ModelSettingsIssueCode } from '@/config/model-settings';
import type { RouterModelMetadata } from '@/router/model-catalog';
import type {
  EnabledThinkingMode,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '@/types/product-model';

const NOT_A_LIST_WARNING =
  '9router-copilot.models is not a list. Saving here replaces it with a new list.';
const WORKSPACE_OVERRIDE_WARNING =
  'A workspace value for 9router-copilot.models overrides user settings. Changes saved here are written to user settings.';

export interface ModelEditorRow {
  sourceIndex: number;
  valid: boolean;
  id?: string;
  name?: string;
  modelId?: string;
  serviceTier?: 'fast';
  toolMode?: ToolMode;
  visionMode?: VisionMode;
  thinkingMode?: ThinkingMode;
  thinkingEfforts?: EnabledThinkingMode[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  issue?: { code: ModelSettingsIssueCode; message: string };
  catalogStatus: 'matched' | 'missing';
}

export interface ModelEditorCatalogEntry {
  modelId: string;
  ownedBy?: string;
  vision: boolean;
  contextWindow?: number;
  maxOutput?: number;
  inUse: boolean;
}

export interface ModelEditorState {
  models: ModelEditorRow[];
  catalog: ModelEditorCatalogEntry[];
  warnings: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readMode<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | undefined {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : undefined;
}

function readThinkingEfforts(value: unknown): EnabledThinkingMode[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const efforts = value.filter(
    (effort): effort is EnabledThinkingMode =>
      typeof effort === 'string' && ENABLED_THINKING_MODE_SET.has(effort)
  );
  return efforts.length === value.length ? efforts : undefined;
}

function readTokens(value: unknown): number | undefined {
  return isPositiveInteger(value) ? value : undefined;
}

function createRow(
  entry: unknown,
  sourceIndex: number,
  issue: { code: ModelSettingsIssueCode; message: string } | undefined,
  catalogIds: ReadonlySet<string>
): ModelEditorRow {
  const source = isPlainObject(entry) ? entry : {};
  const id = readString(source.id);
  const name = readString(source.name);
  const modelId = readString(source.modelId);
  const toolMode = readMode<ToolMode>(source.toolMode, TOOL_MODES);
  const visionMode = readMode<VisionMode>(source.visionMode, VISION_MODES);
  const thinkingMode = readMode<ThinkingMode>(source.thinkingMode, THINKING_MODE_SET);
  const thinkingEfforts = readThinkingEfforts(source.thinkingEfforts);
  const maxInputTokens = readTokens(source.maxInputTokens);
  const maxOutputTokens = readTokens(source.maxOutputTokens);

  // `exactOptionalPropertyTypes` is on, so every optional property is spread in
  // from a narrowed local instead of assigned a possibly-undefined expression.
  return {
    sourceIndex,
    valid: issue === undefined,
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(modelId !== undefined ? { modelId } : {}),
    ...(source.serviceTier === 'fast' ? { serviceTier: 'fast' as const } : {}),
    ...(toolMode !== undefined ? { toolMode } : {}),
    ...(visionMode !== undefined ? { visionMode } : {}),
    ...(thinkingMode !== undefined ? { thinkingMode } : {}),
    ...(thinkingEfforts !== undefined ? { thinkingEfforts } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(issue !== undefined ? { issue } : {}),
    catalogStatus: modelId !== undefined && catalogIds.has(modelId) ? 'matched' : 'missing'
  };
}

export function createModelEditorState(input: {
  entries: unknown;
  catalog: readonly RouterModelMetadata[];
  workspaceOverride?: boolean;
}): ModelEditorState {
  const warnings: string[] = [];
  const isList = Array.isArray(input.entries);
  if (!isList) {
    warnings.push(NOT_A_LIST_WARNING);
  }
  if (input.workspaceOverride === true) {
    warnings.push(WORKSPACE_OVERRIDE_WARNING);
  }

  const entries = isList ? (input.entries as unknown[]) : [];
  const catalogIds = new Set(input.catalog.map((model) => model.id));
  const issuesByIndex = new Map<number, { code: ModelSettingsIssueCode; message: string }>();
  for (const issue of parseModelSettings(entries).issues) {
    if (issue.sourceIndex !== undefined && !issuesByIndex.has(issue.sourceIndex)) {
      issuesByIndex.set(issue.sourceIndex, { code: issue.code, message: issue.message });
    }
  }

  const models = entries.map((entry, sourceIndex) =>
    createRow(entry, sourceIndex, issuesByIndex.get(sourceIndex), catalogIds)
  );
  const configuredModelIds = new Set(
    models.map((model) => model.modelId).filter((modelId): modelId is string => Boolean(modelId))
  );

  return {
    models,
    catalog: input.catalog.map((model) => ({
      modelId: model.id,
      ...(model.ownedBy ? { ownedBy: model.ownedBy } : {}),
      vision: model.vision === true,
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxOutput !== undefined ? { maxOutput: model.maxOutput } : {}),
      inUse: configuredModelIds.has(model.id)
    })),
    warnings
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/runtime/model-editor-view.ts test/unit/runtime/model-editor-view.test.ts
git commit -m "feat(runtime): build model editor view state from settings and catalog"
```

---

### Task 6: HTML shell with list rendering

Static shell, CSP, nonce, and the part of the webview script that renders the list and posts row actions. The draft form markup ships here; its behaviour lands in Task 10.

**Files:**
- Create: `src/runtime/model-editor-html.ts`
- Test: `test/unit/runtime/model-editor-html.test.ts`

**Interfaces:**
- Produces: `createNonce(): string`, `renderModelEditorHtml(nonce: string): string`

- [ ] **Step 1: Write the failing test**

Create `test/unit/runtime/model-editor-html.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNonce, renderModelEditorHtml } from '@/runtime/model-editor-html';

describe('createNonce', () => {
  it('produces a fresh hex nonce per call', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('renderModelEditorHtml', () => {
  const html = renderModelEditorHtml('abc123');

  it('locks the page down with a nonce-bound CSP', () => {
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-abc123';">`
    );
    expect(html).toContain('<script nonce="abc123">');
    expect(html).not.toContain('img-src');
  });

  it('ships the list, form, and warning containers the script targets', () => {
    for (const id of [
      'warnings',
      'model-list',
      'add-model',
      'model-form',
      'field-id',
      'field-name',
      'field-model-id',
      'field-catalog',
      'field-service-tier',
      'field-thinking-mode',
      'field-max-input-tokens',
      'field-max-output-tokens',
      'form-save',
      'form-cancel',
      'refresh-catalog'
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('embeds no settings or catalog data', () => {
    expect(html).not.toContain('9router-copilot.models');
    expect(html).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-html.test.ts`
Expected: FAIL — cannot resolve `@/runtime/model-editor-html`.

- [ ] **Step 3: Write the shell and the list-rendering script**

Create `src/runtime/model-editor-html.ts`. The exported functions are:

```ts
import { randomBytes } from 'node:crypto';
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function renderModelEditorHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>9router Models</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="toolbar">
    <h1>9router models</h1>
    <div class="toolbar-actions">
      <button id="refresh-catalog" type="button">Refresh catalog</button>
      <button id="add-model" type="button" class="primary">Add model</button>
    </div>
  </header>
  <div id="warnings" class="warnings" role="status"></div>
  <div id="error" class="error" role="alert" hidden></div>
  <ul id="model-list" class="model-list"></ul>
  <form id="model-form" class="model-form" hidden>
    <h2 id="form-title">Add model</h2>
    <label for="field-catalog">9router model</label>
    <select id="field-catalog"></select>
    <label for="field-id">Copilot id</label>
    <input id="field-id" type="text" autocomplete="off" spellcheck="false">
    <p class="field-error" data-error-for="id"></p>
    <label for="field-name">Display name</label>
    <input id="field-name" type="text" autocomplete="off">
    <p class="field-error" data-error-for="name"></p>
    <label for="field-model-id">9router model id</label>
    <input id="field-model-id" type="text" autocomplete="off" spellcheck="false">
    <p class="field-error" data-error-for="modelId"></p>
    <label class="checkbox"><input id="field-service-tier" type="checkbox"> Fast tier</label>
    <fieldset><legend>Tool calling</legend>
      <label class="checkbox"><input type="radio" name="toolMode" value="auto"> auto</label>
      <label class="checkbox"><input type="radio" name="toolMode" value="off"> off</label>
    </fieldset>
    <fieldset><legend>Vision</legend>
      <label class="checkbox"><input type="radio" name="visionMode" value="native"> native</label>
      <label class="checkbox"><input type="radio" name="visionMode" value="proxy"> proxy</label>
      <label class="checkbox"><input type="radio" name="visionMode" value="off"> off</label>
    </fieldset>
    <label for="field-thinking-mode">Default thinking mode</label>
    <select id="field-thinking-mode">${THINKING_MODES.map(
      (mode) => `<option value="${mode}">${mode}</option>`
    ).join('')}</select>
    <fieldset id="field-thinking-efforts"><legend>Thinking efforts</legend>${ENABLED_THINKING_MODES.map(
      (mode) =>
        `<label class="checkbox"><input type="checkbox" name="thinkingEfforts" value="${mode}"> ${mode}</label>`
    ).join('')}</fieldset>
    <p class="field-error" data-error-for="thinkingEfforts"></p>
    <label for="field-max-input-tokens">Max input tokens</label>
    <input id="field-max-input-tokens" type="number" min="1" step="1">
    <p class="field-error" data-error-for="maxInputTokens"></p>
    <label for="field-max-output-tokens">Max output tokens</label>
    <input id="field-max-output-tokens" type="number" min="1" step="1">
    <p class="field-error" data-error-for="maxOutputTokens"></p>
    <div class="form-actions">
      <button id="form-cancel" type="button">Cancel</button>
      <button id="form-save" type="submit" class="primary">Save</button>
    </div>
  </form>
</main>
<script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
```

Define `STYLES` as a module-level string. Theme variables only — no external fonts, no images:

```css
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
main { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
h1 { font-size: 15px; margin: 0; }
h2 { font-size: 13px; margin: 0 0 8px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.toolbar-actions { display: flex; gap: 8px; }
button { font-family: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.warnings { display: flex; flex-direction: column; gap: 4px; }
.warning, .error { padding: 6px 8px; border-radius: 2px; font-size: 12px; }
.warning { border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); }
.error { border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
.model-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "name actions" "ids actions" "chips actions"; gap: 2px 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
.row.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
.row-name { grid-area: name; font-weight: 600; }
.row-ids { grid-area: ids; font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); }
.chips { grid-area: chips; display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.chip.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-foreground); }
.chip.bad { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-foreground); }
.row-actions { grid-area: actions; display: flex; align-items: flex-start; gap: 4px; }
.model-form { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
.model-form label { font-size: 12px; margin-top: 6px; }
.model-form input[type="text"], .model-form input[type="number"], .model-form select { font-family: inherit; font-size: 12px; padding: 3px 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
.model-form fieldset { margin: 8px 0 0; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 2px; display: flex; flex-wrap: wrap; gap: 10px; }
.model-form legend { font-size: 11px; color: var(--vscode-descriptionForeground); }
.checkbox { display: inline-flex; align-items: center; gap: 4px; margin-top: 0; }
.field-error { min-height: 14px; margin: 2px 0 0; font-size: 11px; color: var(--vscode-errorForeground); }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
```

Define `CLIENT_SCRIPT` as a module-level template string containing this script. Escape any backtick or `${` inside it, or build it with single-quoted string concatenation:

```js
const vscodeApi = acquireVsCodeApi();
let state = { models: [], catalog: [], warnings: [] };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function renderWarnings() {
  const host = document.getElementById('warnings');
  host.replaceChildren();
  for (const warning of state.warnings) {
    host.append(element('p', 'warning', warning));
  }
}

function renderChips(row) {
  const chips = element('div', 'chips');
  if (row.serviceTier === 'fast') { chips.append(element('span', 'chip', 'Fast')); }
  chips.append(element('span', 'chip', 'tools: ' + (row.toolMode || 'off')));
  chips.append(element('span', 'chip', 'vision: ' + (row.visionMode || 'off')));
  chips.append(element('span', 'chip', 'thinking: ' + (row.thinkingMode || 'off')));
  if (row.catalogStatus === 'missing') {
    chips.append(element('span', 'chip warn', 'not in catalog'));
  }
  if (row.issue) { chips.append(element('span', 'chip bad', row.issue.message)); }
  return chips;
}

function renderList() {
  const list = document.getElementById('model-list');
  list.replaceChildren();
  state.models.forEach(function (row, index) {
    const item = element('li', row.valid ? 'row' : 'row invalid');
    item.append(element('div', 'row-name', row.name || row.id || 'Unnamed model'));
    item.append(element('div', 'row-ids', (row.id || '(no id)') + ' -> ' + (row.modelId || '(no modelId)')));
    item.append(renderChips(row));
    const actions = element('div', 'row-actions');
    const edit = element('button', '', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', function () { openForm(row.sourceIndex); });
    const remove = element('button', '', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'removeModel', sourceIndex: row.sourceIndex });
    });
    const up = element('button', '', 'Up');
    up.type = 'button';
    up.disabled = index === 0;
    up.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'moveModel', sourceIndex: row.sourceIndex, direction: 'up' });
    });
    const down = element('button', '', 'Down');
    down.type = 'button';
    down.disabled = index === state.models.length - 1;
    down.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'moveModel', sourceIndex: row.sourceIndex, direction: 'down' });
    });
    actions.append(edit, remove, up, down);
    item.append(actions);
    list.append(item);
  });
}

function showError(message) {
  const host = document.getElementById('error');
  host.textContent = message;
  host.hidden = message.length === 0;
}

window.addEventListener('message', function (event) {
  const message = event.data;
  if (!message || typeof message !== 'object') { return; }
  if (message.type === 'state') {
    state = message.state;
    showError('');
    renderWarnings();
    renderList();
    renderCatalogOptions();
  }
  if (message.type === 'error') { showError(String(message.message)); }
});

document.getElementById('refresh-catalog').addEventListener('click', function () {
  vscodeApi.postMessage({ type: 'refreshCatalog' });
});

vscodeApi.postMessage({ type: 'ready' });
```

Task 10 adds `openForm`, `renderCatalogOptions`, and the submit handler. For this task, declare both as no-op stubs at the bottom of `CLIENT_SCRIPT` so the script parses and the list renders:

```js
function openForm() {}
function renderCatalogOptions() {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/runtime/model-editor-html.ts test/unit/runtime/model-editor-html.test.ts
git commit -m "feat(runtime): render the model editor webview shell"
```

---

### Task 7: Panel open flow

Fetch the catalog, refuse to open when it fails, and push the first state. Includes the test-stub upgrades the panel tests need.

**Files:**
- Create: `src/runtime/model-editor-panel.ts`
- Modify: `src/config/settings.ts` (export `isUsableRuntimeSettings`)
- Modify: `src/runtime/vision-configuration.ts:427-441` (use the shared guard, delete the local `isValidRuntime`)
- Modify: `test/support/vscode.ts:134-169` (webview messaging), `:222-249` (`showWarningMessage`), `:253-271` (`inspect`, real configuration listeners), `:350-364` (`__getWebviewPanels` returns the panel object)
- Test: `test/unit/runtime/model-editor-panel.test.ts`

**Interfaces:**
- Consumes: `getApiKey` from `@/config/secret-store`; `RouterClient`; `RuntimeSettings`; `createAbortSignalFromToken` from `@/provider/cancellation`; `createModelEditorState` (Task 5); `createNonce`, `renderModelEditorHtml` (Task 6)
- Produces:
  - `type ModelEditorOpener = (token: vscode.CancellationToken) => Promise<void>`
  - `createModelEditorOpener(dependencies: { secrets: vscode.SecretStorage; routerClient: RouterClient; getRuntimeSettings: () => RuntimeSettings }): ModelEditorOpener`
  - `__resetModelEditorPanelForTests(): void`
  - From `@/config/settings`: `isUsableRuntimeSettings(runtime: RuntimeSettings): boolean`

- [ ] **Step 1: Upgrade the vscode test stub**

In `test/support/vscode.ts`:

Replace the inline `webview` object on `WebviewPanel` with a `Webview` class placed above it:

```ts
class Webview {
  public html = '';
  public readonly postedMessages: unknown[] = [];
  private readonly messageListeners = new Set<(message: unknown) => void>();

  public readonly onDidReceiveMessage = (listener: (message: unknown) => void): Disposable => {
    this.messageListeners.add(listener);
    return new Disposable(() => {
      this.messageListeners.delete(listener);
    });
  };

  public async postMessage(message: unknown): Promise<boolean> {
    this.postedMessages.push(message);
    return true;
  }

  public async receiveMessage(message: unknown): Promise<void> {
    for (const listener of [...this.messageListeners]) {
      await listener(message);
    }
  }
}
```

and in `WebviewPanel` use `public readonly webview = new Webview();`.

Add to the `window` object:

```ts
  async showWarningMessage(message: string, ...items: unknown[]): Promise<string | undefined> {
    warningMessages.push(message);
    const actions = items.filter((item): item is string => typeof item === 'string');
    return warningResponse === undefined ? actions[0] : warningResponse;
  },
```

with module-level `const warningMessages: string[] = [];`, `let warningResponse: string | undefined;`, plus `__getWarningMessages()` and `__setWarningResponse(value: string | undefined)` exports, and reset both in `__resetVscodeState`.

Extend `workspace.getConfiguration()` with `inspect`:

```ts
      inspect<T>(key: string): { defaultValue?: T; globalValue?: T; workspaceValue?: T } {
        return {
          ...(configurationDefaults.has(key)
            ? { defaultValue: configurationDefaults.get(key) as T }
            : {}),
          ...(configurationValues.has(key)
            ? { globalValue: configurationValues.get(key) as T }
            : {}),
          ...(configurationWorkspaceValues.has(key)
            ? { workspaceValue: configurationWorkspaceValues.get(key) as T }
            : {})
        };
      },
```

with `const configurationDefaults = new Map<string, unknown>();`, `const configurationWorkspaceValues = new Map<string, unknown>();`, exported setters `__setConfigurationDefaults` and `__setConfigurationWorkspaceValues`, and both cleared in `__resetVscodeState`.

Make `onDidChangeConfiguration` register real listeners:

```ts
const configurationListeners = new Set<(event: { affectsConfiguration: (section: string) => boolean }) => void>();

  onDidChangeConfiguration(
    listener: (event: { affectsConfiguration: (section: string) => boolean }) => void
  ): Disposable {
    configurationListeners.add(listener);
    return new Disposable(() => {
      configurationListeners.delete(listener);
    });
  }
```

with `export function __fireConfigurationChange(section: string): void` that calls every listener with `{ affectsConfiguration: (candidate: string) => section.startsWith(candidate) }`, and `configurationListeners.clear()` in `__resetVscodeState`.

Finally, add `export function __getWebviewPanelObjects(): WebviewPanel[] { return [...webviewPanels]; }` so tests can reach `panel.webview.receiveMessage` and `panel.webview.postedMessages`. Leave the existing `__getWebviewPanels` shape untouched — other tests depend on it.

- [ ] **Step 2: Write the failing test**

Create `test/unit/runtime/model-editor-panel.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __fireConfigurationChange,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues,
  __createCancellationToken
} from '@test/support/vscode';
import { NineRouterError } from '@/router/errors';
import {
  __resetModelEditorPanelForTests,
  createModelEditorOpener
} from '@/runtime/model-editor-panel';
import type { RouterClient } from '@/router/client';

const runtime = {
  baseUrl: 'http://127.0.0.1:20128/v1',
  requestTimeoutMs: 60_000,
  debugMode: 'minimal' as const,
  visionProxySource: undefined,
  visionProxyModelId: '',
  visionProxyPrompt: 'prompt'
};

function createDependencies(overrides: {
  apiKey?: string | undefined;
  listModels?: RouterClient['listModels'];
} = {}) {
  return {
    secrets: {
      get: async () => overrides.apiKey ?? 'test-key',
      store: async () => undefined,
      delete: async () => undefined
    } as unknown as Parameters<typeof createModelEditorOpener>[0]['secrets'],
    routerClient: {
      listModels: overrides.listModels ?? (async () => [{ id: 'router/combo' }])
    } as unknown as RouterClient,
    getRuntimeSettings: () => runtime
  };
}

describe('createModelEditorOpener', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetModelEditorPanelForTests();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  afterEach(() => {
    __resetModelEditorPanelForTests();
  });

  it('opens one panel and answers ready with the current state', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);

    const panels = __getWebviewPanelObjects();
    expect(panels).toHaveLength(1);
    expect(panels[0]?.webview.html).toContain('id="model-list"');

    await panels[0]?.webview.receiveMessage({ type: 'ready' });

    expect(panels[0]?.webview.postedMessages).toEqual([
      {
        type: 'state',
        state: {
          models: [],
          catalog: [{ modelId: 'router/combo', vision: false, inUse: false }],
          warnings: []
        }
      }
    ]);
  });

  it('reveals the existing panel instead of creating a second one', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();

    await open(token.value);
    await open(token.value);

    expect(__getWebviewPanelObjects()).toHaveLength(1);
  });

  it('refuses to open without an API key', async () => {
    const open = createModelEditorOpener(createDependencies({ apiKey: undefined }));
    const token = __createCancellationToken();

    await expect(open(token.value)).rejects.toBeInstanceOf(NineRouterError);
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('refuses to open when the catalog request fails', async () => {
    const listModels = vi.fn(async () => {
      throw new NineRouterError('UPSTREAM_UNAVAILABLE', 'catalog down');
    }) as unknown as RouterClient['listModels'];
    const open = createModelEditorOpener(createDependencies({ listModels }));
    const token = __createCancellationToken();

    await expect(open(token.value)).rejects.toThrow('catalog down');
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('pushes fresh state when configuration changes', async () => {
    const open = createModelEditorOpener(createDependencies());
    const token = __createCancellationToken();
    await open(token.value);
    const panel = __getWebviewPanelObjects()[0];
    await panel?.webview.receiveMessage({ type: 'ready' });

    __setConfigurationValues({
      models: [{ id: 'agent', name: 'Agent', modelId: 'router/combo' }]
    });
    __fireConfigurationChange('9router-copilot.models');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const last = panel?.webview.postedMessages.at(-1) as { state: { models: unknown[] } };
    expect(last.state.models).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-panel.test.ts`
Expected: FAIL — cannot resolve `@/runtime/model-editor-panel`.

- [ ] **Step 4: Share the runtime guard**

In `src/config/settings.ts`, add and export:

```ts
export function isUsableRuntimeSettings(runtime: RuntimeSettings): boolean {
  if (!Number.isFinite(runtime.requestTimeoutMs) || runtime.requestTimeoutMs <= 0) {
    return false;
  }

  try {
    const url = new URL(runtime.baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
```

In `src/runtime/vision-configuration.ts`, delete the local `isValidRuntime` function, import `isUsableRuntimeSettings` from `@/config/settings`, and replace the single call site.

- [ ] **Step 5: Write the panel module**

Create `src/runtime/model-editor-panel.ts`:

```ts
import * as vscode from 'vscode';
import { getApiKey } from '@/config/secret-store';
import { isUsableRuntimeSettings } from '@/config/settings';
import { NineRouterError } from '@/router/errors';
import { createAbortSignalFromToken } from '@/provider/cancellation';
import { createModelEditorState } from './model-editor-view';
import { createNonce, renderModelEditorHtml } from './model-editor-html';
import type { RuntimeSettings } from '@/config/settings';
import type { RouterClient } from '@/router/client';
import type { RouterModelMetadata } from '@/router/model-catalog';

const MODEL_EDITOR_VIEW_TYPE = '9routerCopilot.models';
const SECTION = '9router-copilot';
const MODELS_KEY = 'models';

export type ModelEditorOpener = (token: vscode.CancellationToken) => Promise<void>;

interface Dependencies {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getRuntimeSettings: () => RuntimeSettings;
}

interface PanelSession {
  panel: vscode.WebviewPanel;
  catalog: readonly RouterModelMetadata[];
  subscriptions: vscode.Disposable[];
}

let session: PanelSession | undefined;

async function fetchCatalog(
  dependencies: Dependencies,
  token: vscode.CancellationToken
): Promise<RouterModelMetadata[]> {
  const apiKey = await getApiKey(dependencies.secrets);
  if (!apiKey) {
    throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
  }

  const runtime = dependencies.getRuntimeSettings();
  if (!isUsableRuntimeSettings(runtime)) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      '9router runtime settings are invalid. Check diagnostics for details.'
    );
  }

  const cancellation = createAbortSignalFromToken(token);
  try {
    return await dependencies.routerClient.listModels({
      baseUrl: runtime.baseUrl,
      apiKey,
      timeoutMs: runtime.requestTimeoutMs,
      signal: cancellation.signal
    });
  } finally {
    cancellation.cleanup();
  }
}

function readGlobalEntries(): unknown {
  const configuration = vscode.workspace.getConfiguration(SECTION);
  const inspection = configuration.inspect<unknown>(MODELS_KEY);
  return inspection?.globalValue ?? inspection?.defaultValue ?? [];
}

function hasWorkspaceOverride(): boolean {
  const configuration = vscode.workspace.getConfiguration(SECTION);
  return configuration.inspect<unknown>(MODELS_KEY)?.workspaceValue !== undefined;
}

async function postState(current: PanelSession): Promise<void> {
  await current.panel.webview.postMessage({
    type: 'state',
    state: createModelEditorState({
      entries: readGlobalEntries(),
      catalog: current.catalog,
      ...(hasWorkspaceOverride() ? { workspaceOverride: true } : {})
    })
  });
}

export function createModelEditorOpener(dependencies: Dependencies): ModelEditorOpener {
  return async (token) => {
    const catalog = await fetchCatalog(dependencies, token);

    if (session) {
      session.catalog = catalog;
      session.panel.reveal(vscode.ViewColumn.Active, false);
      await postState(session);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MODEL_EDITOR_VIEW_TYPE,
      '9router Models',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );
    panel.webview.html = renderModelEditorHtml(createNonce());

    const current: PanelSession = { panel, catalog, subscriptions: [] };
    session = current;

    current.subscriptions.push(
      // Return the promise rather than discarding it: VS Code accepts a thenable
      // listener, and the tests await the dispatch through the stub.
      panel.webview.onDidReceiveMessage((message: unknown) =>
        handleMessage(message, current, dependencies)
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.${MODELS_KEY}`)) {
          void postState(current);
        }
      })
    );

    panel.onDidDispose(() => {
      for (const subscription of current.subscriptions) {
        subscription.dispose();
      }
      current.subscriptions.length = 0;
      if (session === current) {
        session = undefined;
      }
    });
  };
}

async function handleMessage(
  message: unknown,
  current: PanelSession,
  dependencies: Dependencies
): Promise<void> {
  void dependencies;
  if (typeof message !== 'object' || message === null) {
    return;
  }

  const { type } = message as { type?: unknown };
  if (type === 'ready') {
    await postState(current);
  }
}
```

`PanelSession.catalog` holds a readonly array but is itself a mutable property, because reopening the panel and `refreshCatalog` both reassign it. Declare it exactly as `catalog: readonly RouterModelMetadata[];`.

Add the reset hook the tests use:

```ts
export function __resetModelEditorPanelForTests(): void {
  session?.panel.dispose();
  session = undefined;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-panel.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite (the stub changed, everything depends on it)**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add src/runtime/model-editor-panel.ts src/config/settings.ts src/runtime/vision-configuration.ts test/support/vscode.ts test/unit/runtime/model-editor-panel.test.ts
git commit -m "feat(runtime): open the model editor panel with router catalog state"
```

---

### Task 8: Panel mutations

Translate webview messages into settings writes, always re-reading the current user-scope list first.

**Files:**
- Modify: `src/runtime/model-editor-panel.ts` (replace `handleMessage`)
- Test: `test/unit/runtime/model-editor-panel.test.ts` (append a mutation describe block)

**Interfaces:**
- Consumes: `addModelEntry`, `updateModelEntry`, `removeModelEntry`, `moveModelEntry` (Task 4); `toSettingsEntry`, `validateDraft` (Tasks 2 and 3)
- Produces: no new exports; the message contract is `ready`, `saveModel`, `removeModel`, `moveModel`, `refreshCatalog`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/runtime/model-editor-panel.test.ts`:

```ts
import { __getConfigurationUpdates, __setWarningResponse } from '@test/support/vscode';

const draft = {
  id: 'agent',
  name: 'Agent',
  modelId: 'router/combo',
  toolMode: 'auto',
  visionMode: 'off',
  thinkingMode: 'off',
  thinkingEfforts: [],
  maxInputTokens: 264_000,
  maxOutputTokens: 264_000
};

async function openPanel() {
  const open = createModelEditorOpener(createDependencies());
  const token = __createCancellationToken();
  await open(token.value);
  const panel = __getWebviewPanelObjects()[0];
  if (!panel) {
    throw new Error('panel was not created');
  }
  return panel;
}

describe('model editor mutations', () => {
  beforeEach(() => {
    __resetVscodeState();
    __resetModelEditorPanelForTests();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  it('appends a validated draft', async () => {
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: null, draft });

    expect(__getConfigurationUpdates()).toEqual([
      { key: 'models', value: [draft], target: 1 }
    ]);
  });

  it('overwrites the entry at a given index', async () => {
    __setConfigurationValues({ models: [{ id: 'old', name: 'Old', modelId: 'router/combo' }] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: 0, draft });

    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([draft]);
  });

  it('rejects an invalid draft without writing settings', async () => {
    const panel = await openPanel();

    await panel.webview.receiveMessage({
      type: 'saveModel',
      sourceIndex: null,
      draft: { ...draft, id: 'Bad Id' }
    });

    expect(__getConfigurationUpdates()).toEqual([]);
    expect(panel.webview.postedMessages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('rejects a duplicate id against the other entries', async () => {
    __setConfigurationValues({ models: [draft] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: null, draft });

    expect(__getConfigurationUpdates()).toEqual([]);
    expect(panel.webview.postedMessages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('deletes only after a modal confirmation', async () => {
    __setConfigurationValues({ models: [draft] });
    __setWarningResponse(undefined);
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'removeModel', sourceIndex: 0 });
    expect(__getConfigurationUpdates()).toEqual([]);

    __setWarningResponse('Delete');
    await panel.webview.receiveMessage({ type: 'removeModel', sourceIndex: 0 });
    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([]);
  });

  it('moves an entry within the list', async () => {
    const second = { ...draft, id: 'second' };
    __setConfigurationValues({ models: [draft, second] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'moveModel', sourceIndex: 1, direction: 'up' });

    expect(__getConfigurationUpdates().at(-1)?.value).toEqual([second, draft]);
  });

  it('ignores out-of-range indexes', async () => {
    __setConfigurationValues({ models: [draft] });
    const panel = await openPanel();

    await panel.webview.receiveMessage({ type: 'moveModel', sourceIndex: 9, direction: 'up' });
    await panel.webview.receiveMessage({ type: 'saveModel', sourceIndex: 9, draft });

    expect(__getConfigurationUpdates()).toEqual([]);
  });
});
```

Note: `__setWarningResponse(undefined)` must mean "user dismissed"; implement the stub so an explicit `undefined` response is returned rather than defaulting to the first action. Track it with a separate `let warningResponseSet = false;` flag in the stub.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-panel.test.ts`
Expected: FAIL — mutations are not handled; no configuration updates recorded.

- [ ] **Step 3: Implement the dispatcher**

Replace `handleMessage` in `src/runtime/model-editor-panel.ts` and add the imports:

```ts
import {
  addModelEntry,
  moveModelEntry,
  readModelEntries,
  removeModelEntry,
  updateModelEntry
} from '@/config/model-entry-edits';
import { toSettingsEntry, validateDraft } from '@/config/model-draft';
```

```ts
function readEntryId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return undefined;
  }

  const { id } = entry as { id?: unknown };
  return typeof id === 'string' ? id : undefined;
}

function isInRange(entries: readonly unknown[], sourceIndex: unknown): sourceIndex is number {
  return (
    typeof sourceIndex === 'number' &&
    Number.isSafeInteger(sourceIndex) &&
    sourceIndex >= 0 &&
    sourceIndex < entries.length
  );
}

async function writeEntries(
  current: PanelSession,
  entries: unknown[]
): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update(MODELS_KEY, entries, vscode.ConfigurationTarget.Global);
  } catch {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to update ${SECTION}.${MODELS_KEY}.`,
      { details: { phase: 'model-editor', settingsKey: `${SECTION}.${MODELS_KEY}` } }
    );
  }

  await postState(current);
}

async function postError(current: PanelSession, message: string): Promise<void> {
  await current.panel.webview.postMessage({ type: 'error', message });
}

async function handleSaveModel(
  message: { sourceIndex?: unknown; draft?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  const rawIndex = message.sourceIndex;
  const isEdit = rawIndex !== null && rawIndex !== undefined;
  if (isEdit && !isInRange(entries, rawIndex)) {
    await postError(current, 'That model no longer exists. Reopen the panel and try again.');
    return;
  }

  const editIndex = isEdit ? (rawIndex as number) : undefined;
  const takenIds = entries
    .map((entry, index) => (index === editIndex ? undefined : readEntryId(entry)))
    .filter((id): id is string => id !== undefined);
  const validation = validateDraft(message.draft, { takenIds });
  if (!validation.draft) {
    await postError(current, validation.errors.map((error) => error.message).join(' '));
    return;
  }

  const entry = toSettingsEntry(validation.draft);
  await writeEntries(
    current,
    editIndex === undefined
      ? addModelEntry(entries, entry)
      : updateModelEntry(entries, editIndex, entry)
  );
}

async function handleRemoveModel(
  message: { sourceIndex?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  if (!isInRange(entries, message.sourceIndex)) {
    return;
  }

  const label = readEntryId(entries[message.sourceIndex]) ?? 'this model';
  const confirmation = await vscode.window.showWarningMessage(
    `Delete ${label} from the Copilot model picker?`,
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  await writeEntries(current, removeModelEntry(entries, message.sourceIndex));
}

async function handleMoveModel(
  message: { sourceIndex?: unknown; direction?: unknown },
  current: PanelSession
): Promise<void> {
  const entries = readModelEntries(readGlobalEntries());
  const direction = message.direction === 'up' || message.direction === 'down' ? message.direction : undefined;
  if (!direction || !isInRange(entries, message.sourceIndex)) {
    return;
  }

  const next = moveModelEntry(entries, message.sourceIndex, direction);
  if (next.every((entry, index) => entry === entries[index])) {
    return;
  }

  await writeEntries(current, next);
}

async function handleMessage(
  message: unknown,
  current: PanelSession,
  dependencies: Dependencies
): Promise<void> {
  if (typeof message !== 'object' || message === null) {
    return;
  }

  const payload = message as {
    type?: unknown;
    sourceIndex?: unknown;
    direction?: unknown;
    draft?: unknown;
  };

  try {
    if (payload.type === 'ready') {
      await postState(current);
      return;
    }
    if (payload.type === 'saveModel') {
      await handleSaveModel(payload, current);
      return;
    }
    if (payload.type === 'removeModel') {
      await handleRemoveModel(payload, current);
      return;
    }
    if (payload.type === 'moveModel') {
      await handleMoveModel(payload, current);
      return;
    }
    if (payload.type === 'refreshCatalog') {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        current.catalog = await fetchCatalog(dependencies, cancellation.token);
        await postState(current);
      } finally {
        cancellation.dispose();
      }
    }
  } catch (error) {
    const failure =
      error instanceof NineRouterError ? error.message : 'Unexpected model editor error';
    await postError(current, failure);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
pnpm test
git add src/runtime/model-editor-panel.ts test/support/vscode.ts test/unit/runtime/model-editor-panel.test.ts
git commit -m "feat(runtime): apply model editor mutations to user settings"
```

---

### Task 9: Command wiring

Contribute the command, register it, and report open-time failures the way the other commands do.

**Files:**
- Modify: `package.json` (`contributes.commands`)
- Modify: `src/runtime/commands.ts:17-22` (dependencies) and the registration block
- Modify: `src/runtime/activate.ts:41-68`
- Test: `test/integration/extension/manage-models-command.test.ts`
- Test: `test/integration/extension/release-guardrails.test.ts` (append)

**Interfaces:**
- Consumes: `ModelEditorOpener` from `@/runtime/model-editor-panel`
- Produces: `CommandDependencies.manageModels?: ModelEditorOpener`

- [ ] **Step 1: Write the failing test**

Create `test/integration/extension/manage-models-command.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __getCommandHandler,
  __getErrorMessages,
  __getWebviewPanelObjects,
  __resetVscodeState,
  __setConfigurationDefaults,
  __setConfigurationValues
} from '@test/support/vscode';
import { NineRouterError } from '@/router/errors';
import { registerCommands } from '@/runtime/commands';

function createContext() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    secrets: {
      get: async () => 'test-key',
      store: async () => undefined,
      delete: async () => undefined
    }
  } as unknown as Parameters<typeof registerCommands>[0];
}

describe('9routerCopilot.manageModels', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationDefaults({ models: [] });
    __setConfigurationValues({ models: [] });
  });

  it('runs the opener', async () => {
    let opened = 0;
    registerCommands(createContext(), {
      manageModels: async () => {
        opened += 1;
      }
    });

    await __getCommandHandler('9routerCopilot.manageModels')?.();

    expect(opened).toBe(1);
    expect(__getWebviewPanelObjects()).toHaveLength(0);
  });

  it('surfaces opener failures as error messages', async () => {
    registerCommands(createContext(), {
      manageModels: async () => {
        throw new NineRouterError('AUTHENTICATION_ERROR', '9router API key is not configured');
      }
    });

    await __getCommandHandler('9routerCopilot.manageModels')?.();

    expect(__getErrorMessages().at(-1)).toContain('9router API key is not configured');
  });
});
```

Append to `test/integration/extension/release-guardrails.test.ts` inside the existing `describe`:

```ts
  it('contributes the manage models command', () => {
    const commands = manifest.contributes.commands as Array<{ command: string; title: string }>;

    expect(commands).toContainEqual({
      command: '9routerCopilot.manageModels',
      title: '9router: Manage Models'
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/integration/extension/manage-models-command.test.ts test/integration/extension/release-guardrails.test.ts`
Expected: FAIL — no such command handler; manifest lacks the contribution.

- [ ] **Step 3: Contribute the command in `package.json`**

Add to `contributes.commands`, after the `configureVisionProxy` entry:

```json
      {
        "command": "9routerCopilot.manageModels",
        "title": "9router: Manage Models"
      }
```

- [ ] **Step 4: Register the command**

In `src/runtime/commands.ts`, extend `CommandDependencies`:

```ts
  manageModels?: ModelEditorOpener;
```

with `import type { ModelEditorOpener } from './model-editor-panel';`, and register:

```ts
  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.manageModels', async () => {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        await dependencies.manageModels?.(cancellation.token);
      } catch (error) {
        const requestId = error instanceof NineRouterError ? error.requestId : undefined;
        const message =
          error instanceof NineRouterError ? error.message : 'Unexpected model editor error';
        await vscode.window.showErrorMessage(
          `9router model setup failed: ${message}${requestId ? ` Request ID: ${requestId}.` : ''}`
        );
      } finally {
        cancellation.dispose();
      }
    })
  );
```

In `src/runtime/activate.ts`, build the opener next to `configureVisionProxy` and pass it through:

```ts
  const manageModels = createModelEditorOpener({
    secrets: context.secrets,
    routerClient,
    getRuntimeSettings: () => loadRuntimeSettings(getExtensionConfiguration())
  });
```

then add `manageModels` to the `registerRuntimeCommands(context, { ... })` object, with `import { createModelEditorOpener } from './model-editor-panel';`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
pnpm lint
git add package.json src/runtime/commands.ts src/runtime/activate.ts test/integration/extension/manage-models-command.test.ts test/integration/extension/release-guardrails.test.ts
git commit -m "feat(runtime): register the 9router manage models command"
```

---

### Task 10: Draft form behaviour

Fill in the two client-script stubs so the form actually edits models, then verify the panel by hand in the Extension Development Host.

**Files:**
- Modify: `src/runtime/model-editor-html.ts` (`CLIENT_SCRIPT`)
- Test: `test/unit/runtime/model-editor-html.test.ts` (append)

**Interfaces:**
- Consumes: the `state` message shape from Task 5 and the `saveModel` contract from Task 8
- Produces: no new module exports

- [ ] **Step 1: Write the failing test**

Append to `test/unit/runtime/model-editor-html.test.ts`:

```ts
describe('client script behaviour', () => {
  const html = renderModelEditorHtml('abc123');

  it('wires the form to the save message contract', () => {
    expect(html).toContain("type: 'saveModel'");
    expect(html).toContain('editingSourceIndex');
    expect(html).toContain('prefillFromCatalog');
  });

  it('has no stubbed handlers left', () => {
    expect(html).not.toContain('function openForm() {}');
    expect(html).not.toContain('function renderCatalogOptions() {}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/runtime/model-editor-html.test.ts`
Expected: FAIL — the stubs are still present.

- [ ] **Step 3: Replace the stubs with the real form logic**

In `CLIENT_SCRIPT`, delete `function openForm() {}` and `function renderCatalogOptions() {}` and add:

```js
let editingSourceIndex = null;

function renderCatalogOptions() {
  const select = document.getElementById('field-catalog');
  select.replaceChildren();
  const blank = element('option', '', 'Select a 9router model');
  blank.value = '';
  select.append(blank);
  for (const entry of state.catalog) {
    const option = element(
      'option',
      '',
      entry.modelId + (entry.inUse ? ' (in use)' : '') + (entry.vision ? ' - vision' : '')
    );
    option.value = entry.modelId;
    select.append(option);
  }
}

function setRadio(name, value) {
  const inputs = document.querySelectorAll('input[name="' + name + '"]');
  inputs.forEach(function (input) { input.checked = input.value === value; });
}

function readRadio(name, fallback) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : fallback;
}

function setCheckboxGroup(name, values) {
  const inputs = document.querySelectorAll('input[name="' + name + '"]');
  inputs.forEach(function (input) { input.checked = values.indexOf(input.value) >= 0; });
}

function readCheckboxGroup(name) {
  const values = [];
  document.querySelectorAll('input[name="' + name + '"]:checked').forEach(function (input) {
    values.push(input.value);
  });
  return values;
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(function (node) { node.textContent = ''; });
}

function fillForm(draft) {
  document.getElementById('field-id').value = draft.id || '';
  document.getElementById('field-name').value = draft.name || '';
  document.getElementById('field-model-id').value = draft.modelId || '';
  document.getElementById('field-service-tier').checked = draft.serviceTier === 'fast';
  setRadio('toolMode', draft.toolMode || 'off');
  setRadio('visionMode', draft.visionMode || 'off');
  document.getElementById('field-thinking-mode').value = draft.thinkingMode || 'off';
  setCheckboxGroup('thinkingEfforts', draft.thinkingEfforts || []);
  document.getElementById('field-max-input-tokens').value = String(draft.maxInputTokens || 264000);
  document.getElementById('field-max-output-tokens').value = String(draft.maxOutputTokens || 264000);
}

function sanitizeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-._]+$/, '');
}

function prefillFromCatalog(modelId) {
  const entry = state.catalog.filter(function (item) { return item.modelId === modelId; })[0];
  if (!entry) { return; }
  const separator = modelId.lastIndexOf('/');
  const maxOutput = entry.maxOutput || 264000;
  const derivedInput = entry.contextWindow ? entry.contextWindow - maxOutput : 0;
  const taken = state.models
    .filter(function (row, index) { return index !== editingSourceIndex && row.id; })
    .map(function (row) { return row.id; });
  let id = sanitizeId(modelId);
  let suffix = 2;
  while (id && taken.indexOf(id) >= 0 && suffix <= 100) {
    id = sanitizeId(modelId) + '-' + suffix;
    suffix += 1;
  }
  fillForm({
    id: id,
    name: separator >= 0 ? modelId.slice(separator + 1) : modelId,
    modelId: modelId,
    toolMode: 'auto',
    visionMode: entry.vision ? 'native' : 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens: derivedInput > 0 ? derivedInput : 264000,
    maxOutputTokens: maxOutput
  });
}

function openForm(sourceIndex) {
  editingSourceIndex = sourceIndex === undefined ? null : sourceIndex;
  clearFieldErrors();
  renderCatalogOptions();
  const row = state.models.filter(function (item) { return item.sourceIndex === editingSourceIndex; })[0];
  document.getElementById('form-title').textContent = row ? 'Edit model' : 'Add model';
  document.getElementById('field-catalog').value = row && row.modelId ? row.modelId : '';
  fillForm(row || { toolMode: 'auto', visionMode: 'off', thinkingMode: 'off', thinkingEfforts: [] });
  document.getElementById('model-form').hidden = false;
}

function closeForm() {
  editingSourceIndex = null;
  document.getElementById('model-form').hidden = true;
}

function readDraft() {
  const serviceTier = document.getElementById('field-service-tier').checked ? 'fast' : undefined;
  const draft = {
    id: document.getElementById('field-id').value.trim(),
    name: document.getElementById('field-name').value.trim(),
    modelId: document.getElementById('field-model-id').value.trim(),
    toolMode: readRadio('toolMode', 'off'),
    visionMode: readRadio('visionMode', 'off'),
    thinkingMode: document.getElementById('field-thinking-mode').value,
    thinkingEfforts: readCheckboxGroup('thinkingEfforts'),
    maxInputTokens: Number(document.getElementById('field-max-input-tokens').value),
    maxOutputTokens: Number(document.getElementById('field-max-output-tokens').value)
  };
  if (serviceTier) { draft.serviceTier = serviceTier; }
  return draft;
}

document.getElementById('add-model').addEventListener('click', function () { openForm(); });
document.getElementById('form-cancel').addEventListener('click', closeForm);
document.getElementById('field-catalog').addEventListener('change', function (event) {
  if (event.target.value) { prefillFromCatalog(event.target.value); }
});
document.getElementById('model-form').addEventListener('submit', function (event) {
  event.preventDefault();
  clearFieldErrors();
  vscodeApi.postMessage({
    type: 'saveModel',
    sourceIndex: editingSourceIndex,
    draft: readDraft()
  });
});
```

Also close the form whenever a fresh `state` message arrives after a successful save: inside the `state` branch of the message listener, add `if (pendingSave) { pendingSave = false; closeForm(); }`, with `let pendingSave = false;` set to `true` in the submit handler and back to `false` in the `error` branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/runtime/model-editor-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify in the Extension Development Host**

Run `pnpm build`, press F5 in VS Code to launch the host, then in the new window:

1. Run `9router: Set API Key` and enter a working key.
2. Run `9router: Manage Models`. Expect the panel to open showing the default `agent` entry with a red badge reading `modelId must be a non-empty base 9router model id without a thinking suffix.`
3. Click Edit on that row, pick a model from the 9router dropdown, confirm id, name, vision, and both token fields populate, then Save. Expect the badge to disappear.
4. Open the Copilot Chat model picker and confirm the model is listed under 9router.
5. Click Add model, save a second entry, then use Up and Down and confirm `settings.json` reorders and the picker follows.
6. Click Delete, dismiss the modal, and confirm nothing changes; then confirm and check the entry disappears.
7. Type an invalid id such as `Bad Id` and Save. Expect an inline error and no settings write.
8. Run `9router: Clear API Key`, then `9router: Manage Models`. Expect no panel and an error notification.

- [ ] **Step 6: Lint and commit**

```bash
pnpm lint
pnpm test
git add src/runtime/model-editor-html.ts test/unit/runtime/model-editor-html.test.ts
git commit -m "feat(runtime): edit and prefill model drafts in the editor panel"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md` (the model configuration section around line 47)

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1 to 10
- Produces: user-facing documentation

- [ ] **Step 1: Document the panel**

Add a `### Manage models` subsection under the existing model configuration section covering:

- `9router: Manage Models` opens a panel listing every entry in `9router-copilot.models`, in picker order.
- The panel needs a working API key and a reachable base URL because it lists models from authenticated `GET /v1/models`; it refuses to open otherwise, and `settings.json` stays the fallback.
- Selecting a catalog model prefills the Copilot id, display name, `modelId`, vision mode from `capabilities.vision`, and both token fields from `capabilities.contextWindow` and `capabilities.maxOutput`. Every prefilled value is editable.
- Entries rejected by validation stay listed with the reason; entries whose `modelId` is absent from the catalog are flagged.
- Add, edit, delete, and reorder write to User settings. A workspace value for `9router-copilot.models` overrides them, and the panel warns when one exists.

- [ ] **Step 2: Verify the docs match the shipped behaviour**

Re-read the new section against `package.json` contributions and the panel behaviour. Every command name, setting key, and message quoted in the docs must exist in the code.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the manage models panel"
```

---

## Verification Checklist

Run before opening the pull request:

- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] `9router: Manage Models` appears in the command palette in the Extension Development Host
- [ ] Adding a model from the panel makes it appear in the Copilot Chat picker without reloading the window
- [ ] Deleting a model from the panel removes it from the picker
- [ ] An entry rejected by `parseModelSettings` still renders with its reason
