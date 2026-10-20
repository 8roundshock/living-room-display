import type { AirQualityState, AlertsState, CountdownEvent, DynamicSources, Reminder, Settings, WeatherAlert, WeatherState, WidgetId } from '../shared/contracts.ts';
import { AIR_CREDIT, SCALE_LABELS, aqiCategory, uvCategory } from './air-categories.ts';
import { airAgeSegments, airReadingView, upcomingAirHours } from './airHourly.ts';
import { addDays, civilDateKey, formatDuration, localTimeZone, moonPhase, nextMoonEvent, sunDay, zoneFormatter, type MoonPhase } from './astronomy.ts';
import { countdownRows } from './calendar.ts';
import { ageLabel, civilDate, compactWeatherTime, lastKnownTime, NBSP, temperature, todayForecast, weatherTimeZone } from './format.ts';
import { conditionLabel } from './weather-conditions.ts';
import { rainOutlook, rainOutlookCopy, rainThreshold } from './weather-outlook.ts';

/**
 * The Dynamic widget's engine (#437): what matters now, from data the display already has, ranked by a
 * fixed table, or else a calm rotation on wall-clock slots. Pure and the single home of every Dynamic
 * constant; exported so Home (#438) can reuse it. Forecasts and model estimates never read as official:
 * only cards from the official alert providers use their words (see the wording guard in the tests).
 * Every threshold here is a product default, not an official criterion.
 */

/** One calm card per minute; a setting is #454. */
export const DYNAMIC_ROTATE_MS = 60_000;
/** The large family lists at most this many cards after the lead (fewer when they do not fit). */
export const DYNAMIC_ROWS_MAX = 3;
const MINUTE = 60_000, HOUR = 60 * MINUTE;
export const DYNAMIC_THRESHOLDS = {
  metric: { HEAT_HIGH: 32, COLD_FEELS: -27, COLD_LOW: -20, WIND_STRONG: 50, WIND_BREEZY: 39 },
  imperial: { HEAT_HIGH: 90, COLD_FEELS: -17, COLD_LOW: -4, WIND_STRONG: 31, WIND_BREEZY: 24 },
  /** "Hot today" stops at this hour in the weather city. */
  HEAT_UNTIL_HOUR: 18,
  AQI: { us: { notable: 101, focus: 151 }, european: { notable: 61, focus: 81 } },
  UV_HIGH: 6,
  REMINDER_SOON_MIN: 60,
  REMINDER_RECENT_OVERDUE_MIN: 120,
  REMINDER_MAX_CARDS: 3,
  SUN_MOMENT_MIN: 60,
  FULL_MOON_BEFORE_SUNSET_MIN: 180,
  /** An hour of the rest of today with this chance (or a measurable amount) makes the day wet. */
  WET_CHANCE: 30,
  /** "Next countdown" in the calm rotation is at least this many days away (sooner ones are notable). */
  COUNTDOWN_CALM_MIN_DAYS: 2,
} as const;

/** WMO codes per hazard family. */
export const HAZARD_FAMILIES = {
  hail: [96, 99], storm: [95], freezing: [56, 57, 66, 67], heavySnow: [75, 86], heavyRain: [65, 82],
} as const satisfies Record<string, readonly number[]>;
type Family = keyof typeof HAZARD_FAMILIES;
const familyOf = (code: number | null | undefined): Family | null => code == null ? null
  : (Object.keys(HAZARD_FAMILIES) as Family[]).find(family => (HAZARD_FAMILIES[family] as readonly number[]).includes(code)) ?? null;

/** The fixed scores (section 4 of the #437 spec). Higher wins; ties go to the earlier start, then the id. */
export const DYNAMIC_SCORES = {
  warning: 1100,
  watch: 1010, hailNow: 1000, stormNow: 990, freezingNow: 985, heavySnowNow: 980,
  hailToday: 970, stormToday: 960, freezingToday: 955, heavySnowToday: 950, advisory: 945,
  rainNow: 940, rainSoon: 930, heavyRain: 925, airUnhealthy: 920, windStrong: 915, coldFeels: 910, heatToday: 905, reminderDue: 900,
  statement: 885, rainPossibleSoon: 880, rainLater: 870, hazardUntimed: 865, severeTomorrow: 860, airSensitive: 850, uvHigh: 840,
  windy: 830, tempTomorrow: 825, countdownToday: 820, countdownTomorrow: 815, reminderToday: 810, reminderOverdue: 805,
  sunMoment: 800, fullMoonTonight: 790, precipitationPossible: 780,
} as const;

export type DynamicSource = keyof DynamicSources;
export type DynamicTier = 'alert' | 'focus' | 'notable' | 'calm';
export type DynamicTone = 'water' | 'sun' | 'time' | 'personal' | 'sky';
/** What the card's glyph slot draws; the renderer turns it into WeatherGlyph, Icon or MoonGlyph. */
export type DynamicGlyph =
  | { kind: 'weather'; code: number; isDay: boolean }
  | { kind: 'icon'; name: 'alert' | 'air' | 'wind' | 'sun' | 'sunrise' | 'moon' | 'check' | 'hourglass' | 'snow'; glyph?: 'sun' | 'moon' | 'snow' }
  | { kind: 'moon'; phase: MoonPhase; southern: boolean };
