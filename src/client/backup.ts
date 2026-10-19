import type { Reminder, Settings } from '../shared/contracts.ts';

/**
 * Restore from backup (#234): a quick client-side check of an export before the server's strict
 * `POST /api/import` validation, and the summary the editor shows before asking to confirm.
 */
export interface BackupFile {
  version: 1;
  exportedAt: string;
  settings: Settings;
  reminders: Reminder[];
}

/** The server reads at most 4 MiB of JSON (src/server/app.ts). */
export const BACKUP_MAX_BYTES = 4 * 1024 * 1024;

export class BackupError extends Error {}

const NOT_A_BACKUP = "That file isn't a backup. Choose one made with Export saved data.";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parses an export, or throws a BackupError with a message for the editor's status line. */
export function parseBackup(text: string): BackupFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  if (!record(value) || !('settings' in value) || !('reminders' in value)) throw new BackupError(NOT_A_BACKUP);
  if (typeof value.version === 'number' && value.version > 1)
    throw new BackupError('This backup comes from a newer version of the app. Update the app, then restore it.');
  const { settings, reminders, exportedAt } = value;
  if (
    value.version !== 1 ||
    typeof exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(exportedAt)) ||
    !record(settings) ||
    !record(settings.appearance) ||
    !record(settings.location) ||
    typeof settings.location.name !== 'string' ||
    !Array.isArray(reminders) ||
    !reminders.every((item) => record(item) && typeof item.text === 'string' && typeof item.completed === 'boolean')
  )
    throw new BackupError(NOT_A_BACKUP);
  return value as unknown as BackupFile;
}

function count(value: number, one: string, many: string): string {
  return value === 0 ? `no ${many}` : `${value} ${value === 1 ? one : many}`;
}

/** What a backup holds, for example "3 reminders (1 completed) and 2 saved styles". */
export function backupContents(backup: BackupFile): string {
  const completed = backup.reminders.filter((item) => item.completed).length;
  const reminders = `${count(backup.reminders.length, 'reminder', 'reminders')}${completed ? ` (${completed} completed)` : ''}`;
  const styles = count(Array.isArray(backup.settings.savedPresets) ? backup.settings.savedPresets.length : 0, 'saved style', 'saved styles');
  return `${reminders} and ${styles}`;
}

/** When the backup was made, in this computer's time zone and the chosen time format (English, like the rest of the editor). */
export function backupDate(backup: BackupFile, clockFormat: Settings['clockFormat'], timeZone?: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', hourCycle: clockFormat === '24h' ? 'h23' : 'h12', timeZone }).format(
    new Date(backup.exportedAt),
  );
}
