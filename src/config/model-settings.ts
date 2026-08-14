import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL_THINKING_MODE,
  DEFAULT_MODEL_TOOL_MODE,
  DEFAULT_MODEL_VISION_MODE
} from './defaults';
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';
import type {
  ConfiguredModel,
  EnabledThinkingMode,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '@/types/product-model';

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const THINKING_SUFFIX_PATTERN = new RegExp(
  `\\((?:${THINKING_MODES.join('|')})\\)$`,
  'i'
);
const ALLOWED_FIELDS = new Set([
  'id',
  'name',
  'modelId',
  'service_tier',
  'toolMode',
  'visionMode',
  'thinkingMode',
  'thinkingEfforts',
  'maxInputTokens',
  'maxOutputTokens'
]);
const TOOL_MODES = new Set<ToolMode>(['auto', 'off']);
const VISION_MODES = new Set<VisionMode>(['native', 'proxy', 'off']);
const THINKING_MODE_SET = new Set<string>(THINKING_MODES);
const ENABLED_THINKING_MODE_SET = new Set<string>(ENABLED_THINKING_MODES);

export type ModelSettingsIssueCode =
  | 'INVALID_MODELS_SETTING'
  | 'INVALID_MODEL_ENTRY'
  | 'UNKNOWN_MODEL_FIELD'
  | 'INVALID_MODEL_ID'
  | 'DUPLICATE_MODEL_ID'
  | 'INVALID_MODEL_NAME'
  | 'INVALID_MODEL_MAPPING'
  | 'INVALID_SERVICE_TIER'
  | 'INVALID_TOOL_MODE'
  | 'INVALID_VISION_MODE'
  | 'INVALID_THINKING_MODE'
  | 'INVALID_THINKING_EFFORTS'
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

  const prototype = Object.getPrototypeOf(value) as unknown;
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
      reject(
        sourceIndex,
        undefined,
        'INVALID_MODEL_ENTRY',
        undefined,
        'Model entry must be an object.'
      );
      return;
    }

    const candidateId = typeof item.id === 'string' ? item.id : undefined;
    const id = candidateId && MODEL_ID_PATTERN.test(candidateId) ? candidateId : undefined;
    const unknownField = Object.keys(item).find((field) => !ALLOWED_FIELDS.has(field));
    if (unknownField) {
      reject(
        sourceIndex,
        id,
        'UNKNOWN_MODEL_FIELD',
        unknownField,
        `Unsupported model field: ${unknownField}.`
      );
      return;
    }
    if (!id) {
      reject(
        sourceIndex,
        id,
        'INVALID_MODEL_ID',
        'id',
        'Model id must match [a-z0-9][a-z0-9._-]*.'
      );
      return;
    }
    if ((idCounts.get(id) ?? 0) > 1) {
      reject(sourceIndex, id, 'DUPLICATE_MODEL_ID', 'id', `Model id "${id}" is duplicated.`);
      return;
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      reject(
        sourceIndex,
        id,
        'INVALID_MODEL_NAME',
        'name',
        'Model name must be a non-empty string.'
      );
      return;
    }

    const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : '';
    if (!modelId || THINKING_SUFFIX_PATTERN.test(modelId)) {
      reject(
        sourceIndex,
        id,
        'INVALID_MODEL_MAPPING',
        'modelId',
        'modelId must be a non-empty base 9router model id without a thinking suffix.'
      );
      return;
    }

    const serviceTier = item.service_tier;
    if (serviceTier !== undefined && serviceTier !== 'fast') {
      reject(
        sourceIndex,
        id,
        'INVALID_SERVICE_TIER',
        'service_tier',
        'service_tier must be fast when configured.'
      );
      return;
    }

    const toolMode = item.toolMode === undefined ? DEFAULT_MODEL_TOOL_MODE : item.toolMode;
    if (typeof toolMode !== 'string' || !TOOL_MODES.has(toolMode as ToolMode)) {
      reject(
        sourceIndex,
        id,
        'INVALID_TOOL_MODE',
        'toolMode',
        'toolMode must be auto or off.'
      );
      return;
    }
    const visionMode = item.visionMode === undefined ? DEFAULT_MODEL_VISION_MODE : item.visionMode;
    if (typeof visionMode !== 'string' || !VISION_MODES.has(visionMode as VisionMode)) {
      reject(
        sourceIndex,
        id,
        'INVALID_VISION_MODE',
        'visionMode',
        'visionMode must be native, proxy, or off.'
      );
      return;
    }
    const thinkingMode =
      item.thinkingMode === undefined ? DEFAULT_MODEL_THINKING_MODE : item.thinkingMode;
    if (typeof thinkingMode !== 'string' || !THINKING_MODE_SET.has(thinkingMode)) {
      reject(
        sourceIndex,
        id,
        'INVALID_THINKING_MODE',
        'thinkingMode',
        'thinkingMode is unsupported.'
      );
      return;
    }
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
    const maxInputTokens =
      item.maxInputTokens === undefined
        ? DEFAULT_MODEL_MAX_INPUT_TOKENS
        : item.maxInputTokens;
    if (!isPositiveInteger(maxInputTokens)) {
      reject(
        sourceIndex,
        id,
        'INVALID_MAX_INPUT_TOKENS',
        'maxInputTokens',
        'maxInputTokens must be a positive integer.'
      );
      return;
    }
    const maxOutputTokens =
      item.maxOutputTokens === undefined
        ? DEFAULT_MODEL_MAX_OUTPUT_TOKENS
        : item.maxOutputTokens;
    if (!isPositiveInteger(maxOutputTokens)) {
      reject(
        sourceIndex,
        id,
        'INVALID_MAX_OUTPUT_TOKENS',
        'maxOutputTokens',
        'maxOutputTokens must be a positive integer.'
      );
      return;
    }

    models.push({
      sourceIndex,
      id,
      name,
      modelId,
      ...(serviceTier === 'fast' ? { service_tier: serviceTier } : {}),
      toolMode: toolMode as ToolMode,
      visionMode: visionMode as VisionMode,
      thinkingMode: thinkingMode as ThinkingMode,
      thinkingEfforts: [...thinkingEfforts] as EnabledThinkingMode[],
      maxInputTokens,
      maxOutputTokens
    });
  });

  return { models, rejectedModels, issues };
}
