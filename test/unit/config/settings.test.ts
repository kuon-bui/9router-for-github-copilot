import { describe, expect, it } from 'vitest';
import {
  buildSettingsSnapshot,
  loadRuntimeSettings,
  normalizeBaseUrl
} from '../../../src/config/settings';

function configuration(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key]
  } as never;
}

describe('runtime settings', () => {
  it('normalizes the router base url to /v1', () => {
    expect(normalizeBaseUrl('https://router.example.com')).toBe('https://router.example.com/v1');
  });

  it('loads and trims the shared Vision proxy model id', () => {
    const runtime = loadRuntimeSettings(
      configuration({ visionProxyModelId: '  router/vision  ' })
    );

    expect(runtime.visionProxyModelId).toBe('router/vision');
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
            thinkingMode: 'xhigh'
          }
        ]
      })
    );

    expect(snapshot.models[0]?.thinkingMode).toBe('xhigh');
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
        requestTimeoutMs: 0
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

  it('degrades image capability without rejecting a proxy model', () => {
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
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBeUndefined();
    expect(snapshot.issues).toContainEqual(
      expect.objectContaining({
        scope: 'capability',
        code: 'MISSING_VISION_PROXY_MODEL',
        path: '9router-copilot.visionProxyModelId'
      })
    );
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
        visionProxyModelId: 'router/vision'
      })
    );

    expect(snapshot.state).toBe('valid');
    expect(snapshot.runtime?.visionProxyModelId).toBe('router/vision');
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
  });
});
