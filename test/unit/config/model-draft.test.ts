import { describe, expect, it } from 'vitest';
import {
  createDraftFromCatalog,
  createUniqueModelId,
  sanitizeModelId,
  suggestDisplayName,
  toSettingsEntry
} from '@/config/model-draft';

describe('sanitizeModelId', () => {
  it('maps catalog ids onto the settings id pattern', () => {
    expect(sanitizeModelId('cx/gpt-5.6-sol')).toBe('cx-gpt-5.6-sol');
    expect(sanitizeModelId('Anthropic/Claude Opus 4.1')).toBe('anthropic-claude-opus-4.1');
    expect(sanitizeModelId('  ---weird///id---  ')).toBe('weird-id');
    expect(sanitizeModelId('///')).toBe('');
  });
});

describe('createUniqueModelId', () => {
  it('suffixes colliding ids', () => {
    expect(createUniqueModelId('cx/gpt-5', [])).toBe('cx-gpt-5');
    expect(createUniqueModelId('cx/gpt-5', ['cx-gpt-5'])).toBe('cx-gpt-5-2');
    expect(createUniqueModelId('cx/gpt-5', ['cx-gpt-5', 'cx-gpt-5-2'])).toBe('cx-gpt-5-3');
  });

  it('returns an empty id when nothing survives sanitisation', () => {
    expect(createUniqueModelId('///', ['x'])).toBe('');
  });
});

describe('suggestDisplayName', () => {
  it('drops the owner prefix and keeps the remainder verbatim', () => {
    expect(suggestDisplayName('cx/gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(suggestDisplayName('router/combo')).toBe('combo');
    expect(suggestDisplayName('plain-model')).toBe('plain-model');
  });
});

describe('createDraftFromCatalog', () => {
  it('prefills every derivable field from catalog metadata', () => {
    expect(
      createDraftFromCatalog({
        id: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000
      })
    ).toEqual({
      id: 'cx-gpt-5.6-sol',
      name: 'gpt-5.6-sol',
      modelId: 'cx/gpt-5.6-sol',
      toolMode: 'auto',
      visionMode: 'native',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 272_000,
      maxOutputTokens: 128_000
    });
  });

  it('falls back to configured defaults when metadata is missing', () => {
    expect(createDraftFromCatalog({ id: 'router/combo' })).toEqual({
      id: 'router-combo',
      name: 'combo',
      modelId: 'router/combo',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 264_000,
      maxOutputTokens: 264_000
    });
  });

  it('falls back when the derived input budget is not positive', () => {
    const draft = createDraftFromCatalog({
      id: 'tiny/model',
      contextWindow: 8_000,
      maxOutput: 8_000
    });

    expect(draft.maxInputTokens).toBe(264_000);
    expect(draft.maxOutputTokens).toBe(8_000);
  });

  it('avoids ids already used by configured models', () => {
    expect(createDraftFromCatalog({ id: 'cx/gpt-5' }, { takenIds: ['cx-gpt-5'] }).id).toBe(
      'cx-gpt-5-2'
    );
  });
});

describe('toSettingsEntry', () => {
  it('writes the nine base fields and omits an unset service tier', () => {
    expect(
      toSettingsEntry({
        id: 'agent',
        name: 'Agent',
        modelId: 'router/combo',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000
      })
    ).toEqual({
      id: 'agent',
      name: 'Agent',
      modelId: 'router/combo',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 264_000,
      maxOutputTokens: 264_000
    });
  });

  it('writes the service tier when it is fast', () => {
    const entry = toSettingsEntry({
      id: 'agent',
      name: 'Agent',
      modelId: 'router/combo',
      serviceTier: 'fast',
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'high',
      thinkingEfforts: ['low', 'high'],
      maxInputTokens: 1,
      maxOutputTokens: 2
    });

    expect(entry.serviceTier).toBe('fast');
    expect(entry.thinkingEfforts).toEqual(['low', 'high']);
  });
});
