import { describe, expect, it } from 'vitest';
import type { ModelEditorCatalogEntry } from '@/types/model-editor';
import {
  buildModelListView,
  buildModelOptions,
  buildProviderOptions,
  findCatalogProvider,
  matchesRowTransition,
  OTHER_PROVIDER,
  resolveActiveProvider,
  resolveCatalogProvider,
  toRouterModelMetadata
} from '@/webview/model-editor/view-model';

function entry(
  overrides: Partial<ModelEditorCatalogEntry> & Pick<ModelEditorCatalogEntry, 'modelId'>
): ModelEditorCatalogEntry {
  return { vision: false, inUse: false, ...overrides };
}

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

describe('resolveCatalogProvider', () => {
  it('prefers ownedBy', () => expect(resolveCatalogProvider(entry({ modelId: 'cx/gpt', ownedBy: 'router' }))).toBe('router'));
  it('falls back to the id prefix', () => expect(resolveCatalogProvider(entry({ modelId: 'cx/gpt-5' }))).toBe('cx'));
  it('uses Other when neither exists', () => expect(resolveCatalogProvider(entry({ modelId: 'my-combo' }))).toBe(OTHER_PROVIDER));
  it('treats a leading slash as no prefix', () => expect(resolveCatalogProvider(entry({ modelId: '/x' }))).toBe(OTHER_PROVIDER));
});

describe('findCatalogProvider', () => {
  it('returns the provider of a catalog model', () => expect(findCatalogProvider([entry({ modelId: 'cx/a', ownedBy: 'cx' })], 'cx/a')).toBe('cx'));
  it('returns undefined for unknown or empty ids', () => {
    expect(findCatalogProvider([entry({ modelId: 'cx/a' })], 'gone/model')).toBeUndefined();
    expect(findCatalogProvider([entry({ modelId: 'cx/a' })], '')).toBeUndefined();
  });
});

describe('buildProviderOptions', () => {
  it('groups, counts, sorts, and puts Other last', () => {
    const options = buildProviderOptions([
      entry({ modelId: 'zz-combo' }), entry({ modelId: 'gc/b', ownedBy: 'gc' }),
      entry({ modelId: 'cx/a', ownedBy: 'cx' }), entry({ modelId: 'cx/b', ownedBy: 'cx' })
    ]);
    expect(options.map((o) => [o.value, o.detail])).toEqual([
      ['cx', '2 models'], ['gc', '1 model'], [OTHER_PROVIDER, '1 model']
    ]);
    expect(options[0]?.iconUrl).toContain('/codex-color.svg');
    expect(options[2]?.iconUrl).toBeUndefined();
  });
  it('returns [] for an empty catalog', () => expect(buildProviderOptions([])).toEqual([]));
});

describe('buildModelOptions', () => {
  it('keeps catalog order for one provider with in use / vision detail', () => {
    const options = buildModelOptions([
      entry({ modelId: 'cx/b', ownedBy: 'cx', inUse: true, vision: true }),
      entry({ modelId: 'gc/x', ownedBy: 'gc' }),
      entry({ modelId: 'cx/a', ownedBy: 'cx' })
    ], 'cx');
    expect(options).toEqual([
      { value: 'cx/b', label: 'cx/b', detail: 'in use · vision' },
      { value: 'cx/a', label: 'cx/a' }
    ]);
  });
  it('returns [] for an unknown provider', () => expect(buildModelOptions([entry({ modelId: 'cx/a' })], 'nope')).toEqual([]));
});

describe('resolveActiveProvider', () => {
  const options = [{ value: 'cx', label: 'cx' }, { value: 'gc', label: 'gc' }];
  it('keeps a provider that is still in the catalog', () =>
    expect(resolveActiveProvider(options, 'gc')).toBe('gc'));
  it('drops a provider that a catalog refresh removed', () =>
    expect(resolveActiveProvider(options, 'kimi')).toBe(''));
  it('stays empty when nothing is chosen', () =>
    expect(resolveActiveProvider(options, '')).toBe(''));
});
