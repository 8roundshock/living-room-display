import type { Reminder, Settings } from '../shared/contracts.ts';
import { isOverdue, reminderCompletedAt } from '../shared/reminders.ts';

type ClockFormat = Settings['clockFormat'];

/** An untouched local date must not reinterpret an existing saved instant. */
export function reminderDuePatch(
  input: string,
  initialInput: string | undefined,
): { dueAt?: string | null } {
  if (initialInput !== undefined && input === initialInput) return {};
  return { dueAt: input ? new Date(input).toISOString() : null };
}

// Reminder labels use the computer timezone, like the reminder form's local date input.
function civilDays(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}
/** Calendar days from `now` to `date` in the computer timezone; daylight-saving days still count as one. */
function dayOffset(date: Date, now: Date): number {
  return civilDays(date) - civilDays(now);
}
function plain(text: string): string {
  // Some engines put a narrow no-break space before AM/PM; keep labels predictable.
  return text.replace(/[  ]/g, ' ');
}

/** Time of day in the user's 12/24-hour setting (#129). */
export function reminderTime(date: Date, format: ClockFormat): string {
  return plain(new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hourCycle: format === '24h' ? 'h23' : 'h12' }).format(date));
}

function relativeDay(date: Date, now: Date): string {
  const offset = dayOffset(date, now);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return new Intl.DateTimeFormat('en', date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export interface ReminderDue { overdue: boolean; when: string }

/** The due day and time, e.g. `Tomorrow · 9:00 AM`, with an overdue flag; null when undated or invalid. */
export function reminderDue(reminder: Pick<Reminder, 'completed' | 'dueAt' | 'createdAt' | 'updatedAt'>, now: Date, format: ClockFormat): ReminderDue | null {
  if (!reminder.dueAt) return null;
  const date = new Date(reminder.dueAt);
  if (!Number.isFinite(date.getTime())) return null;
  return { overdue: isOverdue(reminder, now.getTime()), when: `${relativeDay(date, now)} · ${reminderTime(date, format)}` };
}

/** The editor's due line: `Overdue · Yesterday · 3:00 PM`, `Today · 6:00 PM` or `Anytime`. */
export function reminderDueLabel(reminder: Pick<Reminder, 'completed' | 'dueAt' | 'createdAt' | 'updatedAt'>, now: Date, format: ClockFormat): string {
  const due = reminderDue({ ...reminder, completed: false }, now, format);
  if (!due) return 'Anytime';
  return due.overdue ? `Overdue · ${due.when}` : due.when;
}

/** History detail: `Completed 3:42 PM`, plus ` · was due Yesterday · 3:00 PM` for a dated reminder. */
export function reminderCompletedLabel(reminder: Reminder, now: Date, format: ClockFormat): string {
  const completedAt = reminderCompletedAt(reminder);
  const completed = completedAt ? `Completed ${reminderTime(new Date(completedAt), format)}` : 'Completed';
  const due = reminderDue(reminder, now, format);
  return due ? `${completed} · was due ${due.when}` : completed;
}

/** Groups history by completion day in the computer timezone. */
export function historyDayKey(completedAt: string): string {
  const date = new Date(completedAt);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** History group heading: TODAY, YESTERDAY, `Mon, Oct 12`, or `Oct 12, 2025` for another year. */
export function historyDayHeading(completedAt: string, now: Date): string {
  const date = new Date(completedAt);
  const offset = dayOffset(date, now);
  if (offset === 0) return 'TODAY';
  if (offset === -1) return 'YESTERDAY';
  return new Intl.DateTimeFormat('en', date.getFullYear() === now.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
