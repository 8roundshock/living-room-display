import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LocationResult, Settings, WorldClockCity } from '../../shared/contracts.ts';
import { civilDateKey, isValidTimeZone, localTimeZone, sunIsUp, timeParts, zoneFormatter, zoneOffsetMinutes } from '../astronomy.ts';
import { CitySearch } from '../CitySearch.tsx';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './world-clocks.css';

export const MAX_WORLD_CLOCKS = 4;

/** "+13 h", "−1 h", "+5:30 h"; the relation to this computer's zone. */
export function offsetLabel(minutes: number): string {
  const sign = minutes > 0 ? '+' : '−', value = Math.abs(minutes), hours = Math.floor(value / 60), rest = value % 60;
  return `${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''} h`;
}
/** "Tomorrow · +13 h", "Today · −1 h" or "Same time", DST-correct through Intl offsets. */
export function cityRelation(at: Date, timeZone: string, localZone: string): string {
  const difference = zoneOffsetMinutes(at, timeZone) - zoneOffsetMinutes(at, localZone);
  if (difference === 0) return 'Same time';
  const city = civilDateKey(at, timeZone), local = civilDateKey(at, localZone);
  return `${city > local ? 'Tomorrow' : city < local ? 'Yesterday' : 'Today'} · ${offsetLabel(difference)}`;
}

interface CityTime { city: WorldClockCity; time: string; period: string | null; relation: string; daytime: boolean }
/** Formatting and sun position are calculated once per minute; formatters are cached per zone. */
function useCityTimes(cities: WorldClockCity[], now: Date, clockFormat: Settings['clockFormat'], count: number): CityTime[] {
  const minute = Math.floor(now.getTime() / 60_000);
  const key = JSON.stringify(cities.slice(0, count));
  return useMemo(() => {
    const at = new Date(minute * 60_000), local = localTimeZone();
    return cities.slice(0, count).filter(city => isValidTimeZone(city.timezone)).map(city => ({
      city, ...timeParts(at, city.timezone, clockFormat), relation: cityRelation(at, city.timezone, local), daytime: sunIsUp(at, city.latitude, city.longitude),
    }));
  }, [minute, key, clockFormat, count]);
}

function DayNight({ daytime }: { daytime: boolean }) {
  const name = daytime ? 'sun' : 'moon';
  return <><Icon name={name} size={null} className="wc-daynight" data-glyph={name} /><span className="sr-only">{daytime ? 'Day' : 'Night'}</span></>;
}
function CityClock({ entry, className }: { entry: CityTime; className: string }) {
  return <span className={className}><TransitionText value={entry.time} />{entry.period && <span className="wc-period">{entry.period}</span>}</span>;
}

function WorldClocks({ settings, size, now, embedded }: WidgetContentProps) {
  const cities = settings.widgetData.worldClocks;
  const shown = size === 'small' ? 1 : size === 'medium' ? 2 : MAX_WORLD_CLOCKS;
  const entries = useCityTimes(cities, now, settings.clockFormat, shown);
  const more = cities.length - entries.length;
  if (!entries.length) return embedded ? <div className="widget-body image-placeholder"><Icon name="globe" /><div className="ambient-label">World clocks</div><div className="ambient-description">Add a city</div></div> : null;
  const moreLabel = more > 0 && <div className="wc-more">+{more}</div>;
  if (size === 'large') {
    return <div className="widget-body wc-body"><ul className="wc-rows">{entries.map(entry => <li className="wc-row" key={entry.city.id}>
      <div className="wc-row-copy"><div className="ambient-label wc-label"><DayNight daytime={entry.daytime} /><span className="wc-name">{entry.city.label}</span></div><div className="wc-relation">{entry.relation}</div></div>
      <CityClock entry={entry} className="wc-time" />
    </li>)}</ul></div>;
  }
  return <div className="widget-body wc-body"><div className={size === 'medium' ? 'wc-cities' : 'wc-single'}>{entries.map(entry => <div className="wc-city" key={entry.city.id}>
    <div className="ambient-label wc-label"><DayNight daytime={entry.daytime} /><span className="wc-name">{entry.city.label}</span></div>
    <CityClock entry={entry} className="wc-time" />
    <div className="wc-relation">{entry.relation}</div>
  </div>)}</div>{moreLabel}</div>;
}

