import type { SavedPreset, Settings, VisualSettings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { same, sameEffectiveSettings } from './draft.ts';
import { applyBuiltinPreset, duplicateStyleName, getVisual, MAX_SAVED_STYLES } from './model.ts';

export type NewStyleStart = 'blank' | 'room' | 'phone' | 'night';

/** Fresh visual settings, keeping personal content and the existing capture choice. */
export function newStyleDraft(current: Settings, start: NewStyleStart): Settings {
  const defaults = defaultSettings();
  const next = { ...structuredClone(current), ...getVisual(defaults) };
  next.preview = { ...current.preview, enabled: start !== 'blank' && current.preview.enabled && current.widgets.preview };
  next.widgets.preview = next.preview.enabled;
  if (start === 'blank') {
    for (const id of Object.keys(next.widgets) as (keyof Settings['widgets'])[]) next.widgets[id] = false;
    return next;
  }
  return applyBuiltinPreset(next, start);
}

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
    if (!current) throw new Error('This style was deleted elsewhere. Duplicate current to keep your changes.');
    if (!same(current, intent.original)) throw new Error('This style changed elsewhere. Reload it or duplicate current.');
  }
  const record = { id: intent.id, name, visual: getVisual(draft) };
  if (intent.kind === 'new' && current && !same(current, record))
    throw new Error('This style changed elsewhere. Duplicate current with another name.');
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

/** A duplicate starts from the current draft; its suggested name stays editable. */
export function duplicateStyleSuggestion(presets: readonly SavedPreset[], source: string): string {
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? ' copy' : ` copy ${number}`;
    const name = source.trim().slice(0, 60 - suffix.length).trimEnd() + suffix;
    if (!duplicateStyleName([...presets], name)) return name;
  }
}

/** Undo only a local deletion, using the latest saved record rather than stale metadata. */
export function undoStyleDeletion(base: Settings, draft: Settings, id: string, index: number): Settings {
  const record = base.savedPresets.find(item => item.id === id);
  if (!record) throw new Error('This style was deleted elsewhere. Your current display is unchanged.');
  if (draft.savedPresets.some(item => item.id === id)) return draft;
  if (draft.savedPresets.length >= MAX_SAVED_STYLES) throw new Error(`Up to ${MAX_SAVED_STYLES} styles. Delete one before restoring this style.`);
  const next = structuredClone(draft);
  next.savedPresets.splice(Math.min(index, next.savedPresets.length), 0, structuredClone(record));
  return next;
}
