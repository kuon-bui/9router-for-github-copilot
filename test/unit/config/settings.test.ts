import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_PROXY_PROMPT } from '@/config/defaults';
import {
  buildSettingsSnapshot,
  isUsableRuntimeSettings,
  isVisionProxyConfigured,
  loadRuntimeSettings,
  normalizeBaseUrl,
  normalizeMaxTokens
} from '@/config/settings';

function configuration(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key]
  } as never;
}

describe('runtime settings', () => {
  it('normalizes the router base url to an unversioned root', () => {
    expect(normalizeBaseUrl('https://router.example.com/v1/')).toBe(
      'https://router.example.com'
    );
  });

  it('loads default Vision prompt with no selected source', () => {
    const runtime = loadRuntimeSettings(configuration({}));

    expect(runtime.visionProxySource).toBeUndefined();
    expect(runtime.visionProxyModelId).toBe('');
    expect(runtime.visionProxyPrompt).toBe(DEFAULT_VISION_PROXY_PROMPT);
    expect(isVisionProxyConfigured(runtime)).toBe(false);
  });

  it('loads explicit source, model, and custom prompt', () => {
    const runtime = loadRuntimeSettings(
      configuration({
        visionProxySource: 'copilot',
        visionProxyModelId: 'copilot/gpt-vision',
        visionProxyPrompt: '  Extract visible UI details.  '
      })
    );

    expect(runtime).toMatchObject({
      visionProxySource: 'copilot',
      visionProxyModelId: 'copilot/gpt-vision',
      visionProxyPrompt: 'Extract visible UI details.'
    });
    expect(isVisionProxyConfigured(runtime)).toBe(true);
  });

  it('loads and trims the shared Vision proxy model id', () => {
    const runtime = loadRuntimeSettings(
      configuration({ visionProxyModelId: '  router/vision  ' })
    );

    expect(runtime.visionProxyModelId).toBe('router/vision');
  });

  it('treats legacy model-only configuration as 9router', () => {
    const runtime = loadRuntimeSettings(
      configuration({
        visionProxyModelId: 'router/vision'
      })
    );

    expect(runtime.visionProxySource).toBe('9router');
  });

  it('treats an empty manifest source with a configured model as 9router', () => {
    const runtime = loadRuntimeSettings(
      configuration({
        visionProxySource: '',
        visionProxyModelId: 'router/vision',
        visionProxyPrompt: 'Describe images faithfully.'
      })
    );

    expect(runtime.visionProxySource).toBe('9router');
    expect(isVisionProxyConfigured(runtime)).toBe(true);
  });
});

describe('max token normalization', () => {
  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['decimal', 1.5],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['string', '4096'],
    ['null', null],
    ['object', { value: 4096 }]
  ])('normalizes %s to unlimited', (_label, input) => {
    expect(normalizeMaxTokens(input)).toBeUndefined();
  });

  it('preserves a positive safe integer', () => {
    expect(normalizeMaxTokens(4_096)).toBe(4_096);
  });

  it('defaults missing maxTokens to unlimited runtime behavior', () => {
    expect(loadRuntimeSettings(configuration({})).maxTokens).toBeUndefined();
  });
});

