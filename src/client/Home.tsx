import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { AppState, Settings, Timer, WidgetId } from '../shared/contracts';
import { scheduledSettings } from '../shared/schedule';
import { ScheduleStatus } from './ScheduleStatus';
import { orderTimers, timerDoneAt, timerName, timerPhase, timerRemaining, visibleTimers, KEEP_DONE_MS } from '../shared/timers';
import { showPlacement } from '../shared/show';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG } from '../shared/widgets';
import { ApiError, NETWORK_ERROR_MESSAGE, api } from './api';
import { localTimeZone, timeParts, zoneOffsetMinutes } from './astronomy';
import { civilFromDate, countdownLabel, parseCivil } from './calendar';
import { readFirstRunDismissed } from './FirstRunCard';
import { HOME_WIDGETS, longDay, namesList, relativeDay, todayGroups, type ComingUpItem } from './home-model';
import { HomeSheet, type SheetKind } from './HomeSheets';
import { homeDraftPending } from './home-drafts';
import { ReminderRow, makeRoomLink, type HomeContext, type StatusMessage } from './HomeParts';
import { reminderFormPending } from './RemindersPanel';
import { Icon, type IconName } from './icons';
import { DISPLAY_WINDOW, useDisplayWindow, type DisplayWindowControls } from './displayWindow';
import { StudioHeader } from './StudioHeader';
import { doneAgo, spokenTimeLeft, timeOfDay, timerDigits, timerEnds, timerPhrase } from './timer';
import { usePrefersReducedMotion } from './useMotion';
import { offsetLabel } from './widgets/WorldClocks';
import './home.css';

/** An Undo stays offered this long, or until the next message replaces it. */
const UNDO_MS = 8000;

/** The current minute, updated on the minute; Home's lists change no faster than this. */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => { setMinute(Math.floor(Date.now() / 60_000) * 60_000); schedule(); }, 60_000 - (Date.now() % 60_000) + 20);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return minute;
}

/**
 * Re-renders when a running timer ends or a finished one ages out of Home, so Done appears (and is
 * announced) on time without re-rendering the page every second; the rows count their own digits.
 */
function useTimerBoundaries(timers: readonly Timer[]): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const boundaries = timers.flatMap(timer => {
      const phase = timerPhase(timer, now);
      if (phase === 'running') return [Date.parse(timer.endsAt!)];
      if (phase === 'done') return [timerDoneAt(timer, now)! + KEEP_DONE_MS];
      return [];
    }).filter(at => at > now);
    if (!boundaries.length) return;
    const timer = window.setTimeout(() => setTick(value => value + 1), Math.min(...boundaries) - now + 30);
    return () => window.clearTimeout(timer);
  }, [timers, tick]);
  return tick;
}

