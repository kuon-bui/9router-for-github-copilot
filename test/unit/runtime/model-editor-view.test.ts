import { describe, expect, it } from 'vitest';
import { createModelEditorState, toCatalogMetadata } from '@/runtime/model-editor-view';

const catalog = [
  { id: 'router/combo' },
  {
    id: 'cx/gpt-5.6-sol',
    ownedBy: 'cx',
    vision: true as const,
    contextWindow: 400_000,
    maxOutput: 128_000
  }
];

describe('createModelEditorState', () => {
  it('renders valid rows with their configured fields', () => {
    const state = createModelEditorState({
      entries: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/combo',
          toolMode: 'auto',
          visionMode: 'off',
          thinkingMode: 'off',
          thinkingEfforts: [],
          maxInputTokens: 264_000,
          maxOutputTokens: 264_000
        }
      ],
      catalog
    });

    expect(state.models).toEqual([
      {
        sourceIndex: 0,
        valid: true,
        id: 'agent',
        name: 'Agent',
        modelId: 'router/combo',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000,
        catalogStatus: 'matched'
      }
    ]);
    expect(state.warnings).toEqual([]);
    expect(state.thinkingModes).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(state.thinkingEfforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(state.defaultMaxInputTokens).toBe(264_000);
    expect(state.defaultMaxOutputTokens).toBe(264_000);
  });

  it('keeps rejected entries visible with their parser issue', () => {
    const state = createModelEditorState({
      entries: [{ id: 'agent', name: 'Agent', modelId: '' }],
      catalog
    });

    expect(state.models[0]).toMatchObject({
      sourceIndex: 0,
      valid: false,
      id: 'agent',
      name: 'Agent',
      catalogStatus: 'missing',
      issue: {
        code: 'INVALID_MODEL_MAPPING',
        message:
          'modelId must be a non-empty base 9router model id without a thinking suffix.'
      }
    });
  });

  it('flags configured models that no longer exist in the catalog', () => {
    const state = createModelEditorState({
      entries: [{ id: 'gone', name: 'Gone', modelId: 'retired/model' }],
      catalog
    });

    expect(state.models[0]?.catalogStatus).toBe('missing');
  });

  it('marks catalog entries already used by a configured model', () => {
    const state = createModelEditorState({
      entries: [{ id: 'agent', name: 'Agent', modelId: 'router/combo' }],
      catalog
    });

    expect(state.catalog).toEqual([
      { modelId: 'router/combo', vision: false, inUse: true },
      {
        modelId: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000,
        inUse: false
      }
    ]);
  });

  it('warns when the configured value is not an array', () => {
    const state = createModelEditorState({ entries: 'nope', catalog });

    expect(state.models).toEqual([]);
    expect(state.warnings).toEqual([
      '9router-copilot.models is not a list. Saving here replaces it with a new list.'
    ]);
  });

  it('warns when a workspace value overrides user settings', () => {
    const state = createModelEditorState({
      entries: [],
      catalog,
      workspaceOverride: true
    });

    expect(state.warnings).toEqual([
      'A workspace value for 9router-copilot.models overrides user settings. Changes saved here are written to user settings.'
    ]);
  });
});

describe('toCatalogMetadata', () => {
  it('drops editor-only metadata and absent optional fields', () => {
    expect(
      toCatalogMetadata({
        modelId: 'router/combo',
        ownedBy: 'router',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000,
        inUse: true
      })
    ).toEqual({
      id: 'router/combo',
      ownedBy: 'router',
      vision: true,
      contextWindow: 400_000,
      maxOutput: 128_000
    });
    expect(toCatalogMetadata({ modelId: 'router/basic', vision: false, inUse: false })).toEqual({
      id: 'router/basic'
    });
  });
});