describe('buildSettingsSnapshot', () => {
  it('defaults to one rejected agent until its modelId is configured', () => {
    const snapshot = buildSettingsSnapshot(configuration({}));

    expect(snapshot.state).toBe('empty');
    expect(snapshot.models).toEqual([]);
    expect(snapshot.publishedModels).toEqual([]);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({
        sourceIndex: 0,
        id: 'agent',
        code: 'INVALID_MODEL_MAPPING',
        path: '9router-copilot.models[0].modelId'
      })
    ]);
  });

  it('rejects an explicit null models setting instead of loading defaults', () => {
    const snapshot = buildSettingsSnapshot(configuration({ models: null }));

    expect(snapshot.state).toBe('empty');
    expect(snapshot.models).toEqual([]);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({ code: 'INVALID_MODELS_SETTING' })
    ]);
    expect(snapshot.issues).toEqual([
      expect.objectContaining({ code: 'INVALID_MODELS_SETTING' })
    ]);
  });

  it('publishes arbitrary configured models in array order', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          { id: 'research', name: 'Research', modelId: 'router/research' },
          { id: 'coder', name: 'Coder', modelId: 'router/coder', toolMode: 'auto' }
        ]
      })
    );

    expect(snapshot.state).toBe('valid');
    expect(snapshot.models.map((model) => model.id)).toEqual(['research', 'coder']);
    expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['research', 'coder']);
  });

  it('derives each picker default from the model thinkingMode field', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          {
            id: 'coder',
            name: 'Coder',
            modelId: 'router/coder',
            thinkingMode: 'xhigh',
            thinkingEfforts: ['low', 'xhigh']
          }
        ]
      })
    );

    expect(snapshot.models[0]?.thinkingMode).toBe('xhigh');
    expect(snapshot.models[0]?.thinkingEfforts).toEqual(['low', 'xhigh']);
    expect(
      snapshot.publishedModels[0]?.configurationSchema?.properties.reasoningEffort.default
    ).toBe('xhigh');
  });

  it('publishes configured context limits from each model object', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          {
            id: 'coder',
            name: 'Coder',
            modelId: 'router/coder',
            maxInputTokens: 64_000,
            maxOutputTokens: 4_096
          }
        ]
      })
    );

    expect(snapshot.models[0]).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });
    expect(snapshot.publishedModels[0]).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });
  });

  it('marks the snapshot invalid when runtime settings are malformed', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }],
        baseUrl: 'not-a-url',
        requestTimeoutMs: -1
      })
    );

    expect(snapshot.state).toBe('invalid-runtime');
    expect(snapshot.models.map((model) => model.id)).toEqual(['coder']);
    expect(snapshot.publishedModels).toEqual([]);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_BASE_URL', scope: 'runtime' }),
        expect.objectContaining({ code: 'INVALID_REQUEST_TIMEOUT', scope: 'runtime' })
      ])
    );
  });

  it('accepts zero requestTimeoutMs to disable extension-level timeouts', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }],
        requestTimeoutMs: 0
      })
    );

    expect(snapshot.state).toBe('valid');
    expect(snapshot.runtime?.requestTimeoutMs).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'invalid', null])(
    'keeps runtime valid when maxTokens is %s',
    (maxTokens) => {
      const snapshot = buildSettingsSnapshot(
        configuration({
          models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }],
          maxTokens
        })
      );

      expect(snapshot.state).toBe('valid');
      expect(snapshot.runtime?.maxTokens).toBeUndefined();
      expect(snapshot.issues).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'INVALID_MAX_TOKENS' })])
      );
    }
  );

  it('degrades one broken model without removing valid models', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          { id: 'broken', name: 'Broken', modelId: '' },
          { id: 'coder', name: 'Coder', modelId: 'router/coder' }
        ]
      })
    );

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['coder']);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({
        sourceIndex: 0,
        id: 'broken',
        code: 'INVALID_MODEL_MAPPING'
      })
    ]);
  });

  it('keeps proxy image input available for guided setup when model is missing', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          {
            id: 'coder',
            name: 'Coder',
            modelId: 'router/coder',
            visionMode: 'proxy'
          }
        ]
      })
    );

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels).toHaveLength(1);
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
    expect(snapshot.issues).toContainEqual(
      expect.objectContaining({
        scope: 'capability',
        code: 'MISSING_VISION_PROXY_MODEL',
        message:
          'Proxy Vision is disabled until 9router-copilot.visionProxyModelId references an existing model id for the selected Vision proxy source.',
        path: '9router-copilot.visionProxyModelId'
      })
    );
  });

  it('keeps proxy image input available so guided setup can replace an invalid source', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [{ id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'proxy' }],
        visionProxySource: 'other',
        visionProxyModelId: 'model',
        visionProxyPrompt: 'prompt'
      })
    );

    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
    expect(snapshot.state).toBe('degraded');
  });

  it('does not advertise proxy image input with a blank prompt', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [{ id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'proxy' }],
        visionProxySource: '9router',
        visionProxyModelId: 'model',
        visionProxyPrompt: '   '
      })
    );

    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBeUndefined();
    expect(snapshot.state).toBe('degraded');
  });

  it('advertises proxy image input when the shared model is configured', () => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [
          {
            id: 'coder',
            name: 'Coder',
            modelId: 'router/coder',
            visionMode: 'proxy'
          }
        ],
        visionProxySource: '9router',
        visionProxyModelId: 'router/vision',
        visionProxyPrompt: 'Describe images faithfully.'
      })
    );

    expect(snapshot.state).toBe('valid');
    expect(snapshot.runtime?.visionProxyModelId).toBe('router/vision');
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
  });
});

describe('isUsableRuntimeSettings', () => {
  const runtime = {
    baseUrl: 'https://router.example.com',
    requestTimeoutMs: 60_000,
    debugMode: 'minimal' as const,
    visionProxySource: undefined,
    visionProxyModelId: '',
    visionProxyPrompt: 'prompt'
  };

  it('accepts a zero timeout because zero disables extension-level timeouts', () => {
    expect(isUsableRuntimeSettings({ ...runtime, requestTimeoutMs: 0 })).toBe(true);
  });

  it('accepts a positive timeout', () => {
    expect(isUsableRuntimeSettings(runtime)).toBe(true);
  });

  it('rejects timeouts the settings snapshot also rejects', () => {
    expect(isUsableRuntimeSettings({ ...runtime, requestTimeoutMs: -1 })).toBe(false);
    expect(isUsableRuntimeSettings({ ...runtime, requestTimeoutMs: Number.NaN })).toBe(false);
  });

  it('rejects unusable base urls', () => {
    expect(isUsableRuntimeSettings({ ...runtime, baseUrl: 'not-a-url' })).toBe(false);
    expect(isUsableRuntimeSettings({ ...runtime, baseUrl: '' })).toBe(false);
    expect(isUsableRuntimeSettings({ ...runtime, baseUrl: 'ftp://router.example.com' })).toBe(
      false
    );
  });
});
