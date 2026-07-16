import type { ProductModelKey, ThinkingMode } from '../types/product-model';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3456/v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_TOKENS = 4_096;
export const DEFAULT_DEBUG_MODE = 'minimal' as const;

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
