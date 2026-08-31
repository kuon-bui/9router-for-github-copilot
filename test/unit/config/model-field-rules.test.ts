import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MODEL_FIELDS,
  ENABLED_THINKING_MODE_SET,
  MODEL_ID_PATTERN,
  THINKING_MODE_SET,
  THINKING_SUFFIX_PATTERN,
  TOOL_MODES,
  VISION_MODES,
  isPositiveInteger
} from '@/config/model-field-rules';

describe('model field rules', () => {
  it('accepts settings-compatible model ids and rejects the rest', () => {
    expect(MODEL_ID_PATTERN.test('claude-opus-4.1')).toBe(true);
    expect(MODEL_ID_PATTERN.test('cx-gpt-5.6-sol')).toBe(true);
    expect(MODEL_ID_PATTERN.test('-leading-dash')).toBe(false);
    expect(MODEL_ID_PATTERN.test('Upper')).toBe(false);
    expect(MODEL_ID_PATTERN.test('has/slash')).toBe(false);
    expect(MODEL_ID_PATTERN.test('')).toBe(false);
  });

  it('detects thinking suffixes case-insensitively', () => {
    expect(THINKING_SUFFIX_PATTERN.test('model(high)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(HIGH)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(off)')).toBe(true);
    expect(THINKING_SUFFIX_PATTERN.test('model(turbo)')).toBe(false);
    expect(THINKING_SUFFIX_PATTERN.test('model')).toBe(false);
  });

  it('exposes the ten supported model fields', () => {
    expect([...ALLOWED_MODEL_FIELDS].sort()).toEqual([
      'id',
      'maxInputTokens',
      'maxOutputTokens',
      'modelId',
      'name',
      'serviceTier',
      'thinkingEfforts',
      'thinkingMode',
      'toolMode',
      'visionMode'
    ]);
  });

  it('exposes mode membership sets', () => {
    expect(TOOL_MODES.has('auto')).toBe(true);
    expect(TOOL_MODES.has('off')).toBe(true);
    expect(VISION_MODES.has('proxy')).toBe(true);
    expect(THINKING_MODE_SET.has('off')).toBe(true);
    expect(ENABLED_THINKING_MODE_SET.has('off')).toBe(false);
    expect(ENABLED_THINKING_MODE_SET.has('max')).toBe(true);
  });

  it('recognises positive safe integers only', () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(264_000)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger('1')).toBe(false);
  });
});
