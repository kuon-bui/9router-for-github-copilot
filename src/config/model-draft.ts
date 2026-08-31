import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from './defaults';
import {
  ENABLED_THINKING_MODE_SET,
  MODEL_ID_PATTERN,
  THINKING_MODE_SET,
  THINKING_SUFFIX_PATTERN,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from './model-field-rules';
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
