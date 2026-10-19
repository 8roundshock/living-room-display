import { useEffect, useId, useRef, useState } from 'react';
import type { LocationResult } from '../shared/contracts';
import { api } from './api';
import { Icon } from './icons';

/**
 * Editable APG list-autocomplete: DOM focus remains in the input. The listbox and option ids are
 * unique per instance, so several searches (Weather and World clocks) can coexist.
 */
export function CitySearch({
  value,
  onChange,
  onSelect,
  disabled,
  id = 'city-search',
  label = 'Search for a city',
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (city: LocationResult) => void;
  disabled: boolean;
  /** Input id for an external label; the Weather tab keeps `city-search`. */
  id?: string;
  /** Accessible name of the combobox. */
  label?: string;
}) {
  const instance = useId();
  const listId = `${instance}-options`,
    optionId = (index: number) => `${instance}-option-${index}`;
  const [cities, setCities] = useState<LocationResult[]>([]);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [status, setStatus] = useState('');
  const focused = useRef(false),
    requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current,
      controller = new AbortController();
    setCities([]);
    setActive(-1);
    if (value.trim().length < 2) {
      setOpen(false);
      setStatus('');
      return;
    }
    setStatus('Searching…');
    setOpen(focused.current);
    const timer = window.setTimeout(async () => {
      try {
        const found = await api<LocationResult[]>(
          `/api/locations?q=${encodeURIComponent(value.trim())}`,
          { signal: controller.signal },
        );
        if (id !== requestId.current || controller.signal.aborted) return;
        setCities(found);
        setStatus(
          found.length
            ? `${found.length} ${found.length === 1 ? 'city' : 'cities'} found`
            : 'No cities found',
        );
      } catch {
        if (id === requestId.current && !controller.signal.aborted)
          setStatus('Search unavailable. Try again.');
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(optionId(active))
        ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  function select(city: LocationResult) {
    requestId.current++;
    setOpen(false);
    setCities([]);
    setActive(-1);
    onSelect(city);
  }
  return (
    <div className="city-combobox">
      <Icon name="location" size={17} />
      <input
        id={id}
        className="text-input"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && active >= 0 ? optionId(active) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        placeholder="Search cities"
        value={value}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
          if (value.trim().length >= 2) setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
          }
          if (
            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
            cities.length
          ) {
            event.preventDefault();
            setOpen(true);
            setActive((previous) =>
              event.key === 'ArrowDown'
                ? Math.min(previous + 1, cities.length - 1)
                : previous < 0
                  ? cities.length - 1
                  : Math.max(previous - 1, 0),
            );
          }
          if (event.key === 'Enter' && open && active >= 0 && cities[active]) {
            event.preventDefault();
            select(cities[active]);
          }
        }}
      />
      {value && (
        <button
          className="city-clear icon-button"
          aria-label="Clear city search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            document.getElementById(id)?.focus();
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
      {open && (
        <div className="city-dropdown">
          <ul id={listId} role="listbox" aria-label="Cities">
            {cities.map((city, index) => (
              <li
                key={city.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => select(city)}
              >
                <strong>{city.name}</strong>
                <span>
                  {[city.admin1, city.country].filter(Boolean).join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p
            role="status"
            className={`city-search-status ${cities.length ? 'sr-only' : ''}`}
          >
            {status}
          </p>
        </div>
      )}
      {!open && (
        <span className="sr-only" role="status">
          {status}
        </span>
      )}
    </div>
  );
}
