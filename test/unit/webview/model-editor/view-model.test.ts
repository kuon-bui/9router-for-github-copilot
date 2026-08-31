import { describe, expect, it } from 'vitest';
import { buildModelListView } from '@/webview/model-editor/view-model';

const BASE_STATE = {
  catalog: [], warnings: [], thinkingModes: ['off' as const], thinkingEfforts: [],
  defaultMaxInputTokens: 264_000,
  defaultMaxOutputTokens: 264_000
};

describe('buildModelListView', () => {
  it('labels a row and maps its id pair', () => {
    const [row] = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'agent', name: 'Agent', modelId: 'router/combo', toolMode: 'auto', visionMode: 'native', thinkingMode: 'off', catalogStatus: 'matched' }] });
    expect(row?.title).toBe('Agent');
    expect(row?.idLabel).toBe('agent -> router/combo');
    expect(row?.chips).toEqual([{ label: 'tools: auto', tone: 'plain' }, { label: 'vision: native', tone: 'plain' }, { label: 'thinking: off', tone: 'plain' }]);
  });

  it('falls back through name, id, then placeholder', () => {
    const rows = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'only-id', catalogStatus: 'missing' }, { sourceIndex: 1, valid: true, catalogStatus: 'missing' }] });
    expect(rows[0]).toMatchObject({ title: 'only-id', idLabel: 'only-id -> (no modelId)' });
    expect(rows[1]).toMatchObject({ title: 'Unnamed model', idLabel: '(no id) -> (no modelId)' });
  });

  it('flags fast, missing catalog, and validation issue', () => {
    const [row] = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: false, id: 'agent', modelId: 'router/gone', serviceTier: 'fast', catalogStatus: 'missing', issue: { code: 'INVALID_ID', message: 'id is not usable' } }] });
    expect(row?.chips).toEqual([{ label: 'Fast', tone: 'plain' }, { label: 'tools: off', tone: 'plain' }, { label: 'vision: off', tone: 'plain' }, { label: 'thinking: off', tone: 'plain' }, { label: 'not in catalog', tone: 'warn' }, { label: 'id is not usable', tone: 'bad' }]);
  });
});
