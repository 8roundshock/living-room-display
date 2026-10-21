import type {
  Settings,
  SettingsPatch,
  VisualSettings,
  WidgetId,
} from '../shared/contracts.ts';
import { WIDGET_CATALOG, WIDGET_IDS, isActiveWidget, placementFits } from '../shared/widgets.ts';

export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => same(value, b[index]))
    );
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
    );
  }
  return false;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Settings without what does not change the output: preset labels and hidden-widget positions. */
function comparable(settings: Settings) {
  function visual(value: VisualSettings) {
    const {
      preset: _preset,
      layout: _legacyLayout,
      ...appearance
    } = value.appearance;
    const { widgetOverrides: _legacy, ...rest } = value;
    const { widthPercent: _legacySnapshotWidth, ...preview } = value.preview;
    return {
      ...rest,
      appearance,
      preview: {
        ...preview,
        enabled: !!value.widgets.preview && value.preview.enabled,
      },
      widgetGrid: {
        ...value.widgetGrid,
        placements: Object.fromEntries(
          WIDGET_IDS.filter((id) => value.widgets[id]).map((id) => [
            id,
            value.widgetGrid.placements[id],
          ]),
        ),
      },
    };
  }
  const { widgetOverrides: _legacy, ...base } = settings;
  return {
    ...base,
    ...visual(settings),
    savedPresets: settings.savedPresets.map((preset) => ({
      ...preset,
      visual: visual(preset.visual),
    })),
  };
}

/** Preset labels and hidden-widget positions do not change the current output. */
export function sameEffectiveSettings(a: Settings, b: Settings): boolean {
  return same(comparable(a), comparable(b));
}

type Identified = Record<string, unknown> & { id: string };
/** A list of objects with unique string ids: countdowns, world clocks and saved styles. */
function identifiedList(value: unknown): value is Identified[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((item) => {
    if (!object(item) || typeof item.id !== 'string' || ids.has(item.id))
      return false;
    ids.add(item.id);
    return true;
  });
}
/** Whether `list` moved any item it shares with `base` relative to the others. */
function reordered(base: Identified[], list: Identified[]): boolean {
  const kept = new Set(list.map((item) => item.id));
  const before = base.map((item) => item.id).filter((id) => kept.has(id));
  const shared = new Set(before);
  const after = list.map((item) => item.id).filter((id) => shared.has(id));
  return before.some((id, index) => id !== after[index]);
}

/**
 * Three-way merge of an id list (#242), so two editor tabs keep each other's countdowns, world
 * clocks and saved styles. Additions and removals from both sides are kept. An item changed on
 * one side takes that side's fields; when both changed it, each top-level field merges on its own
 * and the local edit wins only on a field both changed (a field's value is replaced whole, so a
 * saved style's look stays one snapshot). An item removed on one side and edited on the other
 * keeps the edit. The local order wins when this tab moved items, otherwise the server's; the
 * other side's items go before the item that followed them there, else at the end, so two
 * appended countdowns end up server's first, then this tab's.
 */
function mergeIdentifiedLists(
  base: Identified[],
  local: Identified[],
  server: Identified[],
): Identified[] {
  const index = (list: Identified[]) => new Map(list.map((item) => [item.id, item]));
  const before = index(base), mine = index(local), theirs = index(server);
  const merged = new Map<string, Identified>();
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const original = before.get(id), ours = mine.get(id), other = theirs.get(id);
    if (ours && other) {
      if (!original) merged.set(id, structuredClone(ours));
      else
        merged.set(
          id,
          Object.fromEntries(
            [...new Set([...Object.keys(other), ...Object.keys(ours)])].flatMap((key) => {
              const value = same(original[key], ours[key]) ? other[key] : ours[key];
              return value === undefined ? [] : [[key, structuredClone(value)]];
            }),
          ) as Identified,
        );
    } else if (ours) {
      // Added here, or removed elsewhere while edited here: keep it.
      if (!original || !same(original, ours)) merged.set(id, structuredClone(ours));
    } else if (other && !original) merged.set(id, structuredClone(other));
  }
  const localFirst = reordered(base, local);
  const primary = (localFirst ? local : server).map((item) => item.id);
  const secondary = (localFirst ? server : local).map((item) => item.id);
  const result = primary.filter((id) => merged.has(id));
  // The other side's items go before the item that followed them there, else at the end.
  secondary.forEach((id, position) => {
    if (!merged.has(id) || result.includes(id)) return;
    const next = secondary
      .slice(position + 1)
      .map((following) => result.indexOf(following))
      .find((found) => found >= 0);
    result.splice(next ?? result.length, 0, id);
  });
  return result.map((id) => merged.get(id)!);
}