/** The editor's clock for current city times; ticks on the minute, editor only. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(() => { setNow(new Date()); schedule(); }, 60_000 - Date.now() % 60_000 + 50); };
    schedule(); return () => window.clearTimeout(timer);
  }, []);
  return now;
}
function zoneName(timeZone: string): string {
  try { return zoneFormatter(timeZone, { timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value ?? timeZone; } catch { return timeZone; }
}

function WorldClocksSettings({ settings, onChange, saving }: WidgetSettingsProps) {
  const cities = settings.widgetData.worldClocks;
  const [query, setQuery] = useState(''), [message, setMessage] = useState('');
  // Region names from the search result, kept for cities added in this editor session.
  const [regions, setRegions] = useState<Record<string, string>>({});
  const inputId = useId(), now = useMinute(), list = useRef<HTMLUListElement>(null), addField = useRef<HTMLDivElement>(null);
  const focus = useRef<{ id: string; action: string } | null>(null);
  const full = cities.length >= MAX_WORLD_CLOCKS;
  function edit(update: (list: WorldClockCity[]) => WorldClockCity[]) {
    onChange(previous => ({ ...previous, widgetData: { ...previous.widgetData, worldClocks: update(previous.widgetData.worldClocks) } }));
  }
  useLayoutEffect(() => {
    const target = focus.current; if (!target) return; focus.current = null;
    const row = list.current?.querySelector<HTMLElement>(`[data-city-id="${target.id}"]`);
    const buttons = ['up', 'down', 'remove'];
    const preferred = [target.action, ...buttons.filter(action => action !== target.action)];
    const button = preferred.map(action => row?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]:not(:disabled)`)).find(Boolean);
    (button ?? addField.current?.querySelector('input'))?.focus();
  });
  function add(city: LocationResult) {
    setQuery('');
    if (!isValidTimeZone(city.timezone)) { setMessage(`${city.name} has no usable time zone`); return; }
    const id = crypto.randomUUID();
    edit(list => list.length >= MAX_WORLD_CLOCKS ? list : [...list, { id, label: city.name.trim().slice(0, 40), timezone: city.timezone, latitude: city.latitude, longitude: city.longitude }]);
    setRegions(previous => ({ ...previous, [id]: [city.admin1, city.country].filter(Boolean).join(', ') }));
    setMessage(`${city.name} added`);
  }
  function move(id: string, step: -1 | 1, action: 'up' | 'down') {
    focus.current = { id, action };
    edit(list => {
      const index = list.findIndex(city => city.id === id), target = index + step;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const next = [...list]; [next[index], next[target]] = [next[target]!, next[index]!]; return next;
    });
  }
  function remove(id: string, index: number) {
    const neighbour = cities[index + 1] ?? cities[index - 1];
    focus.current = neighbour ? { id: neighbour.id, action: 'remove' } : { id: '', action: 'add' };
    const removed = cities.find(city => city.id === id);
    edit(list => list.filter(city => city.id !== id));
    setMessage(removed ? `${removed.label || 'City'} removed` : '');
  }
  return <div className="world-clock-editor">
    <span className="field-label">Cities</span>
    {cities.length ? <ul className="world-clock-list" ref={list} aria-label="World clock cities">{cities.map((city, index) => {
      const name = city.label.trim() || `city ${index + 1}`, empty = !city.label.trim(), errorId = `${inputId}-error-${city.id}`, metaId = `${inputId}-meta-${city.id}`;
      const time = isValidTimeZone(city.timezone) ? timeParts(now, city.timezone, settings.clockFormat) : null;
      return <li key={city.id} data-city-id={city.id} className="world-clock-item">
        {/* A position-based name stays the same while typing (#192); the row's region and time describe it. */}
        <input className="text-input world-clock-label" aria-label={`City ${index + 1} label`} value={city.label} maxLength={40} disabled={saving}
          aria-invalid={empty || undefined} aria-describedby={empty ? `${errorId} ${metaId}` : metaId}
          onChange={event => { const value = event.target.value; edit(list => list.map(item => item.id === city.id ? { ...item, label: value } : item)); }} />
        <span className="world-clock-meta" id={metaId}><span>{regions[city.id] || zoneName(city.timezone)}</span>{' '}<span className="world-clock-now">{time ? `${time.time}${time.period ? ` ${time.period}` : ''}` : '—'}</span></span>
        {empty && <span className="world-clock-error" id={errorId}>Enter a label</span>}
        <span className="world-clock-actions">
          <button type="button" className="icon-button" data-action="up" aria-label={`Move ${name} up`} disabled={saving || index === 0} onClick={() => move(city.id, -1, 'up')}><Icon name="arrow" size={15} className="world-clock-up" /></button>
          <button type="button" className="icon-button" data-action="down" aria-label={`Move ${name} down`} disabled={saving || index === cities.length - 1} onClick={() => move(city.id, 1, 'down')}><Icon name="arrow" size={15} className="world-clock-down" /></button>
          <button type="button" className="icon-button" data-action="remove" aria-label={`Remove ${name}`} disabled={saving} onClick={() => remove(city.id, index)}><Icon name="trash" size={15} /></button>
        </span>
      </li>;
    })}</ul> : <p className="hint">No cities yet.</p>}
    <div className="city-field" ref={addField}>
      <label className="field-label" htmlFor={inputId}>Add a city</label>
      <CitySearch id={inputId} label="Add a city" value={query} onChange={setQuery} onSelect={add} disabled={saving || full} />
    </div>
    <p className="inline-message" role="status">{full ? `Up to ${MAX_WORLD_CLOCKS} cities. Remove one to add another.` : message || ' '}</p>
    <p className="hint">Times follow each city's time zone and daylight saving.</p>
  </div>;
}

// Synthetic sample cities for the picker; never the user's own list.
const SAMPLE_CITIES: WorldClockCity[] = [
  { id: '6f2f3e10-0000-4000-8000-000000000001', label: 'London', timezone: 'Europe/London', latitude: 51.51, longitude: -0.13 },
  { id: '6f2f3e10-0000-4000-8000-000000000002', label: 'Tokyo', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 },
  { id: '6f2f3e10-0000-4000-8000-000000000003', label: 'Vancouver', timezone: 'America/Vancouver', latitude: 49.28, longitude: -123.12 },
  { id: '6f2f3e10-0000-4000-8000-000000000004', label: 'Sydney', timezone: 'Australia/Sydney', latitude: -33.87, longitude: 151.21 },
];

export const WorldClocksWidget: WidgetModule = {
  Renderer: WorldClocks,
  // With no cities the ambient display hides it; the editor canvas shows a placeholder.
  visible: props => props.embedded || props.settings.widgetData.worldClocks.length > 0,
  Settings: WorldClocksSettings,
  draftProblem: settings => settings.widgetData.worldClocks.some(city => !city.label.trim()) ? 'Each world clock needs a label' : null,
  sample: ({ state, settings }) => {
    const next = { ...settings, widgetData: { ...settings.widgetData, worldClocks: SAMPLE_CITIES.map(city => ({ ...city })) } };
    return { state: { ...state, settings: next }, settings: next };
  },
};
