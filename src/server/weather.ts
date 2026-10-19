import { z } from 'zod';
import type { LocationResult, Settings, WeatherState } from '../shared/contracts.ts';
import { location as locationSchema, timezone as ianaTimezone } from './validation.ts';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
const nullableNumber = z.number().finite().nullable();
const series = z.array(nullableNumber);
const forecastSchema = z.object({
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).optional(),
  utc_offset_seconds: z.number(),
  current: z.object({ time: z.number(), temperature_2m: nullableNumber, apparent_temperature: nullableNumber, weather_code: nullableNumber, is_day: z.number(), wind_speed_10m: nullableNumber }),
  daily: z.object({ time: z.array(z.number()).min(7), weather_code: series, temperature_2m_max: series, temperature_2m_min: series, precipitation_probability_max: series, precipitation_sum: series }),
  hourly: z.object({ time: z.array(z.number()), precipitation_probability: series, precipitation: series, rain: series, showers: series }),
});
const geocodeSchema = z.object({ results: z.array(z.unknown()).optional() });
/** Settings' own name limit, so a chosen city can always be saved (#246). */
const NAME_LIMIT = locationSchema.shape.name.maxLength ?? 100;
function trimName(value: string): string {
  const name = value.trim();
  if (name.length <= NAME_LIMIT) return name;
  // Never split a surrogate pair at the limit.
  const end = /[\uD800-\uDBFF]/.test(name[NAME_LIMIT - 1]!) ? NAME_LIMIT - 1 : NAME_LIMIT;
  return name.slice(0, end).trimEnd();
}
/** One usable result: an id, a name, in-range coordinates and an IANA timezone that Save accepts. */
const geocodeItem = z.object({
  id: z.number(), name: z.string().transform(trimName).pipe(z.string().min(1)),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: ianaTimezone,
  country: z.string().optional().catch(undefined), admin1: z.string().optional().catch(undefined),
});
const TTL = 15 * 60_000;
const RETRY = 60_000;
const LOCATION_TTL = 3600_000;

/** The same tolerance the display uses before it calls an update time unknown. */
export const FUTURE_TOLERANCE = 2 * 60_000;
/** Wall and monotonic readings of one moment (#244). */
export interface Stamp { wall: number; mono: number }
/**
 * Refresh timing uses whichever clock says more time has passed: the monotonic clock keeps counting
 * when the wall clock is set back (a fast hardware clock corrected after boot), and the wall clock
 * still counts a sleep that a monotonic clock may skip. Only the displayed `updatedAt` comes from the
 * wall clock alone. A fake wall clock without a monotonic one serves as both, so tests that move one
 * clock keep working.
 */
export class RefreshClock {
  readonly wall: () => number;
  readonly mono: () => number;
  constructor(wall: () => number = Date.now, mono?: () => number) { this.wall = wall; this.mono = mono ?? (wall === Date.now ? () => performance.now() : wall); }
  stamp(): Stamp { return { wall: this.wall(), mono: this.mono() }; }
  since(stamp: Stamp): number { return Math.max(this.mono() - stamp.mono, this.wall() - stamp.wall); }
  /** A saved update time this far ahead of the wall clock means the clock went back: refresh rather than trust it. */
  inFuture(timestamp: string | null): boolean { return timestamp !== null && Date.parse(timestamp) - this.wall() > FUTURE_TOLERANCE; }
}
/** Due when nothing is saved, the saved data is older than `ttl` or dated in the future; never inside a failure's back-off. */
export function refreshDue(clock: RefreshClock, entry: { fetched: Stamp | null; failed: Stamp | null; state: { updatedAt: string | null } }, ttl: number, retry: number): boolean {
  if (entry.failed && clock.since(entry.failed) < retry) return false;
  return !entry.fetched || !entry.state.updatedAt || clock.since(entry.fetched) >= ttl || clock.inFuture(entry.state.updatedAt);
}

