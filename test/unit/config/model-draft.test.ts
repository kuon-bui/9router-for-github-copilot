import { describe, expect, it } from 'vitest';
import {
  createDraftFromCatalog,
  createUniqueModelId,
  sanitizeModelId,
  suggestDisplayName,
  toSettingsEntry,
  validateDraft
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

describe('validateDraft', () => {
  const validInput = {
    id: 'agent',
    name: 'Agent',
    modelId: 'router/combo',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens: 264_000,
    maxOutputTokens: 264_000
  };

  it('returns a typed draft when every field is valid', () => {
    const result = validateDraft(validInput, { takenIds: ['other'] });

    expect(result.errors).toEqual([]);
    expect(result.draft).toEqual(validInput);
  });

  it('keeps a fast service tier', () => {
    const result = validateDraft({ ...validInput, serviceTier: 'fast' }, { takenIds: [] });

    expect(result.errors).toEqual([]);
    expect(result.draft?.serviceTier).toBe('fast');
  });

  it('rejects a non-object payload', () => {
    expect(validateDraft(null, { takenIds: [] })).toEqual({
      errors: [{ field: 'draft', message: 'Model entry must be an object.' }]
    });
  });

  it('reports every invalid field at once', () => {
    const result = validateDraft(
      {
        id: 'Bad Id',
        name: '   ',
        modelId: 'router/combo(high)',
        serviceTier: 'slow',
        toolMode: 'maybe',
        visionMode: 'sometimes',
        thinkingMode: 'turbo',
        thinkingEfforts: ['low', 'low'],
        maxInputTokens: 0,
        maxOutputTokens: 1.5
      },
      { takenIds: [] }
    );

    expect(result.draft).toBeUndefined();
    expect(result.errors.map((error) => error.field).sort()).toEqual([
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
    expect(result.errors.find((error) => error.field === 'id')?.message).toBe(
      'Model id must match [a-z0-9][a-z0-9._-]*.'
    );
    expect(result.errors.find((error) => error.field === 'modelId')?.message).toBe(
      'modelId must be a non-empty base 9router model id without a thinking suffix.'
    );
  });

  it('rejects an id already used by another entry', () => {
    const result = validateDraft(validInput, { takenIds: ['agent'] });

    expect(result.errors).toEqual([
      { field: 'id', message: 'Model id "agent" is duplicated.' }
    ]);
  });

  it('requires thinking efforts to include a non-off thinking mode', () => {
    const result = validateDraft(
      { ...validInput, thinkingMode: 'high', thinkingEfforts: ['low'] },
      { takenIds: [] }
    );

    expect(result.errors).toEqual([
      {
        field: 'thinkingEfforts',
        message: 'thinkingEfforts must include the configured non-off thinkingMode.'
      }
    ]);
  });
});
