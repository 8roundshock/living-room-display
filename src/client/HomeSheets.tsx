import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CountdownEvent, LocationResult, Reminder, Settings, Timer, WidgetId, WorldClockCity } from '../shared/contracts';
import { TIMER_LABEL_MAX, TIMER_LIMIT, TIMER_MAX_MS, TIMER_MESSAGES, TIMER_MIN_MS } from '../shared/timers';
import { showPlacement } from '../shared/show';
import { WIDGET_CATALOG } from '../shared/widgets';
import { api } from './api';
import { formatTime, localTimeZone } from './astronomy';
import { addDays, civilFromDate, countdownLabel, countdownPassed, daysBetween, formatCivil, nextOccurrence, parseCivil } from './calendar';
import { CitySearch } from './CitySearch';
import { HomeCalendar } from './HomeCalendar';
import { defaultTime, dueAtFor, dueSummary, quickDay, shiftedMessage, type QuickWhen } from './home-model';
import { makeRoomLink, type HomeContext } from './HomeParts';
import { Icon } from './icons';
import { RemindersPanel } from './RemindersPanel';
import { timerPhrase } from './timer';
import { NOTE_MAX_LENGTH, limitNote } from './widgets/Note';
import { MAX_WORLD_CLOCKS } from './widgets/WorldClocks';
import { useHomeDraft as useDraft, forgetHomeDrafts as forget } from './home-drafts';

export type SheetKind = 'timer' | 'reminder' | 'calendar' | 'worldClock' | 'countdown' | 'note' | 'allReminders';

const TITLES: Record<SheetKind, string> = {
  timer: 'Timer', reminder: 'Reminder', calendar: 'Calendar', worldClock: 'World clock', countdown: 'Countdown', note: 'Note', allReminders: 'All reminders',
};
/**
 * One quick action in a native modal `<dialog>` (#438): `showModal()` traps focus, Esc closes it and focus
 * returns to the button that opened it. Below 600 px it is a bottom sheet with its own scroll and a
 * sticky primary button. The status line is inside it while it is open, so a message or Undo is never
 * hidden behind the backdrop.
 */
export function HomeSheet({ kind, context, status, onClose }: {
  kind: SheetKind; context: HomeContext; status: ReactNode;
  onClose: (focus?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submittedControl = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    // The first field, else the first control (for Timer, the first preset).
    window.requestAnimationFrame(() => (element.querySelector<HTMLElement>('[data-autofocus]') ?? element.querySelector<HTMLElement>('input, textarea, button:not(.home-sheet-close)'))?.focus());
    return () => { if (element.open) element.close(); };
  }, []);
  useLayoutEffect(() => {
    const body = dialog.current?.querySelector<HTMLElement>('.home-sheet-body');
    if (!body) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const active = document.activeElement;
        const lost = !active || active === document.body;
        const control = lost ? submittedControl.current : active;
        // An error/status can reduce the scroller after the form's initial reveal.
        // Keep the user's current control visible without changing keyboard focus.
        if (control instanceof HTMLElement && control.isConnected && body.contains(control)) {
          const form = control.closest<HTMLElement>('.reminder-form');
          const target = form && form.getBoundingClientRect().height + 20 <= body.clientHeight ? form : control;
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          // Disabling the submit button during a request can drop browser focus to BODY.
          // Recover only that known submission, never a different control chosen meanwhile.
          if (lost && control.matches('button:not(:disabled), input:not(:disabled)')) control.focus({ preventScroll: true });
        }
      });
    });
    observer.observe(body);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, []);
  const content = (() => {
    switch (kind) {
      case 'timer': return <TimerSheet context={context} onClose={onClose} />;
      case 'reminder': return <ReminderSheet context={context} onClose={onClose} />;
      case 'calendar': return <HomeCalendar context={context} />;
      case 'worldClock': return <WorldClockSheet context={context} />;
      case 'countdown': return <CountdownSheet context={context} />;
      case 'note': return <NoteSheet context={context} />;
      case 'allReminders': return <AllReminders context={context} />;
    }
  })();
  return (
    <dialog
      ref={dialog}
      className={`home-sheet home-sheet-${kind}`}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]')]
          .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.checkVisibility());
        const first = controls[0], last = controls.at(-1);
        const target = event.shiftKey && document.activeElement === first ? last : !event.shiftKey && document.activeElement === last ? first : null;
        if (target) { event.preventDefault(); target.focus(); }
      }}
      onMouseDown={event => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="home-sheet-panel">
        <div className="home-sheet-header">
          <h2 id={titleId} className="home-sheet-title">{TITLES[kind]}</h2>
          <button type="button" className="home-icon-button home-sheet-close" aria-label={`Close ${TITLES[kind]}`} onClick={() => onClose()}><Icon name="close" size={18} /></button>
        </div>
        <div className="home-sheet-body" onSubmitCapture={event => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          submittedControl.current = submitter instanceof HTMLElement ? submitter : null;
        }} onFocusCapture={event => {
          if (submittedControl.current && event.target !== submittedControl.current) submittedControl.current = null;
        }}>{content}</div>
        {status}
      </div>
    </dialog>
  );
}

