import { isDeepStrictEqual } from 'node:util';
import type { Settings } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_IDS } from '../shared/widgets.ts';

/**
 * The installed release whose strict reader must still accept what this build writes (#84).
 * Bump it, with src/server/compat/, after each coordinated install (#130).
 */
export const PREVIOUS_RELEASE = {
  revision: 'd66832b39920b3df7ea0d67e3584289539957cc8',
  widgetIds: ['clock', 'weather', 'rain', 'forecast', 'reminders', 'preview', 'photo', 'worldClocks', 'calendar', 'countdown', 'note', 'airQuality', 'sunMoon'],
} as const;

/**
 * Additive fields omitted at rest while equal to the value the current reader restores, as are
 * default widgetData sections. validation.ts reads its defaults from here (single source).
 * The omission began so bedca44 could read the files (#84). Every baseline since 3fee844, d66832b
 * included, reads these keys, so for them it is optional: #272 kept it to avoid a data-format change
 * in a reader bump. It stays the mechanism for a future additive key or widget id that the previous
 * release does not know: list the key here, or leave the id out of PREVIOUS_RELEASE.widgetIds.
 * `daylightBrightness` (#439) is such a key: d66832b does not know it, so its omission in Fixed
 * mode (null) is required, and a Follow daylight range is a documented rollback exception.
 */
export const AT_REST = { appearance: { accentMode: 'color', animation: 'subtle', daylightBrightness: null } } as const;

/** Settings as written to state.json, state.backup.json and exports: additive defaults omitted. */
export type PersistableSettings = Record<string, unknown>;

type Loose = Record<string, any>;
const previousIds: ReadonlySet<string> = new Set(PREVIOUS_RELEASE.widgetIds);

function omitVisual(visual: Loose): void {
  const appearance = visual.appearance as Loose | undefined;
  if (appearance) {
    for (const [key, value] of Object.entries(AT_REST.appearance)) if (appearance[key] === value) delete appearance[key];
  }
  for (const id of WIDGET_IDS) {
    if (previousIds.has(id)) continue;
    if (visual.widgets?.[id] === false) delete visual.widgets[id];
    // #135: legacy transforms no longer render, and the previous release rejects any transform for an id
    // it does not know, so none is ever written for such an id, whatever its value (#437).
    if (visual.widgetOverrides) delete visual.widgetOverrides[id];
    if (visual.widgetGrid?.placements && visual.widgets?.[id] !== true) delete visual.widgetGrid.placements[id];
  }
}

/**
 * Returns a new object (never mutates its input). Omits only AT_REST values and default widgetData
 * sections, and for widget ids the previous release does not know (Dynamic since #437) an off
 * visibility, every transform (the #135 rule: transforms no longer render, so dropping one loses
 * nothing) and a hidden placement; every other key (for example rain) is always written. An enabled
 * unknown id keeps its visibility and placement: that is a documented rollback exception.
 * Apply only where data reaches disk or an export: never to snapshots, API responses or in-memory
 * data, which the editor compares key by key.
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
