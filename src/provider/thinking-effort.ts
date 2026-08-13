import { ENABLED_THINKING_MODES } from '@/types/product-model';
import type { EnabledThinkingMode, ThinkingMode } from '@/types/product-model';
import type { LanguageModelConfigurationSchema } from '@/types/vscode-chat-compat';

export const THINKING_EFFORTS = ['none', ...ENABLED_THINKING_MODES] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];
export type ThinkingModeSource = 'modelConfiguration' | 'configuration' | 'settings';

export interface EffectiveThinkingMode {
  thinkingMode: ThinkingMode;
  source: ThinkingModeSource;
}

const THINKING_EFFORT_METADATA: Record<
  ThinkingEffort,
  { label: string; description: string }
> = {
  none: {
    label: 'None',
    description: 'Disable thinking for faster responses'
  },
  minimal: {
    label: 'Minimal',
    description: 'Use minimal reasoning effort'
  },
  low: { label: 'Low', description: 'Use low reasoning effort' },
  medium: { label: 'Medium', description: 'Use medium reasoning effort' },
  high: { label: 'High', description: 'Use high reasoning effort' },
  xhigh: {
    label: 'XHigh',
    description: 'Use extra-high reasoning effort'
  },
  max: { label: 'Max', description: 'Use maximum reasoning depth' }
};

export function createThinkingEffortConfigurationSchema(
  defaultMode: ThinkingMode,
  enabledModes: readonly EnabledThinkingMode[]
): LanguageModelConfigurationSchema {
  const efforts: ThinkingEffort[] = ['none', ...enabledModes];

  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: 'Thinking Effort',
        enum: efforts,
        enumItemLabels: efforts.map((effort) => THINKING_EFFORT_METADATA[effort].label),
        enumDescriptions: efforts.map(
          (effort) => THINKING_EFFORT_METADATA[effort].description
        ),
        default: defaultMode === 'off' ? 'none' : defaultMode,
        group: 'navigation'
      }
    }
  };
}

export function resolveEffectiveThinkingMode(
  options: unknown,
  configuredMode: ThinkingMode,
  enabledModes: readonly EnabledThinkingMode[]
): EffectiveThinkingMode {
  const allowedEfforts = new Set<string>(['none', ...enabledModes]);
  const modelConfigurationValue = readReasoningEffort(
    options,
    'modelConfiguration',
    allowedEfforts
  );
  if (modelConfigurationValue) {
    return {
      thinkingMode: toThinkingMode(modelConfigurationValue),
      source: 'modelConfiguration'
    };
  }

  const compatibilityValue = readReasoningEffort(
    options,
    'configuration',
    allowedEfforts
  );
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
  property: 'modelConfiguration' | 'configuration',
  allowedEfforts: ReadonlySet<string>
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
  return typeof value === 'string' && allowedEfforts.has(value)
    ? (value as ThinkingEffort)
    : undefined;
}

function toThinkingMode(effort: ThinkingEffort): ThinkingMode {
  return effort === 'none' ? 'off' : effort;
}
