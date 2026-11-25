import { describe, expect, it } from 'vitest';
import { filterPickerOptions, handleComboboxKey } from '@/webview/shared/combobox-model';

const opts = [
  { value: 'cx/gpt-5', label: 'cx/gpt-5' },
  { value: 'gc/gemini', label: 'gc/gemini', detail: 'vision' },
  { value: 'x(1)', label: 'Paren (1)' }
];

describe('filterPickerOptions', () => {
  it('returns all options for an empty or blank query', () => {
    expect(filterPickerOptions(opts, '')).toEqual(opts);
    expect(filterPickerOptions(opts, '   ')).toEqual(opts);
  });
  it('matches label or value, trimmed and case-insensitive', () => {
    expect(filterPickerOptions(opts, ' GPT ').map((o) => o.value)).toEqual(['cx/gpt-5']);
    expect(filterPickerOptions(opts, 'x(1')).toHaveLength(1);
  });
  it('treats regex characters literally', () => expect(filterPickerOptions(opts, '(')).toHaveLength(1));
  it('returns [] when nothing matches', () => expect(filterPickerOptions(opts, 'zzz')).toEqual([]));
});

describe('handleComboboxKey', () => {
  const closed = { open: false, activeIndex: -1 };
  it('ArrowDown opens on the first option', () =>
    expect(handleComboboxKey(closed, 'ArrowDown', 3)).toEqual({ nav: { open: true, activeIndex: 0 }, preventDefault: true }));
  it('ArrowDown/ArrowUp clamp to the list', () => {
    expect(handleComboboxKey({ open: true, activeIndex: 2 }, 'ArrowDown', 3).nav.activeIndex).toBe(2);
    expect(handleComboboxKey({ open: true, activeIndex: 0 }, 'ArrowUp', 3).nav.activeIndex).toBe(0);
  });
  it('Enter on an open list selects, closes, and blocks form submit', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'Enter', 3)).toEqual({ nav: { open: false, activeIndex: -1 }, selectIndex: 1, preventDefault: true }));
  it('Enter on an open list with no matches blocks submit without selecting', () => {
    const result = handleComboboxKey({ open: true, activeIndex: -1 }, 'Enter', 0);
    expect(result.preventDefault).toBe(true);
    expect(result.selectIndex).toBeUndefined();
  });
  it('Enter on a closed list is left to the form', () =>
    expect(handleComboboxKey(closed, 'Enter', 3).preventDefault).toBe(false));
  it('Escape closes and restores the selected label', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'Escape', 3)).toEqual({ nav: { open: false, activeIndex: -1 }, preventDefault: true, restoreLabel: true }));
  it('other keys pass through', () =>
    expect(handleComboboxKey({ open: true, activeIndex: 1 }, 'a', 3)).toEqual({ nav: { open: true, activeIndex: 1 }, preventDefault: false }));
});
