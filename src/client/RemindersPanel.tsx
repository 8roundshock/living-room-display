import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { AppState, ClearCompletedResult, Reminder, Settings } from '../shared/contracts';
import { REMINDER_HISTORY_LIMIT, historyReminders, pendingReminders, reminderCompletedAt } from '../shared/reminders';
import { ApiError, api } from './api';
import { localInputDate } from './format';
import { Icon } from './icons';
import { historyDayHeading, historyDayKey, reminderCompletedLabel, reminderDueLabel, reminderDuePatch } from './reminder';

/** A completed row stays in Up next this long, so the check registers before it leaves. */
const SETTLE_MS = 900;
const COLLAPSE_MS = 240;
/** Every status message, an Undo offer included, lasts about this long or until the next one replaces it (#295). */
const MESSAGE_MS = 8000;
const HISTORY_PAGE = 50;
/** Said when an action finds that another window already deleted the reminder (#355). */
const DELETED_ELSEWHERE = 'This reminder was deleted in another window.';

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
 * The status line with its Undo offer, every row that is still settling and the open add/edit form
 * live in this module rather than in component state. Switching editor tabs remounts the panel
 * (`key={section}` in Editor), so a check-off keeps settling, its Undo stays offered (#143) and an
 * open form keeps its typed text (#274) across the remount. Their timers belong here too and are
 * never cancelled by an unmount.
 */
interface Session { message: Message | null; settling: Settling }
let session: Session = { message: null, settling: {} };
const listeners = new Set<() => void>();
let messageTimer: number | undefined;
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
/** The Undo button, when it has keyboard focus. */
function undoHasFocus(): boolean {
  return document.activeElement instanceof HTMLElement && document.activeElement.matches('.reminders-panel .reminder-undo');
}
/**
 * A focused Undo that disappears (it expired, or a plain message replaced it) hands focus to the list
 * switch, else Add, rather than dropping it to the page (#297). An action that moves focus itself
 * (Undo focuses the restored circle) runs its own frame callback after this one and wins.
 */
function keepFocusInPanel() {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    const root = document.querySelector('.reminders-panel');
    (root?.querySelector<HTMLElement>('.reminder-view[aria-pressed="true"]') ?? root?.querySelector<HTMLElement>('.add-reminder'))?.focus();
  });
}
function announce(next: Message | null) {
  window.clearTimeout(messageTimer);
  const focused = undoHasFocus();
  publish({ message: next });
  // Another Undo reuses the same button, which keeps focus; anything else removes it.
  if (focused && !next?.undo) keepFocusInPanel();
  // Plain messages expire like the Undo offer, so a stale toast never stays over the list (#295).
  if (next) messageTimer = window.setTimeout(() => { if (session.message === next) announce(null); }, MESSAGE_MS);
}
function setPhase(id: string, phase: Settling[string] | null) {
  const settling = { ...session.settling };
  if (phase) settling[id] = phase; else delete settling[id];
  publish({ settling });
}

/** The open add or edit form (#274). `id` is the edited reminder, or null for a new one. */
interface FormDraft {
  id: string | null;
  text: string;
  due: string;
  /** What the form opened with: unsaved changes are measured against these. */
  initialText: string;
  initialDue: string;
  /** The edited reminder's saved due instant: "Save as a new reminder" keeps it exactly while the date is untouched (#355). */
  savedDueAt: string | null;
  dueProblem: boolean;
  saving: boolean;
  /** The field to focus when the form next mounts: set when it opens or moves, never for a tab switch. */
  focus: 'title' | 'due' | null;
  /** + or another Edit was pressed while this form had unsaved changes; it stays and says so. */
  kept: boolean;
}
let draft: FormDraft | null = null;
const formListeners = new Set<() => void>();
function subscribeForm(listener: () => void) {
  formListeners.add(listener);
  return () => { formListeners.delete(listener); };
}
function currentDraft(): FormDraft | null {
  return draft;
}
/** Which form is open, as a stable primitive: the panel re-renders when it changes, never per keystroke (#354). */
function currentFormKey(): string | null {
  return draft ? draft.id ?? '' : null;
}
function setDraft(next: FormDraft | null) {
  draft = next;
  for (const listener of formListeners) listener();
}
function updateDraft(change: Partial<FormDraft>) {
  if (draft) setDraft({ ...draft, ...change });
}
/**
 * True while an open reminder form holds typed text it has not saved: a new reminder with text, or an
 * edit whose text or date differs from what it opened with. Leaving the editor then asks first, like
 * unsaved settings (#274).
 */
