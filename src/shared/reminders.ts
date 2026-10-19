import type { Reminder } from './contracts.ts';

/** Total stored reminders, pending and completed. The previous release rejects more, so it must stay 1000 for rollback. */
export const REMINDER_LIMIT = 1000;
/** Completed reminders kept as history; a server retention rule, not a data field. */
export const REMINDER_HISTORY_LIMIT = 500;
/** Dated reminders due within this horizon lead the list; later ones follow the undated reminders. */
export const UPCOMING_HORIZON_MS = 7 * 86_400_000;
/** The 409 error for an edit of a completed reminder; the editor recognizes it. */
export const RESTORE_BEFORE_EDITING = 'Restore this reminder before editing it.';

type Item = Pick<Reminder, 'completed' | 'dueAt' | 'createdAt' | 'updatedAt'>;

function instant(value: string | null): number {
  return value ? Date.parse(value) : Number.NaN;
}

/** A completed reminder's completion time is its `updatedAt`; completed reminders are immutable except restore and delete. */
export function reminderCompletedAt(reminder: Item): string | null {
  return reminder.completed ? reminder.updatedAt : null;
}

/** Pending and due strictly before `now`. */
export function isOverdue(reminder: Item, now: number): boolean {
  const due = instant(reminder.dueAt);
  return !reminder.completed && Number.isFinite(due) && due < now;
}

function tier(due: number, now: number): 0 | 1 | 2 {
  if (!Number.isFinite(due)) return 1;
  return due <= now + UPCOMING_HORIZON_MS ? 0 : 2;
}

/**
 * Pending reminders in display order: (1) overdue or due within seven days, soonest first;
 * (2) undated, newest first; (3) dated later, soonest first. Ties fall back to creation time.
 * The editor's Up next list and the ambient widget share this order. Never mutates the input.
 */
export function pendingReminders<T extends Item>(reminders: readonly T[], now: number): T[] {
  return reminders
    .filter(reminder => !reminder.completed)
    .map(reminder => { const due = instant(reminder.dueAt); return { reminder, due, tier: tier(due, now) }; })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 1) return b.reminder.createdAt.localeCompare(a.reminder.createdAt);
      return a.due - b.due || a.reminder.createdAt.localeCompare(b.reminder.createdAt);
    })
    .map(entry => entry.reminder);
}

/** Completed reminders, most recently completed first. Never mutates the input. */
export function historyReminders<T extends Item>(reminders: readonly T[]): T[] {
  return reminders
    .filter(reminder => reminder.completed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

/** Removes the oldest completed reminders beyond `limit`, keeping the stored order; pending reminders are never touched. */
export function pruneHistory<T extends Item>(reminders: readonly T[], limit: number): T[] {
  const completed = historyReminders(reminders);
  if (completed.length <= limit) return [...reminders];
  const removed = new Set(completed.slice(Math.max(0, limit)));
  return reminders.filter(reminder => !removed.has(reminder));
}