/** "Show on my display" (#438): checked by default while the widget is off and has room; with no room, the Edit display link. */
export function ShowSwitch({ id, settings, checked, onChange }: { id: WidgetId; settings: Settings; checked: boolean; onChange: (checked: boolean) => void }) {
  if (settings.widgets[id]) return <p className="home-show home-show-on"><Icon name="check" size={14} />{WIDGET_CATALOG[id].name} is on your display</p>;
  if (!showPlacement(settings, id)) return <p className="home-show home-show-none">No room on your display · <a className="home-link" href={makeRoomLink(id).href}>Make room in Edit display</a></p>;
  return (
    <label className="home-show home-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>Show on my display</span>
    </label>
  );
}

/** Shows a widget after its content saved, when asked; says why when it could not. */
async function showAfterSave(context: HomeContext, id: WidgetId, wanted: boolean): Promise<'on' | 'shown' | 'off' | 'failed'> {
  if (context.settings.widgets[id]) return 'on';
  if (!wanted) return 'off';
  return await context.show(id) ? 'shown' : 'failed';
}

// Timer ---------------------------------------------------------------------------------------------

const PRESETS = [1, 3, 5, 10, 15, 30, 60].map(minutes => ({ ms: minutes * 60_000, label: minutes === 60 ? '1 hour' : `${minutes} min` }));