export function reminderFormPending(): boolean {
  if (!draft || !draft.text.trim()) return false;
  return draft.text.trim() !== draft.initialText.trim() || draft.due !== draft.initialDue;
}

/** Focus moves within the mounted Reminders panel only; after a switch to another tab nothing is taken. */
function focusRow(selector: string, target: string | undefined, fallback: string, previousFocus?: Element | null) {
  window.requestAnimationFrame(() => {
    // A queued next-row handoff must not take focus back from a newer choice (#521).
    const active = document.activeElement;
    if (previousFocus && active !== previousFocus && active !== document.body && active?.isConnected) return;
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
  focusRow(selector, ids[index + 1] ?? ids[index - 1], fallback, document.activeElement);
}
/** Saving or discarding returns focus to that row's Edit button, or to Add after a new reminder (#230). */
function closeForm(focusId: string | null) {
  setDraft(null);
  focusRow('.edit-reminder', focusId ?? undefined, '.add-reminder');
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Lines break only between label parts, never inside "6:00 PM". */
function Segments({ text }: { text: string }) {
  return <>{text.split(' · ').map((part, index) => <Fragment key={index}>{index ? ' · ' : ''}<span className="reminder-segment">{part}</span></Fragment>)}</>;
}

type SetAppState = Dispatch<SetStateAction<AppState | null>>;
/** What the panel knows about the edited reminder: still pending, checked off elsewhere (#187) or deleted elsewhere (#355). */
type Target = 'pending' | 'checkedOff' | 'missing';

/**
 * The add/edit form. It subscribes to the form store itself, so typing re-renders only the form, never
 * the Up next list (#354), and its values survive a tab switch (#274).
 */
function ReminderForm({ target, setState, onError, refresh }: { target: Target; setState: SetAppState; onError: (message: string | null) => void; refresh: () => void }) {
  const value = useSyncExternalStore(subscribeForm, currentDraft);
  const form = useRef<HTMLFormElement>(null), titleField = useRef<HTMLInputElement>(null), dueField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A form that opens (or moves) takes focus; one shown again after a tab switch only comes into view.
    const field = draft?.focus;
    if (field) { updateDraft({ focus: null }); (field === 'due' ? dueField : titleField).current?.focus(); }
    // An incomplete date has no value to keep, so its message cannot outlive a remount either.
    if (draft?.dueProblem && !dueField.current?.validity.badInput) updateDraft({ dueProblem: false });
    form.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  // A form that moves while being typed in (its reminder left Up next) keeps the focused field (#274).
  useLayoutEffect(() => () => {
    const active = document.activeElement;
    if (active && form.current?.contains(active)) updateDraft({ focus: active === dueField.current ? 'due' : 'title' });
  }, []);
  if (!value) return null;
  const { id, text, due, dueProblem, saving } = value;
  const checkedOff = target === 'checkedOff', asNew = id !== null && target === 'missing';

  // Cleared while typing, never on blur: removing the message then would move Save away mid-click.
  function checkDue() {
    if (draft?.dueProblem && !dueField.current?.validity.badInput) updateDraft({ dueProblem: false });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const opened = draft;
    if (!opened || opened.saving) return;
    // The browser bubble is off (noValidate); an incomplete date gets the app's message and focus stays in the field (#258).
    if (dueField.current?.validity.badInput) {
      updateDraft({ dueProblem: true });
      dueField.current.focus();
      return;
    }
    const typed = opened.text.trim();
    if (!typed || checkedOff) return;
    const editing = opened.id !== null && !asNew;
    // "Save as a new reminder" keeps the saved due instant while the date is untouched (#355).
    const dueAt = opened.due === opened.initialDue && opened.savedDueAt ? opened.savedDueAt : opened.due ? new Date(opened.due).toISOString() : null;
    updateDraft({ saving: true });
    onError(null);
    try {
      const received = await api<Reminder>(editing ? `/api/reminders/${opened.id}` : '/api/reminders', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(asNew ? { text: typed, dueAt } : { text: typed, ...reminderDuePatch(opened.due, editing ? opened.initialDue : undefined) }),
      });
      setState(previous => previous ? {
        ...previous,
        reminders: editing ? previous.reminders.map(item => item.id === received.id ? received : item) : [...previous.reminders, received],
      } : previous);
      closeForm(opened.id === null ? null : received.id);
      announce({ text: asNew ? 'Saved as a new reminder' : 'Reminder saved' });
    } catch (caught) {
      if (draft?.id === opened.id) updateDraft({ saving: false });
      if (editing && caught instanceof ApiError && caught.status === 409) {
        onError('This reminder was completed elsewhere. Restore it to edit.');
        refresh();
      } else if (editing && caught instanceof ApiError && caught.status === 404) {
        // Deleted in another window: the row goes, the typed edit stays (the form moves to the top of Up
        // next, keeping focus in its title) and can be saved as new (#355).
        setState(previous => previous ? { ...previous, reminders: previous.reminders.filter(item => item.id !== opened.id) } : previous);
        onError(DELETED_ELSEWHERE);
        focusControl('.reminder-form .reminder-text');
        refresh();
      } else onError(caught instanceof Error ? caught.message : 'Could not save reminder.');
    }
  }
  const hint = checkedOff ? 'Checked off. Undo or restore it to edit.' : asNew ? DELETED_ELSEWHERE : value.kept ? 'Save or discard this reminder first.' : null;

  return (
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
          closeForm(id);
        }
      }}
    >
      <h3 className="reminder-form-title" id="reminder-form-title">{id ? 'Edit reminder' : 'New reminder'}</h3>
      <label>
        <span className="field-label">Reminder</span>
        <input
          ref={titleField}
          className="text-input reminder-text"
          required
          maxLength={240}
          value={text}
          placeholder="What’s on your mind?"
          onChange={event => updateDraft({ text: event.target.value, kept: false })}
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
          onChange={event => { updateDraft({ due: event.target.value, kept: false }); checkDue(); }}
          onKeyUp={checkDue}
        />
      </label>
      {dueProblem && (
        <p className="field-problem" id="reminder-due-problem" role="alert">
          Enter both a date and a time, or clear the field.
        </p>
      )}
      {hint && <p className="reminder-form-hint" id="reminder-form-hint">{hint}</p>}
      <div className="form-actions">
        <button type="button" className="button reminder-discard" disabled={saving} onClick={() => closeForm(id)}>
          Discard
        </button>
        <button className="button primary" disabled={saving || !text.trim() || checkedOff} aria-describedby={hint ? 'reminder-form-hint' : undefined}>
          {saving ? 'Saving…' : asNew ? 'Save as a new reminder' : 'Save reminder'}
        </button>
      </div>
    </form>
  );
}