export function Home({ state, setState, connectionError, disconnected, reload }: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState | null>>;
  connectionError: string | null;
  disconnected: boolean;
  reload: () => Promise<void>;
}) {
  const settings = state.settings;
  const displaySettings = scheduledSettings(settings, state.schedule);
  const displayControls = useDisplayWindow();
  const minute = useMinute();
  const timers = state.timers ?? [];
  const boundary = useTimerBoundaries(timers);
  // `boundary` changes exactly when a timer's phase does; Date.now() then sees the new phase.
  const now = useMemo(() => Math.max(minute, Date.now()), [minute, boundary, state]);
  const reducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [sheet, setSheet] = useState<{ kind: SheetKind; opener: HTMLElement | null } | null>(null);
  const [dismissedWarning, setDismissedWarning] = useState<string | null>(null);
  const [firstRunDismissed] = useState(readFirstRunDismissed);
  const undoTimer = useRef<number | undefined>(undefined);
  const offline = disconnected;

  const announce = useCallback((message: StatusMessage | null) => {
    window.clearTimeout(undoTimer.current);
    setStatus(message);
    if (message && !message.tone) undoTimer.current = window.setTimeout(() => setStatus(current => current === message ? null : current), UNDO_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const run = useCallback(async <T,>(request: () => Promise<T>, retry?: () => void): Promise<T | undefined> => {
    try { return await request(); } catch (caught) {
      const network = caught instanceof ApiError && caught.network;
      announce({ text: network ? NETWORK_ERROR_MESSAGE : caught instanceof Error ? caught.message : 'That did not work. Try again.', tone: 'error', retry: network ? retry : undefined });
      return undefined;
    }
  }, [announce]);
  const applySettings = useCallback((next: Settings) => setState(previous => previous ? { ...previous, settings: next } : previous), [setState]);
  const focusLater = useCallback((selector: string, fallback?: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(selector) ?? (fallback ? document.querySelector<HTMLElement>(fallback) : null);
      element?.focus();
    }));
  }, []);
  const show = useCallback(async (id: WidgetId, saved = 'Saved.') => {
    if (state.schedule?.visual) {
      announce({ text: 'A scheduled style is active. Use the manual style to show this widget.', link: { href: '/#schedule-active', label: 'Schedule controls' } });
      return false;
    }
    try {
      applySettings(await api<Settings>(`/api/widgets/${id}/show`, { method: 'POST' }));
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) announce({ text: `${saved} No room for ${WIDGET_CATALOG[id].name} on your display`, link: makeRoomLink(id) });
      else announce({ text: caught instanceof ApiError && caught.network ? NETWORK_ERROR_MESSAGE : caught instanceof Error ? caught.message : 'Could not show it.', tone: 'error' });
      return false;
    }
  }, [announce, applySettings, state.schedule?.visual]);
  const context: HomeContext = { state, settings: displaySettings, now, offline, setState, reload, announce, run, applySettings, show, focusLater };

  // A finished timer is announced once, and the tab title says so until it is dismissed (#438).
  const homeTimers = useMemo(() => orderTimers(visibleTimers(timers, now, false), now), [timers, now]);
  const done = homeTimers.filter(timer => timerPhase(timer, now) === 'done');
  const announcedDone = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(done.map(timer => timer.id));
    // Timers already finished when Home opened are not news.
    if (announcedDone.current === null) { announcedDone.current = ids; return; }
    const fresh = done.filter(timer => !announcedDone.current!.has(timer.id));
    announcedDone.current = ids;
    if (fresh.length) announce({ text: fresh.map(timer => `${timerPhrase(timer)} is done.`).join(' ') });
  }, [done.map(timer => timer.id).join(), announce]);
  useEffect(() => { document.title = done.length ? 'Done · Still · Home' : 'Still · Home'; }, [done.length]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (homeDraftPending(settings) || reminderFormPending()) event.preventDefault(); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [settings]);

  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const open = (kind: SheetKind) => (event: { currentTarget: HTMLElement }) => setSheet({ kind, opener: event.currentTarget });
  /** Closes the sheet; focus returns to the button that opened it, or moves to `focus` (a new row) after a create. */
  const closeSheet = useCallback((focus?: string) => {
    const opener = sheetRef.current?.opener ?? null;
    setSheet(null);
    if (focus) focusLater(focus);
    else window.requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); });
  }, [focusLater]);

  const date = civilFromDate(new Date(now));
  const time = timeOfDay(new Date(now), settings.clockFormat);
  const groups = useMemo(() => todayGroups(state.reminders, settings.widgetData.countdowns, now), [state.reminders, settings.widgetData.countdowns, now]);
  const warning = state.timersWarning && state.timersWarning !== dismissedWarning ? state.timersWarning : null;
  const showing = ACTIVE_WIDGET_IDS.filter(id => displaySettings.widgets[id] && (id !== 'preview' || displaySettings.preview.enabled));
  // Off widgets that Home feeds and that have something to show.
  const waiting = HOME_WIDGETS.filter(id => !displaySettings.widgets[id] && (
    id === 'clock' ? homeTimers.length > 0 : id === 'reminders' ? groups.pending > 0 : id === 'worldClocks' ? settings.widgetData.worldClocks.length > 0
      : id === 'countdown' ? settings.widgetData.countdowns.length > 0 : id === 'note' ? settings.widgetData.note.text.length > 0 : false));
  const waitingWithoutRoom = waiting.filter(id => !showPlacement(displaySettings, id));

  const actions: { kind: SheetKind; label: string; description: string; icon: IconName }[] = [
    { kind: 'timer', label: 'Timer', description: "Counts down on your display's clock", icon: 'timer' },
    { kind: 'reminder', label: 'Reminder', description: 'With or without a time', icon: 'check' },
    { kind: 'calendar', label: 'Calendar', description: 'Pick a day; it becomes a reminder', icon: 'calendar' },
    { kind: 'worldClock', label: 'World clock', description: 'Time in another city', icon: 'globe' },
    { kind: 'countdown', label: 'Countdown', description: 'Days until a date', icon: 'hourglass' },
    { kind: 'note', label: 'Note', description: 'A short message on your display', icon: 'note' },
  ];

  return (
    <div className="studio home-page" data-animation={reducedMotion ? 'off' : settings.appearance.animation}>
      <StudioHeader page="home" displayControls={displayControls} />
      <main className="home-main">
        <div className="home-columns">
          <div className="home-primary">
            <div className="home-heading">
              <h1 className="home-date"><span className="sr-only">Home · </span>{longDay(date)}</h1>
              <span className="home-time">{time}</span>
            </div>
            <WorldClockChips cities={settings.widgetData.worldClocks} minute={minute} clockFormat={settings.clockFormat} />
            <ScheduleStatus snapshot={state.schedule} presets={settings.savedPresets} setState={setState} reload={reload} />
            {settings.locationSource === 'fallback' && !firstRunDismissed && (
              <p className="home-first-run">
                <Icon name="location" size={15} />
                <span>Weather shows {settings.location.name} until you choose your city.</span>{' '}
                <a className="home-link" href="/settings?focus=city">Choose your city</a>
              </p>
            )}
            <div className="home-actions" role="group" aria-label="Quick actions">
              {actions.map(action => (
                <button key={action.kind} type="button" className="home-action" data-action={action.kind} aria-haspopup="dialog" aria-describedby={`home-action-${action.kind}`} onClick={open(action.kind)}>
                  <span className="home-action-icon"><Icon name={action.icon} size={22} /></span>
                  <span className="home-action-label">{action.label}</span>
                  <span className="home-action-description" id={`home-action-${action.kind}`} aria-hidden="true">{action.description}</span>
                </button>
              ))}
            </div>
            <TodayList context={context} groups={groups} timers={homeTimers} warning={warning} onDismissWarning={() => setDismissedWarning(state.timersWarning ?? null)} openAll={open('allReminders')} />
          </div>
          <DisplayCard state={state} showing={showing} waiting={waiting} waitingWithoutRoom={waitingWithoutRoom} disconnected={disconnected} displayControls={displayControls} />
        </div>
        <div className={`home-status ${status && !sheet ? 'shown' : ''} ${status?.tone === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {status && !sheet && renderStatus(status)}
          {!status && offline && <span className="home-status-text home-offline">Offline · showing saved reminders</span>}
        </div>
      </main>
      {sheet && <HomeSheet kind={sheet.kind} context={context} onClose={closeSheet} status={
        <div className={`home-status home-sheet-status ${status ? 'shown' : ''} ${status?.tone === 'error' ? 'error' : ''}`} role="status" aria-live="polite">{status && renderStatus(status)}</div>
      } />}
    </div>
  );
  function renderStatus(message: StatusMessage) {
    return <>
      <span className="home-status-text">{message.text}</span>
      {message.link && <a className="home-link" href={message.link.href}>{message.link.label}</a>}
      {message.undo && <button type="button" className="home-text-button" onClick={() => { const undo = message.undo!; announce(null); void undo(); }}><Icon name="undo" size={14} />Undo</button>}
      {message.retry && <button type="button" className="home-text-button" onClick={() => { const retry = message.retry!; announce(null); retry(); }}>Retry</button>}
      {message.tone === 'error' && <button type="button" className="home-icon-button" aria-label="Dismiss message" onClick={() => announce(null)}><Icon name="close" size={14} /></button>}
    </>;
  }
}

function WorldClockChips({ cities, minute, clockFormat }: { cities: Settings['widgetData']['worldClocks']; minute: number; clockFormat: Settings['clockFormat'] }) {
  const chips = useMemo(() => {
    const at = new Date(minute), local = localTimeZone();
    return cities.flatMap(city => {
      try {
        const { time, period } = timeParts(at, city.timezone, clockFormat);
        const offset = zoneOffsetMinutes(at, city.timezone) - zoneOffsetMinutes(at, local);
        return [{ id: city.id, label: city.label, time: period ? `${time} ${period}` : time, offset: offset === 0 ? 'same time' : offsetLabel(offset) }];
      } catch { return []; }
    });
  }, [cities, minute, clockFormat]);
  if (!chips.length) return null;
  return (
    <ul className="home-chips" aria-label="World clocks">
      {chips.map(chip => <li key={chip.id} className="home-chip"><span className="home-chip-label">{chip.label}</span> {chip.time} · {chip.offset}</li>)}
    </ul>
  );
}

function DisplayCard({ state, showing, waiting, waitingWithoutRoom, disconnected, displayControls }: { state: AppState; showing: WidgetId[]; waiting: WidgetId[]; waitingWithoutRoom: WidgetId[]; disconnected: boolean; displayControls: DisplayWindowControls }) {
  return (
    <aside className="home-card" aria-labelledby="home-card-title">
      <h2 id="home-card-title" className="home-card-title">On your display</h2>
      <div className="home-card-actions">
        <a className="button primary home-edit-display" href="/editor"><Icon name="edit" size={16} />Edit display</a>
        <a className="button home-open-display" href="/display" target={DISPLAY_WINDOW} onClick={displayControls.openDisplay}><Icon name="monitor" size={16} />{displayControls.displayOpen ? 'Show display' : 'Open display'}</a>
      </div>
      <SnapshotStatus disconnected={disconnected} clockFormat={state.settings.clockFormat} />
      <p className="home-card-showing">{showing.length ? <>Showing: {namesList([...showing].sort((a, b) => WIDGET_CATALOG[a].name.localeCompare(WIDGET_CATALOG[b].name, 'en')))}.</> : 'Nothing is shown on your display.'}</p>
      {waiting.length > 0 && (
        <p className="home-card-waiting">
          Not on your display: {namesList(waiting)}.{' '}
          {waitingWithoutRoom.length > 0 && <a className="home-link" href={makeRoomLink(waitingWithoutRoom[0]!).href}>Make room in Edit display</a>}
        </p>
      )}
    </aside>
  );
}

function SnapshotStatus({ disconnected, clockFormat }: { disconnected: boolean; clockFormat: Settings['clockFormat'] }) {
  const [snapshot, setSnapshot] = useState<{ available: boolean; capturedAt: string | null; pipeline?: { phase: string; writes: number; failures: number; capture: { phase: string; attempts: number; failures: number }; display: { paused: boolean; needsResume: boolean } } } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let stopped = false;
    const read = () => { if (!disconnected && document.visibilityState === 'visible') void api<NonNullable<typeof snapshot>>('/api/preview').then(value => { if (!stopped) setSnapshot(value); }).catch(() => {}); };
    read(); const timer = window.setInterval(read, 5_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [disconnected]);
  if (!snapshot?.pipeline) return null;
  const { pipeline } = snapshot;
  const resume = async () => {
    if (!window.confirm('Close every browser display first, then resume desktop snapshots?')) return;
    try {
      await api('/api/preview/display', { method: 'POST', headers: { 'X-LRD-Display': '1' }, body: JSON.stringify({ action: 'resume', confirmedAllClosed: true }) });
      setSnapshot(await api<NonNullable<typeof snapshot>>('/api/preview')); setMessage('Snapshots resumed.');
    } catch { setMessage('Could not resume snapshots. Try again.'); }
  };
  return <details className="home-card-waiting"><summary>Last screen</summary>
    <p>{snapshot.available && snapshot.capturedAt ? `Saved ${timeOfDay(new Date(snapshot.capturedAt), clockFormat)}` : 'No snapshot saved yet.'}</p>
    <p>Capture: {pipeline.capture.phase.replaceAll('-', ' ')} · {pipeline.capture.attempts} attempts · {pipeline.capture.failures} failed</p>
    <p>File: {pipeline.phase.replaceAll('-', ' ')} · {pipeline.writes} saved · {pipeline.failures} failed</p>
    {pipeline.display.paused && <p>Capture paused while a browser display is open.</p>}
    {pipeline.display.needsResume && <button type="button" className="button" onClick={() => { void resume(); }}>Resume snapshots</button>}
    {message && <p role="status">{message}</p>}
  </details>;
}

// Today -------------------------------------------------------------------------------------------

function TodayList({ context, groups, timers, warning, onDismissWarning, openAll }: {
  context: HomeContext; groups: ReturnType<typeof todayGroups>; timers: Timer[]; warning: string | null; onDismissWarning: () => void; openAll: (event: { currentTarget: HTMLElement }) => void;
}) {
  const { state, now } = context;
  const empty = !timers.length && !warning && !groups.due.length && !groups.anytime.length && !groups.comingUp.length;
  return (
    <section className="home-today" aria-labelledby="home-today-title">
      <h2 id="home-today-title" className="home-section-title">Today</h2>
      {empty && <p className="home-empty">Nothing on today. Start a timer or add a reminder.</p>}
      {(timers.length > 0 || warning) && (
        <TodayGroup title="Timers">
          {warning && <li className="home-row home-warning"><span>{warning}</span><button type="button" className="home-icon-button" aria-label="Dismiss timers message" onClick={onDismissWarning}><Icon name="close" size={14} /></button></li>}
          {timers.map(timer => <TimerRow key={timer.id} timer={timer} context={context} />)}
        </TodayGroup>
      )}
      {groups.due.length > 0 && (
        <TodayGroup title="Due today">
          {groups.due.map(reminder => <ReminderRow key={reminder.id} reminder={reminder} context={context} />)}
        </TodayGroup>
      )}
      {groups.anytime.length > 0 && (
        <TodayGroup title="Anytime">
          {groups.anytime.map(reminder => <ReminderRow key={reminder.id} reminder={reminder} context={context} />)}
          {groups.anytimeMore > 0 && <li className="home-more">+{groups.anytimeMore} more</li>}
        </TodayGroup>
      )}
      {groups.comingUp.length > 0 && (
        <TodayGroup title="Coming up">
          {groups.comingUp.map(item => item.reminder ? <ReminderRow key={item.id} reminder={item.reminder} context={context} /> : <CountdownRow key={item.id} item={item} now={now} />)}
        </TodayGroup>
      )}
      <button type="button" className="home-all-reminders" aria-haspopup="dialog" onClick={openAll}>
        All reminders · {state.reminders.filter(item => !item.completed).length}
        <Icon name="arrow" size={15} />
      </button>
    </section>
  );
}

function TodayGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = `home-group-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="home-group">
      <h3 id={id} className="home-group-title">{title}</h3>
      <ul className="home-rows" aria-labelledby={id}>{children}</ul>
    </div>
  );
}

