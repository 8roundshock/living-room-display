import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AppState, Reminder, Settings, WidgetId } from '../shared/contracts';
import { api } from './api';
import { Icon } from './icons';
import { reminderDue } from './reminder';

/** The completed row stays this long so the check registers before it leaves, as in the Reminders tab. */
export const SETTLE_MS = 900;

export interface StatusMessage {
  text: string;
  undo?: () => Promise<unknown> | void;
  link?: { href: string; label: string };
  retry?: () => void;
  tone?: 'error';
}

/** What every Home control needs: the state, the clock and the shared request handling (#438). */
export interface HomeContext {
  state: AppState;
  settings: Settings;
  now: number;
  offline: boolean;
  setState: Dispatch<SetStateAction<AppState | null>>;
  reload: () => Promise<void>;
  announce: (message: StatusMessage | null) => void;
  /** Runs one request; a failure is announced (with Retry for a lost connection) and returns undefined. */
  run: <T>(request: () => Promise<T>, retry?: () => void) => Promise<T | undefined>;
  /** Sends a settings reply (an item or show endpoint) into the state Home and its preview render. */
  applySettings: (settings: Settings) => void;
  /** Turns a widget on in free cells; reports a lack of room and returns false. */
  show: (id: WidgetId, saved?: string) => Promise<boolean>;
  /** Moves focus once React has rendered: the first match of `selector`, else of `fallback`. */
  focusLater: (selector: string, fallback?: string) => void;
}

/** "Make room in Edit display" opens the picker on this widget (#438). */
export function makeRoomLink(id: WidgetId): { href: string; label: string } {
  return { href: `/editor?add=${id}`, label: 'Make room in Edit display' };
}

/**
 * One reminder with one-tap check-off: the circle fills at once, the row settles for 0.9 s and leaves,
 * and focus moves to the next circle (else the previous one); Undo restores it.
 */
export function ReminderRow({ reminder, context }: { reminder: Reminder; context: HomeContext }) {
  const { now, settings, setState, run, announce, offline, focusLater } = context;
  const [checked, setChecked] = useState(false);
  const due = reminderDue(reminder, new Date(now), settings.clockFormat);
  const replace = (next: Reminder) => setState(previous => previous ? { ...previous, reminders: previous.reminders.map(item => item.id === next.id ? next : item) } : previous);
  async function check(button: HTMLElement) {
    if (checked) return;
    setChecked(true);
    const started = performance.now();
    const saved = await run(() => api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: true }) }), () => { void check(button); });
    if (!saved) { setChecked(false); return; }
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, SETTLE_MS - (performance.now() - started))));
    const list = button.closest('.home-today, .home-day-panel');
    const circles = list ? [...list.querySelectorAll<HTMLElement>('.home-check')] : [];
    const index = circles.indexOf(button), neighbour = circles[index + 1] ?? circles[index - 1];
    const focused = document.activeElement === button;
    replace(saved);
    if (focused) focusLater(neighbour ? `.home-check[data-reminder-id="${neighbour.dataset.reminderId}"]` : '.home-all-reminders', '.home-action[data-action="reminder"]');
    announce({
      text: `Checked off ${reminder.text}`,
      undo: async () => {
        const restored = await run(() => api<Reminder>(`/api/reminders/${reminder.id}`, { method: 'PATCH', body: JSON.stringify({ completed: false }) }));
        if (restored) { replace(restored); focusLater(`.home-check[data-reminder-id="${reminder.id}"]`); }
      },
    });
  }
  return (
    <li className={`home-row home-reminder ${checked ? 'checked' : ''}`}>
      <button type="button" className="home-check" data-reminder-id={reminder.id} aria-pressed={checked} aria-label={`Check off ${reminder.text}`} disabled={offline && !checked} onClick={event => { void check(event.currentTarget); }}>
        <Icon name="check" size={16} />
      </button>
      <span className="home-row-copy">
        <span className="home-row-title">{reminder.text}</span>
        <span className={`home-row-detail ${due?.overdue ? 'overdue' : ''}`}>{due ? `${due.overdue ? 'Overdue · ' : ''}${due.when}` : 'Anytime'}</span>
      </span>
    </li>
  );
}
