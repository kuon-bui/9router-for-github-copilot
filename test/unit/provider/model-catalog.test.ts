import { describe, expect, it } from 'vitest';
import { createPublishedModel, resolvePublishedModels } from '../../../src/provider/model-catalog';

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
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ]);

    expect(models).toEqual([
      expect.objectContaining({ id: 'research', name: 'Research', vendor: '9router' }),
      expect.objectContaining({ id: 'coder', name: 'Coder', vendor: '9router' })
    ]);
  });

  it('publishes an independent thinking effort schema for each model', () => {
    const models = resolvePublishedModels([
      {
        sourceIndex: 0,
        id: 'daily',
        name: 'Daily',
        modelId: 'router/daily',
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
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
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ]);

    expect(models[0]?.configurationSchema?.properties.reasoningEffort.default).toBe('none');
    expect(models[1]?.configurationSchema?.properties.reasoningEffort.default).toBe('max');
    expect(models[0]?.configurationSchema).not.toBe(models[1]?.configurationSchema);
  });

  it('requires proxy availability before publishing image input', () => {
    const setting = {
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      toolMode: 'auto',
      visionMode: 'proxy',
      thinkingMode: 'off',
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192
    } as const;

    expect(createPublishedModel(setting).capabilities.imageInput).toBeUndefined();
    expect(
      createPublishedModel(setting, {
        visionProxyConfigured: true
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
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });

    expect(model).toMatchObject({
      maxInputTokens: 64_000,
      maxOutputTokens: 4_096
    });
  });
});
