import { z } from 'zod';
import type { LocationResult, Settings, WeatherState } from '../shared/contracts.ts';

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
const geocodeSchema = z.object({ results: z.array(z.object({
  id: z.number(), name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  timezone: z.string(), country: z.string().optional(), admin1: z.string().optional(),
})).optional() });
const TTL = 15 * 60_000;
const RETRY = 60_000;

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
  }).filter(interval => Date.parse(interval.intervalEnd) > now).slice(0, 24);
  return state;
}

interface Entry { state: WeatherState; fetchedAt: number; retryAt: number; pending?: Promise<void> }
export class WeatherService {
  #fetch: FetchLike;
  #now: () => number;
  #cache = new Map<string, Entry>();
  #locations = new Map<string, { expires: number; value: LocationResult[] }>();
  constructor(fetcher: FetchLike = fetch, now: () => number = Date.now) { this.#fetch = fetcher; this.#now = now; }

  async get(settings: Settings): Promise<WeatherState> {
    const key = JSON.stringify([settings.location, settings.units]);
    let entry = this.#cache.get(key);
    if (!entry) {
      entry = { state: emptyWeather(settings), fetchedAt: 0, retryAt: 0 };
      if (this.#cache.size >= 8) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(key, entry);
    }
    if (this.#now() >= entry.retryAt && (!entry.state.updatedAt || this.#now() - entry.fetchedAt >= TTL)) {
      entry.pending ??= this.#refresh(settings, entry).finally(() => { delete entry!.pending; });
      await entry.pending;
    }
    const result = structuredClone(entry.state);
    if (result.updatedAt && this.#now() - entry.fetchedAt >= TTL) result.status = 'stale';
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
      entry.state = normalizeForecast(await response.json(), settings, this.#now());
      entry.fetchedAt = this.#now(); entry.retryAt = entry.fetchedAt + TTL;
    } catch {
      entry.state.status = entry.state.updatedAt ? 'stale' : 'unavailable';
      entry.state.error = entry.state.updatedAt ? 'Weather update failed. Showing the last successful forecast.' : 'Weather is unavailable. Check the connection and location settings.';
      entry.retryAt = this.#now() + RETRY;
    }
  }

  async locations(query: string): Promise<LocationResult[]> {
    const cached = this.#locations.get(query.toLocaleLowerCase());
    if (cached && cached.expires > this.#now()) return structuredClone(cached.value);
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString();
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('City search is unavailable. Try again later.');
    const data = geocodeSchema.parse(await response.json());
    const value = (data.results ?? []).map(item => ({ ...item, country: item.country ?? '', admin1: item.admin1 ?? '' }));
    if (this.#locations.size >= 50) this.#locations.delete(this.#locations.keys().next().value!);
    this.#locations.set(query.toLocaleLowerCase(), { expires: this.#now() + 3600_000, value });
    return structuredClone(value);
  }
}
