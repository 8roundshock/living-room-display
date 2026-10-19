import type {
  RainInterval,
  Reminder,
  Settings,
  VisualSettings,
} from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';

export function getVisual(settings: Settings): VisualSettings {
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = settings;
  return structuredClone({ appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview });
}

/** Rain is retired into Weather (#74), so it never carries the credit. */
export function weatherAttributionWidget(settings: Settings): 'forecast' | 'weather' | null {
  return settings.widgets.forecast ? 'forecast' : settings.widgets.weather ? 'weather' : null;
}

export function reminderPresentation(
  settings: Settings,
  reminders: Reminder[] | null | undefined,
  disconnected = false,
): 'hidden' | 'pending' | 'empty' | 'unavailable' {
  if (!settings.widgets.reminders) return 'hidden';
  if (!Array.isArray(reminders)) return 'unavailable';
  if (reminders.some((reminder) => !reminder.completed)) return 'pending';
  // A failed refresh cannot confirm that a retained empty list is still empty.
  if (disconnected) return 'unavailable';
  return settings.widgetBehavior.reminders.hideWhenEmpty ? 'hidden' : 'empty';
}

export type BuiltinPreset = 'phone' | 'room' | 'night';
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = ['phone', 'room', 'night'];
type Look = Pick<
  Settings['appearance'],
  'brightness' | 'accentMode' | 'accentColor' | 'textColor' | 'fontFamily' | 'layout'
>;

/**
 * What a built-in style sets: brightness, accent, text colour, typeface and the retained legacy
 * layout. Room is the default look; every built-in style uses native colours (#75).
 */
export function builtinLook(preset: BuiltinPreset): Look {
  const { brightness, accentMode, accentColor, textColor, fontFamily, layout } =
    defaultSettings().appearance;
  const room: Look = { brightness, accentMode, accentColor, textColor, fontFamily, layout };
  if (preset === 'night')
    return { ...room, brightness: 0.28, accentColor: '#9990b7', textColor: '#a7a3bb', layout: 'minimal' };
  if (preset === 'phone') return { ...room, brightness: 0.7, accentColor: '#a89ec8' };
  return room;
}

/**
 * Built-in styles are looks only (#153, #110, #226): they keep the widgets and their layout, the
 * widget options (Reminders' Hide when empty, Last screen, clock style), Text size and every motion
 * preference, and change only the look.
 */
export function applyBuiltinPreset(settings: Settings, preset: BuiltinPreset): Settings {
  const next = structuredClone(settings);
  next.appearance = { ...next.appearance, ...builtinLook(preset), preset };
  return next;
}

/**
 * The built-in style whose look the appearance shows, so its card reads as chosen whenever applying
 * it would change nothing visible. The legacy layout is not rendered, so it does not count.
 */
export function matchingBuiltinPreset(
  appearance: Settings['appearance'],
): BuiltinPreset | null {
  return (
    BUILTIN_PRESETS.find((preset) => {
      const look = builtinLook(preset);
      return (
        appearance.brightness === look.brightness &&
        appearance.accentMode === look.accentMode &&
        appearance.accentColor.toLowerCase() === look.accentColor &&
        appearance.textColor.toLowerCase() === look.textColor &&
        appearance.fontFamily === look.fontFamily
      );
    }) ?? null
  );
}

/**
 * Reset appearance (#234): every Style tab value returns to its default (the Room look, Text size,
 * Animation and the movement settings). Widgets, their layout and options, the clock style (a
 * Clock widget option), saved styles and personal data stay.
 */
export function resetAppearance(settings: Settings): Settings {
  const next = structuredClone(settings);
  next.appearance = {
    ...defaultSettings().appearance,
    clockStyle: settings.appearance.clockStyle,
  };
  return next;
}

export function upcomingRain(
  intervals: RainInterval[],
  now: number,
): RainInterval[] {
  return intervals
    .filter((interval) => {
      const start = Date.parse(interval.intervalStart);
      const end = Date.parse(interval.intervalEnd);
      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        end > now &&
        start < now + 12 * 3_600_000
      );
    })
    .sort((a, b) => Date.parse(a.intervalStart) - Date.parse(b.intervalStart));
}

export function precipitationOutlook(
  source: RainInterval[],
  unit: 'mm' | 'in',
  now: number,
) {
  const intervals = upcomingRain(source, now);
  let coveredUntil = now;
  let hasGaps = false;
  for (const interval of intervals) {
    const start = Date.parse(interval.intervalStart);
    const end = Date.parse(interval.intervalEnd);
    if (start > coveredUntil) hasGaps = true;
    coveredUntil = Math.max(coveredUntil, end);
  }
  const coverageComplete =
    intervals.length > 0 && !hasGaps && coveredUntil >= now + 12 * 3_600_000;
  const knownChances = intervals
    .map((hour) => hour.precipitationProbability)
    .filter((value) => value !== null);
  const knownAmounts = intervals
    .map((hour) => hour.precipitationAmount)
    .filter((value) => value !== null);
  const knownRain = intervals
    .map((hour) => hour.rainAmount)
    .filter((value) => value !== null);
  const wetThreshold = unit === 'in' ? 0.004 : 0.1;
  return {
    intervals,
    coverageComplete,
    hasGaps,
    coverageStart: intervals[0]?.intervalStart ?? null,
    coverageEnd: intervals.length
      ? new Date(
          Math.max(
            ...intervals.map((interval) => Date.parse(interval.intervalEnd)),
          ),
        ).toISOString()
      : null,
    chance: knownChances.length ? Math.max(...knownChances) : null,
    expected: knownAmounts.length
      ? knownAmounts.reduce((total, amount) => total + amount, 0)
      : null,
    rainExpected: knownRain.length
      ? knownRain.reduce((total, amount) => total + amount, 0)
      : null,
    rainIncomplete: !coverageComplete || knownRain.length !== intervals.length,
    rainDataIncomplete: knownRain.length !== intervals.length,
    rainy: intervals.filter((hour) => (hour.rainAmount ?? 0) >= wetThreshold),
    incomplete:
      !coverageComplete ||
      knownChances.length !== intervals.length ||
      knownAmounts.length !== intervals.length,
    wet: intervals.filter(
      (hour) =>
        (hour.precipitationProbability ?? 0) >= 30 ||
        (hour.precipitationAmount ?? 0) >= wetThreshold,
    ),
  };
}
