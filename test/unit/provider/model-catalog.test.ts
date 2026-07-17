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
        thinkingMode: 'off'
      },
      {
        key: 'agent',
        label: 'Agent',
        comboId: '',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off'
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
        thinkingMode: 'off'
      },
      {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'auto',
        visionMode: 'proxy',
        thinkingMode: 'max'
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
      thinkingMode: 'off'
    } as const;

    expect(createPublishedModel(setting).capabilities.imageInput).toBeUndefined();
    expect(
      createPublishedModel(setting, {
        visionProxyConfigured: true
      }).capabilities.imageInput
    ).toBe(true);
  });
});
