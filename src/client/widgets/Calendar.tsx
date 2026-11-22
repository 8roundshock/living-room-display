import { useMemo, useRef } from 'react';
import type { Settings } from '../../shared/contracts.ts';
import { defaultTheme } from '../../shared/themes.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import { calendarView, compareCivil, weekStartDay, weekdayName, todayCivil, type CalendarView, type CivilDate, type WeekStartSetting } from '../calendar.ts';
import { calendarDates, sourcesSignature, type CalendarDates, type DateSources, type UpcomingRow } from '../calendar-dates.ts';
import { HolidayCalendars } from '../HolidayCalendars';
import { atNaturalWidth, fittingCount, useMeasured } from './measure.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './calendar.css';

/** Lines of upcoming dates under the large month (#716). */
const UPCOMING_LINES = 3;
const NO_DATES: CalendarDates = { upcoming: [], marks: new Map() };
/** Stable fallbacks, so a missing section never looks like new data on every tick. */
const ALL_CALENDARS = defaultTheme().calendars, NO_BIRTHDAYS: DateSources['birthdays'] = [];

function dayState(day: CivilDate, today: CivilDate): 'past' | 'today' | 'future' {
  const order = compareCivil(day, today);
  return order < 0 ? 'past' : order === 0 ? 'today' : 'future';
}

/** The month grid. A day that carries a holiday or an important date gets a small accent dot (#716). */
function MonthGrid({ view, size, marks }: { view: CalendarView; size: WidgetSize; marks: CalendarDates['marks'] }) {
  const labels = size === 'large' ? view.labels.short : view.labels.narrow;
  return <table className="calendar-grid" aria-label={`${view.month} ${view.today.year}`} data-weeks={view.weeks.length}>
    <thead><tr>{labels.map((label, index) => <th key={index} scope="col" abbr={view.labels.long[index]}>{label}</th>)}</tr></thead>
    <tbody>{view.weeks.map((week, row) => <tr key={row}>{week.map((day, column) => {
      if (day === null) return <td key={column} className="calendar-blank" />;
      const state = dayState({ ...view.today, day }, view.today), names = marks.get(day);
      return <td key={column} aria-current={state === 'today' ? 'date' : undefined} aria-label={names ? `${day}, ${names.join(', ')}` : undefined}>
        <span className={`calendar-day calendar-${state}`}>{day}{names && <i className="calendar-mark" aria-hidden="true" />}</span>
      </td>;
    })}</tr>)}</tbody>
  </table>;
}

/** One upcoming date: the date in the accent tone, the name in the text colour. */
function UpcomingLine({ row }: { row: UpcomingRow }) {
  return <><span className="calendar-upcoming-when">{row.when}</span><span className="calendar-upcoming-name">{row.name}</span></>;
}

/** Whether the next date's line fits under the medium date and month, measured from layout boxes at the natural width. */
function nextFits(face: HTMLElement): boolean | null {
  const line = face.querySelector<HTMLElement>('.calendar-next');
  if (!line) return null;
  face.setAttribute('data-measuring', '');
  try { return atNaturalWidth(face, () => fittingCount(face, [line], () => 0) === 1); } finally { face.removeAttribute('data-measuring'); }
}

/**
 * Medium: the date hero beside the month, and the next date on one line under them where the box has room
 * (#716). The line is measured like the Countdown list: when it does not fit it takes no layout and the
 * family looks as it does with nothing upcoming.
 */
function MediumCalendar({ view, dates, fitKey }: { view: CalendarView; dates: CalendarDates; fitKey: string }) {
  const face = useRef<HTMLDivElement>(null);
  const next = dates.upcoming[0];
  const fits = useMeasured(face, JSON.stringify([next?.when, next?.name, view.weeks.length, fitKey]), nextFits, false);
  const shown = Boolean(next) && fits;
  return <div ref={face} className={`calendar-face calendar-family-medium${shown ? ' calendar-with-next' : ''}`}>
    <div className="calendar-main">
      <div className="calendar-hero">
        <div className="ambient-label calendar-weekday">{view.weekday}</div>
        <TransitionText className="calendar-date-number" value={String(view.today.day)} />
        <div className="calendar-month-name">{view.month}</div>
      </div>
      <MonthGrid view={view} size="medium" marks={dates.marks} />
    </div>
    {next && <p className={`calendar-next${shown ? '' : ' calendar-next-hidden'}`}><UpcomingLine row={next} /></p>}
  </div>;
}

