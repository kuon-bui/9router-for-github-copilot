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
