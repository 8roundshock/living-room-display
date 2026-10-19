/**
 * Sun, moon and civil-time calculations done on this computer, with no dependency or network.
 *
 * - Sun: the NOAA solar calculator equations (sunrise/sunset with −0.833° for refraction and the
 *   solar disc, solar noon, altitude and a polar day/night flag). Accurate to about a minute at
 *   ordinary latitudes, less near the polar circles.
 * - Moon: Meeus, Astronomical Algorithms (2nd ed.), ch. 48 low-precision illuminated fraction and
 *   elongation (for the phase name) and ch. 49 instants of new and full moon.
 * - Civil time: Intl time-zone formatting with one cached formatter per zone and option set.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Terrestrial minus universal time for the mid-2020s (≈69 s); only shifts moon instants slightly. */
const DELTA_T_SECONDS = 69;

const sin = (degrees: number) => Math.sin(degrees * RAD);
const cos = (degrees: number) => Math.cos(degrees * RAD);
const tan = (degrees: number) => Math.tan(degrees * RAD);
const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;
const julianDay = (ms: number) => ms / DAY_MS + 2440587.5;

// ---------------------------------------------------------------------------------------------
// Civil time in a zone
// ---------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();
/** One cached Intl formatter per zone and option set; creating formatters every second is costly. */
export function zoneFormatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en', { ...options, timeZone });
    if (formatters.size > 200) formatters.clear();
    formatters.set(key, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone || timeZone === 'auto') return false;
  try { zoneFormatter(timeZone, { year: 'numeric' }); return true; } catch { return false; }
}

/** This computer's time zone (the browser's resolved zone). */
export function localTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The civil date (YYYY-MM-DD) of an instant in a zone. */
export function civilDateKey(at: Date, timeZone: string): string {
  const parts = zoneFormatter(timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Adds whole civil days to a YYYY-MM-DD key (calendar arithmetic, not 24-hour steps). */
export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The zone's UTC offset in minutes at an instant, from Intl longOffset (DST-correct). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const name = zoneFormatter(timeZone, { timeZoneName: 'longOffset' }).formatToParts(at).find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+\-−])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '+' ? minutes : -minutes;
}

/** Hours and minutes split from the day period, following the 12/24-hour setting. */
export function timeParts(at: Date, timeZone: string, clockFormat: '12h' | '24h'): { time: string; period: string | null } {
  const options: Intl.DateTimeFormatOptions = clockFormat === '12h' ? { hour: 'numeric', minute: '2-digit', hour12: true } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const parts = zoneFormatter(timeZone, options).formatToParts(at);
  return {
    time: parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(),
    period: parts.find(part => part.type === 'dayPeriod')?.value ?? null,
  };
}
export function formatTime(at: Date, timeZone: string, clockFormat: '12h' | '24h'): string {
  const { time, period } = timeParts(at, timeZone, clockFormat);
  return period ? `${time} ${period}` : time;
}

/** "10 h 54 min" */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60), rest = rounded % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// ---------------------------------------------------------------------------------------------
// Sun (NOAA)
// ---------------------------------------------------------------------------------------------

interface SolarPosition { declination: number; equationOfTime: number }
function solarPosition(ms: number): SolarPosition {
  const t = (julianDay(ms) - 2451545) / 36525;
  const meanLongitude = normalize(280.46646 + t * (36000.76983 + t * 0.0003032));
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center = sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) + sin(3 * meanAnomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(apparentLongitude)) / RAD;
  const y = tan(obliquity / 2) ** 2;
  const equationOfTime = 4 / RAD * (y * sin(2 * meanLongitude) - 2 * eccentricity * sin(meanAnomaly) + 4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude)
    - 0.5 * y * y * sin(4 * meanLongitude) - 1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly));
  return { declination, equationOfTime };
}

/** cos of the sunrise hour angle for the standard −0.833° altitude; outside [−1, 1] means no rise/set. */
function riseHourAngleCosine(latitude: number, declination: number): number {
  return cos(90.833) / (cos(latitude) * cos(declination)) - tan(latitude) * tan(declination);
}

export interface SunDay {
  /** Null on a polar day or night. */
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  /** Minutes between sunrise and sunset; 1440 on a polar day and 0 on a polar night. */
  daylightMinutes: number;
  polar: 'day' | 'night' | null;
}

const sunDays = new Map<string, SunDay>();
/**
 * Sun events for a civil date (YYYY-MM-DD) at a place. Times are instants; a sunset late in the
 * local evening can fall on the next UTC date. The civil date's events are those around its solar
 * noon. With `timeZone`, that solar noon is moved by whole days to within 12 hours of the zone's
 * civil noon, so zones whose offset crosses the date line against their longitude (Pacific/Apia,
 * Pacific/Kiritimati) get their own day; without it the zone is assumed to follow the longitude.
 */
