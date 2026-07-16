import { describe, expect, it } from 'vitest';
import { resolvePublishedModels } from '../../../src/provider/model-catalog';

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
});
