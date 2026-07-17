import { describe, expect, it } from 'vitest';
import {
  buildSettingsSnapshot,
  loadDisplayModelSettings,
  loadRuntimeSettings
} from '../../../src/config/settings';
import { DEFAULT_MODEL_MAPPINGS } from '../../../src/config/defaults';

describe('loadDisplayModelSettings', () => {
  it('returns only enabled curated models with stable keys', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily', 'fallback'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily-default';
        }

        if (key === 'modelMappings.fallback') {
          return 'combo/fallback-default';
        }

        return undefined;
      }
    };

    expect(loadDisplayModelSettings(configuration as never)).toEqual([
      expect.objectContaining({ key: 'daily', comboId: 'combo/daily-default', enabled: true }),
      expect.objectContaining({ key: 'fallback', comboId: 'combo/fallback-default', enabled: true })
    ]);
  });

  it('does not invent backend combo ids for unconfigured display models', () => {
    const configuration = {
      get: () => undefined
    };

    expect(DEFAULT_MODEL_MAPPINGS).toEqual({
      daily: '',
      agent: '',
      fallback: ''
    });
    expect(loadDisplayModelSettings(configuration as never).map((model) => model.comboId)).toEqual([
      '',
      '',
      ''
    ]);
  });

  it('loads a thinking mode for each curated display model', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily', 'agent'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily';
        }

        if (key === 'modelMappings.agent') {
          return 'combo/agent';
        }

        if (key === 'thinkingMode.agent') {
          return 'high';
        }

        return undefined;
      }
    };

    expect(
      loadDisplayModelSettings(configuration as never).map(({ key, thinkingMode }) => ({
        key,
        thinkingMode
      }))
    ).toEqual([
      { key: 'daily', thinkingMode: 'off' },
      { key: 'agent', thinkingMode: 'high' }
    ]);
  });

  it('normalizes the router base url to /v1', () => {
    const configuration = {
      get: (key: string) => (key === 'baseUrl' ? 'https://router.example.com' : undefined)
    };

    expect(loadRuntimeSettings(configuration as never).baseUrl).toBe('https://router.example.com/v1');
  });

  it('loads and trims the shared Vision proxy combo id', () => {
    const runtime = loadRuntimeSettings({
      get: (key: string) => (key === 'visionProxyComboId' ? '  combo/vision  ' : undefined)
    } as never);

    expect(runtime.visionProxyComboId).toBe('combo/vision');
  });
});

describe('buildSettingsSnapshot', () => {
  it('derives each published picker default from that model thinking setting', () => {
    const snapshot = buildSettingsSnapshot(
      {
        get: (key: string) => {
          const values: Record<string, unknown> = {
            displayModels: ['daily', 'agent'],
            'modelMappings.daily': 'combo/daily',
            'modelMappings.agent': 'combo/agent',
            'thinkingMode.daily': 'low',
            'thinkingMode.agent': 'xhigh'
          };

          return values[key];
        }
      } as never
    );

    expect(
      snapshot.publishedModels.map((model) => ({
        id: model.id,
        defaultEffort: model.configurationSchema?.properties.reasoningEffort.default
      }))
    ).toEqual([
      { id: 'daily', defaultEffort: 'low' },
      { id: 'agent', defaultEffort: 'xhigh' }
    ]);
  });

  it('marks the snapshot invalid when runtime settings are malformed', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'baseUrl') {
          return 'not-a-url';
        }

        if (key === 'requestTimeoutMs') {
          return 0;
        }

        return undefined;
      }
    };

    const snapshot = buildSettingsSnapshot(configuration as never);

    expect(snapshot.state).toBe('invalid-runtime');
    expect(snapshot.publishedModels).toEqual([]);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_BASE_URL', scope: 'runtime' }),
        expect.objectContaining({ code: 'INVALID_REQUEST_TIMEOUT', scope: 'runtime' })
      ])
    );
  });

  it('degrades one broken model mapping without removing valid models from publication', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily', 'agent'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily';
        }

        if (key === 'modelMappings.agent') {
          return '   ';
        }

        return undefined;
      }
    };

    const snapshot = buildSettingsSnapshot(configuration as never);

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['daily']);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({ key: 'agent', code: 'INVALID_COMBO_MAPPING' })
    ]);
  });

  it('degrades only the model with an unsupported thinking mode', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily', 'agent'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily';
        }

        if (key === 'modelMappings.agent') {
          return 'combo/agent';
        }

        if (key === 'thinkingMode.agent') {
          return 'turbo';
        }

        return undefined;
      }
    };

    const snapshot = buildSettingsSnapshot(configuration as never);

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels.map((model) => model.id)).toEqual(['daily']);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({ key: 'agent', code: 'INVALID_THINKING_MODE' })
    ]);
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        modelKey: 'agent',
        code: 'INVALID_THINKING_MODE',
        message: expect.stringContaining('9router-copilot.thinkingMode.agent')
      })
    ]);
  });

  it('rejects a combo mapping that already contains a thinking suffix', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily(high)';
        }

        return undefined;
      }
    };

    const snapshot = buildSettingsSnapshot(configuration as never);

    expect(snapshot.state).toBe('empty');
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({
        key: 'daily',
        code: 'INVALID_COMBO_MAPPING',
        message: expect.stringContaining('9router-copilot.thinkingMode.daily')
      })
    ]);
  });

  it('returns an empty publication state when no display models are valid', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily'];
        }

        if (key === 'modelMappings.daily') {
          return '';
        }

        return undefined;
      }
    };

    const snapshot = buildSettingsSnapshot(configuration as never);

    expect(snapshot.state).toBe('empty');
    expect(snapshot.publishedModels).toEqual([]);
    expect(snapshot.rejectedModels).toEqual([
      expect.objectContaining({ key: 'daily', code: 'INVALID_COMBO_MAPPING' })
    ]);
  });

  it('degrades image capability without rejecting a proxy model', () => {
    const snapshot = buildSettingsSnapshot({
      get: (key: string) => {
        if (key === 'displayModels') return ['agent'];
        if (key === 'modelMappings.agent') return 'combo/agent';
        if (key === 'visionMode.agent') return 'proxy';
        return undefined;
      }
    } as never);

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publishedModels).toHaveLength(1);
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBeUndefined();
    expect(snapshot.issues).toContainEqual(
      expect.objectContaining({
        scope: 'capability',
        code: 'MISSING_VISION_PROXY_COMBO'
      })
    );
  });

  it('advertises proxy image input when the shared combo is configured', () => {
    const snapshot = buildSettingsSnapshot({
      get: (key: string) => {
        if (key === 'displayModels') return ['agent'];
        if (key === 'modelMappings.agent') return 'combo/agent';
        if (key === 'visionMode.agent') return 'proxy';
        if (key === 'visionProxyComboId') return 'combo/vision';
        return undefined;
      }
    } as never);

    expect(snapshot.state).toBe('valid');
    expect(snapshot.runtime?.visionProxyComboId).toBe('combo/vision');
    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
  });
});
