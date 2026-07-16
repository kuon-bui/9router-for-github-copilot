import type { ThinkingMode } from '../types/product-model';
import type { LanguageModelConfigurationSchema } from '../types/vscode-chat-compat';

export const THINKING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];
export type ThinkingModeSource = 'modelConfiguration' | 'configuration' | 'settings';

export interface EffectiveThinkingMode {
  thinkingMode: ThinkingMode;
  source: ThinkingModeSource;
}

const THINKING_EFFORT_SET = new Set<string>(THINKING_EFFORTS);

export function createThinkingEffortConfigurationSchema(
  defaultMode: ThinkingMode
): LanguageModelConfigurationSchema {
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: THINKING_EFFORTS,
        enumItemLabels: ['None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'],
        enumDescriptions: [
          'Disable thinking for faster responses',
          'Use minimal reasoning effort',
          'Use low reasoning effort',
          'Use medium reasoning effort',
          'Use high reasoning effort',
          'Use extra-high reasoning effort',
          'Use maximum reasoning depth'
        ],
        default: defaultMode === 'off' ? 'none' : defaultMode,
        group: 'navigation'
      }
    }
  };
}

export function resolveEffectiveThinkingMode(
  options: unknown,
  configuredMode: ThinkingMode
): EffectiveThinkingMode {
  const modelConfigurationValue = readReasoningEffort(options, 'modelConfiguration');
  if (modelConfigurationValue) {
    return {
      thinkingMode: toThinkingMode(modelConfigurationValue),
      source: 'modelConfiguration'
    };
  }

  const compatibilityValue = readReasoningEffort(options, 'configuration');
  if (compatibilityValue) {
    return {
      thinkingMode: toThinkingMode(compatibilityValue),
      source: 'configuration'
    };
  }

  return {
    thinkingMode: configuredMode,
    source: 'settings'
  };
}

function readReasoningEffort(
  options: unknown,
  property: 'modelConfiguration' | 'configuration'
): ThinkingEffort | undefined {
  if (typeof options !== 'object' || options === null || !(property in options)) {
    return undefined;
  }

  const configuration = (options as Record<string, unknown>)[property];
  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('reasoningEffort' in configuration)
  ) {
    return undefined;
  }

  const value = configuration.reasoningEffort;
  return typeof value === 'string' && THINKING_EFFORT_SET.has(value)
    ? (value as ThinkingEffort)
    : undefined;
}

function toThinkingMode(effort: ThinkingEffort): ThinkingMode {
  return effort === 'none' ? 'off' : effort;
}
