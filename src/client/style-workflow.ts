import type { SavedPreset, Settings, VisualSettings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { same, sameEffectiveSettings } from './draft.ts';
import { duplicateStyleName, getVisual, MAX_SAVED_STYLES } from './model.ts';

export type StyleSaveIntent =
  | { kind: 'current' }
  | { kind: 'update'; id: string; original: SavedPreset; name?: string }
  | { kind: 'new'; id: string; name: string };

/** Compare rendered settings, ignoring legacy labels/hidden coordinates just like the editor. */
export function sameVisual(a: VisualSettings, b: VisualSettings): boolean {
  const defaults = defaultSettings();
  return sameEffectiveSettings({ ...defaults, ...a }, { ...defaults, ...b });
}

/** A captured intent is checked against the latest revision before every PATCH, including retry. */
export function prepareStyleSave(base: Settings, draft: Settings, intent: StyleSaveIntent): Settings {
  if (intent.kind === 'current') return structuredClone(draft);
  const current = base.savedPresets.find(item => item.id === intent.id);
  const name = (intent.kind === 'new' ? intent.name : intent.name ?? intent.original.name).trim();
  if (!name || name.length > 60) throw new Error('Use a style name from 1 to 60 characters.');
  if (intent.kind === 'update') {
    if (!current) throw new Error('This style was deleted elsewhere. Save as new to keep your changes.');
    if (!same(current, intent.original)) throw new Error('This style changed elsewhere. Reload it or save as new.');
  }
  const record = { id: intent.id, name, visual: getVisual(draft) };
  if (intent.kind === 'new' && current && !same(current, record))
    throw new Error('This style changed elsewhere. Save as new with another name.');
  const list = draft.savedPresets.filter(item => item.id !== intent.id);
  const duplicate = duplicateStyleName(list, name);
  // Existing imported duplicate names are preserved when updating without renaming.
  const renamed = intent.kind === 'new' || name !== intent.original.name;
  if (renamed && duplicate) throw new Error(`A style named ${duplicate} already exists.`);
  if (list.length >= MAX_SAVED_STYLES) throw new Error(`Up to ${MAX_SAVED_STYLES} styles. Delete one before saving another.`);
  const next = structuredClone(draft);
  const at = next.savedPresets.findIndex(item => item.id === intent.id);
  if (at < 0) next.savedPresets.push(record);
  else next.savedPresets[at] = record;
  return next;
}

/** Restore only an explicitly remembered identity whose saved visual still matches the display. */
export function restoredStyleId(settings: Settings, remembered: string | null): string {
  const preset = settings.savedPresets.find(item => item.id === remembered);
  return preset && sameVisual(preset.visual, getVisual(settings)) ? preset.id : '';
}
