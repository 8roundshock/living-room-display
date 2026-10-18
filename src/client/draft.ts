import type {
  Settings,
  SettingsPatch,
  VisualSettings,
} from '../shared/contracts.ts';
import { WIDGET_IDS } from '../shared/widgets.ts';

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

/** Preset labels and hidden-widget positions do not change the current output. */
export function sameEffectiveSettings(a: Settings, b: Settings): boolean {
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
  function comparable(settings: Settings) {
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
  return same(comparable(a), comparable(b));
}

/** Refresh untouched fields without losing a local edit, including during Save. */
export function rebaseDraft<T>(base: T, draft: T, incoming: T): T {
  if (same(base, draft)) return structuredClone(incoming);
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

export function rebaseSettings(
  base: Settings,
  draft: Settings,
  incoming: Settings,
): Settings {
  const result = rebaseDraft(base, draft, incoming);
  if (
    !same(base.widgetGrid, draft.widgetGrid) ||
    !same(base.widgets, draft.widgets) ||
    base.preview.enabled !== draft.preview.enabled
  ) {
    // Density, families, origins and visibility describe one valid arrangement.
    // Mixing untouched coordinates from another density can put a locally
    // edited widget outside the board or enable it on top of another widget.
    result.widgetGrid = structuredClone(draft.widgetGrid);
    result.widgets = structuredClone(draft.widgets);
    result.preview.enabled = draft.preview.enabled;
  }
  if (
    !same(base.location, draft.location) ||
    base.locationSource !== draft.locationSource
  ) {
    result.location = structuredClone(draft.location);
    result.locationSource = draft.locationSource;
  }
  return result;
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
  if (patch.location || patch.locationSource) {
    // A location and its source are one selection, not independently rebasable.
    patch.location = structuredClone(draft.location);
    patch.locationSource = draft.locationSource;
    if (automaticLocation) patch.automaticLocation = true;
  }
  return patch;
}
