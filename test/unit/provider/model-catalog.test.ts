import { describe, expect, it } from 'vitest';
import { createPublishedModel, resolvePublishedModels } from '../../../src/provider/model-catalog';

describe('resolvePublishedModels', () => {
  it('publishes only curated models with valid combo mappings', () => {
    const models = resolvePublishedModels([
      {
        key: 'daily',
        label: 'Daily',
        comboId: 'combo/daily',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        key: 'agent',
        label: 'Agent',
        comboId: '',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      }
    ]);

    expect(models).toEqual([
      expect.objectContaining({ id: 'daily', name: 'Daily', vendor: '9router' })
    ]);
  });

  it('publishes an independent thinking effort schema for each model', () => {
    const models = resolvePublishedModels([
      {
        key: 'daily',
        label: 'Daily',
        comboId: 'combo/daily',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192
      },
      {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
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
      key: 'agent',
      label: 'Agent',
      comboId: 'combo/agent',
      enabled: true,
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
      key: 'daily',
      label: 'Daily',
      comboId: 'combo/daily',
      enabled: true,
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
