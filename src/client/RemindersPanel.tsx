import { Fragment, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { AppState, ClearCompletedResult, Reminder, Settings } from '../shared/contracts';
import { REMINDER_HISTORY_LIMIT, RESTORE_BEFORE_EDITING, historyReminders, pendingReminders, reminderCompletedAt } from '../shared/reminders';
import { api } from './api';
import { localInputDate } from './format';
import { Icon } from './icons';
import { historyDayHeading, historyDayKey, reminderCompletedLabel, reminderDueLabel, reminderDuePatch } from './reminder';

/** A completed row stays in Up next this long, so the check registers before it leaves. */
const SETTLE_MS = 900;
const COLLAPSE_MS = 240;
const UNDO_MS = 8000;
const HISTORY_PAGE = 50;

type View = 'upnext' | 'history';
interface Message { text: string; undo?: Reminder }
type Settling = Record<string, 'saving' | 'settled' | 'leaving'>;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Lines break only between label parts, never inside "6:00 PM". */
function Segments({ text }: { text: string }) {
  return <>{text.split(' · ').map((part, index) => <Fragment key={index}>{index ? ' · ' : ''}<span className="reminder-segment">{part}</span></Fragment>)}</>;
}

/**
 * The editor's Reminders tab. Every action saves immediately and independently of the settings
 * draft; the Up next order is the same `pendingReminders` order the display uses.
 */
export function RemindersPanel({
  state,
  setState,
  connectionError,
  clockFormat,
  onError,
}: {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState | null>>;
  connectionError: string | null;
  clockFormat: Settings['clockFormat'];
  onError: (message: string | null) => void;
}) {
  const [view, setView] = useState<View>('upnext');
  const [now, setNow] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState(''),
    [due, setDue] = useState('');
  const [initialDue, setInitialDue] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [settling, setSettling] = useState<Settling>({});
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [confirmClear, setConfirmClear] = useState(false),
    [clearing, setClearing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<number>());
  const undoTimer = useRef<number | undefined>(undefined);
  const settlingRef = useRef(settling);
  settlingRef.current = settling;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    const pending = timers.current;
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(undoTimer.current);
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);
  function later(callback: () => void, ms: number) {
    const id = window.setTimeout(() => { timers.current.delete(id); callback(); }, ms);
    timers.current.add(id);
  }
  function announce(next: Message | null) {
    window.clearTimeout(undoTimer.current);
    setMessage(next);
    // The Undo offer lasts about eight seconds, or until the next message replaces it.
    if (next?.undo) undoTimer.current = window.setTimeout(() => setMessage(current => current === next ? null : current), UNDO_MS);
  }
  function replace(received: Reminder) {
    setState(previous => previous ? { ...previous, reminders: previous.reminders.map(item => item.id === received.id ? received : item) } : previous);
  }
  function remove(ids: Set<string>) {
    setState(previous => previous ? { ...previous, reminders: previous.reminders.filter(item => !ids.has(item.id)) } : previous);
  }
  function setPhase(id: string, phase: Settling[string] | null) {
    setSettling(current => {
      const next = { ...current };
      if (phase) next[id] = phase; else delete next[id];
      return next;
    });
  }
  function focusAfter(selector: string, ids: string[], index: number, fallback: string) {
    // Next row, else the previous one, else a stable control, so keyboard users can keep going.
    const target = ids[index + 1] ?? ids[index - 1];
    window.requestAnimationFrame(() => {
      const root = panel.current;
      const element = (target && root?.querySelector<HTMLElement>(`${selector}[data-reminder-id="${target}"]`)) || root?.querySelector<HTMLElement>(fallback);
      element?.focus();
    });
  }
  async function refreshReminders() {
    try {
      const reminders = await api<Reminder[]>('/api/reminders');
      setState(previous => previous ? { ...previous, reminders } : previous);
    } catch { /* The regular state refresh retries. */ }
  }

  const upNext = pendingReminders(
    state.reminders.map(item => settling[item.id] && item.completed ? { ...item, completed: false } : item),
    now.getTime(),
  );
  const history = historyReminders(state.reminders);
  const pendingCount = state.reminders.filter(item => !item.completed).length;
  const completedCount = state.reminders.length - pendingCount;

  function startForm(reminder?: Reminder) {
    const dueInput = localInputDate(reminder?.dueAt);
    setEditingId(reminder?.id ?? null);
    setText(reminder?.text ?? '');
    setDue(dueInput);
    setInitialDue(reminder ? dueInput : undefined);
    setFormOpen(true);
    onError(null);
    announce(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    onError(null);
    try {
      const received = await api<Reminder>(editingId ? `/api/reminders/${editingId}` : '/api/reminders', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({ text: text.trim(), ...reminderDuePatch(due, initialDue) }),
      });
      setState(previous => previous ? {
        ...previous,
        reminders: editingId ? previous.reminders.map(item => item.id === received.id ? received : item) : [...previous.reminders, received],
      } : previous);
      setFormOpen(false);
      announce({ text: 'Reminder saved' });
    } catch (caught) {
      if (caught instanceof Error && caught.message === RESTORE_BEFORE_EDITING) {
        onError('This reminder was completed elsewhere. Restore it to edit.');
        void refreshReminders();
      } else onError(caught instanceof Error ? caught.message : 'Could not save reminder.');
    } finally {
      setSaving(false);
    }
  }
  async function complete(reminder: Reminder) {
    const phase = settlingRef.current[reminder.id];
    if (phase === 'saving') return;
    // Tapping the circle again during the settle restores the reminder.
    if (phase) { void restore(reminder); return; }
    const visible = upNext.filter(item => !settlingRef.current[item.id]).map(item => item.id);
    onError(null);
    setPhase(reminder.id, 'saving');
    focusAfter('.complete-button', visible, visible.indexOf(reminder.id), '.add-reminder');
    try {
      const received = await api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true }) });
      replace(received);
      setPhase(reminder.id, 'settled');
      announce({ text: `Completed “${reminder.text}”`, undo: received });
      later(() => {
        if (settlingRef.current[reminder.id] !== 'settled') return;
        if (reducedMotion()) { setPhase(reminder.id, null); return; }
        setPhase(reminder.id, 'leaving');
        later(() => { if (settlingRef.current[reminder.id] === 'leaving') setPhase(reminder.id, null); }, COLLAPSE_MS);
      }, SETTLE_MS);
    } catch {
      setPhase(reminder.id, null);
      onError('Could not complete reminder. It is still in Up next.');
    }
  }
  async function restore(reminder: Reminder, focus?: { ids: string[]; index: number }) {
    onError(null);
    try {
      const received = await api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: false }) });
      setPhase(reminder.id, null);
      replace(received);
      announce({ text: `Restored “${received.text}”` });
      if (focus) focusAfter('.history-check', focus.ids, focus.index, '.reminder-view[data-view="history"]');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not restore reminder.');
    }
  }
  async function deleteReminder(reminder: Reminder, ids: string[], selector: string, fallback: string) {
    onError(null);
    try {
      await api<void>(`/api/reminders/${reminder.id}`, { method: 'DELETE' });
      focusAfter(selector, ids, ids.indexOf(reminder.id), fallback);
      setPhase(reminder.id, null);
      remove(new Set([reminder.id]));
      announce({ text: reminder.completed ? 'Deleted from history' : 'Reminder deleted' });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not delete reminder.');
    }
  }
  async function clearHistory() {
    setClearing(true);
    onError(null);
    try {
      const result = await api<ClearCompletedResult>('/api/reminders/completed', { method: 'DELETE' });
      setState(previous => previous ? { ...previous, reminders: previous.reminders.filter(item => !item.completed) } : previous);
      setConfirmClear(false);
      setSettling({});
      announce({ text: `History cleared (${result.deleted})` });
      window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.reminder-view[data-view="history"]')?.focus());
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not clear history.');
    } finally {
      setClearing(false);
    }
  }

  const upNextIds = upNext.map(item => item.id);
  const shownHistory = history.slice(0, historyLimit);
  const historyIds = shownHistory.map(item => item.id);
  const groups: { key: string; heading: string; items: Reminder[] }[] = [];
  for (const item of shownHistory) {
    const completedAt = reminderCompletedAt(item) ?? item.updatedAt;
    const key = historyDayKey(completedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, heading: historyDayHeading(completedAt, now), items: [] });
    groups.at(-1)!.items.push(item);
  }

  return (
    <div className="reminders-panel" ref={panel}>
      <div className="panel-heading">
        <h2>Reminders</h2>
        <button className="icon-button add-reminder" aria-label="Add reminder" onClick={() => startForm()}>
          <Icon name="plus" size={20} />
        </button>
      </div>
      <p className="panel-subtitle">Saved immediately · always silent</p>
      <div className="reminder-views" role="group" aria-label="Reminder lists">
        {([['upnext', `Up next (${pendingCount})`], ['history', `History (${completedCount})`]] as const).map(([name, label]) => (
          <button
            key={name}
            className="reminder-view"
            data-view={name}
            aria-pressed={view === name}
            onClick={() => { setView(name); setConfirmClear(false); }}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'upnext' && (upNext.length ? (
        <ul className="reminder-list">
          {upNext.map(reminder => {
            const phase = settling[reminder.id];
            const dueLabel = reminderDueLabel(reminder, now, clockFormat);
            return (
              <li key={reminder.id} className={`editor-reminder-row ${phase === 'leaving' ? 'leaving' : ''}`}>
                <div className="editor-reminder">
                  <button
                    className={`complete-button ${phase ? 'done' : ''}`}
                    data-reminder-id={reminder.id}
                    aria-label={`Complete: ${reminder.text}`}
                    onClick={() => { void complete(state.reminders.find(item => item.id === reminder.id) ?? reminder); }}
                  >
                    <span>{phase && <Icon name="check" size={13} />}</span>
                  </button>
                  <div className={`reminder-copy ${phase ? 'done' : ''}`}>
                    <p>{reminder.text}</p>
                    <span className={dueLabel.startsWith('Overdue') && !phase ? 'overdue' : undefined}><Segments text={dueLabel} /></span>
                  </div>
                  <div className="reminder-actions">
                    <button className="icon-button" aria-label={`Edit: ${reminder.text}`} disabled={!!phase} onClick={() => startForm(reminder)}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete: ${reminder.text}`}
                      disabled={phase === 'saving'}
                      onClick={() => { void deleteReminder(state.reminders.find(item => item.id === reminder.id) ?? reminder, upNextIds, '.complete-button', '.add-reminder'); }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-reminders">
          <span><Icon name="check" size={24} /></span>
          <h3>{connectionError ? 'Reminders unavailable' : 'All clear'}</h3>
          <button className="text-button" onClick={() => startForm()}>Add a reminder</button>
        </div>
      ))}
      {view === 'history' && (history.length ? (
        <>
          {groups.map(group => (
            <section className="history-day" key={group.key} aria-label={group.heading}>
              <h3 className="history-heading">{group.heading}</h3>
              <ul className="reminder-list">
                {group.items.map(reminder => (
                  <li key={reminder.id} className="editor-reminder-row">
                    <div className="editor-reminder history-reminder">
                      <button
                        className="complete-button done history-check"
                        data-reminder-id={reminder.id}
                        aria-label={`Restore: ${reminder.text}`}
                        onClick={() => { void restore(reminder, { ids: historyIds, index: historyIds.indexOf(reminder.id) }); }}
                      >
                        <span><Icon name="check" size={13} /></span>
                      </button>
                      <div className="reminder-copy done">
                        <p>{reminder.text}</p>
                        <span><Segments text={reminderCompletedLabel(reminder, now, clockFormat)} /></span>
                      </div>
                      <div className="reminder-actions">
                        <button
                          className="icon-button"
                          aria-label={`Move back to Up next: ${reminder.text}`}
                          onClick={() => { void restore(reminder, { ids: historyIds, index: historyIds.indexOf(reminder.id) }); }}
                        >
                          <Icon name="undo" size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete: ${reminder.text}`}
                          onClick={() => { void deleteReminder(reminder, historyIds, '.history-check', '.reminder-view[data-view="history"]'); }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {history.length > shownHistory.length && (
            <button className="text-button history-more" onClick={() => setHistoryLimit(limit => limit + HISTORY_PAGE)}>
              Show {Math.min(HISTORY_PAGE, history.length - shownHistory.length)} more
            </button>
          )}
          {confirmClear ? (
            <div className="clear-history-confirm" role="group" aria-label="Clear history">
              <p>Delete {completedCount} completed reminders? This can’t be undone.</p>
              <div className="form-actions">
                <button className="button" disabled={clearing} onClick={() => setConfirmClear(false)}>Keep</button>
                <button className="button danger" disabled={clearing} onClick={() => { void clearHistory(); }}>
                  {clearing ? 'Deleting…' : 'Delete all'}
                </button>
              </div>
            </div>
          ) : (
            <button className="text-button clear-history" onClick={() => setConfirmClear(true)}>Clear history…</button>
          )}
        </>
      ) : (
        <div className="empty-reminders empty-history">
          <span><Icon name="check" size={24} /></span>
          <h3>No completed reminders yet</h3>
          <p>Check off a reminder and it moves here.</p>
        </div>
      ))}
      {view === 'history' && <p className="history-footnote">Kept on this computer · latest {REMINDER_HISTORY_LIMIT}</p>}
      {formOpen && (
        <form className="reminder-form" onSubmit={event => { void submit(event); }}>
          <label>
            <span className="field-label">Reminder</span>
            <input
              autoFocus
              className="text-input"
              required
              maxLength={240}
              value={text}
              placeholder="What’s on your mind?"
              onChange={event => setText(event.target.value)}
            />
          </label>
          <label>
            <span className="field-label">
              When <span className="muted">(optional · local time)</span>
            </span>
            <input className="text-input" type="datetime-local" value={due} onChange={event => setDue(event.target.value)} />
          </label>
          <div className="form-actions">
            <button type="button" className="button" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancel reminder
            </button>
            <button className="button primary" disabled={saving || !text.trim()}>
              {saving ? 'Saving…' : 'Save reminder'}
            </button>
          </div>
        </form>
      )}
      <p className="inline-message reminder-status" role="status">
        {message ? <>
          <span>{message.text}</span>
          {message.undo && (
            <button className="text-button reminder-undo" onClick={() => { const target = message.undo!; announce(null); void restore(target); }}>
              Undo
            </button>
          )}
        </> : ' '}
      </p>
    </div>
  );
}
