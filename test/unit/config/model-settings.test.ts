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
        service_tier: 'fast',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        thinkingEfforts: ['high'],
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
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000
      },
      {
        sourceIndex: 1,
        id: 'research-v2',
        name: 'Research',
        modelId: 'router/research',
        service_tier: 'fast',
        toolMode: 'auto',
        visionMode: 'native',
        thinkingMode: 'high',
        thinkingEfforts: ['high'],
        maxInputTokens: 64_000,
        maxOutputTokens: 4_096
      }
    ]);
    expect(result.rejectedModels).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('preserves ordered enabled thinking efforts', () => {
    const result = parseModelSettings([
      {
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        thinkingMode: 'medium',
        thinkingEfforts: ['high', 'minimal', 'medium']
      }
    ]);

    expect(result.models[0]).toMatchObject({
      thinkingMode: 'medium',
      thinkingEfforts: ['high', 'minimal', 'medium']
    });
  });

  it.each([
    ['null', null],
    ['non-array', 'high'],
    ['unsupported value', ['turbo']],
    ['non-string value', ['low', 42]],
    ['duplicate value', ['low', 'low']]
  ])('rejects %s thinkingEfforts', (_label, thinkingEfforts) => {
    const result = parseModelSettings([
      { id: 'agent', name: 'Agent', modelId: 'router/agent', thinkingEfforts }
    ]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({
        sourceIndex: 0,
        id: 'agent',
        code: 'INVALID_THINKING_EFFORTS',
        path: '9router-copilot.models[0].thinkingEfforts'
      })
    ]);
  });

  it('rejects a non-off default outside thinkingEfforts', () => {
    const result = parseModelSettings([
      {
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        thinkingMode: 'high',
        thinkingEfforts: ['low', 'medium']
      },
      { id: 'daily', name: 'Daily', modelId: 'router/daily' }
    ]);

    expect(result.models.map((model) => model.id)).toEqual(['daily']);
    expect(result.rejectedModels[0]).toMatchObject({
      id: 'agent',
      code: 'INVALID_THINKING_EFFORTS',
      path: '9router-copilot.models[0].thinkingEfforts'
    });
  });

  it('keeps off valid with an enabled effort allowlist', () => {
    const result = parseModelSettings([
      {
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        thinkingMode: 'off',
        thinkingEfforts: ['max']
      }
    ]);

    expect(result.models[0]).toMatchObject({
      thinkingMode: 'off',
      thinkingEfforts: ['max']
    });
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
      'invalid service tier',
      { id: 'agent', name: 'Agent', modelId: 'router/agent', service_tier: 'default' },
      'INVALID_SERVICE_TIER'
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

  it.each([
    ['service_tier', 'INVALID_SERVICE_TIER'],
    ['toolMode', 'INVALID_TOOL_MODE'],
    ['visionMode', 'INVALID_VISION_MODE'],
    ['thinkingMode', 'INVALID_THINKING_MODE'],
    ['thinkingEfforts', 'INVALID_THINKING_EFFORTS'],
    ['maxInputTokens', 'INVALID_MAX_INPUT_TOKENS'],
    ['maxOutputTokens', 'INVALID_MAX_OUTPUT_TOKENS']
  ])('rejects explicit null for optional field %s', (field, code) => {
    const result = parseModelSettings([
      { id: 'agent', name: 'Agent', modelId: 'router/agent', [field]: null }
    ]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, code })
    ]);
  });

  it('does not retain an unvalidated id in issues or rejected diagnostics', () => {
    const result = parseModelSettings([
      { id: 'api-key\nforged-line', name: 'Agent', modelId: 'router/agent' }
    ]);

    expect(result.rejectedModels[0]).not.toHaveProperty('id');
    expect(result.issues[0]).not.toHaveProperty('displayModelId');
  });

  it.each([[null], [[]], [new Date()]])('rejects a non-plain model entry', (entry) => {
    const result = parseModelSettings([entry]);

    expect(result.models).toEqual([]);
    expect(result.rejectedModels).toEqual([
      expect.objectContaining({ sourceIndex: 0, code: 'INVALID_MODEL_ENTRY' })
    ]);
  });
});
