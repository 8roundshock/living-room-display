/**
 * Follow daylight brightness (#439, curve from #591): the display is at Brightest while it is light
 * outside at the weather location, at an evening level for a lit room until a chosen dim time, and
 * at Dimmest from then until the next dawn. It uses the Sun & moon maths in astronomy.ts, on this
 * computer, with no network.
 *
 * Curve, as a fraction of the way from Dimmest (0) to Brightest (1):
 *
 *   fraction = evening + (1 − evening) · daylight
 *
 * - smooth(x) = x²(3 − 2x) with x clamped to 0–1 (smoothstep: no corner at either end).
 * - daylight = smooth((elevation − DAYLIGHT_DAWN_DEGREES) / (DAYLIGHT_FULL_DEGREES − DAYLIGHT_DAWN_DEGREES))
 *   from the sun's geometric elevation now. It starts at civil dawn (−6°), is about 45% at sunrise
 *   and reaches 1 with the sun 5° up, 30 to 50 minutes after sunrise at Toronto, then holds all day.
 *   Evening mirrors it: 1 until the sun is 5° above the horizon, 0 from civil dusk.
 * - evening = DAYLIGHT_EVENING_LEVEL · arm · (1 − smooth((now − dim instant) / DAYLIGHT_DIM_RAMP_MINUTES)).
 *   The dim instant is the first time the clock at the weather location shows the saved dim time
 *   after the solar noon, so 00:30 belongs to the evening before. `arm` raises the term from 0 to
 *   1 with smooth() over the DAYLIGHT_ARM_MINUTES before each solar noon: in daylight the display
 *   is at Brightest then, so that is not seen. Before that window the previous solar day's evening
 *   term applies (0 once its ramp has finished).
 *
 * So after sunset the display eases from Brightest to the evening level as dusk falls, holds it,
 * glides to Dimmest over the half hour after the dim time, and stays there until dawn. Each term is
 * continuous, so the value never jumps. Daylight wins: while the sun is 5° up the fraction is 1
 * whatever the clock says, a dim time that arrives in daylight (a high-latitude summer) only lets
 * dusk carry the display to Dimmest, and a dawn that begins before the ramp ends blends with it.
 *
 * Evening level: 0.65 of the range. With the starting range (Night's 28% to Phone's 70%) that is
 * 55%, the Room look's Fixed level, which was chosen for a lit living room.
 *
 * Rate: the sun's elevation changes by at most 0.25° a minute (the equator at an equinox), so dawn
 * and dusk move the fraction by at most 1.5 · 0.25 / 11 = 3.4% of the range a minute (2.5% at
 * Toronto), and the dim ramp by at most 1.5 · 0.65 / 30 = 3.3%. Measured for every minute of 2026
 * at nine places from the equator to 78° N, no minute exceeds 3.5% with a dim time of 11 PM or
 * later; an early dim time whose ramp meets dusk reaches 4.1% (8 PM at Sydney in January). With
 * the starting range 4.1% is 1.7% of full brightness, spread by the display's 10 s glide. The #439 curve stayed near 1% a minute by taking
 * all morning; reaching Brightest with the morning light needs the faster dawn.
 *
 * Low sun and polar days: nothing is scaled to the noon elevation, so a day whose sun stays under
 * 5° peaks below Brightest, as the light outside does. On a polar day the display stays at
 * Brightest while the sun is 5° up and dips toward the evening level (or Dimmest, after the dim
 * time) around solar midnight when it is lower. In a polar night there is no dawn: the display
 * rests at Dimmest through the morning, rises to the evening level over the two hours before solar
 * noon (plus what civil twilight adds) and holds it until the dim time.
 */
import type { AppearanceSettings, DaylightBrightness, LocationSettings } from '../shared/contracts.ts';
import { DEFAULT_DIM_TIME, dimTimeMinutes } from '../shared/daylight.ts';
import { addDays, civilDateKey, isValidTimeZone, sunAltitude, sunDay, zoneOffsetMinutes } from './astronomy.ts';
import { weatherTimeZone } from './format.ts';

