import { useEffect, useMemo, useRef, useState } from 'react';
import type { CountdownEvent, Settings } from '../../shared/contracts.ts';
import {
  addDays, civilFromDate, countdownDate, daysBetween, countdownLabel, countdownPassed, formatCivil, nextOccurrence, parseCivil, todayCivil, upcomingCountdowns,
  type CivilDate, type UpcomingCountdown,
} from '../calendar.ts';
import { Icon } from '../icons.tsx';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './countdown.css';

/** Same limits as the server, which remains the authority. */
const MAX_COUNTDOWNS = 12, MAX_TITLE = 60, FIRST_YEAR = 1900, LAST_YEAR = 2200;
const ROWS: Record<WidgetContentProps['size'], number> = { small: 1, medium: 3, large: 5 };

// Visibility runs on every one-second tick; recompute only when the day or the list changes.
const cache = new WeakMap<readonly CountdownEvent[], { today: string; upcoming: UpcomingCountdown[] }>();
function upcomingFor(events: readonly CountdownEvent[], today: string): UpcomingCountdown[] {
  const cached = cache.get(events);
  if (cached?.today === today) return cached.upcoming;
  const upcoming = upcomingCountdowns(events, parseCivil(today)!);
  cache.set(events, { today, upcoming });
  return upcoming;
}

function Count({ item, className }: { item: UpcomingCountdown; className: string }) {
  const label = countdownLabel(item.days);
  return <div className={`${className} ${label.unit ? 'countdown-number' : 'countdown-word'}`} aria-label={label.text}>
    <TransitionText className="countdown-value" value={label.value} />
    {label.unit && <span className="countdown-unit">{label.unit}</span>}
  </div>;
}

function Row({ item, today }: { item: UpcomingCountdown; today: CivilDate }) {
  const label = countdownLabel(item.days);
  return <li className="countdown-row">
    <div className="countdown-row-copy"><p className="countdown-row-title">{item.event.title}</p><p className="countdown-date">{countdownDate(item.date, today)}</p></div>
    <p className="countdown-row-days" aria-label={label.text}><TransitionText className="countdown-value" value={label.value} />{label.unit && <span className="countdown-unit">{label.unit}</span>}</p>
  </li>;
}

function Countdown({ settings, now, size, embedded }: WidgetContentProps) {
  const today = todayCivil(now), events = settings.widgetData.countdowns;
  const upcoming = useMemo(() => upcomingFor(events, today), [events, today]);
  const civil = parseCivil(today)!;
  if (!upcoming.length) return embedded ? <div className="widget-body image-placeholder countdown-placeholder">
    <Icon name="hourglass" /><div className="ambient-label">Countdown</div><div className="ambient-description">Add a date to count down to</div>
  </div> : null;
  const [next, ...rest] = upcoming as [UpcomingCountdown, ...UpcomingCountdown[]];
  const hero = <div className="countdown-hero">
    <Count item={next} className="countdown-count" />
    <p className="countdown-title">{next.event.title}</p>
    <p className="countdown-date">{countdownDate(next.date, civil)}</p>
  </div>;
  if (size === 'small') return <div className="countdown-face countdown-family-small">{hero}</div>;
  if (size === 'medium') return <div className="countdown-face countdown-family-medium">
    {hero}
    {rest.length > 0 && <ul className="countdown-list">{rest.slice(0, ROWS.medium - 1).map(item => <Row key={item.event.id} item={item} today={civil} />)}</ul>}
  </div>;
  const shown = upcoming.slice(0, ROWS.large);
  return <div className="countdown-face countdown-family-large">
    <ul className="countdown-list">{shown.map(item => <Row key={item.event.id} item={item} today={civil} />)}</ul>
    {upcoming.length > shown.length && <p className="countdown-more">+{upcoming.length - shown.length} more</p>}
  </div>;
}

function dateProblem(value: string): boolean {
  const date = parseCivil(value);
  return !date || date.year < FIRST_YEAR || date.year > LAST_YEAR;
}

function draftProblem(settings: Settings): string | null {
  const events = settings.widgetData.countdowns;
  if (events.some(event => !event.title.trim())) return 'Countdown needs a title';
  if (events.some(event => dateProblem(event.date))) return 'Countdown needs a date';
  return null;
}

function status(event: CountdownEvent, today: CivilDate): string {
  if (dateProblem(event.date)) return 'Choose a date';
  if (countdownPassed(event, today)) return 'Passed';
  const date = nextOccurrence(event, today)!, label = countdownLabel(daysBetween(today, date));
  return `${label.unit ? `In ${label.text}` : label.text} · ${countdownDate(date, today)}`;
}

