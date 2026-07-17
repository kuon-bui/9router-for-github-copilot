import type { ProductModelKey, ThinkingMode } from '../types/product-model';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3456/v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_TOKENS = 4_096;
export const DEFAULT_DEBUG_MODE = 'minimal' as const;
export const DEFAULT_VISION_PROXY_COMBO_ID = '';
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

export const DEFAULT_DISPLAY_MODELS: ProductModelKey[] = ['daily', 'agent', 'fallback'];

export const DEFAULT_MODEL_LABELS: Record<ProductModelKey, string> = {
  daily: 'Daily',
  agent: 'Agent',
  fallback: 'Fallback'
};

export const DEFAULT_MODEL_MAPPINGS: Record<ProductModelKey, string> = {
  daily: '',
  agent: '',
  fallback: ''
};

export const DEFAULT_MAX_INPUT_TOKENS: Record<ProductModelKey, number> = {
  daily: 128_000,
  agent: 128_000,
  fallback: 128_000
};

export const DEFAULT_MAX_OUTPUT_TOKENS: Record<ProductModelKey, number> = {
  daily: 8_192,
  agent: 8_192,
  fallback: 8_192
};

export const DEFAULT_TOOL_MODES: Record<ProductModelKey, 'auto' | 'off'> = {
  daily: 'off',
  agent: 'auto',
  fallback: 'off'
};

export const DEFAULT_VISION_MODES: Record<ProductModelKey, 'native' | 'proxy' | 'off'> = {
  daily: 'off',
  agent: 'proxy',
  fallback: 'off'
};

export const DEFAULT_THINKING_MODES: Record<ProductModelKey, ThinkingMode> = {
  daily: 'off',
  agent: 'off',
  fallback: 'off'
};
