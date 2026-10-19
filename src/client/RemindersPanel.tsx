import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type FormEvent, type SetStateAction } from 'react';
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
/** Undo puts back a check-off (restore) or a single delete from Up next (re-create, #237). */
interface Undo { kind: 'complete' | 'delete'; reminder: Reminder }
interface Message { text: string; undo?: Undo }
/**
 * A checked row stays in Up next through these phases: `saving` (PATCH in flight), `settled`
 * (saved, waiting out the settle), `leaving` (collapsing) and `restoring` (a restore PATCH in
 * flight; the settle timers leave the row alone until it returns).
 */
type Settling = Record<string, 'saving' | 'settled' | 'leaving' | 'restoring'>;

/*
 * The status line with its Undo offer, and every row that is still settling, live in this module
 * rather than in component state. Switching editor tabs remounts the panel (`key={section}` in
 * Editor), so a check-off keeps settling and its Undo stays offered across the remount (#143).
 * Their timers belong here too and are never cancelled by an unmount.
 */
interface Session { message: Message | null; settling: Settling }
let session: Session = { message: null, settling: {} };
const listeners = new Set<() => void>();
let undoTimer: number | undefined;
/** Check-off generations: timers from an earlier check-off of the same reminder stand down. */
const completions = new Map<string, number>();
/** Delete Undos whose re-create is in flight; another press of the same Undo is ignored. */
const recreating = new Set<Undo>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function current(): Session {
  return session;
}
function publish(change: Partial<Session>) {
  session = { ...session, ...change };
  for (const listener of listeners) listener();
}
function announce(next: Message | null) {
  window.clearTimeout(undoTimer);
  publish({ message: next });
  // The Undo offer lasts about eight seconds, or until the next message replaces it.
  if (next?.undo) undoTimer = window.setTimeout(() => { if (session.message === next) publish({ message: null }); }, UNDO_MS);
}
function setPhase(id: string, phase: Settling[string] | null) {
  const settling = { ...session.settling };
  if (phase) settling[id] = phase; else delete settling[id];
  publish({ settling });
}
/** Focus moves within the mounted Reminders panel only; after a switch to another tab nothing is taken. */
function focusRow(selector: string, target: string | undefined, fallback: string) {
  window.requestAnimationFrame(() => {
    const root = document.querySelector('.reminders-panel');
    const element = (target && root?.querySelector<HTMLElement>(`${selector}[data-reminder-id="${target}"]`)) || root?.querySelector<HTMLElement>(fallback);
    element?.focus();
  });
}
/** A control that replaces or follows the one that had focus. */
function focusControl(selector: string) {
  focusRow(selector, undefined, selector);
}
function focusAfter(selector: string, ids: string[], index: number, fallback: string) {
  // Next row, else the previous one, else a stable control, so keyboard users can keep going.
  focusRow(selector, ids[index + 1] ?? ids[index - 1], fallback);
}

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
  const [dueProblem, setDueProblem] = useState(false);
  const [saving, setSaving] = useState(false);
  const { message, settling } = useSyncExternalStore(subscribe, current);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [confirmClear, setConfirmClear] = useState(false),
    [clearing, setClearing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const dueField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // A focused row stays clear of the status line that now covers the panel's bottom edge (#228).
  useEffect(() => {
    const active = document.activeElement;
    if (message && active instanceof HTMLElement && panel.current?.contains(active) && !active.closest('.reminder-status')) active.scrollIntoView({ block: 'nearest' });
  }, [message]);
  // An opened form, and the row it edits, scroll fully into view (#236).
  useEffect(() => {
    if (formOpen) form.current?.scrollIntoView({ block: 'nearest' });
  }, [formOpen, editingId]);
  function replace(received: Reminder) {
    setState(previous => previous ? { ...previous, reminders: previous.reminders.map(item => item.id === received.id ? received : item) } : previous);
  }
  function remove(ids: Set<string>) {
    setState(previous => previous ? { ...previous, reminders: previous.reminders.filter(item => !ids.has(item.id)) } : previous);
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
  // The edit form takes the place of its row (#236); a new reminder, or an edited one that has left
  // Up next, uses the form at the top of the list instead.
  const inlineEdit = formOpen && editingId !== null && upNext.some(item => item.id === editingId);
  // Rows that show a circle and actions; the row being edited shows its form instead.
  const rowIds = upNext.filter(item => !(inlineEdit && item.id === editingId)).map(item => item.id);
  // A reminder checked off while its edit is open cannot be saved until it is restored (#187).
  const checkedOff = formOpen && editingId !== null && state.reminders.some(item => item.id === editingId && item.completed);

  function startForm(reminder?: Reminder) {
    const dueInput = localInputDate(reminder?.dueAt);
    setEditingId(reminder?.id ?? null);
    setText(reminder?.text ?? '');
    setDue(dueInput);
    setInitialDue(reminder ? dueInput : undefined);
    setDueProblem(false);
    setFormOpen(true);
    // The form always opens in Up next, where it is visible.
    setView('upnext');
    setConfirmClear(false);
    onError(null);
    // An Undo offer outlives opening a form; only a plain status message clears.
    if (!session.message?.undo) announce(null);
  }
  /** Saving or discarding returns focus to that row's Edit button, or to Add after a new reminder (#230). */
  function closeForm() {
    setFormOpen(false);
    setDueProblem(false);
    focusRow('.edit-reminder', editingId ?? undefined, '.add-reminder');
  }
  // Cleared while typing, never on blur: removing the message then would move Save away mid-click.
  function checkDue() {
    if (dueProblem && !dueField.current?.validity.badInput) setDueProblem(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    // The browser bubble is off (noValidate); an incomplete date gets the app's message and focus stays in the field (#258).
    if (dueField.current?.validity.badInput) {
      setDueProblem(true);
      dueField.current.focus();
      return;
    }
    if (!text.trim() || checkedOff) return;
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
      closeForm();
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
    const phase = session.settling[reminder.id];
    if (phase === 'saving' || phase === 'restoring') return;
    // Tapping the circle again during the settle restores the reminder.
    if (phase) { void restore(reminder); return; }
    const visible = rowIds.filter(id => !session.settling[id]);
    // Timers from an earlier check-off of the same reminder (restored, then checked again) stand down.
    const generation = (completions.get(reminder.id) ?? 0) + 1;
    completions.set(reminder.id, generation);
    const still = (phase: Settling[string]) => session.settling[reminder.id] === phase && completions.get(reminder.id) === generation;
    onError(null);
    setPhase(reminder.id, 'saving');
    focusAfter('.complete-button', visible, visible.indexOf(reminder.id), '.add-reminder');
    try {
      const received = await api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true }) });
      replace(received);
      setPhase(reminder.id, 'settled');
      announce({ text: `Completed “${reminder.text}”`, undo: { kind: 'complete', reminder: received } });
      window.setTimeout(() => {
        if (!still('settled')) return;
        if (reducedMotion()) { setPhase(reminder.id, null); return; }
        setPhase(reminder.id, 'leaving');
        window.setTimeout(() => { if (still('leaving')) setPhase(reminder.id, null); }, COLLAPSE_MS);
      }, SETTLE_MS);
    } catch {
      setPhase(reminder.id, null);
      onError('Could not complete reminder. It is still in Up next.');
    }
  }
  /**
   * `focus` names where keyboard focus goes afterwards: the next History row after a History
   * restore, or the restored reminder's own circle after Undo (whose button unmounts).
   */
  async function restore(reminder: Reminder, focus?: { ids: string[]; index: number } | 'restored') {
    if (session.settling[reminder.id] === 'restoring') return;
    onError(null);
    // The row shows unchecked in Up next at once, and the settle timers leave it alone meanwhile.
    setPhase(reminder.id, 'restoring');
    try {
      const received = await api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: false }) });
      setPhase(reminder.id, null);
      replace(received);
      announce({ text: `Restored “${received.text}”` });
      if (focus === 'restored') focusRow('.complete-button', received.id, '.reminder-view[data-view="upnext"]');
      else if (focus) focusAfter('.history-check', focus.ids, focus.index, '.reminder-view[data-view="history"]');
    } catch (caught) {
      // Still completed, so it leaves Up next; an Undo offer stays (and keeps focus) for a retry.
      setPhase(reminder.id, null);
      onError(caught instanceof Error ? caught.message : 'Could not restore reminder.');
    }
  }
  async function deleteReminder(reminder: Reminder, list: View, ids: string[]) {
    const [selector, fallback] = list === 'history' ? ['.history-check', '.reminder-view[data-view="history"]'] : ['.complete-button', '.add-reminder'];
    onError(null);
    try {
      await api<void>(`/api/reminders/${reminder.id}`, { method: 'DELETE' });
      focusAfter(selector, ids, ids.indexOf(reminder.id), fallback);
      setPhase(reminder.id, null);
      remove(new Set([reminder.id]));
      // A row deleted while it settles in Up next was deleted from Up next, not from History.
      // Only a pending reminder deleted from Up next can be put back (#237).
      announce(list === 'history'
        ? { text: 'Deleted from history' }
        : { text: 'Reminder deleted', undo: reminder.completed ? undefined : { kind: 'delete', reminder } });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not delete reminder.');
    }
  }
  async function undo(target: Undo) {
    if (target.kind === 'complete') { await restore(target.reminder, 'restored'); return; }
    if (recreating.has(target)) return;
    recreating.add(target);
    onError(null);
    const { text: deletedText, dueAt, createdAt } = target.reminder;
    try {
      // The exact due string and the original creation time return it to its sorted place.
      const received = await api<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify({ text: deletedText, dueAt, createdAt }) });
      setState(previous => previous ? { ...previous, reminders: [...previous.reminders, received] } : previous);
      announce({ text: `Restored “${received.text}”` });
      focusRow('.complete-button', received.id, '.reminder-view[data-view="upnext"]');
    } catch (caught) {
      // The Undo offer stays (and keeps focus) for a retry.
      onError(caught instanceof Error ? caught.message : 'Could not restore reminder.');
    } finally {
      recreating.delete(target);
    }
  }
  function openClearConfirm() {
    setConfirmClear(true);
    focusControl('.clear-keep');
  }
  function keepHistory() {
    setConfirmClear(false);
    focusControl('.clear-history');
  }
  async function clearHistory() {
    setClearing(true);
    onError(null);
    try {
      const result = await api<ClearCompletedResult>('/api/reminders/completed', { method: 'DELETE' });
      setState(previous => previous ? { ...previous, reminders: previous.reminders.filter(item => !item.completed) } : previous);
      setConfirmClear(false);
      publish({ settling: {} });
      announce({ text: `History cleared (${result.deleted})` });
      focusControl('.reminder-view[data-view="history"]');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not clear history.');
    } finally {
      setClearing(false);
    }
  }

  const shownHistory = history.slice(0, historyLimit);
  const historyIds = shownHistory.map(item => item.id);
  const groups: { key: string; heading: string; items: Reminder[] }[] = [];
  for (const item of shownHistory) {
    const completedAt = reminderCompletedAt(item) ?? item.updatedAt;
    const key = historyDayKey(completedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, heading: historyDayHeading(completedAt, now), items: [] });
    groups.at(-1)!.items.push(item);
  }

  const reminderForm = formOpen && (
    <form
      ref={form}
      className="reminder-form"
      noValidate
      aria-labelledby="reminder-form-title"
      onSubmit={event => { void submit(event); }}
      onKeyDown={event => {
        // Escape closes the form only; focus returns to the row's Edit button or to Add.
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          event.stopPropagation();
          closeForm();
        }
      }}
    >
      <h3 className="reminder-form-title" id="reminder-form-title">{editingId ? 'Edit reminder' : 'New reminder'}</h3>
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
        <input
          ref={dueField}
          className="text-input"
          type="datetime-local"
          value={due}
          aria-invalid={dueProblem || undefined}
          aria-describedby={dueProblem ? 'reminder-due-problem' : undefined}
          onChange={event => { setDue(event.target.value); checkDue(); }}
          onKeyUp={checkDue}
        />
      </label>
      {dueProblem && (
        <p className="field-problem" id="reminder-due-problem" role="alert">
          Enter both a date and a time, or clear the field.
        </p>
      )}
      {checkedOff && <p className="reminder-form-hint" id="reminder-form-hint">Checked off. Undo or restore it to edit.</p>}
      <div className="form-actions">
        <button type="button" className="button reminder-discard" disabled={saving} onClick={closeForm}>
          Discard
        </button>
        <button className="button primary" disabled={saving || !text.trim() || checkedOff} aria-describedby={checkedOff ? 'reminder-form-hint' : undefined}>
          {saving ? 'Saving…' : 'Save reminder'}
        </button>
      </div>
    </form>
  );

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
      {view === 'upnext' && !inlineEdit && reminderForm}
      {view === 'upnext' && (upNext.length ? (
        <ul className="reminder-list">
          {upNext.map(reminder => {
            if (inlineEdit && reminder.id === editingId) {
              return <li key={reminder.id} className="editor-reminder-row editing">{reminderForm}</li>;
            }
            const phase = settling[reminder.id];
            // A restore in flight already shows the row unchecked.
            const done = phase !== undefined && phase !== 'restoring';
            const dueLabel = reminderDueLabel(reminder, now, clockFormat);
            return (
              <li key={reminder.id} className={`editor-reminder-row ${phase === 'leaving' ? 'leaving' : ''}`}>
                <div className="editor-reminder">
                  <button
                    className={`complete-button ${done ? 'done' : ''}`}
                    data-reminder-id={reminder.id}
                    aria-label={`Complete: ${reminder.text}`}
                    // Pressed while the row settles: pressing again restores it (#186).
                    aria-pressed={done}
                    onClick={() => { void complete(state.reminders.find(item => item.id === reminder.id) ?? reminder); }}
                  >
                    <span>{done && <Icon name="check" size={13} />}</span>
                  </button>
                  <div className={`reminder-copy ${done ? 'done' : ''}`}>
                    <p>{reminder.text}</p>
                    <span className={dueLabel.startsWith('Overdue') && !done ? 'overdue' : undefined}><Segments text={dueLabel} /></span>
                  </div>
                  <div className="reminder-actions">
                    <button
                      className="icon-button edit-reminder"
                      data-reminder-id={reminder.id}
                      aria-label={`Edit: ${reminder.text}`}
                      disabled={!!phase}
                      onClick={() => startForm(reminder)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete: ${reminder.text}`}
                      disabled={phase === 'saving' || phase === 'restoring'}
                      onClick={() => { void deleteReminder(state.reminders.find(item => item.id === reminder.id) ?? reminder, 'upnext', rowIds); }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : !formOpen && (
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
                          onClick={() => { void deleteReminder(reminder, 'history', historyIds); }}
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
            <div
              className="clear-history-confirm"
              role="group"
              aria-label="Clear history"
              onKeyDown={event => { if (event.key === 'Escape' && !clearing) { event.preventDefault(); keepHistory(); } }}
            >
              <p>Delete {completedCount} completed {completedCount === 1 ? 'reminder' : 'reminders'}? This can’t be undone.</p>
              <div className="form-actions">
                <button className="button clear-keep" disabled={clearing} onClick={keepHistory}>Keep</button>
                <button className="button danger" disabled={clearing} onClick={() => { void clearHistory(); }}>
                  {clearing ? 'Deleting…' : 'Delete all'}
                </button>
              </div>
            </div>
          ) : (
            <button className="text-button clear-history" onClick={openClearConfirm}>Clear history…</button>
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
      {/* Sticky at the bottom of the visible panel, so the message and its Undo stay in view (#228). */}
      <p className={`inline-message reminder-status ${message ? 'has-message' : ''}`} role="status">
        {message ? <>
          <span>{message.text}</span>
          {message.undo && (
            <button className="text-button reminder-undo" onClick={() => { void undo(message.undo!); }}>
              Undo
            </button>
          )}
        </> : ' '}
      </p>
    </div>
  );
}
