import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { civilFromDate, formatCivil, parseCivil, weekStartDay, weekdayLabels, type CivilDate } from './calendar';
import { ReminderRow, type HomeContext } from './HomeParts';
import { addReminder, ShowSwitch } from './HomeSheets';
import { dayName, defaultTime, dueAtFor, isPastDay, longDay, monthGrid, monthTitle, moveDay, reminderMarks, remindersOn, shiftedMessage } from './home-model';
import { Icon } from './icons';

/**
 * Home's calendar (#438): pick a day and it becomes an ordinary dated reminder (9:00 AM unless another
 * time is chosen). A month grid on the saved week start, with neighbouring days dim and clickable; days
 * with pending dated reminders carry a dot (the caution tone when one is overdue). A roving-tabindex
 * grid: arrows move by day or week across months, PageUp/PageDown by month (the day clamped), Home/End
 * to the week's edges, and Enter or Space selects the day and moves to What. Days are this computer's
 * local days; a past day or time is refused, and a spring-forward shift is named.
 */
export function HomeCalendar({ context }: { context: HomeContext }) {
  const { state, settings, now, offline } = context;
  const today = civilFromDate(new Date(now)), todayKey = formatCivil(today);
  const weekStart = weekStartDay(settings.widgetData.calendar.weekStart);
  const [focused, setFocused] = useState<CivilDate>(today);
  const [selected, setSelected] = useState(todayKey);
  const [text, setText] = useState('');
  // 9:00 AM, or the next whole hour on today once 9:00 AM has passed.
  const timeFor = (day: string) => day === formatCivil(civilFromDate(new Date())) ? (new Date().getHours() >= 9 ? defaultTime('today', Date.now()) : '09:00') : '09:00';
  const [time, setTime] = useState(() => timeFor(todayKey));
  const [showWanted, setShowWanted] = useState(true);
  const [problem, setProblem] = useState<{ field: 'text' | 'time'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null), what = useRef<HTMLInputElement>(null), timeField = useRef<HTMLInputElement>(null), form = useRef<HTMLFormElement>(null);
  const moved = useRef(false);
  const weeks = useMemo(() => monthGrid(focused.year, focused.month, weekStart), [focused.year, focused.month, weekStart]);
  const marks = useMemo(() => reminderMarks(state.reminders, now), [state.reminders, now]);
  const labels = weekdayLabels(weekStart, 'short'), longLabels = weekdayLabels(weekStart, 'long');
  const focusedKey = formatCivil(focused);
  const selectedDate = parseCivil(selected)!;
  const past = isPastDay(selected, now);
  const dayReminders = remindersOn(state.reminders, selected);
  useEffect(() => {
    // Keyboard moves keep DOM focus on the newly focused day, including after a month change.
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusedKey}"]`)?.focus();
  }, [focusedKey]);
  function select(date: CivilDate, focusWhat: boolean) {
    setFocused(date); setSelected(formatCivil(date)); setProblem(null); setTime(timeFor(formatCivil(date)));
    if (focusWhat) window.requestAnimationFrame(() => (isPastDay(formatCivil(date), Date.now()) ? grid.current?.querySelector<HTMLElement>(`[data-day="${formatCivil(date)}"]`) : what.current)?.focus());
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>, date: CivilDate) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(date, true); return; }
    const next = moveDay(date, event.key, weekStart);
    if (!next) return;
    event.preventDefault();
    moved.current = true;
    setFocused(next);
  }
  function month(offset: number) {
    const index = focused.year * 12 + focused.month - 1 + offset, year = Math.floor(index / 12), month = index - year * 12 + 1;
    setFocused({ year, month, day: 1 });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || past) return;
    const trimmed = text.trim();
    if (!trimmed) { setProblem({ field: 'text', message: 'Enter what to remember.' }); what.current?.focus(); return; }
    const due = time ? dueAtFor(selected, time) : null;
    if (!due) { setProblem({ field: 'time', message: 'Enter both a date and a time, or choose Anytime in Reminder.' }); timeField.current?.focus(); return; }
    if (Date.parse(due.iso) <= Date.now()) { setProblem({ field: 'time', message: 'That time has passed. Choose a later time.' }); timeField.current?.focus(); return; }
    setProblem(null); setBusy(true);
    try {
      const reminder = await addReminder(context, trimmed, due.iso, showWanted, due.shifted ? shiftedMessage(selected, time, due, settings.clockFormat) : '', () => form.current?.requestSubmit());
      if (!reminder) return;
      setText(''); setTime(timeFor(selected));
      context.focusLater(`.home-day-list .home-check[data-reminder-id="${reminder.id}"]`);
    } finally { setBusy(false); }
  }
  return (
    <div className="home-calendar">
      <div className="home-calendar-heading">
        <h3 className="home-calendar-month" id="home-calendar-month" aria-live="polite">{monthTitle(focused.year, focused.month)}</h3>
        <div className="home-calendar-nav">
          <button type="button" className="home-icon-button" aria-label="Previous month" onClick={() => month(-1)}><Icon name="chevronLeft" size={18} /></button>
          <button type="button" className="button small" onClick={() => select(today, false)}>Today</button>
          <button type="button" className="home-icon-button" aria-label="Next month" onClick={() => month(1)}><Icon name="chevronRight" size={18} /></button>
        </div>
      </div>
      <div className="home-calendar-grid" role="grid" aria-labelledby="home-calendar-month" ref={grid}>
        <div className="home-calendar-row" role="row">
          {labels.map((label, index) => <span key={label} className="home-calendar-weekday" role="columnheader" aria-label={longLabels[index]}>{label}</span>)}
        </div>
        {weeks.map(week => (
          <div key={week[0]!.key} className="home-calendar-row" role="row">
            {week.map(cell => {
              const mark = marks.get(cell.key);
              return (
                <div
                  key={cell.key}
                  role="gridcell"
                  className={['home-day', cell.inMonth ? '' : 'outside', cell.key === todayKey ? 'today' : '', cell.key === selected ? 'selected' : '', isPastDay(cell.key, now) ? 'past' : ''].filter(Boolean).join(' ')}
                  data-day={cell.key}
                  data-autofocus={cell.key === focusedKey ? 'true' : undefined}
                  tabIndex={cell.key === focusedKey ? 0 : -1}
                  aria-selected={cell.key === selected}
                  aria-current={cell.key === todayKey ? 'date' : undefined}
                  aria-label={dayName(cell, mark)}
                  onClick={() => select(cell, false)}
                  onKeyDown={event => onKey(event, cell)}
                >
                  <span aria-hidden="true">{cell.day}</span>
                  {mark && <i className={`home-day-dot ${mark.overdue ? 'overdue' : ''}`} aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <section className="home-day-panel" aria-labelledby="home-day-title">
        <h3 id="home-day-title" className="home-day-title">{longDay(selectedDate)}</h3>
        {dayReminders.length > 0 && <ul className="home-rows home-day-list" aria-label={`Reminders on ${longDay(selectedDate)}`}>{dayReminders.map(reminder => <ReminderRow key={reminder.id} reminder={reminder} context={context} />)}</ul>}
        {past ? (
          <div className="home-notice"><p>This day has passed.</p><button type="button" className="button small" onClick={() => select(today, true)}>Go to today</button></div>
        ) : (
          <form ref={form} className="home-form" onSubmit={submit} noValidate>
            <fieldset className="home-fieldset" disabled={offline || busy}>
              <legend className="home-legend">Add a reminder on {longDay(selectedDate)}</legend>
              <label className="home-field"><span>What</span><input ref={what} className="text-input" maxLength={240} value={text} onChange={event => { setText(event.target.value); setProblem(null); }} aria-invalid={problem?.field === 'text'} aria-describedby={problem ? 'home-calendar-problem' : undefined} /></label>
              <label className="home-field"><span>Time</span><input ref={timeField} className="text-input" type="time" value={time} onChange={event => { setTime(event.target.value); setProblem(null); }} aria-invalid={problem?.field === 'time'} aria-describedby={problem?.field === 'time' ? 'home-calendar-problem' : undefined} /></label>
              {problem && <p className="home-problem" id="home-calendar-problem" role="alert">{problem.message}</p>}
              <ShowSwitch id="reminders" settings={settings} checked={showWanted} onChange={setShowWanted} />
              <div className="home-sheet-actions"><button type="submit" className="button primary">Add to calendar</button></div>
            </fieldset>
          </form>
        )}
      </section>
    </div>
  );
}
