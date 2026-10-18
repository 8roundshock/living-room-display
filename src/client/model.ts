import type {
  RainInterval,
  Settings,
  VisualSettings,
} from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';

export function getVisual(settings: Settings): VisualSettings {
  const { appearance, widgets, widgetOverrides, preview } = settings;
  return structuredClone({ appearance, widgets, widgetOverrides, preview });
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
    .filter(
      (interval) =>
        new Date(interval.intervalEnd).getTime() > now &&
        new Date(interval.intervalStart).getTime() < now + 12 * 3_600_000,
    )
    .slice(0, 12);
}

export function precipitationOutlook(
  intervals: RainInterval[],
  unit: 'mm' | 'in',
) {
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
    chance: knownChances.length ? Math.max(...knownChances) : null,
    expected: knownAmounts.length
      ? knownAmounts.reduce((total, amount) => total + amount, 0)
      : null,
    rainExpected: knownRain.length
      ? knownRain.reduce((total, amount) => total + amount, 0)
      : null,
    rainIncomplete: knownRain.length !== intervals.length,
    rainy: intervals.filter((hour) => (hour.rainAmount ?? 0) >= wetThreshold),
    incomplete:
      knownChances.length !== intervals.length ||
      knownAmounts.length !== intervals.length,
    wet: intervals.filter(
      (hour) =>
        (hour.precipitationProbability ?? 0) >= 30 ||
        (hour.precipitationAmount ?? 0) >= wetThreshold,
    ),
  };
}
