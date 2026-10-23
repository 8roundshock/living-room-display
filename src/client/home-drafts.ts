import { useState } from 'react';
import type { Settings } from '../shared/contracts';

const drafts: Record<string, unknown> = {}, draftBases: Record<string, unknown> = {};
/** Retain field values across Home dialog closes, without creating a dirty default. */
export function useHomeDraft<T>(key: string, initial: () => T): [T, (value: T, asDefault?: boolean) => void] {
  const [baseline] = useState<T>(() => key in draftBases ? draftBases[key] as T : initial());
  const [value, setValue] = useState<T>(() => key in drafts ? drafts[key] as T : baseline);
  return [value, (next, asDefault = false) => { if (asDefault || !(key in draftBases)) draftBases[key] = asDefault ? next : baseline; drafts[key] = next; setValue(next); }];
}
export function forgetHomeDrafts(...keys: string[]): void { for (const key of keys) { delete drafts[key]; delete draftBases[key]; } }
export function homeDraftPending(settings: Settings): boolean { return hasHomeDrafts(drafts, draftBases, settings.widgetData.note.text); }

/** Pending Home form choices live only in this document, so leaving must warn before losing them. */
export function hasHomeDrafts(values: Readonly<Record<string, unknown>>, bases: Readonly<Record<string, unknown>>, savedNote: string): boolean {
  const when = values['reminder.when'] ?? bases['reminder.when'] ?? 'today';
  const normalized = (key: string, value: unknown) => {
    if (/^timer\.(hours|minutes|seconds)$/.test(key)) return String(Number(String(value).trim()));
    return typeof value === 'string' ? value.trim() : JSON.stringify(value);
  };
  return Object.entries(values).some(([key, value]) => {
    if (key === 'note.text') return normalized(key, value) !== savedNote;
    if (key === 'calendar.selected' && !String(values['calendar.text'] ?? '').trim()) return false;
    if (!(key in bases)) return false;
    // Remembered custom fields do not make the currently selected simple choice dirty.
    if (key === 'reminder.day' && when !== 'date' || key === 'reminder.time' && when === 'anytime') return false;
    return normalized(key, value) !== normalized(key, bases[key]);
  });
}