export function emptyWeather(settings: Settings): WeatherState {
  return { status: 'unavailable', updatedAt: null, error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/',
    location: structuredClone(settings.location), units: settings.units === 'imperial'
      ? { temperature: '°F', windSpeed: 'mph', precipitation: 'in' }
      : { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
    current: null, daily: [], hourly: [],
  };
}

export function normalizeForecast(payload: unknown, settings: Settings, now: number): WeatherState {
  const data = forecastSchema.parse(payload);
  for (const group of [data.daily, data.hourly]) {
    if (Object.values(group).some(values => values.length !== group.time.length)) throw new Error('Incomplete forecast series');
  }
  const state = emptyWeather(settings);
  if (settings.location.timezone === 'auto') {
    if (!data.timezone) throw new Error('The forecast did not resolve the device timezone');
    state.location.timezone = data.timezone;
  }
  const current = data.current;
  state.status = 'fresh'; state.updatedAt = new Date(now).toISOString();
  // Drop only hours that both this computer and the provider consider over, and keep 24 beyond this
  // computer's clock: a fast clock at arrival must not discard the hours that are actually upcoming, nor
  // a provider hour this clock already passed shorten the window (#244). The display filters expired hours again.
  const reference = Math.min(now, current.time * 1000);
  state.current = { time: new Date(current.time * 1000).toISOString(), temperature: current.temperature_2m,
    feelsLike: current.apparent_temperature, weatherCode: current.weather_code, isDay: current.is_day === 1, windSpeed: current.wind_speed_10m };
  state.daily = data.daily.time.slice(0, 7).map((time, index) => ({
    // The API uses its request-time fixed offset for daily boundaries, even across DST.
    date: new Date((time + data.utc_offset_seconds) * 1000).toISOString().slice(0, 10),
    weatherCode: data.daily.weather_code[index] ?? null, temperatureMax: data.daily.temperature_2m_max[index] ?? null,
    temperatureMin: data.daily.temperature_2m_min[index] ?? null,
    precipitationProbability: data.daily.precipitation_probability_max[index] ?? null,
    precipitationAmount: data.daily.precipitation_sum[index] ?? null,
  }));
  state.hourly = data.hourly.time.map((time, index) => {
    const rain = data.hourly.rain[index]; const showers = data.hourly.showers[index];
    return {
      // Both hourly probability and amount describe the PRECEDING hour, not the following hour.
      intervalStart: new Date((time - 3600) * 1000).toISOString(), intervalEnd: new Date(time * 1000).toISOString(),
      precipitationProbability: data.hourly.precipitation_probability[index] ?? null,
      precipitationAmount: data.hourly.precipitation[index] ?? null,
      rainAmount: rain != null && showers != null ? rain + showers : null,
    };
  }).filter(interval => Date.parse(interval.intervalEnd) > reference);
  state.hourly = state.hourly.slice(0, 24 + state.hourly.filter(interval => Date.parse(interval.intervalEnd) <= now).length);
  return state;
}

interface Entry { state: WeatherState; fetched: Stamp | null; failed: Stamp | null; pending?: Promise<void> }
export class WeatherService {
  #fetch: FetchLike;
  #clock: RefreshClock;
  #cache = new Map<string, Entry>();
  #locations = new Map<string, { cached: Stamp; value: LocationResult[] }>();
  constructor(fetcher: FetchLike = fetch, now: () => number = Date.now, monotonic?: () => number) { this.#fetch = fetcher; this.#clock = new RefreshClock(now, monotonic); }

  async get(settings: Settings): Promise<WeatherState> {
    const key = JSON.stringify([settings.location, settings.units]);
    let entry = this.#cache.get(key);
    if (!entry) {
      entry = { state: emptyWeather(settings), fetched: null, failed: null };
      if (this.#cache.size >= 8) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(key, entry);
    }
    if (refreshDue(this.#clock, entry, TTL, RETRY)) {
      entry.pending ??= this.#refresh(settings, entry).finally(() => { delete entry!.pending; });
      await entry.pending;
    }
    const result = structuredClone(entry.state);
    if (result.updatedAt && entry.fetched && this.#clock.since(entry.fetched) >= TTL) result.status = 'stale';
    return result;
  }

  async #refresh(settings: Settings, entry: Entry): Promise<void> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(settings.location.latitude), longitude: String(settings.location.longitude),
      timezone: settings.location.timezone, timeformat: 'unixtime', forecast_days: '7',
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
      hourly: 'precipitation_probability,precipitation,rain,showers',
      temperature_unit: settings.units === 'imperial' ? 'fahrenheit' : 'celsius',
      wind_speed_unit: settings.units === 'imperial' ? 'mph' : 'kmh', precipitation_unit: settings.units === 'imperial' ? 'inch' : 'mm',
    }).toString();
    try {
      const response = await this.#fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      entry.state = normalizeForecast(await response.json(), settings, this.#clock.wall());
      entry.fetched = this.#clock.stamp(); entry.failed = null;
    } catch {
      entry.state.status = entry.state.updatedAt ? 'stale' : 'unavailable';
      entry.state.error = entry.state.updatedAt ? 'Weather update failed. Showing the last successful forecast.' : 'Weather is unavailable. Check the connection and location settings.';
      entry.failed = this.#clock.stamp();
    }
  }

  async locations(query: string): Promise<LocationResult[]> {
    const cached = this.#locations.get(query.toLocaleLowerCase());
    if (cached && this.#clock.since(cached.cached) < LOCATION_TTL) return structuredClone(cached.value);
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString();
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('City search is unavailable. Try again later.');
    const data = geocodeSchema.parse(await response.json());
    // Each result is checked on its own (#246): one without a usable timezone or coordinates is left
    // out instead of failing the whole search, and every result offered can be saved as the city.
    const value: LocationResult[] = (data.results ?? []).flatMap(item => {
      const result = geocodeItem.safeParse(item);
      return result.success ? [{ ...result.data, country: result.data.country ?? '', admin1: result.data.admin1 ?? '' }] : [];
    });
    if (this.#locations.size >= 50) this.#locations.delete(this.#locations.keys().next().value!);
    this.#locations.set(query.toLocaleLowerCase(), { cached: this.#clock.stamp(), value });
    return structuredClone(value);
  }
}
