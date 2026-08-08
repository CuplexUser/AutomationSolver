import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterChoices, type SymbolChoice } from '@automationsolver/shared';

/**
 * The device box, once a puzzle is written in variables.
 *
 * An input with a list under it. Without this the feature is a tax: declaring a
 * variable and then typing its name from memory is strictly worse than typing
 * `M40`, and a player would rightly stop doing it. So the picker is not a nicety
 * on top of scopes, it is the half that makes the other half worth having.
 *
 * The address rides along in the list and again under the box once a name
 * resolves, because this game teaches a platform where `M40` is a real thing an
 * engineer reads off a monitor screen. Naming it does not mean hiding it.
 */
export interface SymbolFieldProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  choices: SymbolChoice[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

const ORIGIN_LABEL: Record<SymbolChoice['origin'], string> = {
  local: 'local',
  global: 'global',
  plant: 'plant',
};

export function SymbolField({
  value,
  onChange,
  onFocus,
  onBlur,
  choices,
  disabled = false,
  className = 'field mono compact',
  placeholder,
  ariaLabel,
  title,
  inputRef,
}: SymbolFieldProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLSpanElement>(null);
  const listId = useId();

  const matches = useMemo(() => filterChoices(choices, value).slice(0, 8), [choices, value]);
  // What the typed text currently means, so the box can say so without the
  // player having to open anything.
  const resolved = useMemo(
    () => choices.find((c) => c.name.toLowerCase() === value.trim().toLowerCase()),
    [choices, value],
  );

  // Clamped on the way out rather than reset from an effect. The highlight is a
  // function of the list, and a list that just got shorter should not need a
  // render to stop pointing past the end of itself.
  const activeIndex = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  // Close on a click anywhere else. A blur handler alone cannot do this: mousing
  // down on a list row blurs the input before the click lands, which would shut
  // the list under the pointer and swallow the very choice being made.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const commit = (choice: SymbolChoice): void => {
    onChange(choice.name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (matches.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % matches.length);
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && matches[activeIndex]) {
      // Tab commits as well as Enter: the box is a picker, and tabbing out of one
      // having highlighted a row means that row.
      if (e.key === 'Enter') e.preventDefault();
      commit(matches[activeIndex]);
    }
  };

  return (
    <span className="symbol-field" ref={boxRef}>
      <input
        ref={inputRef}
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Typing re-filters the list, so the highlight goes back to the top.
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          onFocus?.();
          if (choices.length > 0) setOpen(true);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        title={title}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />
      {resolved && !open && (
        <span className={`symbol-echo dev-${resolved.kind}`} aria-hidden="true">
          {resolved.address}
        </span>
      )}
      {open && matches.length > 0 && (
        <ul className="symbol-list" id={listId} role="listbox">
          {matches.map((choice, i) => (
            <li key={`${choice.origin}:${choice.name}`}>
              <button
                type="button"
                className={`symbol-row${i === activeIndex ? ' is-active' : ''}`}
                role="option"
                aria-selected={i === activeIndex}
                // The input must not blur before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(choice)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="symbol-name">{choice.name}</span>
                <span className={`symbol-addr dev-${choice.kind}`}>
                  {choice.address}
                </span>
                <span className="symbol-origin">{ORIGIN_LABEL[choice.origin]}</span>
                {choice.detail && <span className="symbol-detail">{choice.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