/** Refresh untouched fields without losing a local edit, including during Save. */
export function rebaseDraft<T>(base: T, draft: T, incoming: T): T {
  if (same(base, draft)) return structuredClone(incoming);
  if (identifiedList(base) && identifiedList(draft) && identifiedList(incoming))
    return mergeIdentifiedLists(base, draft, incoming) as T;
  if (object(base) && object(draft) && object(incoming)) {
    return Object.fromEntries(
      Object.keys(incoming).map((key) => [
        key,
        rebaseDraft(base[key], draft[key], incoming[key]),
      ]),
    ) as T;
  }
  return structuredClone(draft);
}

export interface SettingsRebase {
  settings: Settings;
  /** Widgets another window added that have no room in this draft's layout, so the draft leaves them off (#350). */
  crowdedOut: WidgetId[];
}

/**
 * Rebases a settings draft from `base` onto `incoming` (a poll, or a Save refused as stale, #287).
 * A layout the draft changed stays one arrangement, while widget visibility merges three ways
 * against the draft's own base (#350): a widget only the other window removed is removed here too,
 * and one only it added joins at its saved place when that is free on this board, else it is
 * reported in `crowdedOut` and stays off. With `automaticLocation` (the draft's location is an
 * automatic or failed-lookup result), a manual city in `incoming` wins, as the server's guard
 * would keep it anyway.
 */
export function rebaseSettingsReport(
  base: Settings,
  draft: Settings,
  incoming: Settings,
  { automaticLocation = false }: { automaticLocation?: boolean } = {},
): SettingsRebase {
  const result = rebaseDraft(base, draft, incoming);
  const crowdedOut: WidgetId[] = [];
  if (
    !same(base.widgetGrid, draft.widgetGrid) ||
    !same(base.widgets, draft.widgets)
  ) {
    // Density, families, origins and visibility describe one valid arrangement.
    // Mixing untouched coordinates from another density can put a locally
    // edited widget outside the board or enable it on top of another widget.
    result.widgetGrid = structuredClone(draft.widgetGrid);
    result.widgets = structuredClone(draft.widgets);
    for (const id of WIDGET_IDS) {
      const before = !!base.widgets[id],
        mine = !!draft.widgets[id],
        theirs = !!incoming.widgets[id];
      // This draft changed it (it wins), or the other window did not.
      if (mine !== before || theirs === before) continue;
      // Removing a widget always leaves a valid board.
      if (!theirs) {
        result.widgets[id] = false;
        continue;
      }
      const placement = incoming.widgetGrid.placements[id];
      if (
        isActiveWidget(id) &&
        result.widgetGrid.density === incoming.widgetGrid.density &&
        result.widgetGrid.revision === incoming.widgetGrid.revision &&
        placementFits(result.widgetGrid, id, placement, result.widgets)
      ) {
        result.widgetGrid.placements[id] = structuredClone(placement);
        result.widgets[id] = true;
      } else {
        crowdedOut.push(id);
        // Last screen's capture flag follows the widget, so it stays as this draft has it.
        if (id === 'preview') result.preview.enabled = draft.preview.enabled;
      }
    }
  }
  if (automaticLocation && incoming.locationSource === 'manual') {
    result.location = structuredClone(incoming.location);
    result.locationSource = incoming.locationSource;
  } else if (
    !same(base.location, draft.location) ||
    base.locationSource !== draft.locationSource
  ) {
    result.location = structuredClone(draft.location);
    result.locationSource = draft.locationSource;
  }
  return { settings: result, crowdedOut };
}

export function rebaseSettings(
  base: Settings,
  draft: Settings,
  incoming: Settings,
): Settings {
  return rebaseSettingsReport(base, draft, incoming).settings;
}