function CountdownRow({ item, now }: { item: ComingUpItem; now: number }) {
  const date = parseCivil(item.day)!;
  const days = Math.round((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())) / 86_400_000);
  return (
    <li className="home-row">
      <span className="home-row-icon" aria-hidden="true"><Icon name="hourglass" size={16} /></span>
      <span className="home-row-copy"><span className="home-row-title">{item.title}</span><span className="home-row-detail">{days > 1 ? `In ${countdownLabel(days).text}` : countdownLabel(days).text} · {relativeDay(item.day, now)}</span></span>
    </li>
  );
}

/** A timer row: the digits tick in this row's own one-second interval, so the page does not re-render. */
function TimerRow({ timer, context }: { timer: Timer; context: HomeContext }) {
  const { settings, run, setState, announce, offline, focusLater } = context;
  const [now, setNow] = useState(() => Date.now());
  const phase = timerPhase(timer, now), name = timerName(timer), phrase = timerPhrase(timer), remaining = timerRemaining(timer, now);
  useEffect(() => {
    setNow(Date.now());
    if (timerPhase(timer, Date.now()) !== 'running') return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer]);
  const replace = (next: Timer) => setState(previous => previous ? { ...previous, timers: (previous.timers ?? []).map(item => item.id === next.id ? next : item) } : previous);
  const remove = (id: string) => setState(previous => previous ? { ...previous, timers: (previous.timers ?? []).filter(item => item.id !== id) } : previous);
  async function patch(body: object): Promise<Timer | undefined> {
    const next = await run(() => api<Timer>(`/api/timers/${timer.id}`, { method: 'PATCH', body: JSON.stringify(body) }), () => { void patch(body); });
    if (next) replace(next);
    return next;
  }
  async function cancel(word: 'cancelled' | 'dismissed') {
    const ok = await run(async () => { await api(`/api/timers/${timer.id}`, { method: 'DELETE' }); return true; }, () => { void cancel(word); });
    if (!ok) return;
    remove(timer.id);
    focusLater('.home-timer-row button', '.home-action[data-action="timer"]');
    announce({
      text: `${phrase} ${word}`.replace(/^./, letter => letter.toUpperCase()),
      undo: async () => {
        const input = { label: timer.label, durationMs: timer.durationMs, ...(timer.remainingMs !== null ? { remainingMs: timer.remainingMs } : { endsAt: timer.endsAt! }) };
        const restored = await run(() => api<Timer>('/api/timers', { method: 'POST', body: JSON.stringify(input) }));
        if (restored) {
          setState(previous => previous ? { ...previous, timers: [...(previous.timers ?? []), restored] } : previous);
          focusLater(`.home-timer-row[data-timer-id="${restored.id}"] button`);
        }
      },
    });
  }
  const ends = phase === 'running' ? timerEnds(Date.parse(timer.endsAt!), now, settings.clockFormat) : null;
  const minuteKey = Math.ceil(remaining / 60_000);
  return (
    <li className={`home-row home-timer-row phase-${phase}`} data-timer-id={timer.id} data-timer-phase={phase}>
      <span className="home-row-icon" aria-hidden="true"><Icon name="timer" size={16} /></span>
      <span className="home-row-copy">
        <span className="home-row-title">{name}</span>
        {phase === 'done' ? (
          <span className="home-row-detail overdue">Done · {doneAgo(now - timerDoneAt(timer, now)!)}</span>
        ) : (
          <span className="home-row-detail">
            <span className="home-timer-digits" aria-hidden="true">{timerDigits(remaining)}</span>
            <span className="sr-only" key={minuteKey}>{spokenTimeLeft(remaining)}</span>
            {phase === 'paused' ? ' · paused' : ` · ${ends}`}
          </span>
        )}
      </span>
      <span className="home-row-actions">
        {phase === 'done' ? (
          <>
            <button type="button" className="home-chip-button" aria-label={`Restart ${phrase}`} disabled={offline} onClick={() => { void patch({ restart: true }); }}><Icon name="refresh" size={15} /><span className="home-button-text">Restart</span></button>
            <button type="button" className="home-chip-button" aria-label={`Dismiss ${phrase}`} disabled={offline} onClick={() => { void cancel('dismissed'); }}><Icon name="close" size={15} /><span className="home-button-text">Dismiss</span></button>
          </>
        ) : (
          <>
            <button type="button" className="home-chip-button" aria-label={`${phase === 'paused' ? 'Resume' : 'Pause'} ${phrase}`} disabled={offline} onClick={() => { void patch({ paused: phase !== 'paused' }); }}>
              <Icon name={phase === 'paused' ? 'play' : 'pause'} size={15} /><span className="home-button-text">{phase === 'paused' ? 'Resume' : 'Pause'}</span>
            </button>
            <button type="button" className="home-chip-button" aria-label={`Add 1 minute to ${phrase}`} disabled={offline} onClick={() => { void patch({ addMs: 60_000 }); }}><span className="home-button-text home-plus">+1 min</span></button>
            <button type="button" className="home-chip-button" aria-label={`Cancel ${phrase}`} disabled={offline} onClick={() => { void cancel('cancelled'); }}><Icon name="close" size={15} /><span className="home-button-text">Cancel</span></button>
          </>
        )}
      </span>
    </li>
  );
}