function CountdownSettings({ settings, onChange, saving }: WidgetSettingsProps) {
  const events = settings.widgetData.countdowns, today = civilFromDate(new Date());
  const [focusId, setFocusId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    list.current?.querySelector<HTMLInputElement>(`[data-countdown-title="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId]);
  const update = (next: (events: CountdownEvent[]) => CountdownEvent[]) => onChange((previous: Settings) => ({ ...previous, widgetData: { ...previous.widgetData, countdowns: next(previous.widgetData.countdowns) } }));
  const edit = (id: string, change: Partial<CountdownEvent>) => update(events => events.map(event => event.id === id ? { ...event, ...change } : event));
  return <div className="countdown-settings" ref={list}>
    <span className="field-label">Dates</span>
    {events.length === 0 && <p className="countdown-settings-empty">No dates yet.</p>}
    {events.map((event, index) => {
      const number = index + 1, titleMissing = !event.title.trim(), passed = !dateProblem(event.date) && countdownPassed(event, today);
      const errorId = `countdown-${event.id}-error`;
      return <fieldset key={event.id} className={`countdown-editor-row ${passed ? 'passed' : ''}`}>
        <legend className="sr-only">Countdown {number}</legend>
        <input
          className="text-input"
          aria-label={`Countdown ${number} title`}
          data-countdown-title={event.id}
          placeholder="Title"
          maxLength={MAX_TITLE}
          value={event.title}
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? errorId : undefined}
          onChange={change => edit(event.id, { title: change.target.value })}
          onBlur={change => { const trimmed = change.target.value.trim(); if (trimmed !== event.title) edit(event.id, { title: trimmed }); }}
        />
        {titleMissing && <p className="countdown-error" id={errorId}>Countdown needs a title</p>}
        <div className="countdown-editor-controls">
          <input
            className="text-input countdown-date-input"
            type="date"
            aria-label={`Countdown ${number} date`}
            min={`${FIRST_YEAR}-01-01`}
            max={`${LAST_YEAR}-12-31`}
            value={event.date}
            aria-invalid={dateProblem(event.date)}
            onChange={change => edit(event.id, { date: change.target.value })}
          />
          <label className="toggle-row countdown-yearly">
            <span>Every year</span>
            <input className="toggle" type="checkbox" aria-label={`Countdown ${number} every year`} checked={event.repeatsYearly} onChange={change => edit(event.id, { repeatsYearly: change.target.checked })} />
          </label>
          <button type="button" className="icon-button countdown-remove" aria-label={`Remove countdown ${number}`} title="Remove" onClick={() => update(events => events.filter(item => item.id !== event.id))}>
            <Icon name="trash" size={16} />
          </button>
        </div>
        <p className={`countdown-editor-status ${passed ? 'passed' : ''}`}>{status(event, today)}</p>
      </fieldset>;
    })}
    <button
      type="button"
      className="button small countdown-add"
      disabled={saving || events.length >= MAX_COUNTDOWNS}
      onClick={() => {
        const id = crypto.randomUUID();
        update(events => [...events, { id, title: '', date: formatCivil(addDays(civilFromDate(new Date()), 7)), repeatsYearly: false }]);
        setFocusId(id);
      }}
    ><Icon name="plus" size={15} />Add date</button>
    <p className="hint">{events.length >= MAX_COUNTDOWNS ? `Up to ${MAX_COUNTDOWNS} dates. ` : ''}Counts whole days on this computer's calendar.</p>
  </div>;
}

// Synthetic sample only; private titles never reach the picker.
const SAMPLE: CountdownEvent[] = [
  { id: '7a1c0d4e-0000-4000-8000-000000000001', title: 'Weekend trip', date: '2026-10-30', repeatsYearly: false },
  { id: '7a1c0d4e-0000-4000-8000-000000000002', title: 'Birthday', date: '1990-11-03', repeatsYearly: true },
  { id: '7a1c0d4e-0000-4000-8000-000000000003', title: 'Holiday', date: '2026-12-24', repeatsYearly: false },
];

export const CountdownWidget: WidgetModule = {
  Renderer: Countdown,
  visible: props => props.embedded || upcomingFor(props.settings.widgetData.countdowns, todayCivil(props.now)).length > 0,
  Settings: CountdownSettings,
  draftProblem,
  sample: ({ state, settings }) => {
    const next = { ...settings, widgetData: { ...settings.widgetData, countdowns: SAMPLE } };
    return { state: { ...state, settings: next }, settings: next };
  },
};
