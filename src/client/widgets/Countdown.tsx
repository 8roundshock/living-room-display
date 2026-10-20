import { useEffect, useRef, useState } from 'react';
import type { CountdownEvent, Settings } from '../../shared/contracts.ts';
import {
  addDays, civilFromDate, countdownDate, countdownLabel, countdownPassed, countdownRows, daysBetween, formatCivil, nextOccurrence, parseCivil, todayCivil,
  type CivilDate, type CountdownRow,
} from '../calendar.ts';
import { Icon } from '../icons.tsx';
import { atNaturalWidth, fittingCount, layoutExtent, useMeasured } from './measure.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './countdown.css';

/** Same limits as the server, which remains the authority. */
const MAX_COUNTDOWNS = 12, MAX_TITLE = 60, FIRST_YEAR = 1900, LAST_YEAR = 2200;
/** Rows beside the medium hero; large measures how many fit. */
const MEDIUM_ROWS = 2;

function Count({ item, className }: { item: CountdownRow; className: string }) {
  const { label } = item;
  return <div className={`${className} ${label.unit ? 'countdown-number' : 'countdown-word'}`} aria-label={label.text}>
    <TransitionText className="countdown-value" value={label.value} />
    {label.unit && <span className="countdown-unit">{label.unit}</span>}
  </div>;
}

function Row({ item, overflow = false }: { item: CountdownRow; overflow?: boolean }) {
  const { label } = item;
  return <li className={overflow ? 'countdown-row countdown-overflow' : 'countdown-row'}>
    <div className="countdown-row-copy"><p className="countdown-row-title">{item.event.title}</p><p className="countdown-date">{item.dateText}</p></div>
    <p className="countdown-row-days" aria-label={label.text}><TransitionText className="countdown-value" value={label.value} />{label.unit && <span className="countdown-unit">{label.unit}</span>}</p>
  </li>;
}

/**
 * Large lists as many complete rows as the box holds, then an exact "+N more" (#221), measured like
 * the Reminders list from layout boxes: the face is fixed at 100cqh, overflow rows take no layout
 * outside measuring, and measuring always runs top-anchored. 0 means even one row overflows; the face
 * then shows one row and the shared fit zooms the widget out.
 */
function measureLarge(face: HTMLElement, total: number): number | null {
  const rows = [...face.querySelectorAll<HTMLElement>('.countdown-list > .countdown-row')];
  if (!rows.length) return null;
  face.setAttribute('data-measuring', '');
  try {
    return atNaturalWidth(face, () => {
      const more = layoutExtent(face.querySelector('.countdown-more-probe'));
      return fittingCount(face, rows, count => count < total ? more : 0);
    });
  } finally { face.removeAttribute('data-measuring'); }
}

function LargeCountdown({ upcoming, settings }: { upcoming: CountdownRow[]; settings: Settings }) {
  const face = useRef<HTMLDivElement>(null);
  const total = upcoming.length;
  const key = JSON.stringify([upcoming.map(item => [item.event.id, item.event.title, item.dateText, item.label.text]), settings.appearance.fontScale, settings.appearance.fontFamily]);
  const fit = useMeasured(face, key, element => measureLarge(element, total), total);
  const shown = Math.max(1, Math.min(fit, total)), more = total - shown;
  return <div ref={face} className={['countdown-face', 'countdown-family-large', fit === 0 ? 'countdown-overfull' : ''].filter(Boolean).join(' ')}>
    <ul className="countdown-list">{upcoming.map((item, index) => <Row key={item.event.id} item={item} overflow={index >= shown} />)}</ul>
    {more > 0 && <p className="countdown-more">+{more} more</p>}
    <p className="countdown-more-probe" aria-hidden="true">+{total} more</p>
  </div>;
}

