/**
 * Follow daylight brightness (#439): the display's brightness rises and falls with the sun at the
 * weather location, between a chosen Dimmest and Brightest, peaking at local solar noon. It uses the
 * Sun & moon maths in astronomy.ts, on this computer, with no network.
 *
 * Curve: dimmest + (brightest − dimmest) · max(0, sin(elevation now)) / sin(elevation at solar noon),
 * using the sun's geometric elevation and the solar noon of the current solar day (the one nearest
 * the instant). It is Dimmest from sunset to sunrise, Brightest at solar noon, rises through the
 * morning and falls through the afternoon. On a polar day it never reaches Dimmest; on a polar night
 * (the sun below the horizon at noon) it stays at Dimmest.
 *
 * Low sun: the noon elevation counts as at least DAYLIGHT_LOW_SUN_DEGREES. Without that floor, a
 * day whose sun barely clears the horizon (midwinter beyond about 61° latitude) would swing from
 * Dimmest to Brightest within minutes, up to 10% a minute at Tromsø. With it every place stays
 * under about 1% a minute, and such a day peaks lower, as the light outside does. Days whose noon
 * sun is higher (Toronto all year) are unaffected.
 */
import type { AppearanceSettings, DaylightBrightness, LocationSettings } from '../shared/contracts.ts';
import { sunAltitude, sunDay } from './astronomy.ts';

/** The value changes at most once a minute: every reader computes it for the start of the minute. */
export const DAYLIGHT_STEP_MS = 60_000;
/**
 * The display glides to each new value over this time. A minute's change is at most about 1% of the
 * range (0.7% at Toronto), so the step is invisible, while a larger change (a saved range, the PC
 * waking) fades slowly. Short enough that the compositor is idle most of each minute.
 */
export const DAYLIGHT_TRANSITION_SECONDS = 10;
/** The lowest noon elevation the curve is scaled to (see above). */
export const DAYLIGHT_LOW_SUN_DEGREES = 5;

const RAD = Math.PI / 180;

/**
 * Where Follow daylight starts when first chosen: Night's 28% at night and Phone's 70% at noon,
 * widened so the current Fixed level lies inside the range.
 */
export function defaultDaylightRange(brightness: number): DaylightBrightness {
  return { dimmest: Math.min(0.28, brightness), brightest: Math.max(0.7, brightness) };
}

/** The start of the minute containing `at`, so every reader in that minute agrees. */
export function daylightStep(at: Date | number): Date {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(Math.floor(ms / DAYLIGHT_STEP_MS) * DAYLIGHT_STEP_MS);
}

/** The mean solar date of an instant at a longitude: its solar noon is within about 12 hours. */
function solarDateKey(ms: number, longitude: number): string {
  return new Date(ms + longitude * 240_000).toISOString().slice(0, 10);
}

export interface DaylightCurve {
  /** 0 while the sun is down (Dimmest), 1 at the solar noon (Brightest). */
  fraction: number;
  /** The solar noon the curve peaks at: the current solar day's, the one nearest the instant. */
  peak: Date;
  /** The solar day is a polar day (the sun never sets) or a polar night (it never rises). */
  polar: 'day' | 'night' | null;
}

/** The daylight fraction at an instant and place; exact, with no minute step. */
export function daylightCurve(at: Date, latitude: number, longitude: number): DaylightCurve {
  const day = sunDay(solarDateKey(at.getTime(), longitude), latitude, longitude);
  const peakSine = Math.sin(Math.max(sunAltitude(day.solarNoon, latitude, longitude), DAYLIGHT_LOW_SUN_DEGREES) * RAD);
  const sine = Math.sin(sunAltitude(at, latitude, longitude) * RAD);
  const fraction = Math.min(1, Math.max(0, sine / peakSine));
  return { fraction, peak: day.solarNoon, polar: day.polar };
}

type BrightnessChoice = Pick<AppearanceSettings, 'brightness' | 'daylightBrightness'>;
type Place = Pick<LocationSettings, 'latitude' | 'longitude'>;

/** A range point for a fraction, rounded to 0.001 so a re-render never restarts a transition. */
export function daylightLevel(range: DaylightBrightness, fraction: number): number {
  return Math.round((range.dimmest + (range.brightest - range.dimmest) * fraction) * 1000) / 1000;
}

/**
 * The brightness the display shows now: the Fixed level, or the Follow daylight value for the
 * start of the current minute at the weather location.
 */
export function effectiveBrightness(appearance: BrightnessChoice, place: Place, at: Date | number): number {
  const range = appearance.daylightBrightness;
  if (!range) return appearance.brightness;
  return daylightLevel(range, daylightCurve(daylightStep(at), place.latitude, place.longitude).fraction);
}

export interface DaylightStatus extends DaylightCurve {
  /** The effective brightness for the current minute. */
  brightness: number;
}

/** What the editor reports for a Follow daylight range: the value now and when it peaks. */
export function daylightStatus(range: DaylightBrightness, place: Place, at: Date | number): DaylightStatus {
  const curve = daylightCurve(daylightStep(at), place.latitude, place.longitude);
  return { ...curve, brightness: daylightLevel(range, curve.fraction) };
}
