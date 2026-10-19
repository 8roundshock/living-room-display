import { useMemo } from 'react';
import type { Settings } from '../../shared/contracts.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import {
  civilFromDate, civilWeekday, compareCivil, monthMatrix, monthName, parseCivil, todayCivil, weekStartDay, weekStrip, weekdayLabels, weekdayName,
  type CivilDate, type WeekStartSetting, type Weekday,
} from '../calendar.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';
import './calendar.css';

interface CalendarView {
  today: CivilDate; weekday: string; month: string; weekStart: Weekday;
  weeks: (number | null)[][]; strip: ReturnType<typeof weekStrip>;
}

/** Recomputed only when the local date or week start changes, not on every one-second tick. */
function calendarView(today: string, setting: WeekStartSetting): CalendarView {
  const date = parseCivil(today) ?? civilFromDate(new Date()), weekStart = weekStartDay(setting);
  return {
    today: date, weekStart, weekday: weekdayName(civilWeekday(date)),
    month: monthName(date), weeks: monthMatrix(date.year, date.month, weekStart), strip: weekStrip(date, weekStart),
  };
}

function dayState(day: CivilDate, today: CivilDate): 'past' | 'today' | 'future' {
  const order = compareCivil(day, today);
  return order < 0 ? 'past' : order === 0 ? 'today' : 'future';
}

function MonthGrid({ view, size }: { view: CalendarView; size: WidgetSize }) {
  const labels = weekdayLabels(view.weekStart, size === 'large' ? 'short' : 'narrow');
  const fullNames = Array.from({ length: 7 }, (_, index) => weekdayName(((view.weekStart + index) % 7) as Weekday));
  return <table className="calendar-grid" aria-label={`${view.month} ${view.today.year}`} data-weeks={view.weeks.length}>
    <thead><tr>{labels.map((label, index) => <th key={index} scope="col" abbr={fullNames[index]}>{label}</th>)}</tr></thead>
    <tbody>{view.weeks.map((week, row) => <tr key={row}>{week.map((day, column) => {
      if (day === null) return <td key={column} className="calendar-blank" />;
      const state = dayState({ ...view.today, day }, view.today);
      return <td key={column} aria-current={state === 'today' ? 'date' : undefined}><span className={`calendar-day calendar-${state}`}>{day}</span></td>;
    })}</tr>)}</tbody>
  </table>;
}

function Calendar({ settings, now, size }: WidgetContentProps) {
  const today = todayCivil(now), setting = settings.widgetData.calendar.weekStart;
  const view = useMemo(() => calendarView(today, setting), [today, setting]);
  if (size === 'small') {
    const labels = weekdayLabels(view.weekStart);
    return <div className="calendar-face calendar-family-small">
      <div className="ambient-label calendar-month">{view.month}</div>
      <table className="calendar-grid calendar-strip" aria-label={`Week of ${view.month} ${view.today.day}`}>
        <thead><tr>{labels.map((label, index) => <th key={index} scope="col" abbr={weekdayName(view.strip[index]!.weekday)}>{label}</th>)}</tr></thead>
        <tbody><tr>{view.strip.map(day => {
          const state = dayState(day, view.today);
          return <td key={`${day.month}-${day.day}`} aria-current={state === 'today' ? 'date' : undefined}><span className={`calendar-day calendar-${state}`}>{day.day}</span></td>;
        })}</tr></tbody>
      </table>
    </div>;
  }
  if (size === 'medium') return <div className="calendar-face calendar-family-medium">
    <div className="calendar-hero">
      <div className="ambient-label calendar-weekday">{view.weekday}</div>
      <TransitionText className="calendar-date-number" value={String(view.today.day)} />
      <div className="calendar-month-name">{view.month}</div>
    </div>
    <MonthGrid view={view} size={size} />
  </div>;
  return <div className="calendar-face calendar-family-large">
    <div className="calendar-heading"><span className="ambient-label calendar-month">{view.month}</span><span className="calendar-year">{view.today.year}</span></div>
    <MonthGrid view={view} size={size} />
  </div>;
}

function CalendarSettings({ settings, onChange }: WidgetSettingsProps) {
  const automatic = weekdayName(weekStartDay('locale'));
  return <label className="calendar-settings">
    <span className="field-label">Week starts on</span>
    <select className="select-input" value={settings.widgetData.calendar.weekStart} onChange={event => {
      const weekStart = event.target.value as WeekStartSetting;
      onChange((previous: Settings) => ({ ...previous, widgetData: { ...previous.widgetData, calendar: { ...previous.widgetData.calendar, weekStart } } }));
    }}>
      <option value="locale">Automatic · {automatic}</option>
      <option value="sunday">Sunday</option>
      <option value="monday">Monday</option>
    </select>
  </label>;
}

export const CalendarWidget: WidgetModule = { Renderer: Calendar, Settings: CalendarSettings };
