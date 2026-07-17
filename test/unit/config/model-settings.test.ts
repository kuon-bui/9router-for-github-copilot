import { describe, expect, it } from 'vitest';
import { parseModelSettings } from '../../../src/config/model-settings';

describe('parseModelSettings', () => {
  it('parses arbitrary model ids in array order and applies conservative defaults', () => {
    const result = parseModelSettings([
      { id: 'coder', name: '  Coding Pro  ', modelId: '  router/coder  ' },
      {
        id: 'research-v2',
        name: 'Research',
        modelId: 'router/research',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        maxInputTokens: 64_000,
        maxOutputTokens: 4_096
      }
    ]);

    expect(result.models).toEqual([
      {
        sourceIndex: 0,
        id: 'coder',
        name: 'Coding Pro',
        modelId: 'router/coder',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        sourceIndex: 1,
        id: 'research-v2',
        name: 'Research',
        modelId: 'router/research',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        maxInputTokens: 64_000,
        maxOutputTokens: 4_096
      }
    ]);
    expect(result.rejectedModels).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('rejects every duplicate id while preserving unrelated models', () => {
    const result = parseModelSettings([
      { id: 'agent', name: 'First', modelId: 'router/first' },
      { id: 'coder', name: 'Coder', modelId: 'router/coder' },
      { id: 'agent', name: 'Second', modelId: 'router/second' }
    ]);

    expect(result.models.map((model) => model.id)).toEqual(['coder']);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, id: 'agent', code: 'DUPLICATE_MODEL_ID' }),
      expect.objectContaining({ sourceIndex: 2, id: 'agent', code: 'DUPLICATE_MODEL_ID' })
    ]);
  });

  it.each([
    ['uppercase id', { id: 'Agent', name: 'Agent', modelId: 'router/agent' }, 'INVALID_MODEL_ID'],
    ['trimmed id', { id: ' agent ', name: 'Agent', modelId: 'router/agent' }, 'INVALID_MODEL_ID'],
    ['empty name', { id: 'agent', name: '   ', modelId: 'router/agent' }, 'INVALID_MODEL_NAME'],
    ['empty model id', { id: 'agent', name: 'Agent', modelId: '   ' }, 'INVALID_MODEL_MAPPING'],
    [
      'unknown field',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', typo: true },
      'UNKNOWN_MODEL_FIELD'
    ],
    [
      'thinking suffix',
      { id: 'agent', name: 'Agent', modelId: 'router/agent(high)' },
      'INVALID_MODEL_MAPPING'
    ],
    [
      'invalid tools',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', toolMode: 'yes' },
      'INVALID_TOOL_MODE'
    ],
    [
      'invalid vision',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'yes' },
      'INVALID_VISION_MODE'
    ],
    [
      'invalid thinking',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', thinkingMode: 'turbo' },
      'INVALID_THINKING_MODE'
    ],
    [
      'invalid input tokens',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', maxInputTokens: 0 },
      'INVALID_MAX_INPUT_TOKENS'
    ],
    [
      'invalid output tokens',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', maxOutputTokens: 1.5 },
      'INVALID_MAX_OUTPUT_TOKENS'
    ]
  ])('rejects %s with a field-scoped issue', (_label, model, code) => {
    const result = parseModelSettings([model]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, code })
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ scope: 'model', sourceIndex: 0, code })
    ]);
  });

  it('rejects a non-array setting', () => {
    const result = parseModelSettings({ id: 'agent' });

    expect(result.models).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_MODELS_SETTING',
        path: '9router-copilot.models'
      })
    ]);
  });

  it.each([[null], [[]], [new Date()]])('rejects a non-plain model entry', (entry) => {
    const result = parseModelSettings([entry]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, code: 'INVALID_MODEL_ENTRY' })
    ]);
  });
});
