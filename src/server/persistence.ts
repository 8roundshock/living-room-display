import { isDeepStrictEqual } from 'node:util';
import type { Settings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_IDS } from '../shared/widgets.ts';

/**
 * The installed release whose strict reader must still accept what this build writes (#84).
 * Bump it, with src/server/compat/, after each coordinated install (#130).
 */
export const PREVIOUS_RELEASE = {
  revision: 'bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8',
  widgetIds: ['clock', 'weather', 'rain', 'forecast', 'reminders', 'preview', 'photo'],
} as const;

/**
 * Additive fields the previous release cannot parse, omitted at rest while equal to the value the
 * current reader restores. validation.ts reads its defaults from here (single source).
 */
export const AT_REST = { appearance: { accentMode: 'color', animation: 'subtle' } } as const;

/** Settings as written to state.json, state.backup.json and exports: additive defaults omitted. */
export type PersistableSettings = Record<string, unknown>;

type Loose = Record<string, any>;
const previousIds: ReadonlySet<string> = new Set(PREVIOUS_RELEASE.widgetIds);
const identity = { offsetX: 0, offsetY: 0, scale: 1 };

function omitVisual(visual: Loose): void {
  const appearance = visual.appearance as Loose | undefined;
  if (appearance) {
    for (const [key, value] of Object.entries(AT_REST.appearance)) if (appearance[key] === value) delete appearance[key];
  }
  for (const id of WIDGET_IDS) {
    if (previousIds.has(id)) continue;
    if (visual.widgets?.[id] === false) delete visual.widgets[id];
    if (visual.widgetOverrides && isDeepStrictEqual(visual.widgetOverrides[id], identity)) delete visual.widgetOverrides[id];
    if (visual.widgetGrid?.placements && visual.widgets?.[id] !== true) delete visual.widgetGrid.placements[id];
  }
}

/**
 * Returns a new object (never mutates its input). Omits only keys the previous release does not
 * know, and only while the current reader restores the same value; every previous-release key
 * (for example rain) is always written. Apply only where data reaches disk or an export: never to
 * snapshots, API responses or in-memory data, which the editor compares key by key.
 */
export function persistableSettings(settings: Settings): PersistableSettings {
  const result = structuredClone(settings) as unknown as Loose;
  omitVisual(result);
  for (const preset of (result.savedPresets ?? []) as Loose[]) if (preset?.visual) omitVisual(preset.visual);
  const widgetData = result.widgetData as Loose | undefined;
  if (widgetData && typeof widgetData === 'object') {
    const defaults = (defaultSettings() as unknown as Loose).widgetData as Loose | undefined ?? {};
    for (const key of Object.keys(widgetData)) if (isDeepStrictEqual(widgetData[key], defaults[key])) delete widgetData[key];
    if (!Object.keys(widgetData).length) delete result.widgetData;
  }
  return result;
}

export function persistableData<T extends { settings: Settings }>(data: T): Omit<T, 'settings'> & { settings: PersistableSettings } {
  return { ...data, settings: persistableSettings(data.settings) };
}