export function sunDay(dateKey: string, latitude: number, longitude: number, timeZone?: string): SunDay {
  const key = `${dateKey}|${latitude}|${longitude}|${timeZone ?? ''}`;
  const cached = sunDays.get(key);
  if (cached) return cached;
  const midnight = Date.parse(`${dateKey}T00:00:00Z`);
  const at = (minutes: number) => midnight + minutes * MINUTE_MS;
  let base = 720 - 4 * longitude;
  if (timeZone) {
    // Civil noon in minutes after this date's UTC midnight.
    const civilNoon = 720 - zoneOffsetMinutes(new Date(midnight + 720 * MINUTE_MS), timeZone);
    base += Math.round((civilNoon - base) / 1440) * 1440;
  }
  let noon = base;
  for (let step = 0; step < 2; step++) noon = base - solarPosition(at(noon)).equationOfTime;
  const noonPosition = solarPosition(at(noon));
  const cosine = riseHourAngleCosine(latitude, noonPosition.declination);
  let result: SunDay;
  if (cosine < -1 || cosine > 1) {
    const day = cosine < -1;
    result = { sunrise: null, sunset: null, solarNoon: new Date(at(noon)), daylightMinutes: day ? 1440 : 0, polar: day ? 'day' : 'night' };
  } else {
    const event = (direction: -1 | 1) => {
      let minutes = noon + direction * 4 * Math.acos(cosine) / RAD;
      // Refine with the sun's position at the event itself rather than at noon.
      for (let step = 0; step < 3; step++) {
        const position = solarPosition(at(minutes));
        const angle = Math.acos(Math.min(1, Math.max(-1, riseHourAngleCosine(latitude, position.declination)))) / RAD;
        minutes = base - position.equationOfTime + direction * 4 * angle;
      }
      return minutes;
    };
    const rise = event(-1), set = event(1);
    result = { sunrise: new Date(at(rise)), sunset: new Date(at(set)), solarNoon: new Date(at(noon)), daylightMinutes: set - rise, polar: null };
  }
  if (sunDays.size > 256) sunDays.clear();
  sunDays.set(key, result);
  return result;
}

