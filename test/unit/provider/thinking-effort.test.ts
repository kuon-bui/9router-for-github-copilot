import { describe, expect, it } from 'vitest';
import {
  createThinkingEffortConfigurationSchema,
  resolveEffectiveThinkingMode
} from '@/provider/thinking-effort';

describe('createThinkingEffortConfigurationSchema', () => {
  it('publishes None followed by configured efforts in configured order', () => {
    const schema = createThinkingEffortConfigurationSchema('xhigh', [
      'high',
      'minimal',
      'xhigh'
    ]);

    expect(schema.properties.reasoningEffort).toEqual({
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'high', 'minimal', 'xhigh'],
      enumItemLabels: ['None', 'High', 'Minimal', 'XHigh'],
      enumDescriptions: [
        'Disable thinking for faster responses',
        'Use high reasoning effort',
        'Use minimal reasoning effort',
        'Use extra-high reasoning effort'
      ],
      default: 'xhigh',
      group: 'navigation'
    });
  });

  it('maps off default to none for a non-empty picker', () => {
    const schema = createThinkingEffortConfigurationSchema('off', ['max']);

    expect(schema.properties.reasoningEffort.default).toBe('none');
  });
});

describe('resolveEffectiveThinkingMode', () => {
  it('accepts None regardless of enabled efforts', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: 'none'
          }
        },
        'high',
        ['high']
      )
    ).toEqual({
      thinkingMode: 'off',
      source: 'modelConfiguration'
    });
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'maps enabled picker value %s directly',
    (pickerValue) => {
      expect(
        resolveEffectiveThinkingMode(
          {
            modelConfiguration: {
              reasoningEffort: pickerValue
            }
          },
          'low',
          [pickerValue]
        )
      ).toEqual({
        thinkingMode: pickerValue,
        source: 'modelConfiguration'
      });
    }
  );

  it('uses the compatibility configuration field when modelConfiguration is absent', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          configuration: {
            reasoningEffort: 'max'
          }
        },
        'low',
        ['low', 'max']
      )
    ).toEqual({
      thinkingMode: 'max',
      source: 'configuration'
    });
  });

  it('falls back when modelConfiguration contains a stale effort', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          modelConfiguration: {
            reasoningEffort: 'max'
          }
        },
        'low',
        ['low', 'medium']
      )
    ).toEqual({
      thinkingMode: 'low',
      source: 'settings'
    });
  });

  it('applies the same allowlist to compatibility configuration', () => {
    expect(
      resolveEffectiveThinkingMode(
        {
          configuration: {
            reasoningEffort: 'medium'
          }
        },
        'low',
        ['low', 'medium']
      )
    ).toEqual({
      thinkingMode: 'medium',
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
        'medium',
        ['medium']
      )
    ).toEqual({
      thinkingMode: 'medium',
      source: 'settings'
    });
  });
});