/** The value changes at most once a minute: every reader computes it for the start of the minute. */
export const DAYLIGHT_STEP_MS = 60_000;
/**
 * The display glides to each new value over this time. A minute's change is at most about 4% of
 * the range (see above), so the step is invisible, while a larger change (a saved range, the PC
 * waking) fades slowly. Short enough that the compositor is idle most of each minute.
 */
export const DAYLIGHT_TRANSITION_SECONDS = 10;
/** Civil dawn and dusk: the sun's elevation where the daylight term leaves and returns to 0. */
export const DAYLIGHT_DAWN_DEGREES = -6;
/** The sun's elevation from which the daylight term is 1 (Brightest). */
export const DAYLIGHT_FULL_DEGREES = 5;
/** The lit-room level held after dusk until the dim time, as a fraction of the range. */
export const DAYLIGHT_EVENING_LEVEL = 0.65;
/** How long the glide from the evening level to Dimmest takes after the dim time. */
export const DAYLIGHT_DIM_RAMP_MINUTES = 30;
/** The evening term returns over this long before each solar noon. */
export const DAYLIGHT_ARM_MINUTES = 120;

const MINUTE = 60_000, HOUR = 3_600_000;
const RAMP_MS = DAYLIGHT_DIM_RAMP_MINUTES * MINUTE, ARM_MS = DAYLIGHT_ARM_MINUTES * MINUTE;
/**
 * The dim instant is kept at most this long after its solar noon, so its ramp always ends before
 * the next noon's arm window opens. Only a time zone that does not belong to the longitude (a device
 * location still waiting for its forecast, on a computer set to another zone) can reach it.
 */
const LATEST_DIM_MS = 21 * HOUR;

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Where Follow daylight starts when first chosen: Night's 28% at night and Phone's 70% by day,
 * widened so the current Fixed level lies inside the range, dimming at 11 PM.
 */
export function defaultDaylightRange(brightness: number): DaylightBrightness {
  return { dimmest: Math.min(0.28, brightness), brightest: Math.max(0.7, brightness), dimTime: DEFAULT_DIM_TIME };
}