function Countdown({ settings, now, size, embedded }: WidgetContentProps) {
  // Rows and their strings are built once per list and civil day, not on every tick (#193).
  const upcoming = countdownRows(settings.widgetData.countdowns, todayCivil(now));
  if (!upcoming.length) return embedded ? <div className="widget-body image-placeholder countdown-placeholder">
    <Icon name="hourglass" /><div className="ambient-label">Countdown</div><div className="ambient-description">Add a date to count down to</div>
  </div> : null;
  if (size === 'large') return <LargeCountdown upcoming={upcoming} settings={settings} />;
  const [next, ...rest] = upcoming as [CountdownRow, ...CountdownRow[]];
  const hero = <div className="countdown-hero">
    <Count item={next} className="countdown-count" />
    <p className="countdown-title">{next.event.title}</p>
    <p className="countdown-date">{next.dateText}</p>
  </div>;
  if (size === 'small') return <div className="countdown-face countdown-family-small">{hero}</div>;
  return <div className="countdown-face countdown-family-medium">
    {hero}
    {rest.length > 0 && <ul className="countdown-list">{rest.slice(0, MEDIUM_ROWS).map(item => <Row key={item.event.id} item={item} />)}</ul>}
  </div>;
}

function dateProblem(value: string): boolean {
  const date = parseCivil(value);
  return !date || date.year < FIRST_YEAR || date.year > LAST_YEAR;
}

function dateMessage(value: string): string | null {
  if (!parseCivil(value)) return 'Countdown needs a date';
  return dateProblem(value) ? `Use a date between ${FIRST_YEAR} and ${LAST_YEAR}` : null;
}
const complete = (event: CountdownEvent) => Boolean(event.title.trim()) && !dateProblem(event.date);

function draftProblem(settings: Settings): string | null {
  const events = settings.widgetData.countdowns;
  if (events.some(event => !event.title.trim())) return 'Countdown needs a title';
  for (const event of events) { const message = dateMessage(event.date); if (message) return message; }
  return null;
}

function status(event: CountdownEvent, today: CivilDate): string {
  if (countdownPassed(event, today)) return 'Passed';
  const date = nextOccurrence(event, today)!, label = countdownLabel(daysBetween(today, date));
  return `${label.unit ? `In ${label.text}` : label.text} · ${countdownDate(date, today)}`;
}