function TimerSheet({ context, onClose }: { context: HomeContext; onClose: (focus?: string) => void }) {
  const { settings, offline, run, announce, setState, show } = context;
  const [hours, setHours] = useDraft('timer.hours', () => '0');
  const [minutes, setMinutes] = useDraft('timer.minutes', () => '5');
  const [seconds, setSeconds] = useDraft('timer.seconds', () => '0');
  const [label, setLabel] = useDraft('timer.label', () => '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const clockOn = settings.widgets.clock;
  const full = (context.state.timers ?? []).length >= TIMER_LIMIT;
  async function start(durationMs: number, name = '') {
    if (busy) return;
    setBusy(true);
    try {
      const timer = await run(() => api<Timer>('/api/timers', { method: 'POST', body: JSON.stringify({ durationMs, ...(name.trim() ? { label: name.trim() } : {}) }) }), () => { void start(durationMs, name); });
      if (!timer) return;
      forget('timer.hours', 'timer.minutes', 'timer.seconds', 'timer.label');
      setState(previous => previous ? { ...previous, timers: [...(previous.timers ?? []), timer] } : previous);
      onClose(`.home-timer-row[data-timer-id="${timer.id}"] button`);
      announce({ text: `${timerPhrase(timer)} started · ${context.settings.widgets.clock ? "on your display's clock." : "your display's Clock is off, so it shows here only."}` });
    } finally { setBusy(false); }
  }
  function custom(event: FormEvent) {
    event.preventDefault();
    const parts = [hours, minutes, seconds].map(value => value.trim() === '' ? 0 : Number(value));
    const total = parts.every(value => Number.isInteger(value) && value >= 0) ? ((parts[0]! * 60 + parts[1]!) * 60 + parts[2]!) * 1000 : NaN;
    if (!(total >= TIMER_MIN_MS && total <= TIMER_MAX_MS)) { setProblem(TIMER_MESSAGES.range); return; }
    setProblem('');
    void start(total, label);
  }
  return (
    <>
      <p className="home-sheet-lede">Counts down silently on your display's clock.</p>
      {!clockOn && (
        <div className="home-notice">
          <p>Timers show in your display's Clock, which is off.</p>
          {showPlacement(settings, 'clock')
            ? <button type="button" className="button small" disabled={offline} onClick={() => { void show('clock').then(ok => ok && announce({ text: 'Clock is on your display.' })); }}>Show the clock</button>
            : <a className="home-link" href={makeRoomLink('clock').href}>Make room in Edit display</a>}
        </div>
      )}
      {full && <p className="home-notice">{TIMER_MESSAGES.limit}</p>}
      <fieldset className="home-fieldset" disabled={offline || busy}>
        <legend className="home-legend">Start now</legend>
        <div className="home-presets">
          {PRESETS.map((preset, index) => (
            <button key={preset.ms} type="button" className="home-preset" data-autofocus={index === 0 ? 'true' : undefined} aria-label={`Start a ${preset.label} timer`} onClick={() => { void start(preset.ms); }}>{preset.label}</button>
          ))}
        </div>
      </fieldset>
      <form className="home-form" onSubmit={custom} noValidate>
        <fieldset className="home-fieldset" disabled={offline || busy}>
          <legend className="home-legend">Custom</legend>
          <div className="home-duration">
            <label className="home-field"><span>Hours</span><input className="text-input" inputMode="numeric" type="number" min={0} max={24} value={hours} onChange={event => setHours(event.target.value)} aria-invalid={!!problem} aria-describedby={problem ? 'home-timer-problem' : undefined} /></label>
            <label className="home-field"><span>Minutes</span><input className="text-input" inputMode="numeric" type="number" min={0} max={59} value={minutes} onChange={event => setMinutes(event.target.value)} aria-invalid={!!problem} /></label>
            <label className="home-field"><span>Seconds</span><input className="text-input" inputMode="numeric" type="number" min={0} max={59} value={seconds} onChange={event => setSeconds(event.target.value)} aria-invalid={!!problem} /></label>
          </div>
          <label className="home-field"><span>Name (optional)</span><input className="text-input" maxLength={TIMER_LABEL_MAX} placeholder="Pasta" value={label} onChange={event => setLabel(event.target.value)} /></label>
          {problem && <p className="home-problem" id="home-timer-problem" role="alert">{problem}</p>}
          <div className="home-sheet-actions"><button type="submit" className="button primary">Start timer</button></div>
        </fieldset>
      </form>
    </>
  );
}

// Reminder ------------------------------------------------------------------------------------------

/** Saves one reminder (Home's quick add and calendar) and says where it shows. */
export async function addReminder(context: HomeContext, text: string, dueAt: string | null, showWanted: boolean, note: string, retry: () => void): Promise<Reminder | undefined> {
  const reminder = await context.run(() => api<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify({ text, dueAt }) }), retry);
  if (!reminder) return undefined;
  context.setState(previous => previous ? { ...previous, reminders: [...previous.reminders, reminder] } : previous);
  const shown = await showAfterSave(context, 'reminders', showWanted);
  if (shown === 'failed') return reminder;
  const where = shown === 'off' ? ' Reminders is off on your display.' : ' · in Reminders on your display.';
  context.announce({ text: `${dueAt ? `Added for ${dueSummary(dueAt, Date.now(), context.state.settings.clockFormat)}` : 'Added'}${where}${note ? ` ${note}` : ''}` });
  return reminder;
}

