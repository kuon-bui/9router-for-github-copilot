export const DEFAULT_BASE_URL = 'http://127.0.0.1:3456/v1';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_TOKENS = 0;
export const DEFAULT_DEBUG_MODE = 'minimal' as const;
export const DEFAULT_MODEL_TOOL_MODE = 'off' as const;
export const DEFAULT_MODEL_VISION_MODE = 'off' as const;
export const DEFAULT_MODEL_THINKING_MODE = 'off' as const;
export const DEFAULT_MODEL_MAX_INPUT_TOKENS = 264_000;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 264_000;
export const DEFAULT_VISION_PROXY_SOURCE = '' as const;
export const DEFAULT_VISION_PROXY_MODEL_ID = '';
export const DEFAULT_VISION_PROXY_PROMPT =
  'Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.';

export const DEFAULT_MODELS = [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off'
  }
] as const;
