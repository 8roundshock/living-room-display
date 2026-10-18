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

export function weatherAttributionWidget(settings: Settings): 'forecast' | 'weather' | 'rain' | null {
  return settings.widgets.forecast ? 'forecast' : settings.widgets.weather ? 'weather' : settings.widgets.rain ? 'rain' : null;
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

export function applyBuiltinPreset(
  settings: Settings,
  preset: 'phone' | 'room' | 'night',
): Settings {
  const defaults = defaultSettings();
  return {
    ...settings,
    ...getVisual(defaults),
    appearance: {
      ...defaults.appearance,
      preset,
      // The Animation level is a motion preference, not part of a look (#76). Soft motion and
      // clock style still reset until #110 decides.
      animation: settings.appearance.animation,
      ...(preset === 'night'
        ? {
            brightness: 0.28,
            accentColor: '#9990b7',
            textColor: '#a7a3bb',
            fontScale: 0.9,
            layout: 'minimal' as const,
          }
        : preset === 'phone'
          ? {
              brightness: 0.7,
              fontScale: 0.85,
              accentColor: '#a89ec8',
              motionIntervalSeconds: 120,
            }
          : {}),
    },
  };
}

export function sortReminders<
  T extends { completed: boolean; dueAt: string | null; createdAt: string },
>(reminders: T[]): T[] {
  return [...reminders].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) -
        (b.dueAt ? new Date(b.dueAt).getTime() : Infinity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
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
