export interface PickerOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly iconUrl?: string;
}

export interface ComboboxNav {
  readonly open: boolean;
  readonly activeIndex: number;
}

export interface ComboboxKeyResult {
  readonly nav: ComboboxNav;
  readonly selectIndex?: number;
  readonly preventDefault: boolean;
  readonly restoreLabel?: true;
}

export function filterPickerOptions(
  options: readonly PickerOption[],
  query: string
): PickerOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...options];
  }
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(normalized) ||
      option.value.toLowerCase().includes(normalized)
  );
}

export function handleComboboxKey(
  nav: ComboboxNav,
  key: string,
  optionCount: number
): ComboboxKeyResult {
  if (key === 'ArrowDown') {
    if (optionCount <= 0) {
      return { nav: { open: true, activeIndex: -1 }, preventDefault: true };
    }
    const nextIndex = nav.open ? Math.min(optionCount - 1, Math.max(0, nav.activeIndex + 1)) : 0;
    return { nav: { open: true, activeIndex: nextIndex }, preventDefault: true };
  }

  if (key === 'ArrowUp') {
    if (optionCount <= 0) {
      return { nav: { open: true, activeIndex: -1 }, preventDefault: true };
    }
    const nextIndex = nav.open ? Math.max(0, nav.activeIndex - 1) : optionCount - 1;
    return { nav: { open: true, activeIndex: nextIndex }, preventDefault: true };
  }

  if (key === 'Enter') {
    if (!nav.open) {
      return { nav, preventDefault: false };
    }
    if (nav.activeIndex >= 0 && nav.activeIndex < optionCount) {
      return {
        nav: { open: false, activeIndex: -1 },
        selectIndex: nav.activeIndex,
        preventDefault: true
      };
    }
    return { nav, preventDefault: true };
  }

  if (key === 'Escape') {
    if (!nav.open) {
      return { nav, preventDefault: false };
    }
    return {
      nav: { open: false, activeIndex: -1 },
      preventDefault: true,
      restoreLabel: true
    };
  }

  return { nav, preventDefault: false };
}
