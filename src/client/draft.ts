import type { Settings, SettingsPatch } from '../shared/contracts.ts';

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const patch = (difference(base, draft) ?? {}) as SettingsPatch & {
    version?: number;
  };
  delete patch.version;
  if (patch.location || patch.locationSource) {
    // A location and its source are one selection, not independently rebasable.
    patch.location = structuredClone(draft.location);
    patch.locationSource = draft.locationSource;
    if (automaticLocation) patch.automaticLocation = true;
  }
  return patch;
}
