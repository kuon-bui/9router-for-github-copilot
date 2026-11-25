import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';
import {
  filterPickerOptions,
  handleComboboxKey,
  type ComboboxNav,
  type PickerOption
} from './combobox-model';

export interface ComboboxProps {
  readonly id: string;
  readonly label: string;
  readonly options: readonly PickerOption[];
  readonly value: string;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

const CLOSED_NAV: ComboboxNav = { open: false, activeIndex: -1 };

export function Combobox(props: ComboboxProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [nav, setNav] = useState<ComboboxNav>(CLOSED_NAV);

  const isDisabled = Boolean(props.disabled);
  const isOpen = nav.open && !isDisabled;
  const filtered = filterPickerOptions(props.options, query);
  const selectedLabel = props.options.find((option) => option.value === props.value)?.label ?? '';
  const inputValue = isOpen ? query : selectedLabel;
  const listboxId = `${props.id}-listbox`;
  const activeOptionId =
    isOpen && nav.activeIndex >= 0 && nav.activeIndex < filtered.length
      ? `${props.id}-option-${nav.activeIndex}`
      : undefined;
  const labelId = `${props.id}-label`;

  // Long lists overflow the popup, so keep the keyboard-active option on screen.
  useEffect(() => {
    if (activeOptionId !== undefined) {
      document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeOptionId]);

  function openPicker(): void {
    if (isDisabled) {
      return;
    }
    const selectedIndex = props.options.findIndex((option) => option.value === props.value);
    setQuery('');
    setNav({ open: true, activeIndex: selectedIndex });
  }

  function handleInputChange(rawValue: string): void {
    // A closed picker shows the selected label, so typing appends to it; search only what
    // the user typed rather than "<label><typed>".
    const nextQuery =
      !isOpen && selectedLabel.length > 0 && rawValue.startsWith(selectedLabel)
        ? rawValue.slice(selectedLabel.length)
        : rawValue;
    const nextFiltered = filterPickerOptions(props.options, nextQuery);
    setQuery(nextQuery);
    setNav({ open: true, activeIndex: nextFiltered.length > 0 ? 0 : -1 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (isDisabled) {
      return;
    }
    const result = handleComboboxKey(nav, event.key, filtered.length);
    if (result.preventDefault) {
      event.preventDefault();
    }
    setNav(result.nav);
    if (result.selectIndex !== undefined) {
      const chosen = filtered[result.selectIndex];
      if (chosen) {
        props.onChange(chosen.value);
      }
      setQuery('');
    } else if (result.restoreLabel) {
      setQuery('');
    }
  }

  return (
    <div className="ui-combobox-field">
      <label id={labelId} htmlFor={props.id}>
        {props.label}
      </label>
      <div className="ui-combobox">
        <input
          id={props.id}
          className="ui-field"
          type="text"
          role="combobox"
          autoComplete="off"
          spellcheck={false}
          disabled={isDisabled}
          placeholder={props.placeholder}
          value={inputValue}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          {...(activeOptionId !== undefined ? { 'aria-activedescendant': activeOptionId } : {})}
          onFocus={openPicker}
          onClick={() => {
            if (!isOpen) {
              openPicker();
            }
          }}
          onBlur={() => {
            setNav(CLOSED_NAV);
            setQuery('');
          }}
          onChange={(event) => handleInputChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        {isOpen ? (
          <div
            id={listboxId}
            className="ui-combobox-list"
            role="listbox"
            aria-labelledby={labelId}
            // Keep focus in the input for any press inside the popup (scrollbar, padding,
            // empty row); otherwise blur closes the list mid-drag.
            onMouseDown={(event) => event.preventDefault()}
          >
            {filtered.length === 0 ? (
              <div className="ui-combobox-empty">No matches</div>
            ) : (
              filtered.map((option, index) => {
                const isActive = index === nav.activeIndex;
                const isSelected = option.value === props.value;
                return (
                  <div
                    key={option.value}
                    id={`${props.id}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`ui-combobox-option${isActive ? ' ui-combobox-option-active' : ''}`}
                    // mousemove, not mouseenter: keyboard scrolling slides options under a
                    // still cursor and must not steal the active index.
                    onMouseMove={() => {
                      if (nav.activeIndex !== index) {
                        setNav({ open: true, activeIndex: index });
                      }
                    }}
                    onMouseDown={() => {
                      setNav(CLOSED_NAV);
                      setQuery('');
                      props.onChange(option.value);
                    }}
                  >
                    {option.iconUrl !== undefined ? (
                      <img
                        src={option.iconUrl}
                        alt=""
                        width={16}
                        height={16}
                        className="shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                    {option.detail !== undefined ? (
                      <span className="ui-combobox-detail">{option.detail}</span>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