/** A dim time as the editor lists it: "11:00 PM" or "23:00", with midnight named. */
export function dimTimeLabel(dimTime: string, clockFormat: '12h' | '24h'): string {
  const minutes = dimTimeMinutes(dimTime), hour = Math.floor(minutes / 60), minute = String(minutes % 60).padStart(2, '0');
  const time = clockFormat === '24h' ? `${String(hour).padStart(2, '0')}:${minute}` : `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
  return minutes === 0 ? `${time} (midnight)` : time;
}

/** The start of the minute containing `at`, so every reader in that minute agrees. */
export function daylightStep(at: Date | number): Date {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(Math.floor(ms / DAYLIGHT_STEP_MS) * DAYLIGHT_STEP_MS);
}

/**
 * The zone the dim time is read in: the weather location's, or the forecast's resolved zone while
 * the location stores `auto` (a device area), or this computer's until a forecast has arrived.
 */
export function daylightTimeZone(locationZone: string | null | undefined, weatherZone?: string | null): string {
  return isValidTimeZone(locationZone) ? locationZone : weatherTimeZone(weatherZone);
}

/** The mean solar date of an instant at a longitude: its solar noon is within about 12 hours. */
function solarDateKey(ms: number, longitude: number): string {
  return new Date(ms + longitude * 240_000).toISOString().slice(0, 10);
}

/** The instant a zone's clock shows `minutes` after midnight on a civil date (DST gaps land within the hour). */
function wallInstant(dateKey: string, minutes: number, timeZone: string): number {
  const wall = Date.parse(`${dateKey}T00:00:00Z`) + minutes * MINUTE;
  let ms = wall - zoneOffsetMinutes(new Date(wall), timeZone) * MINUTE;
  ms = wall - zoneOffsetMinutes(new Date(ms), timeZone) * MINUTE;
  return ms;
}

/** The first time the zone's clock shows the dim time after a solar noon. */
function dimInstant(noon: Date, dimTime: string | null | undefined, timeZone: string): number {
  const minutes = dimTimeMinutes(dimTime);
  const date = civilDateKey(noon, timeZone);
  let ms = wallInstant(date, minutes, timeZone);
  if (ms < noon.getTime()) ms = wallInstant(addDays(date, 1), minutes, timeZone);
  return Math.min(ms, noon.getTime() + LATEST_DIM_MS);
}

interface Evening {
  /** The evening term now, 0 to DAYLIGHT_EVENING_LEVEL. */
  level: number;
  /** The dim instant of the evening this instant belongs to. */
  dimAt: number;
  /** The solar noon that evening follows. */
  noon: number;
}

function evening(ms: number, latitude: number, longitude: number, dimTime: string | null | undefined, timeZone: string): Evening {
  const key = solarDateKey(ms, longitude);
  let day = sunDay(key, latitude, longitude), arm = 1;
  const armStart = day.solarNoon.getTime() - ARM_MS;
  if (ms < armStart) day = sunDay(addDays(key, -1), latitude, longitude);
  else arm = smooth((ms - armStart) / ARM_MS);
  const dimAt = dimInstant(day.solarNoon, dimTime, timeZone);
  return { level: DAYLIGHT_EVENING_LEVEL * arm * (1 - smooth((ms - dimAt) / RAMP_MS)), dimAt, noon: day.solarNoon.getTime() };
}

/** The daylight term for a sun elevation in degrees. */
export function daylightTerm(elevation: number): number {
  return smooth((elevation - DAYLIGHT_DAWN_DEGREES) / (DAYLIGHT_FULL_DEGREES - DAYLIGHT_DAWN_DEGREES));
}

export interface DaylightCurve {
  /** 0 at Dimmest, 1 at Brightest. */
  fraction: number;
  /** The daylight term: 0 before civil dawn and after civil dusk, 1 with the sun 5° up. */
  daylight: number;
  /** The evening term: DAYLIGHT_EVENING_LEVEL from midday until the dim time, 0 after its ramp. */
  evening: number;
  /** The solar day is a polar day (the sun never sets) or a polar night (it never rises). */
  polar: 'day' | 'night' | null;
}

/** The curve at an instant and place; exact, with no minute step. */
export function daylightCurve(at: Date, latitude: number, longitude: number, dimTime: string | null | undefined, timeZone: string): DaylightCurve {
  const ms = at.getTime();
  const daylight = daylightTerm(sunAltitude(at, latitude, longitude));
  const { level } = evening(ms, latitude, longitude, dimTime, timeZone);
  return {
    fraction: Math.min(1, Math.max(0, level + (1 - level) * daylight)), daylight, evening: level,
    polar: sunDay(solarDateKey(ms, longitude), latitude, longitude).polar,
  };
}

type BrightnessChoice = Pick<AppearanceSettings, 'brightness' | 'daylightBrightness'>;
type Place = Pick<LocationSettings, 'latitude' | 'longitude'>;
type Range = Pick<DaylightBrightness, 'dimmest' | 'brightest'>;

/** A range point for a fraction, rounded to 0.001 so a re-render never restarts a transition. */
export function daylightLevel(range: Range, fraction: number): number {
  return Math.round((range.dimmest + (range.brightest - range.dimmest) * fraction) * 1000) / 1000;
}

/**
 * The brightness the display shows now: the Fixed level, or the Follow daylight value for the
 * start of the current minute at the weather location, with the dim time read in `timeZone`.
 */
export function effectiveBrightness(appearance: BrightnessChoice, place: Place, at: Date | number, timeZone: string): number {
  const range = appearance.daylightBrightness;
  if (!range) return appearance.brightness;
  return daylightLevel(range, daylightCurve(daylightStep(at), place.latitude, place.longitude, range.dimTime, timeZone).fraction);
}

/**
 * The instant between `from` and `to` where the sun's elevation crosses `degrees`, or null when it
 * is on one side at both ends. The elevation is monotonic between a solar noon and the solar
 * midnight on either side of it, which is how this is called.
 */
function crossing(place: Place, from: number, to: number, degrees: number): Date | null {
  const above = (ms: number) => sunAltitude(new Date(ms), place.latitude, place.longitude) >= degrees;
  const start = above(from);
  if (start === above(to)) return null;
  let low = from, high = to;
  while (high - low > 1000) {
    const middle = (low + high) / 2;
    if (above(middle) === start) low = middle; else high = middle;
  }
  return new Date(high);
}

export interface DaylightStatus extends DaylightCurve {
  /** The effective brightness for the current minute. */
  brightness: number;
  /** The brightness of the evening level for this range. */
  eveningBrightness: number;
  /** The sun is 5° up now, so the display is at Brightest. */
  full: boolean;
  /**
   * While `full`: when the display reached Brightest this morning, or null when the sun has stayed
   * that high since before the last solar midnight. Otherwise: when it next reaches Brightest, this
   * solar day or the next, or null when the sun stays lower through both.
   */
  fullAt: Date | null;
  /**
   * How the display next reaches Dimmest. `time`: it starts gliding down at `dimAt`, the dim time.
   * `dusk`: it is still light at the dim time, so Dimmest arrives with civil dusk at `dimAt`.
   * `never`: it stays light until the next morning; `dimAt` is the dim time.
   */
  dims: 'time' | 'dusk' | 'never';
  dimAt: Date;
}

/** What the editor reports for a Follow daylight range: the value now, when it is at Brightest and when it dims. */
export function daylightStatus(range: DaylightBrightness, place: Place, at: Date | number, timeZone: string): DaylightStatus {
  const now = daylightStep(at), ms = now.getTime();
  const curve = daylightCurve(now, place.latitude, place.longitude, range.dimTime, timeZone);
  const key = solarDateKey(ms, place.longitude);
  const noonOf = (dateKey: string) => sunDay(dateKey, place.latitude, place.longitude).solarNoon;
  const morning = (dateKey: string) => {
    const noon = noonOf(dateKey).getTime();
    return crossing(place, noon - 12 * HOUR, noon, DAYLIGHT_FULL_DEGREES);
  };
  const full = curve.daylight >= 1;
  let fullAt = morning(key);
  // The sun is still low: after this solar day's morning (or without one), the next morning counts.
  if (!full && (!fullAt || fullAt.getTime() <= ms)) fullAt = morning(addDays(key, 1));

  let cycle = evening(ms, place.latitude, place.longitude, range.dimTime, timeZone);
  // Once tonight's ramp has finished, the next dim time is the one after the coming solar noon.
  if (ms >= cycle.dimAt + RAMP_MS) {
    const next = noonOf(solarDateKey(cycle.noon + 24 * HOUR, place.longitude));
    cycle = { level: 0, dimAt: dimInstant(next, range.dimTime, timeZone), noon: next.getTime() };
  }
  let dims: DaylightStatus['dims'] = 'time', dimAt = new Date(cycle.dimAt);
  if (sunAltitude(dimAt, place.latitude, place.longitude) > DAYLIGHT_DAWN_DEGREES) {
    const dusk = crossing(place, cycle.noon, cycle.noon + 12 * HOUR, DAYLIGHT_DAWN_DEGREES);
    if (dusk && dusk.getTime() > cycle.dimAt) { dims = 'dusk'; dimAt = dusk; } else dims = 'never';
  }
  return {
    ...curve, brightness: daylightLevel(range, curve.fraction), eveningBrightness: daylightLevel(range, DAYLIGHT_EVENING_LEVEL),
    full, fullAt, dims, dimAt,
  };
}
