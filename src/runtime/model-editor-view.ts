import { parseModelSettings } from '@/config/model-settings';
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from '@/config/defaults';
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
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';

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
  thinkingModes: ThinkingMode[];
  thinkingEfforts: EnabledThinkingMode[];
  defaultMaxInputTokens: number;
  defaultMaxOutputTokens: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readMode<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>
): T | undefined {
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
    models
      .map((model) => model.modelId)
      .filter((modelId): modelId is string => modelId !== undefined)
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
    warnings,
    thinkingModes: [...THINKING_MODES],
    thinkingEfforts: [...ENABLED_THINKING_MODES],
    defaultMaxInputTokens: DEFAULT_MODEL_MAX_INPUT_TOKENS,
    defaultMaxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS
  };
}

export function toCatalogMetadata(entry: ModelEditorCatalogEntry): RouterModelMetadata {
  return {
    id: entry.modelId,
    ...(entry.ownedBy !== undefined ? { ownedBy: entry.ownedBy } : {}),
    ...(entry.vision ? { vision: true as const } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxOutput !== undefined ? { maxOutput: entry.maxOutput } : {})
  };
}
