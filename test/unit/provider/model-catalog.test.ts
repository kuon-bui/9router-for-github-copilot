import { describe, expect, it } from 'vitest';
import { createPublishedModel, resolvePublishedModels } from '@/provider/model-catalog';

describe('resolvePublishedModels', () => {
  it('publishes arbitrary configured models in input order', () => {
    const models = resolvePublishedModels([
      {
        sourceIndex: 0,
        id: 'research',
        name: 'Research',
        modelId: 'router/research',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        sourceIndex: 1,
        id: 'coder',
        name: 'Coder',
        modelId: 'router/coder',
        toolMode: 'auto',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ]);

    expect(models).toEqual([
      expect.objectContaining({ id: 'research', name: 'Research', vendor: '9router' }),
      expect.objectContaining({ id: 'coder', name: 'Coder', vendor: '9router' })
    ]);
  });

  it('marks fast-tier models in the picker display name', () => {
    const model = createPublishedModel({
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      serviceTier: 'fast',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192
    });

    expect(model.name).toBe('⚡ Agent');
  });

  it('publishes an independent allowlisted thinking schema for each model', () => {
    const models = resolvePublishedModels([
      {
        sourceIndex: 0,
        id: 'daily',
        name: 'Daily',
        modelId: 'router/daily',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        sourceIndex: 1,
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        toolMode: 'auto',
        visionMode: 'proxy',
        thinkingMode: 'max',
        thinkingEfforts: ['low', 'max'],
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ]);

    expect(models[0]?.configurationSchema).toBeUndefined();
    expect(models[1]?.configurationSchema?.properties.reasoningEffort).toMatchObject({
      enum: ['none', 'low', 'max'],
      default: 'max'
    });
  });

  it('publishes proxy image input when guided setup is available', () => {
    const setting = {
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      toolMode: 'auto',
      visionMode: 'proxy',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192
    } as const;

    expect(createPublishedModel(setting).capabilities.imageInput).toBeUndefined();
    expect(
      createPublishedModel(setting, {
        visionProxyAvailable: true
      }).capabilities.imageInput
    ).toBe(true);
  });

  it('publishes configured input and output token limits', () => {
    const model = createPublishedModel({
      sourceIndex: 0,
      id: 'daily',
      name: 'Daily',
      modelId: 'router/daily',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      thinkingEfforts: [],
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });

    expect(model).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });
  });

  it('prefers validated router metadata over configured fallback limits', () => {
    const model = createPublishedModel(
      {
        sourceIndex: 0,
        id: 'agent',
        name: 'Agent',
        modelId: 'cx/gpt-5.6-sol',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192
      },
      {
        routerModel: {
          id: 'cx/gpt-5.6-sol',
          contextWindow: 372_000,
          maxOutput: 128_000
        }
      }
    );

    expect(model).toMatchObject({
      maxInputTokens: 244_000,
      maxOutputTokens: 128_000
    });
  });

  it('subtracts configured output fallback when catalog metadata omits maxOutput', () => {
    const model = createPublishedModel(
      {
        sourceIndex: 0,
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192
      },
      {
        routerModel: {
          id: 'router/agent',
          contextWindow: 400_000
        }
      }
    );

    expect(model).toMatchObject({
      maxInputTokens: 391_808,
      maxOutputTokens: 8_192
    });
  });

  it.each([
    ['equals output limit', 8_192],
    ['is smaller than output limit', 4_096]
  ])('uses configured input fallback when contextWindow %s', (_case, contextWindow) => {
    const model = createPublishedModel(
      {
        sourceIndex: 0,
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 64_000,
        maxOutputTokens: 8_192
      },
      {
        routerModel: {
          id: 'router/agent',
          contextWindow,
          maxOutput: 8_192
        }
      }
    );

    expect(model).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192
    });
  });

  it('matches catalog metadata by exact backend model id', () => {
    const settings = [
      {
        sourceIndex: 0,
        id: 'agent',
        name: 'Agent',
        modelId: 'cx/gpt-5.6-sol',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        thinkingEfforts: [],
        maxInputTokens: 264_000,
        maxOutputTokens: 264_000
      }
    ] as const;

    expect(
      resolvePublishedModels([...settings], {
        routerModels: [
          { id: 'cx/gpt-5.6-sol-preview', contextWindow: 800_000, maxOutput: 256_000 },
          { id: 'cx/gpt-5.6-sol', contextWindow: 400_000, maxOutput: 128_000 }
        ]
      })[0]
    ).toMatchObject({
      maxInputTokens: 272_000,
      maxOutputTokens: 128_000
    });
  });
});