/** Names widgets a rebase had to leave off (#350), for the editor's layout message line. */
export function crowdedOutMessage(ids: readonly WidgetId[]): string {
  const names = ids.map((id) => WIDGET_CATALOG[id].name);
  if (names.length === 1)
    return `${names[0]} was added in another window; there is no room for it in this layout`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} were added in another window; there is no room for them in this layout`;
}

/**
 * Whether `result` keeps every effective change that `incoming` saved since `base` (#287). A Save
 * refused as stale retries by itself only then; otherwise the merge would undo something another
 * window saved, so the editor asks for a review first.
 */
export function keepsSavedChanges(
  base: Settings,
  incoming: Settings,
  result: Settings,
): boolean {
  return keeps(comparable(base), comparable(incoming), comparable(result));
}
function keeps(base: unknown, incoming: unknown, result: unknown): boolean {
  if (same(base, incoming)) return true;
  if (identifiedList(base) && identifiedList(incoming) && identifiedList(result)) {
    const before = new Map(base.map((item) => [item.id, item]));
    const kept = new Map(result.map((item) => [item.id, item]));
    const theirs = new Set(incoming.map((item) => item.id));
    // Removed there but kept here (edited here meanwhile).
    if (base.some((item) => !theirs.has(item.id) && kept.has(item.id))) return false;
    for (const item of incoming) {
      const original = before.get(item.id),
        mine = kept.get(item.id);
      if (!mine || !(original ? keeps(original, item, mine) : same(item, mine))) return false;
    }
    if (reordered(base, incoming)) {
      const order = (list: Identified[]) =>
        list.map((item) => item.id).filter((id) => before.has(id) && theirs.has(id) && kept.has(id));
      if (!same(order(incoming), order(result))) return false;
    }
    return true;
  }
  if (object(base) && object(incoming) && object(result))
    return [...new Set([...Object.keys(base), ...Object.keys(incoming)])].every((key) =>
      keeps(base[key], incoming[key], result[key]),
    );
  return same(incoming, result);
}

/**
 * List limits as the server validates them. Each tab stays within them, but a merge of two
 * tabs' lists can exceed one (#288), which then blocks Save with this reason.
 */
const LIST_LIMITS: { count: (settings: Settings) => number; limit: number; items: string }[] = [
  { count: (settings) => settings.widgetData.countdowns.length, limit: 12, items: 'dates' },
  { count: (settings) => settings.widgetData.worldClocks.length, limit: 4, items: 'cities' },
  { count: (settings) => settings.savedPresets.length, limit: 12, items: 'saved styles' },
];
export function listLimitProblem(settings: Settings): string | null {
  const over = LIST_LIMITS.find(({ count, limit }) => count(settings) > limit);
  return over ? `Up to ${over.limit} ${over.items} · remove one to save` : null;
}

function difference(base: unknown, draft: unknown): unknown {
  if (same(base, draft)) return undefined;
  if (object(base) && object(draft)) {
    return Object.fromEntries(
      Object.keys(draft).flatMap((key) => {
        const value = difference(base[key], draft[key]);
        return value === undefined ? [] : [[key, value]];
      }),
    );
  }
  return structuredClone(draft);
}

/** A settings draft never resubmits untouched fields from an old poll. */
export function settingsChanges(
  base: Settings,
  draft: Settings,
  automaticLocation = false,
): SettingsPatch {
  if (sameEffectiveSettings(base, draft)) return {};
  const patch = (difference(base, draft) ?? {}) as SettingsPatch & {
    version?: number;
  };
  delete patch.version;
  if (
    patch.appearance &&
    Object.keys(patch.appearance).every(
      (key) => key === 'preset' || key === 'layout',
    )
  )
    delete patch.appearance;
  if (patch.widgetGrid?.placements && !patch.widgetGrid.density) {
    for (const id of Object.keys(
      patch.widgetGrid.placements,
    ) as (keyof Settings['widgets'])[]) {
      if (!base.widgets[id] && !draft.widgets[id])
        delete patch.widgetGrid.placements[id];
    }
    if (!Object.keys(patch.widgetGrid.placements).length)
      delete patch.widgetGrid.placements;
    if (!Object.keys(patch.widgetGrid).length) delete patch.widgetGrid;
  }
  if (patch.widgetGrid?.placements) {
    // A per-key difference cannot express a removed custom span, which would
    // leave Save permanently dirty: send the whole placement, `span: null` clearing it.
    const placements = patch.widgetGrid.placements as Record<string, unknown>;
    for (const id of Object.keys(placements) as (keyof Settings['widgets'])[]) {
      const { span, ...placement } = draft.widgetGrid.placements[id];
      placements[id] = { ...structuredClone(placement), span: span ? { ...span } : null };
    }
  }
  if (patch.location || patch.locationSource) {
    // A location and its source are one selection, not independently rebasable.
    patch.location = structuredClone(draft.location);
    patch.locationSource = draft.locationSource;
    if (automaticLocation) patch.automaticLocation = true;
  }
  return patch;
}