function face(view: CalendarView, size: WidgetSize, dates: CalendarDates, fitKey: string) {
  if (size === 'small') return <div className="calendar-face calendar-family-small">
    <div className="ambient-label calendar-month">{view.month}</div>
    <table className="calendar-grid calendar-strip" aria-label={`Week of ${view.month} ${view.today.day}`}>
      {/* The strip starts on the week start, so it shares the header order. */}
      <thead><tr>{view.labels.narrow.map((label, index) => <th key={index} scope="col" abbr={view.labels.long[index]}>{label}</th>)}</tr></thead>
      <tbody><tr>{view.strip.map(day => {
        const state = dayState(day, view.today);
        return <td key={`${day.month}-${day.day}`} aria-current={state === 'today' ? 'date' : undefined}><span className={`calendar-day calendar-${state}`}>{day.day}</span></td>;
      })}</tr></tbody>
    </table>
  </div>;
  if (size === 'medium') return <MediumCalendar view={view} dates={dates} fitKey={fitKey} />;
  const upcoming = dates.upcoming.slice(0, UPCOMING_LINES);
  return <div className={`calendar-face calendar-family-large${upcoming.length ? ' calendar-with-upcoming' : ''}`}>
    <div className="calendar-heading"><span className="ambient-label calendar-month">{view.month}</span><span className="calendar-year">{view.today.year}</span></div>
    <MonthGrid view={view} size={size} marks={dates.marks} />
    {upcoming.length > 0 && <ul className="calendar-upcoming" aria-label="Upcoming dates">
      {upcoming.map(row => <li key={row.key} className="calendar-upcoming-row"><UpcomingLine row={row} /></li>)}
    </ul>}
  </div>;
}

/** The sources of the Calendar's dates (#716): the theme's holiday calendars (absent means all, as for themes), birthdays and Countdown dates. */
function dateSources(settings: Settings): DateSources {
  return { calendars: settings.appearance.theme?.calendars ?? ALL_CALENDARS, birthdays: settings.birthdays ?? NO_BIRTHDAYS, countdowns: settings.widgetData.countdowns };
}

function Calendar({ settings, now, size }: WidgetContentProps) {
  const today = todayCivil(now), setting = settings.widgetData.calendar.weekStart;
  const sources = dateSources(settings);
  // A state refresh hands over new arrays with the same content: the signature keeps the dates and the face.
  const signature = useMemo(() => sourcesSignature(sources), [sources.calendars, sources.birthdays, sources.countdowns]);
  const fitKey = `${settings.appearance.fontScale}|${settings.appearance.fontFamily}`;
  // The view, its labels and the upcoming dates are built once per civil day and set of sources (#193, #716);
  // the same element on every other one-second tick lets React skip the whole face.
  return useMemo(() => {
    const view = calendarView(today, setting);
    return face(view, size, size === 'small' ? NO_DATES : calendarDates(sources, view.today), fitKey);
  }, [today, setting, size, signature, fitKey]);
}

function CalendarSettings({ settings, onChange, saving }: WidgetSettingsProps) {
  const automatic = weekdayName(weekStartDay('locale'));
  return <div className="calendar-settings">
    <label>
      <span className="field-label">Week starts on</span>
      <select className="select-input" value={settings.widgetData.calendar.weekStart} onChange={event => {
        const weekStart = event.target.value as WeekStartSetting;
        onChange((previous: Settings) => ({ ...previous, widgetData: { ...previous.widgetData, calendar: { ...previous.widgetData.calendar, weekStart } } }));
      }}>
        <option value="locale">Automatic · {automatic}</option>
        <option value="sunday">Sunday</option>
        <option value="monday">Monday</option>
      </select>
    </label>
    <HolidayCalendars value={settings.appearance.theme?.calendars ?? ALL_CALENDARS} disabled={saving} onChange={calendars => onChange((previous: Settings) => ({ ...previous, appearance: { ...previous.appearance, theme: { ...(previous.appearance.theme ?? defaultTheme()), calendars } } }))} />
    <p className="hint">Large lists the next three holidays and important dates, medium the next one where it fits, and both mark those days in the month. They come from these holiday calendars (shared with themes and Dynamic), Birthdays in Settings and your Countdown dates, up to 90 days ahead.</p>
  </div>;
}

export const CalendarWidget: WidgetModule = { Renderer: Calendar, Settings: CalendarSettings };
