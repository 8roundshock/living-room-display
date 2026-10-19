import type {
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
