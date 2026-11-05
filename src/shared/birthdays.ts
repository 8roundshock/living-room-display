/** Private annual content, deliberately separate from saved visual styles. */
export const BIRTHDAY_TREATMENTS = ['classic', 'russian', 'korean'] as const;
export type BirthdayTreatment = typeof BIRTHDAY_TREATMENTS[number];
export interface BirthdayEntry { id: string; name: string; date: string; treatment: BirthdayTreatment }
export const BIRTHDAY_LIMIT = 24;
export const BIRTHDAY_LABELS: Record<BirthdayTreatment, string> = {
  classic: 'Classic', russian: 'Russian accents', korean: 'Korean accents',
};
export function validBirthdayDate(value: string): boolean {
  if (value.length !== 5 || !/^\d{2}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(0, 2)), day = Number(value.slice(3));
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
/** Exact civil day only, including February 29. Coincident mixed treatments share Classic. */
export function birthdayTreatmentForDate(entries: readonly BirthdayEntry[], civilDate: string): BirthdayTreatment | null {
  if (civilDate.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) return null;
  const instant = Date.parse(`${civilDate}T12:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== civilDate) return null;
  const matches = entries.filter(entry => entry.date === civilDate.slice(5));
  if (!matches.length) return null;
  return matches.every(entry => entry.treatment === matches[0]!.treatment) ? matches[0]!.treatment : 'classic';
}
export function birthdayProblem(entries: readonly BirthdayEntry[]): string | null {
  if (entries.length > BIRTHDAY_LIMIT) return `Up to ${BIRTHDAY_LIMIT} birthdays · remove one to save`;
  if (entries.some(entry => !entry.name.trim() || entry.name.trim().length > 60)) return 'Give each birthday a name of 1–60 characters.';
  if (entries.some(entry => !validBirthdayDate(entry.date))) return 'Choose a valid month and day for each birthday.';
  return null;
}