function CountdownSettings({ settings, onChange, saving }: WidgetSettingsProps) {
  const events = settings.widgetData.countdowns, today = civilFromDate(new Date());
  const [focusId, setFocusId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef({ settings, onChange });
  latest.current = { settings, onChange };
  // Incomplete rows can only be fixed in this panel. When it closes (the widget is removed or
  // collapsed, or the tab changes), an edited row gets back the last complete title or date this
  // panel received for it and a row it never received complete is dropped, so Save is never
  // blocked by a field nobody can see and closing the panel never deletes a saved date.
  // `known` holds the latest complete version of each row that arrived from outside this panel:
  // at opening, after Save (the editor rebases onto the server response), Cancel or a poll (which
  // also carries unsaved complete edits). Rows are read-only while a Save is running, so the
  // rebase after Save always records what the server stored.
  const own = useRef(new WeakSet<readonly CountdownEvent[]>());
  const known = useRef(new Map<string, CountdownEvent>());
  const seen = useRef<readonly CountdownEvent[] | null>(null);
  if (events !== seen.current) {
    if (!own.current.has(events)) for (const event of events) if (complete(event)) known.current.set(event.id, event);
    seen.current = events;
  }
  useEffect(() => () => {
    const { settings: last, onChange: change } = latest.current;
    if (last.widgetData.countdowns.every(complete)) return;
    change((previous: Settings) => {
      const events = previous.widgetData.countdowns;
      if (events.every(complete)) return previous;
      const repaired = events.flatMap(event => {
        if (complete(event)) return [event];
        const before = known.current.get(event.id);
        if (!before) return [];
        const restored = { ...event, title: event.title.trim() ? event.title : before.title, date: dateProblem(event.date) ? before.date : event.date };
        return complete(restored) ? [restored] : [];
      });
      return { ...previous, widgetData: { ...previous.widgetData, countdowns: repaired } };
    });
  }, []);
  useEffect(() => {
    if (!focusId) return;
    list.current?.querySelector<HTMLInputElement>(`[data-countdown-title="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId]);
  const update = (next: (events: CountdownEvent[]) => CountdownEvent[]) => onChange((previous: Settings) => {
    const countdowns = next(previous.widgetData.countdowns);
    own.current.add(countdowns);
    return { ...previous, widgetData: { ...previous.widgetData, countdowns } };
  });
  const edit = (id: string, change: Partial<CountdownEvent>) => update(events => events.map(event => event.id === id ? { ...event, ...change } : event));
  return <div className="countdown-settings" ref={list}>
    <span className="field-label">Dates</span>
    {events.length === 0 && <p className="countdown-settings-empty">No dates yet.</p>}
    {events.map((event, index) => {
      const number = index + 1, titleMissing = !event.title.trim(), passed = !dateProblem(event.date) && countdownPassed(event, today);
      const errorId = `countdown-${event.id}-error`, dateError = dateMessage(event.date), dateErrorId = `countdown-${event.id}-date-error`;
      return <fieldset key={event.id} className={`countdown-editor-row ${passed ? 'passed' : ''}`}>
        <legend className="sr-only">Countdown {number}</legend>
        <input
          className="text-input"
          aria-label={`Countdown ${number} title`}
          data-countdown-title={event.id}
          disabled={saving}
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
            disabled={saving}
            aria-label={`Countdown ${number} date`}
            min={`${FIRST_YEAR}-01-01`}
            max={`${LAST_YEAR}-12-31`}
            value={event.date}
            aria-invalid={dateError !== null}
            aria-describedby={dateError ? dateErrorId : undefined}
            onChange={change => edit(event.id, { date: change.target.value })}
          />
          <label className="toggle-row countdown-yearly">
            <span>Every year</span>
            <input className="toggle" type="checkbox" disabled={saving} aria-label={`Countdown ${number} every year`} checked={event.repeatsYearly} onChange={change => edit(event.id, { repeatsYearly: change.target.checked })} />
          </label>
          <button type="button" className="icon-button countdown-remove" disabled={saving} aria-label={`Remove countdown ${number}`} title="Remove" onClick={() => update(events => events.filter(item => item.id !== event.id))}>
            <Icon name="trash" size={16} />
          </button>
        </div>
        {dateError ? <p className="countdown-error" id={dateErrorId}>{dateError}</p> : <p className={`countdown-editor-status ${passed ? 'passed' : ''}`}>{status(event, today)}</p>}
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

// Synthetic sample only; private titles never reach the picker. The dates are days after the sample's
// own time (its weather update time, which the picker sets to now, #361), so the counts stay 12, 16
// and 67 days on any date.
function sampleCountdowns(anchor: Date): CountdownEvent[] {
  const today = civilFromDate(anchor), date = (days: number) => addDays(today, days), birthday = date(16);
  return [
    { id: '7a1c0d4e-0000-4000-8000-000000000001', title: 'Weekend trip', date: formatCivil(date(12)), repeatsYearly: false },
    // A yearly date in 1990 (not a leap year, so 29 February becomes the 28th).
    { id: '7a1c0d4e-0000-4000-8000-000000000002', title: 'Birthday', date: formatCivil({ ...birthday, year: 1990, day: birthday.month === 2 && birthday.day === 29 ? 28 : birthday.day }), repeatsYearly: true },
    { id: '7a1c0d4e-0000-4000-8000-000000000003', title: 'Holiday', date: formatCivil(date(67)), repeatsYearly: false },
  ];
}

export const CountdownWidget: WidgetModule = {
  Renderer: Countdown,
  visible: props => props.embedded || countdownRows(props.settings.widgetData.countdowns, todayCivil(props.now)).length > 0,
  Settings: CountdownSettings,
  draftProblem,
  sample: ({ state, settings }) => {
    const anchor = new Date(Date.parse(state.weather.updatedAt ?? '') || Date.now());
    const next = { ...settings, widgetData: { ...settings.widgetData, countdowns: sampleCountdowns(anchor) } };
    return { state: { ...state, settings: next }, settings: next };
  },
};
