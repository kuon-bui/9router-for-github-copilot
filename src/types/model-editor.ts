import type {
  EnabledThinkingMode,
  ThinkingMode,
  ToolMode,
  VisionMode
} from '@/types/product-model';

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