interface RowActions {
  complete: (id: string) => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
}
/**
 * One Up next row. Memoized on the reminder, its label and phase (#354): a keystroke, a settle elsewhere
 * or a status message never re-renders the other rows.
 */
const UpNextRow = memo(function UpNextRow({ reminder, label, phase, actions }: { reminder: Reminder; label: string; phase: Settling[string] | undefined; actions: RowActions }) {
  // A restore in flight already shows the row unchecked.
  const done = phase !== undefined && phase !== 'restoring';
  return (
    <li className={`editor-reminder-row ${phase === 'leaving' ? 'leaving' : ''}`}>
      <div className="editor-reminder">
        <button
          className={`complete-button ${done ? 'done' : ''}`}
          data-reminder-id={reminder.id}
          aria-label={`Complete: ${reminder.text}`}
          // Pressed while the row settles: pressing again restores it (#186).
          aria-pressed={done}
          onClick={() => actions.complete(reminder.id)}
        >
          <span>{done && <Icon name="check" size={13} />}</span>
        </button>
        <div className={`reminder-copy ${done ? 'done' : ''}`}>
          <p>{reminder.text}</p>
          <span className={label.startsWith('Overdue') && !done ? 'overdue' : undefined}><Segments text={label} /></span>
        </div>
        <div className="reminder-actions">
          <button
            className="icon-button edit-reminder"
            data-reminder-id={reminder.id}
            aria-label={`Edit: ${reminder.text}`}
            disabled={!!phase}
            onClick={() => actions.edit(reminder.id)}
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Delete: ${reminder.text}`}
            disabled={phase === 'saving' || phase === 'restoring'}
            onClick={() => actions.remove(reminder.id)}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </li>
  );
});

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
  setState: SetAppState;
  connectionError: string | null;
  clockFormat: Settings['clockFormat'];
  onError: (message: string | null) => void;
}) {
  const [view, setView] = useState<View>('upnext');
  const [now, setNow] = useState(() => new Date());
  const { message, settling } = useSyncExternalStore(subscribe, current);
  const formKey = useSyncExternalStore(subscribeForm, currentFormKey);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [confirmClear, setConfirmClear] = useState(false),
    [clearing, setClearing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  // A focused row stays clear of the status line that now covers the panel's bottom edge (#228).
  useEffect(() => {
    const active = document.activeElement;
    if (message && active instanceof HTMLElement && panel.current?.contains(active) && !active.closest('.reminder-status')) active.scrollIntoView({ block: 'nearest' });
  }, [message]);
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
  /** Another window deleted the reminder (#355): its row goes, and the alert says so instead of a false or raw error. */
  function deletedElsewhere(id: string) {
    setPhase(id, null);
    remove(new Set([id]));
    onError(DELETED_ELSEWHERE);
    void refreshReminders();
  }

  // Order and labels change at most once a minute, and only with the list, the settling rows or the
  // clock format; typing in the form changes none of them (#354).
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const upNext = useMemo(() => pendingReminders(
    state.reminders.map(item => settling[item.id] && item.completed ? { ...item, completed: false } : item),
    minute,
  ), [state.reminders, settling, minute]);
  const labels = useMemo(() => new Map(upNext.map(item => [item.id, reminderDueLabel(item, new Date(minute), clockFormat)])), [upNext, minute, clockFormat]);
  const history = useMemo(() => historyReminders(state.reminders), [state.reminders]);
  const pendingCount = state.reminders.filter(item => !item.completed).length;
  const completedCount = state.reminders.length - pendingCount;
  const formOpen = formKey !== null, editingId = formKey || null;
  const editing = editingId === null ? undefined : state.reminders.find(item => item.id === editingId);
  // The edit form takes the place of its row (#236); a new reminder, or an edited one that has left
  // Up next, uses the form at the top of the list instead.
  const inlineEdit = formOpen && editingId !== null && upNext.some(item => item.id === editingId);
  // Rows that show a circle and actions; the row being edited shows its form instead.
  const rowIds = upNext.filter(item => !(inlineEdit && item.id === editingId)).map(item => item.id);
  // A reminder checked off while its edit is open cannot be saved until it is restored (#187); one
  // deleted in another window can be saved as a new reminder (#355).
  const target: Target = editingId === null ? 'pending' : !editing ? 'missing' : editing.completed ? 'checkedOff' : 'pending';

  function startForm(reminder?: Reminder) {
    setView('upnext');
    setConfirmClear(false);
    onError(null);
    // An Undo offer outlives opening a form; only a plain status message clears.
    if (!session.message?.undo) announce(null);
    // An open form with unsaved typing is never replaced (#274): it stays, comes into view and says so.
    const same = draft !== null && draft.id === (reminder?.id ?? null);
    if (draft && (same || reminderFormPending())) {
      updateDraft({ kept: !same });
      focusControl('.reminder-form .reminder-text');
      return;
    }
    const dueInput = localInputDate(reminder?.dueAt);
    setDraft({
      id: reminder?.id ?? null,
      text: reminder?.text ?? '',
      due: dueInput,
      initialText: reminder?.text ?? '',
      initialDue: dueInput,
      savedDueAt: reminder?.dueAt ?? null,
      dueProblem: false,
      saving: false,
      focus: 'title',
      kept: false,
    });
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
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) { deletedElsewhere(reminder.id); return; }
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
      if (caught instanceof ApiError && caught.status === 404) {
        // Nothing is left to restore, so an Undo offer for it goes too.
        if (session.message?.undo?.reminder.id === reminder.id) announce(null);
        else if (focus && focus !== 'restored') focusAfter('.history-check', focus.ids, focus.index, '.reminder-view[data-view="history"]');
        deletedElsewhere(reminder.id);
        return;
      }
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
      if (caught instanceof ApiError && caught.status === 404) {
        // Already gone: the row leaves as it would have, with the honest reason and no Undo (#355).
        focusAfter(selector, ids, ids.indexOf(reminder.id), fallback);
        deletedElsewhere(reminder.id);
        return;
      }
      onError(caught instanceof Error ? caught.message : 'Could not delete reminder.');
    }
  }
  async function undo(target: Undo) {
    if (target.kind === 'complete') { await restore(target.reminder, 'restored'); return; }
    if (recreating.has(target)) return;
    recreating.add(target);
    onError(null);
    const { text: deletedText, dueAt, createdAt } = target.reminder;
    // The exact due string and the original creation time return it to its sorted place. A creation time
    // later than now (the clock was set back, or the data came from a computer whose clock ran ahead) is
    // left out, so the server stamps its own and the reminder still returns, perhaps a place away (#296).
    const recreate = (withCreated: boolean) => api<Reminder>('/api/reminders', { method: 'POST', body: JSON.stringify(withCreated ? { text: deletedText, dueAt, createdAt } : { text: deletedText, dueAt }) });
    const keepCreated = Date.parse(createdAt) <= Date.now();
    try {
      let received: Reminder;
      try {
        received = await recreate(keepCreated);
      } catch (caught) {
        // The server's clock may still be behind this browser's: try once more without it.
        if (!(keepCreated && caught instanceof ApiError && caught.status === 400)) throw caught;
        received = await recreate(false);
      }
      setState(previous => previous ? { ...previous, reminders: [...previous.reminders, received] } : previous);
      announce({ text: `Restored “${received.text}”` });
      focusRow('.complete-button', received.id, '.reminder-view[data-view="upnext"]');
    } catch (caught) {
      // The Undo offer stays (and keeps focus) for a retry. A rejected request never shows its schema text.
      onError(caught instanceof ApiError && caught.status === 400 ? 'Could not restore reminder.' : caught instanceof Error ? caught.message : 'Could not restore reminder.');
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

  // Row callbacks read the latest render through a ref, so the memoized rows keep one stable object.
  const latest = useRef({ complete, startForm, deleteReminder, state, rowIds });
  latest.current = { complete, startForm, deleteReminder, state, rowIds };
  const actions = useMemo<RowActions>(() => {
    const find = (id: string) => latest.current.state.reminders.find(item => item.id === id);
    return {
      complete: id => { const reminder = find(id); if (reminder) void latest.current.complete(reminder); },
      edit: id => { const reminder = find(id); if (reminder) latest.current.startForm(reminder); },
      remove: id => { const reminder = find(id); if (reminder) void latest.current.deleteReminder(reminder, 'upnext', latest.current.rowIds); },
    };
  }, []);

  const shownHistory = history.slice(0, historyLimit);
  const historyIds = shownHistory.map(item => item.id);
  const groups: { key: string; heading: string; items: Reminder[] }[] = [];
  for (const item of shownHistory) {
    const completedAt = reminderCompletedAt(item) ?? item.updatedAt;
    const key = historyDayKey(completedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, heading: historyDayHeading(completedAt, now), items: [] });
    groups.at(-1)!.items.push(item);
  }

  const reminderForm = formOpen && <ReminderForm key={formKey} target={target} setState={setState} onError={onError} refresh={() => { void refreshReminders(); }} />;

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
          {upNext.map(reminder => inlineEdit && reminder.id === editingId
            ? <li key={reminder.id} className="editor-reminder-row editing">{reminderForm}</li>
            : <UpNextRow key={reminder.id} reminder={reminder} label={labels.get(reminder.id) ?? 'Anytime'} phase={settling[reminder.id]} actions={actions} />)}
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
      {/* With a message, sticky at the bottom of the visible panel so it and its Undo stay in view (#228). */}
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