/** Geometric altitude of the sun's centre in degrees (no refraction). */
export function sunAltitude(at: Date, latitude: number, longitude: number): number {
  const ms = at.getTime();
  const { declination, equationOfTime } = solarPosition(ms);
  const utcMinutes = ((ms % DAY_MS) + DAY_MS) % DAY_MS / MINUTE_MS;
  const hourAngle = (utcMinutes + equationOfTime + 4 * longitude) / 4 - 180;
  const cosZenith = sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

/** Whether the sun's upper limb is above the horizon (the same −0.833° as sunrise/sunset). */
export function sunIsUp(at: Date, latitude: number, longitude: number): boolean {
  return sunAltitude(at, latitude, longitude) > -0.833;
}

// ---------------------------------------------------------------------------------------------
// Moon (Meeus ch. 48 and 49)
// ---------------------------------------------------------------------------------------------

export type MoonPhaseName = 'New moon' | 'Waxing crescent' | 'First quarter' | 'Waxing gibbous' | 'Full moon' | 'Waning gibbous' | 'Last quarter' | 'Waning crescent';
export interface MoonPhase {
  /** Position in the synodic cycle from the Sun–Moon elongation: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  cycle: number;
  /** Illuminated fraction of the disc, 0–1. */
  illumination: number;
  name: MoonPhaseName;
  waxing: boolean;
}
/** Principal phases are named within about a day either side (±0.034 of the cycle). */
export const PRINCIPAL_PHASE_WINDOW = 0.034;

export function moonPhase(at: Date): MoonPhase {
  const t = (julianDay(at.getTime()) + DELTA_T_SECONDS / 86400 - 2451545) / 36525;
  const elongationMean = 297.8501921 + 445267.1114034 * t - 0.0018819 * t * t + t ** 3 / 545868 - t ** 4 / 113065000;
  const sunAnomaly = 357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + t ** 3 / 24490000;
  const moonAnomaly = 134.9633964 + 477198.8675055 * t + 0.0087414 * t * t + t ** 3 / 69699 - t ** 4 / 14712000;
  // Meeus 48.4: phase angle i = 180° − (true elongation); keep the elongation for direction.
  const elongation = normalize(elongationMean + 6.289 * sin(moonAnomaly) - 2.1 * sin(sunAnomaly) + 1.274 * sin(2 * elongationMean - moonAnomaly)
    + 0.658 * sin(2 * elongationMean) + 0.214 * sin(2 * moonAnomaly) + 0.11 * sin(elongationMean));
  const illumination = (1 - cos(elongation)) / 2;
  const cycle = elongation / 360;
  const near = (target: number) => Math.min(Math.abs(cycle - target), 1 - Math.abs(cycle - target)) <= PRINCIPAL_PHASE_WINDOW;
  const name: MoonPhaseName = near(0) ? 'New moon' : near(0.25) ? 'First quarter' : near(0.5) ? 'Full moon' : near(0.75) ? 'Last quarter'
    : cycle < 0.25 ? 'Waxing crescent' : cycle < 0.5 ? 'Waxing gibbous' : cycle < 0.75 ? 'Waning gibbous' : 'Waning crescent';
  return { cycle, illumination, name, waxing: cycle < 0.5 };
}

const PLANETARY: [number, number, number][] = [
  [299.77, 0.107408, 325], [251.88, 0.016321, 165], [251.83, 26.651886, 164], [349.42, 36.412478, 126], [84.66, 18.206239, 110],
  [141.74, 53.303771, 62], [207.14, 2.453732, 60], [154.84, 7.30686, 56], [34.52, 27.261239, 47], [207.19, 0.121824, 42],
  [291.34, 1.844379, 40], [161.72, 24.198154, 37], [239.56, 25.513099, 35], [331.55, 3.592518, 23],
];
/** Meeus ch. 49: the instant of the new (integer k) or full (k + 0.5) moon numbered k from Jan 2000. */
function moonPhaseInstant(k: number): number {
  const t = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * t * t - 0.00000015 * t ** 3 + 0.00000000073 * t ** 4;
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const m = 2.5534 + 29.1053567 * k - 0.0000014 * t * t - 0.00000011 * t ** 3;
  const mp = 201.5643 + 385.81693528 * k + 0.0107582 * t * t + 0.00001238 * t ** 3 - 0.000000058 * t ** 4;
  const f = 160.7108 + 390.67050284 * k - 0.0016118 * t * t - 0.00000227 * t ** 3 + 0.000000011 * t ** 4;
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * t * t + 0.00000215 * t ** 3;
  const full = Math.abs(k % 1) > 0.25;
  jde += (full ? -0.40614 : -0.4072) * sin(mp) + (full ? 0.17302 : 0.17241) * e * sin(m) + (full ? 0.01614 : 0.01608) * sin(2 * mp)
    + (full ? 0.01043 : 0.01039) * sin(2 * f) + (full ? 0.00734 : 0.00739) * e * sin(mp - m) - (full ? 0.00515 : 0.00514) * e * sin(mp + m)
    + (full ? 0.00209 : 0.00208) * e * e * sin(2 * m) - 0.00111 * sin(mp - 2 * f) - 0.00057 * sin(mp + 2 * f) + 0.00056 * e * sin(2 * mp + m)
    - 0.00042 * sin(3 * mp) + 0.00042 * e * sin(m + 2 * f) + 0.00038 * e * sin(m - 2 * f) - 0.00024 * e * sin(2 * mp - m) - 0.00017 * sin(omega)
    - 0.00007 * sin(mp + 2 * m) + 0.00004 * sin(2 * mp - 2 * f) + 0.00004 * sin(3 * m) + 0.00003 * sin(mp + m - 2 * f) + 0.00003 * sin(2 * mp + 2 * f)
    - 0.00003 * sin(mp + m + 2 * f) + 0.00003 * sin(mp - m + 2 * f) - 0.00002 * sin(mp - m - 2 * f) - 0.00002 * sin(3 * mp + m) + 0.00002 * sin(4 * mp);
  PLANETARY.forEach(([base, rate, coefficient], index) => { jde += coefficient * 1e-6 * sin(base + rate * k + (index === 0 ? -0.009173 * t * t : 0)); });
  return (jde - 2440587.5) * DAY_MS - DELTA_T_SECONDS * 1000;
}

/** The first full or new moon strictly after `at`. */
export function nextMoonEvent(at: Date, kind: 'full' | 'new'): Date {
  const years = (julianDay(at.getTime()) - 2451545) / 365.25;
  let k = Math.floor(years * 12.3685) - 1 + (kind === 'full' ? 0.5 : 0);
  for (let step = 0; step < 6; step++, k++) {
    const instant = moonPhaseInstant(k);
    if (instant > at.getTime()) return new Date(instant);
  }
  return new Date(moonPhaseInstant(k));
}
