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
