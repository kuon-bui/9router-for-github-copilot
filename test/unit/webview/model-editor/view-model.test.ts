import { describe, expect, it } from 'vitest';
import { buildModelListView, matchesRowTransition, toRouterModelMetadata } from '@/webview/model-editor/view-model';

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
    expect(row?.catalogMissing).toBe(false);
    expect(row?.chips).toEqual([{ label: 'tools: auto', tone: 'plain' }, { label: 'vision: native', tone: 'plain' }, { label: 'thinking: off', tone: 'plain' }]);
  });

  it('falls back through name, id, then placeholder', () => {
    const rows = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'only-id', catalogStatus: 'missing' }, { sourceIndex: 1, valid: true, catalogStatus: 'missing' }] });
    expect(rows[0]).toMatchObject({ title: 'only-id', idLabel: 'only-id -> (no modelId)' });
    expect(rows[1]).toMatchObject({ title: 'Unnamed model', idLabel: '(no id) -> (no modelId)' });
  });

  it('flags fast, missing catalog, and validation issue', () => {
    const [row] = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: false, id: 'agent', modelId: 'router/gone', serviceTier: 'fast', catalogStatus: 'missing', issue: { code: 'INVALID_ID', message: 'id is not usable' } }] });
    expect(row?.catalogMissing).toBe(true);
    expect(row?.chips).toEqual([{ label: 'Fast', tone: 'plain' }, { label: 'tools: off', tone: 'plain' }, { label: 'vision: off', tone: 'plain' }, { label: 'thinking: off', tone: 'plain' }, { label: 'not in catalog', tone: 'warn' }, { label: 'id is not usable', tone: 'bad' }]);
  });

  it('derives a stable view-transition key from id, falling back to modelId then position', () => {
    const rows = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'gpt-5', catalogStatus: 'matched' }, { sourceIndex: 1, valid: true, modelId: 'router/claude', catalogStatus: 'matched' }, { sourceIndex: 2, valid: true, catalogStatus: 'missing' }] });
    expect(rows.map((row) => row.key)).toEqual(['model-gpt-5', 'model-router-claude', 'model-row-2']);
  });

  it('sanitizes ids with characters invalid in a CSS custom-ident', () => {
    const [row] = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'My Model! (v2)', catalogStatus: 'matched' }] });
    expect(row?.key).toBe('model-My-Model-v2');
  });

  it('de-duplicates keys when ids repeat, matching DUPLICATE_MODEL_ID staying non-fatal', () => {
    const rows = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'dup', catalogStatus: 'matched' }, { sourceIndex: 1, valid: true, id: 'dup', catalogStatus: 'matched' }] });
    expect(rows.map((row) => row.key)).toEqual(['model-dup', 'model-dup-1']);
  });

  it('keeps each model\'s key attached to its identity, not its array position, across a reorder', () => {
    const before = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'a', catalogStatus: 'matched' }, { sourceIndex: 1, valid: true, id: 'b', catalogStatus: 'matched' }] });
    const after = buildModelListView({ ...BASE_STATE, models: [{ sourceIndex: 0, valid: true, id: 'b', catalogStatus: 'matched' }, { sourceIndex: 1, valid: true, id: 'a', catalogStatus: 'matched' }] });
    expect(before.find((row) => row.title === 'a')?.key).toBe(after.find((row) => row.title === 'a')?.key);
    expect(before.find((row) => row.title === 'b')?.key).toBe(after.find((row) => row.title === 'b')?.key);
  });
});

describe('matchesRowTransition', () => {
  const KEYS = ['model-a', 'model-b', 'model-c'];

  it('recognises the requested row disappearing as that delete', () => {
    expect(matchesRowTransition({ kind: 'remove', key: 'model-b' }, KEYS, ['model-a', 'model-c'])).toBe(true);
  });

  it('rejects a delete intent when a cancelled delete is followed by an unrelated refresh', () => {
    expect(matchesRowTransition({ kind: 'remove', key: 'model-b' }, KEYS, KEYS)).toBe(false);
  });

  it('rejects a delete intent when a different row went away', () => {
    expect(matchesRowTransition({ kind: 'remove', key: 'model-b' }, KEYS, ['model-a', 'model-b'])).toBe(false);
  });

  it('recognises the same rows in a new order as a move', () => {
    expect(matchesRowTransition({ kind: 'move' }, KEYS, ['model-b', 'model-a', 'model-c'])).toBe(true);
  });

  it('rejects a move intent when the order did not change or the rows differ', () => {
    expect(matchesRowTransition({ kind: 'move' }, KEYS, KEYS)).toBe(false);
    expect(matchesRowTransition({ kind: 'move' }, KEYS, ['model-a', 'model-c'])).toBe(false);
    expect(matchesRowTransition({ kind: 'move' }, KEYS, ['model-c', 'model-b', 'model-x'])).toBe(false);
  });
});

describe('toRouterModelMetadata', () => {
  it('drops editor-only metadata and absent optional fields', () => {
    expect(
      toRouterModelMetadata({
        modelId: 'router/combo',
        ownedBy: 'router',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000,
        inUse: true
      })
    ).toEqual({
      id: 'router/combo',
      ownedBy: 'router',
      vision: true,
      contextWindow: 400_000,
      maxOutput: 128_000
    });
    expect(toRouterModelMetadata({ modelId: 'router/basic', vision: false, inUse: false })).toEqual({
      id: 'router/basic'
    });
  });
});