export interface DynamicPhrase { text: string; caution: boolean }
export interface DynamicCard {
  /** Stable across minutes, so the rotation latch and swaps follow the thing, not its wording. */
  id: string;
  source: DynamicSource;
  kind: string;
  tier: DynamicTier;
  score: number;
  /** When the thing starts (ms), for the tie-break; null sorts last. */
  start: number | null;
  /** A number to show in the glyph slot (an AQI, a temperature); null shows the glyph. */
  value: string | null;
  kicker: string;
  /** The kicker word itself uses the status tone (an official warning only). */
  kickerCaution: boolean;
  headline: string;
  /** The small family's headline. */
  compact: string;
  detail: string | null;
  /** The small family's one-line detail, when the full one would not fit (null: use `detail`). */
  detailCompact: string | null;
  /** A word before the detail in the status tone ("Overdue", as in Reminders). */
  detailFlag: string | null;
  glyph: DynamicGlyph | null;
  tone: DynamicTone;
  /** Where it comes from ("Forecast estimate", a provider, a place). */
  provenance: string | null;
  /** The small family's shorter provenance, when it has one. */
  provenanceShort: string | null;
  /** The data's age or freshness ("Saved forecast · Updated 2 hr ago" in the status tone). */
  age: DynamicPhrase | null;
  /** The large family's right-aligned row time. */
  time: string | null;
  /** The editor's summary words ("Rain soon"); never a private title. */
  label: string;
  official?: true;
}
/** A footer phrase about a source that is not the card's own. */
export interface DynamicStatus extends DynamicPhrase {
  source: DynamicSource | 'connection';
  /** Priority for the small family, which shows at most one; null never shows there. */
  smallRank: number | null;
  /** Shown by the large family only. */
  largeOnly?: true;
  /** Counts as a degraded source (so an empty widget reads as unavailable, not empty). */
  degraded: boolean;
}
export interface DynamicSignals {
  alert: DynamicCard[]; focus: DynamicCard[]; notable: DynamicCard[];
  /** The calm rotation after skipping what the board already shows (or every calm card when that would leave nothing). */
  calm: DynamicCard[];
  statuses: DynamicStatus[];
  degraded: boolean;
}
export interface DynamicInput {
  weather: WeatherState;
  airQuality: AirQualityState | undefined;
  alerts: AlertsState | undefined;
  reminders: Reminder[] | null | undefined;
  countdowns: readonly CountdownEvent[];
  sources: DynamicSources;
  onBoard: Partial<Record<WidgetId, boolean>>;
  clockFormat: Settings['clockFormat'];
  airScale: AirQualityState['scale'];
  now: number;
  disconnected: boolean;
  /** This computer's zone, for reminders and countdowns (defaults to the browser's). */
  localTimeZone?: string;
}

const BANNED = /\b(warning|warnings|alert|alerts|watch|watches|advisory|advisories)\b/i;
/** Official words belong to official cards only: everything else is checked against this (tests use it). */
export function soundsOfficial(text: string): boolean { return BANNED.test(text); }

/** The current wall-clock slot; the editor canvas and picker samples hold slot 0. No timer: the display's 1 s tick re-renders. */
export function rotationSlot(now: number, embedded: boolean): number {
  return embedded ? 0 : Math.floor(now / DYNAMIC_ROTATE_MS);
}

/** The shared age label with its number and unit kept together ("2 hr ago" never breaks, #221). */
function ageText(timestamp: string | null, now: number): string {
  return ageLabel(timestamp, now).replace(/(\d+) (\w+) ago$/, `$1${NBSP}$2${NBSP}ago`);
}

