import { describe, expect, it } from 'vitest';
import {
  addModelEntry,
  moveModelEntry,
  readModelEntries,
  removeModelEntry,
  updateModelEntry
} from '@/config/model-entry-edits';

const broken = { id: 'broken', name: 'Broken' };
const valid = { id: 'agent', name: 'Agent', modelId: 'router/combo' };

describe('readModelEntries', () => {
  it('copies arrays and replaces non-arrays with an empty list', () => {
    const source = [valid];
    const copy = readModelEntries(source);

    expect(copy).toEqual([valid]);
    expect(copy).not.toBe(source);
    expect(readModelEntries('nope')).toEqual([]);
    expect(readModelEntries(undefined)).toEqual([]);
  });
});

describe('addModelEntry', () => {
  it('appends without touching existing entries', () => {
    const next = addModelEntry([broken], valid);

    expect(next).toEqual([broken, valid]);
    expect(next[0]).toBe(broken);
  });
});

describe('updateModelEntry', () => {
  it('replaces one entry and keeps the rest by reference', () => {
    const next = updateModelEntry([broken, valid], 1, { ...valid, name: 'Renamed' });

    expect(next[0]).toBe(broken);
    expect(next[1]).toEqual({ ...valid, name: 'Renamed' });
  });

  it('leaves the list unchanged for an out-of-range index', () => {
    expect(updateModelEntry([valid], 5, broken)).toEqual([valid]);
    expect(updateModelEntry([valid], -1, broken)).toEqual([valid]);
  });
});

describe('removeModelEntry', () => {
  it('removes the target entry only', () => {
    expect(removeModelEntry([broken, valid], 0)).toEqual([valid]);
    expect(removeModelEntry([broken, valid], 9)).toEqual([broken, valid]);
  });
});

describe('moveModelEntry', () => {
  it('swaps with the adjacent entry', () => {
    expect(moveModelEntry([broken, valid], 1, 'up')).toEqual([valid, broken]);
    expect(moveModelEntry([broken, valid], 0, 'down')).toEqual([valid, broken]);
  });

  it('is a no-op at the boundaries and out of range', () => {
    expect(moveModelEntry([broken, valid], 0, 'up')).toEqual([broken, valid]);
    expect(moveModelEntry([broken, valid], 1, 'down')).toEqual([broken, valid]);
    expect(moveModelEntry([broken, valid], 7, 'up')).toEqual([broken, valid]);
  });
});