function ReminderSheet({ context, onClose }: { context: HomeContext; onClose: (focus?: string) => void }) {
  const { settings, offline } = context;
  const [text, setText] = useDraft('reminder.text', () => '');
  const [when, setWhen] = useDraft<QuickWhen>('reminder.when', () => 'today');
  const [day, setDay] = useDraft('reminder.day', () => quickDay('tomorrow', Date.now()));
  const [time, setTime] = useDraft('reminder.time', () => defaultTime('today', Date.now()));
  const [showWanted, setShowWanted] = useState(true);
  const [problem, setProblem] = useState<{ field: 'text' | 'time'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const textField = useRef<HTMLInputElement>(null), timeField = useRef<HTMLInputElement>(null), form = useRef<HTMLFormElement>(null);
  function choose(next: QuickWhen) {
    setWhen(next); setProblem(null);
    if (next !== 'anytime') setTime(defaultTime(next, Date.now()));
    if (next === 'date') setDay(quickDay('tomorrow', Date.now()));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) { setProblem({ field: 'text', message: 'Enter what to remember.' }); textField.current?.focus(); return; }
    let dueAt: string | null = null, note = '';
    if (when !== 'anytime') {
      const target = when === 'date' ? day : quickDay(when, Date.now());
      const due = time ? dueAtFor(target, time) : null;
      if (!due) { setProblem({ field: 'time', message: 'Enter both a date and a time, or choose Anytime.' }); timeField.current?.focus(); return; }
      if (Date.parse(due.iso) <= Date.now()) { setProblem({ field: 'time', message: 'That time has passed. Choose a later time.' }); timeField.current?.focus(); return; }
      dueAt = due.iso;
      if (due.shifted) note = shiftedMessage(target, time, due, settings.clockFormat);
    }
    setProblem(null); setBusy(true);
    try {
      // Retry sends the form again, so a lost connection keeps what was typed and still closes on success.
      const reminder = await addReminder(context, trimmed, dueAt, showWanted, note, () => form.current?.requestSubmit());
      if (!reminder) return;
      forget('reminder.text', 'reminder.when', 'reminder.day', 'reminder.time');
      onClose(`.home-check[data-reminder-id="${reminder.id}"]`);
    } finally { setBusy(false); }
  }
  const options: [QuickWhen, string][] = [['anytime', 'Anytime'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['date', 'Pick a date']];
  return (
    <form ref={form} className="home-form" onSubmit={submit} noValidate>
      <fieldset className="home-fieldset" disabled={offline || busy}>
        <label className="home-field">
          <span>What</span>
          <input ref={textField} data-autofocus="true" className="text-input" maxLength={240} value={text} onChange={event => setText(event.target.value)} aria-invalid={problem?.field === 'text'} aria-describedby={problem?.field === 'text' ? 'home-reminder-problem' : undefined} />
        </label>
        <div className="home-field" role="radiogroup" aria-label="When">
          <span aria-hidden="true">When</span>
          <div className="home-segments">
            {options.map(([value, name]) => (
              <label key={value} className={`home-segment ${when === value ? 'selected' : ''}`}>
                <input type="radio" name="home-reminder-when" value={value} checked={when === value} onChange={() => choose(value)} />
                {name}
              </label>
            ))}
          </div>
        </div>
        {when !== 'anytime' && (
          <div className="home-row-fields">
            {when === 'date' && <label className="home-field"><span>Date</span><input className="text-input" type="date" value={day} min={quickDay('today', Date.now())} onChange={event => { setDay(event.target.value); setProblem(null); }} /></label>}
            <label className="home-field"><span>Time</span><input ref={timeField} className="text-input" type="time" value={time} onChange={event => { setTime(event.target.value); setProblem(null); }} aria-invalid={problem?.field === 'time'} aria-describedby={problem?.field === 'time' ? 'home-reminder-problem' : undefined} /></label>
          </div>
        )}
        {problem && <p className="home-problem" id="home-reminder-problem" role="alert">{problem.message}</p>}
        <ShowSwitch id="reminders" settings={settings} checked={showWanted} onChange={setShowWanted} />
        <div className="home-sheet-actions"><button type="submit" className="button primary">Add reminder</button></div>
      </fieldset>
    </form>
  );
}

// World clock ---------------------------------------------------------------------------------------

function WorldClockSheet({ context }: { context: HomeContext }) {
  const { settings, offline, run, announce, applySettings, focusLater, now } = context;
  const cities = settings.widgetData.worldClocks;
  const [query, setQuery] = useDraft('world.query', () => '');
  const [city, setCity] = useDraft<LocationResult | null>('world.city', () => null);
  const [label, setLabel] = useDraft('world.label', () => '');
  const [showWanted, setShowWanted] = useState(true);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const full = cities.length >= MAX_WORLD_CLOCKS;
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || full) return;
    if (!city) { setProblem('Search for a city and choose it from the list.'); document.getElementById('home-city-search')?.focus(); return; }
    const name = label.trim() || city.name;
    setProblem(''); setBusy(true);
    try {
      const saved = await run(() => api<Settings>('/api/world-clocks', { method: 'POST', body: JSON.stringify({ label: name.slice(0, 40), timezone: city.timezone, latitude: city.latitude, longitude: city.longitude }) }), () => { void add(event); });
      if (!saved) return;
      applySettings(saved);
      forget('world.query', 'world.city', 'world.label');
      setQuery(''); setCity(null); setLabel('');
      const added = saved.widgetData.worldClocks.at(-1);
      const shown = await showAfterSave({ ...context, state: { ...context.state, settings: saved } }, 'worldClocks', showWanted);
      if (shown !== 'failed') announce({ text: `${name} added${shown === 'off' ? '. World clocks is off on your display.' : ' · in World clocks on your display.'}` });
      if (added) focusLater(`.home-list-row[data-item-id="${added.id}"] button`);
    } finally { setBusy(false); }
  }
  async function remove(item: WorldClockCity, index: number) {
    const saved = await run(() => api<Settings>(`/api/world-clocks/${item.id}`, { method: 'DELETE' }), () => { void remove(item, index); });
    if (!saved) return;
    applySettings(saved);
    focusLater('.home-sheet .home-list-row button', '#home-city-search');
    announce({
      text: `${item.label} removed`,
      undo: async () => {
        const restored = await run(() => api<Settings>('/api/world-clocks', { method: 'POST', body: JSON.stringify({ id: item.id, index, label: item.label, timezone: item.timezone, latitude: item.latitude, longitude: item.longitude }) }));
        if (restored) { applySettings(restored); focusLater(`.home-list-row[data-item-id="${item.id}"] button`); }
      },
    });
  }
  const at = new Date(now), local = localTimeZone();
  return (
    <>
      {cities.length > 0 && (
        <ul className="home-list" aria-label="Your cities">
          {cities.map((item, index) => (
            <li key={item.id} className="home-list-row" data-item-id={item.id}>
              <span className="home-row-copy"><span className="home-row-title">{item.label}</span><span className="home-row-detail">{safeTime(at, item.timezone, settings.clockFormat)}{item.timezone === local ? ' · same time zone' : ''}</span></span>
              <button type="button" className="home-chip-button" aria-label={`Remove ${item.label}`} disabled={offline} onClick={() => { void remove(item, index); }}><Icon name="trash" size={15} /><span className="home-button-text">Remove</span></button>
            </li>
          ))}
        </ul>
      )}
      <form className="home-form" onSubmit={add} noValidate>
        <fieldset className="home-fieldset" disabled={offline || busy || full}>
          <div className="home-field">
            <label htmlFor="home-city-search">City</label>
            <CitySearch id="home-city-search" value={query} onChange={value => { setQuery(value); setProblem(''); }} onSelect={chosen => { setCity(chosen); setQuery(chosen.name); setLabel(chosen.name); }} disabled={offline || busy || full} description="Type two or more letters to search for a city" />
          </div>
          <label className="home-field"><span>Label</span><input className="text-input" maxLength={40} value={label} onChange={event => setLabel(event.target.value)} /></label>
          {problem && <p className="home-problem" role="alert">{problem}</p>}
          {full && <p className="home-hint">Up to 4 cities. Remove one to add another.</p>}
          <ShowSwitch id="worldClocks" settings={settings} checked={showWanted} onChange={setShowWanted} />
          <div className="home-sheet-actions"><button type="submit" className="button primary">Add clock</button></div>
        </fieldset>
      </form>
      <p className="home-hint">Rename or reorder in <a className="home-link" href="/editor">Edit display</a>.</p>
    </>
  );
}
function safeTime(at: Date, timezone: string, clockFormat: Settings['clockFormat']): string {
  try { return formatTime(at, timezone, clockFormat); } catch { return timezone; }
}