function byRank(a: DynamicCard, b: DynamicCard): number {
  return b.score - a.score || (a.start ?? Infinity) - (b.start ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface Context {
  input: DynamicInput; now: number; tz: string; local: string; metric: boolean;
  fresh: boolean; place: string;
  time: (ms: number, zone?: string) => string;
  /** "6 PM" today, "Tue 6 PM" on another day, in `zone`. */
  when: (ms: number, zone?: string) => string;
}

function card(partial: Omit<DynamicCard, 'value' | 'kickerCaution' | 'detail' | 'detailCompact' | 'detailFlag' | 'glyph' | 'provenance' | 'provenanceShort' | 'age' | 'time' | 'start'> & Partial<DynamicCard>): DynamicCard {
  return { value: null, kickerCaution: false, detail: null, detailCompact: null, detailFlag: null, glyph: null, provenance: null, provenanceShort: null, age: null, time: null, start: null, ...partial };
}
const toneForCode = (code: number | null): DynamicTone => {
  const family = familyOf(code);
  if (family === 'heavySnow' || (code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86))) return 'sky';
  if (family || (code !== null && code >= 51)) return 'water';
  return code === 0 || code === 1 ? 'sun' : 'sky';
};

// ---- Official alerts ---------------------------------------------------------------------------------

const LEVEL_WORDS: Record<WeatherAlert['level'], string> = { warning: 'Warning', watch: 'Watch', advisory: 'Advisory', statement: 'Statement' };
function alertEnded(alert: WeatherAlert, now: number): boolean {
  return [alert.endsAt, alert.expiresAt].some(value => value !== null && Date.parse(value) <= now);
}
function alertsAge(alerts: AlertsState, ctx: Context): DynamicPhrase | null {
  if (!alerts.checkedAt) return null;
  const at = ctx.time(Date.parse(alerts.checkedAt));
  if (ctx.input.disconnected) return { text: `Offline${NBSP}·${NBSP}checked ${at}`, caution: true };
  if (alerts.status === 'stale') return { text: `Saved alerts${NBSP}·${NBSP}checked ${at}`, caution: true };
  return { text: `Checked ${at}`, caution: false };
}
function alertCards(ctx: Context, statuses: DynamicStatus[]): DynamicCard[] {
  const { alerts, sources } = ctx.input;
  if (!sources.alerts || !alerts || alerts.status === 'off' || alerts.status === 'unsupported') return [];
  if (alerts.status === 'unavailable') {
    statuses.push({ source: 'alerts', text: 'Weather alerts unavailable', caution: true, smallRank: 1, degraded: true });
    return [];
  }
  const alive = alerts.alerts.filter(alert => !alertEnded(alert, ctx.now));
  const checked = alerts.checkedAt ? ctx.time(Date.parse(alerts.checkedAt)) : null;
  if (alerts.status === 'stale' && checked) statuses.push({ source: 'alerts', text: `Saved alerts${NBSP}·${NBSP}checked ${checked}`, caution: true, smallRank: null, degraded: false });
  // A confirmed empty list is said only where there is room, and never while the list is saved.
  if (alerts.status === 'fresh' && !alive.length && checked) statuses.push({ source: 'alerts', text: `No alerts${NBSP}·${NBSP}checked ${checked}`, caution: false, smallRank: null, largeOnly: true, degraded: false });
  const age = alertsAge(alerts, ctx);
  const source = alerts.source ?? 'Official weather alerts';
  return alive.map(alert => {
    const start = alert.startsAt ? Date.parse(alert.startsAt) : Date.parse(alert.issuedAt);
    const end = alert.endsAt ? Date.parse(alert.endsAt) : null;
    const parts = [start > ctx.now ? `From ${ctx.when(start)}` : null, end !== null ? `Until ${ctx.when(end)}` : null, alert.area].filter(Boolean) as string[];
    const tier: DynamicTier = alert.level === 'warning' ? 'alert' : alert.level === 'statement' ? 'notable' : 'focus';
    return card({
      id: `alert:${alert.id}`, source: 'alerts', kind: `official-${alert.level}`, tier, score: DYNAMIC_SCORES[alert.level], start,
      kicker: LEVEL_WORDS[alert.level], kickerCaution: alert.level === 'warning',
      headline: alert.name, compact: alert.name, detail: parts.join(` · `) || null, detailCompact: parts.slice(0, 2).filter(part => part !== alert.area).join(' · ') || null,
      // The alert icon sits in the kicker beside the level word; the headline takes the whole width.
      glyph: null, tone: 'sky',
      provenance: source, provenanceShort: alerts.provider === 'eccc' ? 'Environment Canada' : source, age,
      time: start > ctx.now ? ctx.time(start) : end !== null ? `Until ${ctx.time(end)}` : null, label: alert.name, official: true,
    });
  });
}

// ---- Weather -----------------------------------------------------------------------------------------

interface RestOfToday { hasData: boolean; wet: boolean; peak: number | null; firstWet: number | null }
/** The remaining hourly intervals of the weather city's civil today: wet when one has ≥30% or a measurable amount. */
export function restOfToday(weather: Pick<WeatherState, 'hourly' | 'units'>, now: number, timeZone: string): RestOfToday {
  const today = civilDate(now, timeZone), threshold = rainThreshold(weather.units.precipitation);
  const hours = weather.hourly.filter(hour => {
    const start = Date.parse(hour.intervalStart), end = Date.parse(hour.intervalEnd);
    return Number.isFinite(start) && Number.isFinite(end) && end > now && civilDate(Math.max(start, now), timeZone) === today;
  });
  const wetHours = hours.filter(hour => (hour.precipitationProbability ?? -1) >= DYNAMIC_THRESHOLDS.WET_CHANCE || (hour.precipitationAmount ?? 0) >= threshold);
  const chances = hours.map(hour => hour.precipitationProbability).filter((value): value is number => value !== null);
  return { hasData: hours.length > 0, wet: wetHours.length > 0, peak: chances.length ? Math.max(...chances) : null, firstWet: wetHours.length ? Date.parse(wetHours[0]!.intervalStart) : null };
}

const HAZARD_WORDS: Record<Family, { now: [string, string] | null; today: (code: number) => [string, string]; tomorrow: (code: number) => [string, string]; label: string }> = {
  hail: { now: ['Thunderstorms with hail', 'Storms with hail'], today: () => ['Thunderstorms with hail in today’s forecast', 'Storms with hail today'], tomorrow: () => ['Thunderstorms with hail tomorrow', 'Hail tomorrow'], label: 'Storms with hail' },
  storm: { now: ['Thunderstorms', 'Thunderstorms'], today: () => ['Thunderstorms in today’s forecast', 'Storms today'], tomorrow: () => ['Thunderstorms tomorrow', 'Storms tomorrow'], label: 'Thunderstorms' },
  freezing: { now: null, today: code => [`${conditionLabel(code)} in today’s forecast`, `${conditionLabel(code)} today`], tomorrow: code => [`${conditionLabel(code)} tomorrow`, `${conditionLabel(code)} tomorrow`], label: 'Freezing rain' },
  heavySnow: { now: ['Heavy snow', 'Heavy snow'], today: () => ['Heavy snow in today’s forecast', 'Heavy snow today'], tomorrow: () => ['Heavy snow tomorrow', 'Heavy snow tomorrow'], label: 'Heavy snow' },
  heavyRain: { now: ['Heavy rain', 'Heavy rain'], today: () => ['Heavy rain in today’s forecast', 'Heavy rain today'], tomorrow: () => ['Heavy rain tomorrow', 'Heavy rain tomorrow'], label: 'Heavy rain' },
};
const NOW_SCORES: Partial<Record<Family, number>> = { hail: DYNAMIC_SCORES.hailNow, storm: DYNAMIC_SCORES.stormNow, freezing: DYNAMIC_SCORES.freezingNow, heavySnow: DYNAMIC_SCORES.heavySnowNow };
const TODAY_SCORES: Partial<Record<Family, number>> = { hail: DYNAMIC_SCORES.hailToday, storm: DYNAMIC_SCORES.stormToday, freezing: DYNAMIC_SCORES.freezingToday, heavySnow: DYNAMIC_SCORES.heavySnowToday };

function localHour(now: number, timeZone: string): number {
  return Number(zoneFormatter(timeZone, { hour: '2-digit', hourCycle: 'h23' }).format(new Date(now))) % 24;
}

function weatherCards(ctx: Context, statuses: DynamicStatus[]): DynamicCard[] {
  const { weather, sources, disconnected } = ctx.input;
  if (!sources.weather) return [];
  if (weather.status === 'unavailable' || (!weather.current && !weather.daily.length && !weather.hourly.length)) {
    statuses.push({ source: 'weather', text: 'Weather unavailable', caution: true, smallRank: 2, degraded: true });
    return [];
  }
  if (weather.status === 'stale') statuses.push({ source: 'weather', text: 'Saved forecast', caution: true, smallRank: 3, degraded: false });
  const { now, tz } = ctx, thresholds = ctx.metric ? DYNAMIC_THRESHOLDS.metric : DYNAMIC_THRESHOLDS.imperial;
  const age: DynamicPhrase = {
    text: `${disconnected ? `Offline${NBSP}·${NBSP}` : weather.status === 'stale' ? `Saved forecast${NBSP}·${NBSP}` : ''}${ageText(weather.updatedAt, now)}`,
    caution: disconnected || weather.status !== 'fresh',
  };
  const estimate = { provenance: 'Forecast estimate', age } as const;
  const cards: DynamicCard[] = [];
  // Current conditions stand only while the shared last-known rule does not apply (#243, #411), and say
  // "Now" only for a fresh forecast on a connected display.
  const current = weather.current && !lastKnownTime(weather, disconnected, tz, ctx.input.clockFormat, now) ? weather.current : null;
  const updated = weather.updatedAt ? Date.parse(weather.updatedAt) : NaN;
  const asOf = ctx.fresh ? 'Now' : Number.isFinite(updated) ? `As of ${ctx.time(updated)}` : 'Saved reading';
  const today = todayForecast(weather.daily, tz, now);
  const tomorrowDate = addDays(civilDate(now, tz), 1);
  const tomorrow = weather.daily.find(day => day.date.slice(0, 10) === tomorrowDate);
  const rest = restOfToday(weather, now, tz);
  const outlook = rainOutlook(weather, now);
  const full = rainOutlookCopy(outlook, tz, ctx.input.clockFormat, now, 'full');
  const compact = rainOutlookCopy(outlook, tz, ctx.input.clockFormat, now, 'compact');
  const spellStart = outlook.firstSpell ? Date.parse(outlook.firstSpell.start) : null;
  const rainGlyph: DynamicGlyph = { kind: 'weather', code: 63, isDay: current?.isDay ?? true };

  // Rain: likely now or within six hours is focus; possible, later or precipitation possible is notable.
  let rainNear = false;
  if ((outlook.kind === 'now' || outlook.kind === 'soon') && full.headline) {
    rainNear = true;
    const likely = outlook.qualifier === 'likely';
    const score = likely ? (outlook.kind === 'now' ? DYNAMIC_SCORES.rainNow : DYNAMIC_SCORES.rainSoon) : DYNAMIC_SCORES.rainPossibleSoon;
    cards.push(card({
      id: 'weather:rain', source: 'weather', kind: `rain-${outlook.kind}`, tier: likely ? 'focus' : 'notable', score, start: spellStart,
      kicker: 'Weather', headline: full.headline, compact: compact.headline, detail: full.detail || null, glyph: rainGlyph, tone: 'water',
      provenance: full.confidence || 'Forecast estimate', age, time: outlook.kind === 'now' ? 'Now' : spellStart !== null ? ctx.time(spellStart) : null,
      label: outlook.kind === 'now' ? 'Rain now' : 'Rain soon',
    }));
  } else if (outlook.kind === 'later' && full.headline) {
    cards.push(card({
      id: 'weather:rain', source: 'weather', kind: 'rain-later', tier: 'notable', score: DYNAMIC_SCORES.rainLater, start: spellStart,
      kicker: 'Weather', headline: full.headline, compact: compact.headline, detail: full.detail || null, glyph: rainGlyph, tone: 'water',
      provenance: full.confidence || 'Forecast estimate', age, time: spellStart !== null ? ctx.time(spellStart) : null, label: 'Rain later',
    }));
  } else if (outlook.kind === 'possible' && full.headline) {
    cards.push(card({
      id: 'weather:rain', source: 'weather', kind: 'precipitation-possible', tier: 'notable', score: DYNAMIC_SCORES.precipitationPossible, start: null,
      kicker: 'Weather', headline: full.headline, compact: compact.headline, glyph: rainGlyph, tone: 'water',
      provenance: full.confidence || 'Forecast estimate', age, label: 'Precipitation possible',
    }));
  }

  // Hazards: one card, the strongest. A condition now beats today's forecast of it; today's forecast
  // counts only while the rest of the day is wet; heavy rain gives way to a rain-now or rain-soon card.
  const hazards: DynamicCard[] = [];
  const nowFamily = current ? familyOf(current.weatherCode) : null;
  if (current && nowFamily && nowFamily !== 'heavyRain') {
    const words = HAZARD_WORDS[nowFamily].now ?? [conditionLabel(current.weatherCode), conditionLabel(current.weatherCode)];
    hazards.push(card({
      id: 'weather:hazard', source: 'weather', kind: `${nowFamily}-now`, tier: 'focus', score: NOW_SCORES[nowFamily]!, start: now,
      kicker: 'Weather', headline: words[0], compact: words[1], detail: asOf, glyph: { kind: 'weather', code: current.weatherCode!, isDay: current.isDay },
      tone: toneForCode(current.weatherCode), ...estimate, label: words[1],
    }));
  }
  const todayFamily = familyOf(today?.weatherCode);
  if (today && todayFamily && todayFamily !== 'heavyRain' && todayFamily !== nowFamily) {
    const [headline, short] = HAZARD_WORDS[todayFamily].today(today.weatherCode!);
    const glyph: DynamicGlyph = { kind: 'weather', code: today.weatherCode!, isDay: true };
    if (!rest.hasData) {
      hazards.push(card({
        id: 'weather:hazard', source: 'weather', kind: `${todayFamily}-today`, tier: 'notable', score: DYNAMIC_SCORES.hazardUntimed, start: null,
        kicker: 'Weather', headline, compact: short, detail: 'Timing unavailable', glyph, tone: toneForCode(today.weatherCode), ...estimate, label: short,
      }));
    } else if (rest.wet) {
      hazards.push(card({
        id: 'weather:hazard', source: 'weather', kind: `${todayFamily}-today`, tier: 'focus', score: TODAY_SCORES[todayFamily]!, start: rest.firstWet,
        kicker: 'Weather', headline, compact: short, detail: rest.peak === null ? 'Rest of today' : `Up to ${rest.peak}% chance${NBSP}·${NBSP}rest of today`,
        detailCompact: rest.peak === null ? null : `Up to ${rest.peak}% chance`,
        glyph, tone: toneForCode(today.weatherCode), ...estimate, time: rest.firstWet !== null ? ctx.time(Math.max(rest.firstWet, now)) : null, label: short,
      }));
    }
  }
  const heavyRainCode = current && nowFamily === 'heavyRain' ? current.weatherCode : todayFamily === 'heavyRain' ? today!.weatherCode : null;
  if (heavyRainCode !== null && !rainNear && rest.wet) {
    hazards.push(card({
      id: 'weather:hazard', source: 'weather', kind: 'heavy-rain', tier: 'focus', score: DYNAMIC_SCORES.heavyRain, start: rest.firstWet,
      kicker: 'Weather', headline: 'Heavy rain in today’s forecast', compact: 'Heavy rain today',
      detail: rest.peak === null ? 'Rest of today' : `Up to ${rest.peak}% chance${NBSP}·${NBSP}rest of today`, detailCompact: rest.peak === null ? null : `Up to ${rest.peak}% chance`,
      glyph: { kind: 'weather', code: heavyRainCode, isDay: true }, tone: 'water', ...estimate, label: 'Heavy rain today',
    }));
  }
  if (hazards.length) cards.push(hazards.sort(byRank)[0]!);

  // Wind and cold from the current reading.
  if (current?.windSpeed != null) {
    const wind = Math.round(current.windSpeed), unit = weather.units.windSpeed;
    const strong = current.windSpeed >= thresholds.WIND_STRONG, windy = current.windSpeed >= thresholds.WIND_BREEZY;
    if (strong || windy) cards.push(card({
      id: 'weather:wind', source: 'weather', kind: strong ? 'wind-strong' : 'windy', tier: strong ? 'focus' : 'notable', score: strong ? DYNAMIC_SCORES.windStrong : DYNAMIC_SCORES.windy, start: now,
      kicker: 'Weather', headline: strong ? 'Strong wind' : 'Windy', compact: strong ? 'Strong wind' : 'Windy', value: `${wind}`,
      detail: `${wind}${NBSP}${unit}${NBSP}·${NBSP}${asOf}`, glyph: { kind: 'icon', name: 'wind' }, tone: 'sky', ...estimate, label: strong ? 'Strong wind' : 'Windy',
    }));
  }
  if (current?.feelsLike != null && current.feelsLike <= thresholds.COLD_FEELS) {
    cards.push(card({
      id: 'weather:cold', source: 'weather', kind: 'cold-feels', tier: 'focus', score: DYNAMIC_SCORES.coldFeels, start: now,
      kicker: 'Weather', headline: 'Very cold', compact: 'Very cold', value: temperature(current.feelsLike),
      detail: `Feels like ${temperature(current.feelsLike)}${NBSP}·${NBSP}${asOf}`, glyph: { kind: 'icon', name: 'snow', glyph: 'snow' }, tone: 'sky', ...estimate, label: 'Very cold',
    }));
  }
  // Heat from today's forecast high, until 18:00 in the weather city.
  if (today?.temperatureMax != null && today.temperatureMax >= thresholds.HEAT_HIGH && localHour(now, tz) < DYNAMIC_THRESHOLDS.HEAT_UNTIL_HOUR) {
    cards.push(card({
      id: 'weather:heat', source: 'weather', kind: 'heat-today', tier: 'focus', score: DYNAMIC_SCORES.heatToday, start: null,
      kicker: 'Weather', headline: 'Hot today', compact: 'Hot today', value: temperature(today.temperatureMax),
      detail: `High ${temperature(today.temperatureMax)}`, glyph: { kind: 'icon', name: 'sun', glyph: 'sun' }, tone: 'sun', ...estimate, label: 'Hot today',
    }));
  }
  // Tomorrow: a hazard family, then heat or deep cold.
  const tomorrowFamily = familyOf(tomorrow?.weatherCode);
  if (tomorrow && tomorrowFamily) {
    const [headline, short] = HAZARD_WORDS[tomorrowFamily].tomorrow(tomorrow.weatherCode!);
    cards.push(card({
      id: 'weather:tomorrow', source: 'weather', kind: `${tomorrowFamily}-tomorrow`, tier: 'notable', score: DYNAMIC_SCORES.severeTomorrow, start: null,
      kicker: 'Weather', headline, compact: short, detail: tomorrow.precipitationProbability === null ? 'Tomorrow' : `Up to ${tomorrow.precipitationProbability}% chance`,
      glyph: { kind: 'weather', code: tomorrow.weatherCode!, isDay: true }, tone: toneForCode(tomorrow.weatherCode), ...estimate, label: short,
    }));
  }
  if (tomorrow?.temperatureMax != null && tomorrow.temperatureMax >= thresholds.HEAT_HIGH) {
    cards.push(card({
      id: 'weather:tomorrow-temp', source: 'weather', kind: 'heat-tomorrow', tier: 'notable', score: DYNAMIC_SCORES.tempTomorrow, start: null,
      kicker: 'Weather', headline: 'Hot tomorrow', compact: 'Hot tomorrow', value: temperature(tomorrow.temperatureMax), detail: `High ${temperature(tomorrow.temperatureMax)}`,
      glyph: { kind: 'icon', name: 'sun', glyph: 'sun' }, tone: 'sun', ...estimate, label: 'Hot tomorrow',
    }));
  } else if (tomorrow?.temperatureMin != null && tomorrow.temperatureMin <= thresholds.COLD_LOW) {
    cards.push(card({
      id: 'weather:tomorrow-temp', source: 'weather', kind: 'cold-tomorrow', tier: 'notable', score: DYNAMIC_SCORES.tempTomorrow, start: null,
      kicker: 'Weather', headline: 'Very cold tomorrow', compact: 'Very cold tomorrow', value: temperature(tomorrow.temperatureMin), detail: `Low ${temperature(tomorrow.temperatureMin)}`,
      glyph: { kind: 'icon', name: 'snow', glyph: 'snow' }, tone: 'sky', ...estimate, label: 'Very cold tomorrow',
    }));
  }

  // Calm: conditions, today's high and low, and a dry spell (fresh, connected and complete only).
  if (current && current.weatherCode !== null) {
    const condition = conditionLabel(current.weatherCode);
    cards.push(card({
      id: 'weather:conditions', source: 'weather', kind: 'conditions', tier: 'calm', score: 0, start: null,
      kicker: 'Weather', headline: condition, compact: condition, value: temperature(current.temperature),
      detail: current.feelsLike === null ? asOf : `Feels like ${temperature(current.feelsLike)}${NBSP}·${NBSP}${asOf}`,
      glyph: { kind: 'weather', code: current.weatherCode, isDay: current.isDay }, tone: toneForCode(current.weatherCode), ...estimate, label: condition,
    }));
  }
  if (today && today.temperatureMax !== null && today.temperatureMin !== null) {
    const high = temperature(today.temperatureMax), low = temperature(today.temperatureMin);
    cards.push(card({
      id: 'weather:high-low', source: 'weather', kind: 'high-low', tier: 'calm', score: 0, start: null,
      kicker: 'Weather', headline: `High ${high}${NBSP}·${NBSP}Low ${low}`, compact: `${high} / ${low}`, detail: today.weatherCode === null ? 'Today' : `Today${NBSP}·${NBSP}${conditionLabel(today.weatherCode)}`,
      glyph: today.weatherCode === null ? null : { kind: 'weather', code: today.weatherCode, isDay: true }, tone: toneForCode(today.weatherCode), ...estimate,
      label: `High ${high}${NBSP}·${NBSP}low ${low}`,
    }));
  }
  if (outlook.kind === 'calm' && ctx.fresh) {
    cards.push(card({
      id: 'weather:dry', source: 'weather', kind: 'dry', tier: 'calm', score: 0, start: null,
      kicker: 'Weather', headline: 'Dry for the next 12 hours', compact: 'Dry for 12 hours', detail: 'No rain in the hourly forecast',
      glyph: current && current.weatherCode !== null && current.weatherCode < 45 ? { kind: 'weather', code: current.weatherCode, isDay: current.isDay } : { kind: 'weather', code: 3, isDay: true },
      tone: 'sky', ...estimate, label: 'Dry for 12 hours',
    }));
  }
  return cards;
}

// ---- Air and UV --------------------------------------------------------------------------------------

function airCards(ctx: Context, statuses: DynamicStatus[]): DynamicCard[] {
  const { airQuality: air, sources, disconnected, clockFormat } = ctx.input;
  if (!sources.air) return [];
  if (!air || air.status === 'off') {
    statuses.push({ source: 'air', text: 'Air quality not loaded yet', caution: false, smallRank: null, degraded: true });
    return [];
  }
  if (air.status === 'unavailable' || !air.current) {
    statuses.push({ source: 'air', text: 'Air quality unavailable', caution: true, smallRank: 4, degraded: true });
    return [];
  }
  const { now } = ctx, zone = weatherTimeZone(air.location.timezone), scale = air.scale ?? ctx.input.airScale;
  const view = airReadingView({ updatedAt: air.updatedAt, hourly: air.hourly }, air.current, now, zone, clockFormat);
  if (view.kind === 'lastKnown') {
    statuses.push({ source: 'air', text: 'Saved air reading', caution: true, smallRank: null, degraded: false });
    return [];
  }
  const segments = airAgeSegments({ age: ageText(air.updatedAt, now), stale: air.status === 'stale', reading: true, disconnected });
  if (view.kind === 'estimate') segments.splice(disconnected ? 1 : 0, 1, 'Saved estimate');
  const age: DynamicPhrase = { text: segments.join(`${NBSP}·${NBSP}`), caution: disconnected || air.status === 'stale' || view.kind === 'estimate' };
  const cards: DynamicCard[] = [];
  if (view.aqi !== null) {
    const aqi = Math.round(view.aqi), limits = DYNAMIC_THRESHOLDS.AQI[scale];
    const category = aqiCategory(aqi, scale)!, detail = `${SCALE_LABELS[scale]} ${aqi}`;
    const base = { id: 'air:aqi', source: 'air' as const, kicker: 'Air quality', value: String(aqi), detail, glyph: { kind: 'icon', name: 'air' } as DynamicGlyph, tone: 'sky' as const, provenance: AIR_CREDIT, age, start: null };
    if (aqi >= limits.focus) cards.push(card({ ...base, kind: 'air-unhealthy', tier: 'focus', score: DYNAMIC_SCORES.airUnhealthy, headline: `${category} air`, compact: `${category} air`, label: `${category} air` }));
    else if (aqi >= limits.notable) {
      const [headline, short] = scale === 'us' ? ['Unhealthy for sensitive groups', 'Sensitive groups'] : [`${category} air`, `${category} air`];
      cards.push(card({ ...base, kind: 'air-sensitive', tier: 'notable', score: DYNAMIC_SCORES.airSensitive, headline, compact: short, label: short }));
    } else cards.push(card({ ...base, id: 'air:calm', kind: 'air-calm', tier: 'calm', score: 0, headline: `${category} air`, compact: `${category} air`, label: `${category} air` }));
  }
  // UV from today's upcoming readings only: a peak that has already passed is never today's.
  const today = civilDateKey(new Date(now), zone);
  const upcoming = upcomingAirHours(air.hourly, now).filter(reading => reading.uvIndex !== null && civilDateKey(new Date(reading.time), zone) === today);
  const peak = upcoming.reduce<(typeof upcoming)[number] | null>((best, reading) => !best || reading.uvIndex! > best.uvIndex! ? reading : best, null);
  if (peak && Math.round(peak.uvIndex!) >= DYNAMIC_THRESHOLDS.UV_HIGH) {
    const value = Math.round(peak.uvIndex!), word = uvCategory(value), at = Date.parse(peak.time);
    cards.push(card({
      id: 'air:uv', source: 'air', kind: 'uv-high', tier: 'notable', score: DYNAMIC_SCORES.uvHigh, start: at,
      kicker: 'UV index', headline: `${word} UV today`, compact: `${word} UV`, value: String(value),
      detail: at <= now ? `UV ${value} this hour` : `Peaks ${value} at ${ctx.time(at, zone)}`, glyph: { kind: 'icon', name: 'sun', glyph: 'sun' }, tone: 'sun',
      provenance: AIR_CREDIT, age, time: ctx.time(at, zone), label: `${word} UV`,
    }));
  }
  return cards;
}

// ---- Sun and moon ------------------------------------------------------------------------------------

function skyCards(ctx: Context): DynamicCard[] {
  const { weather, sources } = ctx.input;
  if (!sources.sky) return [];
  const { now, tz } = ctx, { latitude, longitude } = weather.location, at = new Date(now);
  const today = civilDateKey(at, tz), sun = sunDay(today, latitude, longitude, tz);
  let next: { label: 'Sunrise' | 'Sunset'; at: number } | { label: 'Sun up all day' | 'Sun stays down today'; at: null };
  const polar = (value: 'day' | 'night') => value === 'day' ? 'Sun up all day' as const : 'Sun stays down today' as const;
  if (sun.polar) next = { label: polar(sun.polar), at: null };
  else if (now < sun.sunrise!.getTime()) next = { label: 'Sunrise', at: sun.sunrise!.getTime() };
  else if (now < sun.sunset!.getTime()) next = { label: 'Sunset', at: sun.sunset!.getTime() };
  else {
    const tomorrow = sunDay(addDays(today, 1), latitude, longitude, tz);
    next = tomorrow.sunrise ? { label: 'Sunrise', at: tomorrow.sunrise.getTime() } : { label: polar(tomorrow.polar ?? 'night'), at: null };
  }
  const daylight = sun.polar ? (sun.polar === 'day' ? '24 h daylight' : 'No daylight') : `${formatDuration(sun.daylightMinutes)} daylight`;
  const place = { provenance: ctx.place, tone: 'sun' as const, kicker: 'Sun & moon', source: 'sky' as const };
  const cards: DynamicCard[] = [];
  if (next.at !== null) {
    const minutes = Math.ceil((next.at - now) / MINUTE), headline = `${next.label} ${ctx.time(next.at)}`;
    const moment = minutes <= DYNAMIC_THRESHOLDS.SUN_MOMENT_MIN;
    cards.push(card({
      ...place, id: 'sky:sun', kind: moment ? 'sun-moment' : 'sun-next', tier: moment ? 'notable' : 'calm', score: moment ? DYNAMIC_SCORES.sunMoment : 0, start: next.at,
      headline, compact: headline, detail: moment ? `In ${minutes} min` : daylight, glyph: { kind: 'icon', name: 'sunrise', glyph: 'sun' },
      label: headline,
    }));
  } else {
    cards.push(card({
      ...place, id: 'sky:sun', kind: 'sun-polar', tier: 'calm', score: 0, headline: next.label, compact: next.label, detail: daylight,
      glyph: next.label === 'Sun up all day' ? { kind: 'icon', name: 'sun', glyph: 'sun' } : { kind: 'icon', name: 'moon', glyph: 'moon' }, label: next.label,
    }));
  }
  const phase = moonPhase(at), lit = `${Math.round(phase.illumination * 100)}% lit`;
  const glyph: DynamicGlyph = { kind: 'moon', phase, southern: latitude < 0 };
  const evening = sun.polar === 'night' || (!sun.polar && (now >= sun.sunset!.getTime() - DYNAMIC_THRESHOLDS.FULL_MOON_BEFORE_SUNSET_MIN * MINUTE || now < sun.sunrise!.getTime()));
  if (phase.name === 'Full moon' && evening) {
    cards.push(card({ ...place, tone: 'time', id: 'sky:moon', kind: 'full-moon-tonight', tier: 'notable', score: DYNAMIC_SCORES.fullMoonTonight, start: null, headline: 'Full moon tonight', compact: 'Full moon tonight', detail: lit, glyph, label: 'Full moon tonight' }));
  } else {
    // The next principal phase, named by weekday within the week ("Full moon Mon").
    const kind = phase.name === 'Full moon' ? 'New moon' : 'Full moon', when = nextMoonEvent(at, kind === 'Full moon' ? 'full' : 'new');
    const days = (Date.parse(`${civilDateKey(when, tz)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
    const day = days === 0 ? 'today' : days < 7 ? zoneFormatter(tz, { weekday: 'short' }).format(when) : zoneFormatter(tz, { month: 'short', day: 'numeric' }).format(when);
    const headline = `${kind} ${day}`;
    cards.push(card({ ...place, tone: 'time', id: 'sky:moon', kind: 'moon-phase', tier: 'calm', score: 0, start: null, headline, compact: headline, detail: `${phase.name}${NBSP}·${NBSP}${lit}`, glyph, label: headline }));
  }
  return cards;
}

// ---- Reminders and countdowns ------------------------------------------------------------------------

function relativeDay(ms: number, now: number, zone: string): string {
  const date = civilDate(ms, zone), today = civilDate(now, zone);
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return zoneFormatter(zone, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

function personalCards(ctx: Context, statuses: DynamicStatus[]): DynamicCard[] {
  const { reminders, countdowns, sources, disconnected } = ctx.input;
  if (!sources.personal) return [];
  const { now, local } = ctx, cards: DynamicCard[] = [];
  const offline = (what: string): DynamicPhrase | null => disconnected ? { text: `Saved ${what}${NBSP}·${NBSP}offline`, caution: true } : null;
  if (!Array.isArray(reminders)) statuses.push({ source: 'personal', text: 'Reminders unavailable', caution: true, smallRank: 5, degraded: true });
  else {
    const t = DYNAMIC_THRESHOLDS, today = civilDate(now, local);
    const chosen = reminders.flatMap(reminder => {
      const due = reminder.dueAt ? Date.parse(reminder.dueAt) : NaN;
      if (reminder.completed || !Number.isFinite(due)) return [];
      const until = (due - now) / MINUTE;
      const overdue = until < 0, base = { id: `reminder:${reminder.id}`, source: 'personal' as const, kicker: 'Reminder', headline: reminder.text, compact: reminder.text,
        start: due, glyph: { kind: 'icon', name: 'check' } as DynamicGlyph, tone: 'personal' as const, age: offline('reminders'), time: ctx.time(due, local),
        detail: `${relativeDay(due, now, local)}${NBSP}·${NBSP}${ctx.time(due, local)}` };
      if ((!overdue && until <= t.REMINDER_SOON_MIN) || (overdue && -until <= t.REMINDER_RECENT_OVERDUE_MIN)) {
        return [card({ ...base, kind: overdue ? 'reminder-overdue-recent' : 'reminder-soon', tier: 'focus', score: DYNAMIC_SCORES.reminderDue, detailFlag: overdue ? 'Overdue' : null, label: overdue ? 'Overdue reminder' : 'Reminder due soon' })];
      }
      if (overdue) return [card({ ...base, kind: 'reminder-overdue', tier: 'notable', score: DYNAMIC_SCORES.reminderOverdue, detailFlag: 'Overdue', label: 'Overdue reminder' })];
      if (civilDate(due, local) === today) return [card({ ...base, kind: 'reminder-today', tier: 'notable', score: DYNAMIC_SCORES.reminderToday, label: 'Reminder later today' })];
      return [];
    });
    cards.push(...chosen.sort(byRank).slice(0, t.REMINDER_MAX_CARDS));
  }
  // Countdowns use this computer's calendar, as the Countdown widget does.
  const rows = countdownRows(countdowns, civilDate(now, local));
  for (const row of rows) {
    if (row.days > 1) break;
    const today = row.days === 0;
    cards.push(card({
      id: `countdown:${row.event.id}`, source: 'personal', kind: today ? 'countdown-today' : 'countdown-tomorrow', tier: 'notable',
      score: today ? DYNAMIC_SCORES.countdownToday : DYNAMIC_SCORES.countdownTomorrow, start: null, kicker: 'Countdown', headline: row.event.title, compact: row.event.title,
      detail: `${today ? 'Today' : 'Tomorrow'}${NBSP}·${NBSP}${row.dateText}`, glyph: { kind: 'icon', name: 'hourglass' }, tone: 'personal', age: offline('dates'),
      time: today ? 'Today' : 'Tomorrow', label: today ? 'Countdown today' : 'Countdown tomorrow',
    }));
  }
  const later = rows.find(row => row.days >= DYNAMIC_THRESHOLDS.COUNTDOWN_CALM_MIN_DAYS);
  if (later) cards.push(card({
    id: 'countdown:next', source: 'personal', kind: 'countdown-next', tier: 'calm', score: 0, start: null, kicker: 'Countdown', headline: later.event.title, compact: later.event.title,
    detail: `In ${later.label.text}${NBSP}·${NBSP}${later.dateText}`, glyph: { kind: 'icon', name: 'hourglass' }, tone: 'personal', age: offline('dates'),
    time: later.label.text, label: 'Next countdown',
  }));
  return cards;
}

// ---- Signals, selection and rotation ----------------------------------------------------------------

/** Calm order, and the widget whose presence on the board makes each one redundant. */
const CALM_ORDER: { id: string; skipWith: WidgetId[] }[] = [
  { id: 'weather:conditions', skipWith: ['weather'] },
  { id: 'weather:high-low', skipWith: ['weather', 'forecast'] },
  { id: 'weather:dry', skipWith: ['weather'] },
  { id: 'sky:sun', skipWith: ['sunMoon'] },
  { id: 'sky:moon', skipWith: ['sunMoon'] },
  { id: 'countdown:next', skipWith: ['countdown'] },
  { id: 'air:calm', skipWith: ['airQuality'] },
];

/** Every card Dynamic could show now, by tier, plus the footer's status phrases. Pure; callers memoize per minute. */
export function dynamicSignals(input: DynamicInput): DynamicSignals {
  const now = input.now;
  const tz = weatherTimeZone(input.weather.location.timezone);
  const local = input.localTimeZone ?? localTimeZone();
  const time = (ms: number, zone = tz) => compactWeatherTime(new Date(ms).toISOString(), zone, input.clockFormat);
  const ctx: Context = {
    input, now, tz, local, metric: input.weather.units.temperature !== '°F', fresh: input.weather.status === 'fresh' && !input.disconnected,
    place: input.weather.location.name, time,
    when: (ms, zone = tz) => civilDate(ms, zone) === civilDate(now, zone) ? time(ms, zone) : `${zoneFormatter(zone, { weekday: 'short' }).format(new Date(ms))}${NBSP}${time(ms, zone)}`,
  };
  const statuses: DynamicStatus[] = [];
  if (input.disconnected) statuses.push({ source: 'connection', text: 'Offline', caution: true, smallRank: 0, degraded: true });
  const cards = [...alertCards(ctx, statuses), ...weatherCards(ctx, statuses), ...airCards(ctx, statuses), ...skyCards(ctx), ...personalCards(ctx, statuses)];
  const tier = (name: DynamicTier) => cards.filter(item => item.tier === name).sort(byRank);
  const calmCards = CALM_ORDER.flatMap(({ id }) => cards.filter(item => item.tier === 'calm' && item.id === id));
  const kept = calmCards.filter(item => !CALM_ORDER.find(entry => entry.id === item.id)!.skipWith.some(widget => input.onBoard[widget]));
  const notable = tier('notable');
  statuses.sort((a, b) => (a.smallRank ?? 99) - (b.smallRank ?? 99));
  return {
    alert: tier('alert'), focus: tier('focus'), notable,
    calm: kept.length || notable.length ? kept : calmCards,
    statuses, degraded: statuses.some(status => status.degraded),
  };
}

/** Memoizes dynamicSignals on its inputs' identities and the minute, so no formatter work repeats while the minute holds (#99, #185). */
export function memoizeDynamicSignals(): (input: DynamicInput) => DynamicSignals {
  let last: { key: unknown[]; value: DynamicSignals } | null = null;
  return input => {
    const minute = Math.floor(input.now / MINUTE);
    const key = [input.weather, input.airQuality, input.alerts, input.reminders, input.countdowns, input.sources, input.onBoard, input.clockFormat, input.airScale, minute, input.disconnected, input.localTimeZone];
    if (last && key.every((value, index) => Object.is(value, last!.key[index]))) return last.value;
    last = { key, value: dynamicSignals({ ...input, now: minute * MINUTE }) };
    return last.value;
  };
}

export type DynamicMode = 'alert' | 'focus' | 'rotate' | 'unavailable' | 'empty';
export interface DynamicChoice {
  mode: DynamicMode;
  lead: DynamicCard | null;
  /**
   * What follows the lead, up to the limit asked for: the large family's rows and the editor's "Next".
   * After a warning or focus lead come the other warnings and focus cards, the notable ones, then the
   * calm rotation as filler; in rotation, the cards that follow, wrapping.
   */
  also: DynamicCard[];
  /** How many warning, focus and notable cards follow a warning or focus lead ("+2 more"); calm filler never counts. */
  more: number;
  /** "1 of 2" while several warnings take turns. */
  position: { index: number; count: number } | null;
}
export interface DynamicPrevious { slot: number; id: string }

/**
 * What to show in a slot. Official warnings come first and take turns by slot; otherwise the strongest
 * focus card stays put; otherwise the notable cards then the calm ones rotate, one per slot. A card shown
 * earlier in the same slot stays (the latch), so a change mid-minute never jumps the rotation, while a new
 * or stronger warning or focus card replaces the lead at once.
 */
export function chooseDynamic(signals: DynamicSignals, slot: number, previous: DynamicPrevious | null, alsoLimit: number): DynamicChoice {
  const limit = Math.max(0, alsoLimit);
  if (signals.alert.length) {
    const count = signals.alert.length, index = ((slot % count) + count) % count, lead = signals.alert[index]!;
    const rest = [...signals.alert.slice(index + 1), ...signals.alert.slice(0, index), ...signals.focus, ...signals.notable];
    return { mode: 'alert', lead, also: [...rest, ...signals.calm].slice(0, limit), more: rest.length, position: count > 1 ? { index, count } : null };
  }
  if (signals.focus.length) {
    const [lead, ...others] = signals.focus as [DynamicCard, ...DynamicCard[]];
    const rest = [...others, ...signals.notable];
    return { mode: 'focus', lead, also: [...rest, ...signals.calm].slice(0, limit), more: rest.length, position: null };
  }
  const rotation = [...signals.notable, ...signals.calm];
  if (!rotation.length) return { mode: signals.degraded ? 'unavailable' : 'empty', lead: null, also: [], more: 0, position: null };
  const latched = previous && previous.slot === slot ? rotation.findIndex(item => item.id === previous.id) : -1;
  const index = latched >= 0 ? latched : ((slot % rotation.length) + rotation.length) % rotation.length;
  const rest = [...rotation.slice(index + 1), ...rotation.slice(0, index)];
  return { mode: 'rotate', lead: rotation[index]!, also: rest.slice(0, limit), more: 0, position: null };
}

/** The inspector's summary line: "Now showing: Rain soon. Next: Sunset 6:29 PM, Full moon Mon." */
export function dynamicSummary(choice: DynamicChoice): string {
  if (!choice.lead) return choice.mode === 'unavailable' ? 'Nothing to show while its sources are unavailable.' : 'Nothing to show yet.';
  const next = choice.also.slice(0, 2).map(item => item.label);
  return `Now showing: ${choice.lead.label}.${next.length ? ` Next: ${next.join(', ')}.` : ''}`;
}
