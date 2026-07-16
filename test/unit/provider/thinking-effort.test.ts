import { describe, expect, it } from 'vitest';
import {
  createThinkingEffortConfigurationSchema,
  resolveEffectiveThinkingMode
} from '../../../src/provider/thinking-effort';

describe('createThinkingEffortConfigurationSchema', () => {
  it('publishes all seven picker choices with the configured model default', () => {
    const schema = createThinkingEffortConfigurationSchema('xhigh');

    expect(schema.properties.reasoningEffort).toEqual({
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
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
      default: 'xhigh',
      group: 'navigation'
    });
  });

  it('maps the local off default to the picker none value', () => {
    const schema = createThinkingEffortConfigurationSchema('off');

    expect(schema.properties.reasoningEffort.default).toBe('none');
  });
});

describe('resolveEffectiveThinkingMode', () => {
  it.each([
    ['none', 'off'],
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max']
  ] as const)('maps picker value %s to internal mode %s', (pickerValue, expectedMode) => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: pickerValue
          }
        },
        'low'
      )
    ).toEqual({
      thinkingMode: expectedMode,
      source: 'modelConfiguration'
    });
  });

  it('uses the compatibility configuration field when modelConfiguration is absent', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          configuration: {
            reasoningEffort: 'max'
          }
        },
        'low'
      )
    ).toEqual({
      thinkingMode: 'max',
      source: 'configuration'
    });
  });

  it('falls back to the validated local setting for malformed host values', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: 'turbo'
          },
          configuration: {
            reasoningEffort: 42
          }
        },
        'medium'
      )
    ).toEqual({
      thinkingMode: 'medium',
      source: 'settings'
    });
  });
});
