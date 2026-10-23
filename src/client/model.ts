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

/**
 * The one widget that carries the “Forecast by Open-Meteo” credit: Forecast, else Weather, else Dynamic
 * (#437) while both are off. Rain is retired into Weather (#74), so it never carries the credit.
 */
export function weatherAttributionWidget(settings: Settings): 'forecast' | 'weather' | 'dynamic' | null {
  return settings.widgets.forecast ? 'forecast' : settings.widgets.weather ? 'weather' : settings.widgets.dynamic ? 'dynamic' : null;
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
 * The stored `appearance.preset` label follows the look (#277): the built-in style whose look the
 * appearance shows, else `custom`. Every appearance edit writes it, so the saved label never
 * disagrees with the card the editor shows as chosen. The label is not part of the effective
 * settings (`sameEffectiveSettings` ignores it), so it never makes a draft dirty by itself, and its
 * values stay the four the previous release accepts.
 */
export function labelLook(appearance: Settings['appearance']): Settings['appearance'] {
  const preset = matchingBuiltinPreset(appearance) ?? 'custom';
  return appearance.preset === preset ? appearance : { ...appearance, preset };
}

/** Applies an appearance edit and keeps the stored style label in step with the look (#277). */
export function withAppearance(
  settings: Settings,
  update: Partial<Settings['appearance']>,
): Settings {
  return { ...settings, appearance: labelLook({ ...settings.appearance, ...update }) };
}

/**
 * Reset layout (#435): which widgets are shown, where, at what size, and the grid density return to
 * the default board. Widget options (clock style, Hide when empty, snapshot opacity), widget content
 * (cities, dates, the note), the appearance, saved styles and personal data stay. Last screen's
 * `preview.enabled` follows its widget, as when it is added or removed.
 */
export function resetLayout(settings: Settings): Settings {
  const next = structuredClone(settings), defaults = defaultSettings();
  next.widgets = defaults.widgets;
  next.widgetGrid = defaults.widgetGrid;
  next.preview = { ...next.preview, enabled: defaults.widgets.preview };
  return next;
}

/**
 * Reset appearance (#234): every Style tab value returns to its default (the Room look, Text size,
 * Animation and the movement settings). Widgets, their layout and options, the clock style (a
 * Clock widget option), saved styles and personal data stay.
 */
export function resetAppearance(settings: Settings): Settings {
  const next = structuredClone(settings);
  next.appearance = labelLook({
    ...defaultSettings().appearance,
    clockStyle: settings.appearance.clockStyle,
  });
  return next;
}

/**
 * Saved styles (#344): a name is refused when another style already uses it, compared without
 * case and surrounding spaces. Returns the existing style's name, or null when the name is free.
 */
export function duplicateStyleName(
  styles: readonly { id: string; name: string }[],
  name: string,
  except?: string,
): string | null {
  const wanted = name.trim().toLocaleLowerCase();
  if (!wanted) return null;
  return (
    styles.find((style) => style.id !== except && style.name.trim().toLocaleLowerCase() === wanted)
      ?.name ?? null
  );
}

/** The most saved styles the server accepts (`savedPresets` in src/server/validation.ts). */
export const MAX_SAVED_STYLES = 12;

/** "1 second", "2 seconds": a slider's value as it is read aloud (#342). */
export function spokenSeconds(seconds: number): string {
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}

/** The move interval read aloud (#342): "30 seconds", "3 minutes", "1 minute 30 seconds". */
export function spokenInterval(seconds: number): string {
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  if (!minutes) return spokenSeconds(rest);
  const whole = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return rest ? `${whole} ${spokenSeconds(rest)}` : whole;
}