// Countdown -----------------------------------------------------------------------------------------

function CountdownSheet({ context }: { context: HomeContext }) {
  const { settings, offline, run, announce, applySettings, focusLater, now } = context;
  const events = settings.widgetData.countdowns;
  const today = civilFromDate(new Date(now));
  const [title, setTitle] = useDraft('countdown.title', () => '');
  const [date, setDate] = useDraft('countdown.date', () => formatCivil(addDays(civilFromDate(new Date()), 7)));
  const [yearly, setYearly] = useDraft('countdown.yearly', () => false);
  const [showWanted, setShowWanted] = useState(true);
  const [problem, setProblem] = useState<{ field: 'title' | 'date'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const full = events.length >= 12;
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy || full) return;
    const name = title.trim(), parsed = parseCivil(date);
    if (!name) { setProblem({ field: 'title', message: 'Give the countdown a title.' }); document.getElementById('home-countdown-title')?.focus(); return; }
    if (!parsed || parsed.year < 1900 || parsed.year > 2200) { setProblem({ field: 'date', message: 'Use a date between 1900 and 2200' }); document.getElementById('home-countdown-date')?.focus(); return; }
    setProblem(null); setBusy(true);
    try {
      const saved = await run(() => api<Settings>('/api/countdowns', { method: 'POST', body: JSON.stringify({ title: name, date, repeatsYearly: yearly }) }), () => { void add(event); });
      if (!saved) return;
      applySettings(saved);
      forget('countdown.title', 'countdown.date', 'countdown.yearly');
      setTitle(''); setDate(formatCivil(addDays(civilFromDate(new Date()), 7))); setYearly(false);
      const added = saved.widgetData.countdowns.at(-1);
      const shown = await showAfterSave({ ...context, state: { ...context.state, settings: saved } }, 'countdown', showWanted);
      if (shown !== 'failed') announce({ text: `${name} added${shown === 'off' ? '. Countdown is off on your display.' : ' · in Countdown on your display.'}` });
      if (added) focusLater(`.home-list-row[data-item-id="${added.id}"] button`);
    } finally { setBusy(false); }
  }
  async function remove(item: CountdownEvent, index: number) {
    const saved = await run(() => api<Settings>(`/api/countdowns/${item.id}`, { method: 'DELETE' }), () => { void remove(item, index); });
    if (!saved) return;
    applySettings(saved);
    focusLater('.home-sheet .home-list-row button', '#home-countdown-title');
    announce({
      text: `${item.title} removed`,
      undo: async () => {
        const restored = await run(() => api<Settings>('/api/countdowns', { method: 'POST', body: JSON.stringify({ id: item.id, index, title: item.title, date: item.date, repeatsYearly: item.repeatsYearly }) }));
        if (restored) { applySettings(restored); focusLater(`.home-list-row[data-item-id="${item.id}"] button`); }
      },
    });
  }
  return (
    <>
      {events.length > 0 && (
        <ul className="home-list" aria-label="Your countdowns">
          {events.map((item, index) => {
            const next = nextOccurrence(item, today), days = next ? daysBetween(today, next) : null;
            const detail = countdownPassed(item, today) || days === null ? 'Passed' : days > 1 ? `In ${countdownLabel(days).text}` : countdownLabel(days).text;
            return (
              <li key={item.id} className="home-list-row" data-item-id={item.id}>
                <span className="home-row-copy"><span className="home-row-title">{item.title}</span><span className="home-row-detail">{detail}{item.repeatsYearly ? ' · every year' : ''}</span></span>
                <button type="button" className="home-chip-button" aria-label={`Remove ${item.title}`} disabled={offline} onClick={() => { void remove(item, index); }}><Icon name="trash" size={15} /><span className="home-button-text">Remove</span></button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="home-form" onSubmit={add} noValidate>
        <fieldset className="home-fieldset" disabled={offline || busy || full}>
          <label className="home-field"><span>Title</span><input id="home-countdown-title" data-autofocus="true" className="text-input" maxLength={60} value={title} onChange={event => { setTitle(event.target.value); setProblem(null); }} aria-invalid={problem?.field === 'title'} /></label>
          <div className="home-row-fields">
            <label className="home-field"><span>Date</span><input id="home-countdown-date" className="text-input" type="date" min="1900-01-01" max="2200-12-31" value={date} onChange={event => { setDate(event.target.value); setProblem(null); }} aria-invalid={problem?.field === 'date'} /></label>
            <label className="home-switch home-inline-switch"><input type="checkbox" role="switch" checked={yearly} onChange={event => setYearly(event.target.checked)} /><span>Every year</span></label>
          </div>
          {problem && <p className="home-problem" role="alert">{problem.message}</p>}
          {full && <p className="home-hint">Up to 12 countdowns. Remove one to add another.</p>}
          <ShowSwitch id="countdown" settings={settings} checked={showWanted} onChange={setShowWanted} />
          <div className="home-sheet-actions"><button type="submit" className="button primary">Add countdown</button></div>
        </fieldset>
      </form>
    </>
  );
}

// Note ----------------------------------------------------------------------------------------------

function NoteSheet({ context }: { context: HomeContext }) {
  const { settings, offline, run, announce, applySettings } = context;
  const saved = settings.widgetData.note.text;
  const [text, setText] = useDraft('note.text', () => saved);
  const [showWanted, setShowWanted] = useState(true);
  const [busy, setBusy] = useState(false);
  const differs = limitNote(text).trim() !== saved;
  const previousSaved = useRef(saved);
  useEffect(() => {
    const previous = previousSaved.current;
    previousSaved.current = saved;
    // A poll must not turn untouched text into a draft, or replace genuine local typing (#512).
    if (saved !== previous && limitNote(text).trim() === previous) resetText(saved);
    else if (!differs) forget('note.text');
  }, [saved, text, differs]);
  function resetText(value: string) {
    setText(value);
    // Updating the field also caches it. Saved/discarded text is no longer a draft: clear the
    // cache afterward so reopening uses the latest saved note, including another page's edits.
    forget('note.text');
  }
  async function save(value: string, undoText?: string) {
    setBusy(true);
    try {
      const next = await run(() => api<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ widgetData: { note: { text: value } } }) }), () => { void save(value, undoText); });
      if (!next) return false;
      applySettings(next);
      resetText(next.widgetData.note.text);
      if (undoText !== undefined) {
        announce({ text: 'Note cleared', undo: async () => { const back = await run(() => api<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ widgetData: { note: { text: undoText } } }) })); if (back) { applySettings(back); resetText(back.widgetData.note.text); } } });
        return true;
      }
      const shown = next.widgetData.note.text ? await showAfterSave({ ...context, state: { ...context.state, settings: next } }, 'note', showWanted) : 'off';
      if (shown !== 'failed') announce({ text: next.widgetData.note.text ? `Note saved${shown === 'off' ? '. Note is off on your display.' : ' · on your display.'}` : 'Note saved' });
      return true;
    } finally { setBusy(false); }
  }
  return (
    <form className="home-form" onSubmit={event => { event.preventDefault(); if (differs) void save(limitNote(text).trim()); }} noValidate>
      <fieldset className="home-fieldset" disabled={offline || busy}>
        <label className="home-field">
          <span>Note</span>
          <textarea data-autofocus="true" className="text-input home-note" rows={4} value={text} onChange={event => setText(limitNote(event.target.value))} aria-describedby="home-note-count" />
        </label>
        <p className="home-note-count" id="home-note-count" aria-live="polite">{limitNote(text).length}/{NOTE_MAX_LENGTH}</p>
        <ShowSwitch id="note" settings={settings} checked={showWanted} onChange={setShowWanted} />
        <div className="home-sheet-actions">
          {differs && <button type="submit" className="button primary">Save note</button>}
          {differs && <button type="button" className="button" onClick={() => resetText(saved)}>Discard</button>}
          {!differs && saved && <button type="button" className="button" onClick={() => { void save('', saved); }}>Clear note</button>}
        </div>
      </fieldset>
    </form>
  );
}

// All reminders -------------------------------------------------------------------------------------

function AllReminders({ context }: { context: HomeContext }) {
  // The existing Reminders panel, its only instance on the page (#438).
  return <div className="home-reminders"><RemindersPanel state={context.state} setState={context.setState} connectionError={context.offline ? 'offline' : null} clockFormat={context.settings.clockFormat} onError={message => context.announce(message ? { text: message, tone: 'error' } : null)} /></div>;
}
