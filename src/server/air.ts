import { z } from 'zod';
import type { AirPollutant, AirQualityState, Settings } from '../shared/contracts.ts';
import type { FetchLike } from './weather.ts';

/**
 * Air quality for the saved weather location from the keyless Open-Meteo air-quality API (CAMS
 * model). Requested only while the widget is saved enabled (/api/state) or explicitly previewed
 * in the editor (/api/air-quality). Values are model estimates, never local sensor readings.
 */
export type AirScale = AirQualityState['scale'];
export const AIR_SOURCE_URL = 'https://open-meteo.com/en/docs/air-quality-api';
export const AIR_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TTL = 30 * 60_000;
const RETRY = 2 * 60_000;
const MAX_ENTRIES = 8;

/** Sub-indices per scale, in tie-break order. CAMS has no European carbon monoxide sub-index. */
export const AIR_SUB_INDICES: Record<AirScale, AirPollutant[]> = {
  us: ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide'],
  european: ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide'],
};
export function airCurrentFields(scale: AirScale): string[] {
  return [`${scale}_aqi`, ...AIR_SUB_INDICES[scale].map(pollutant => `${scale}_aqi_${pollutant}`), 'pm2_5', 'pm10', 'uv_index'];
}

/** A missing or non-finite value stays unknown; nothing is filled in. */
const value = z.number().finite().nullable().optional().catch(null).transform(item => item ?? null);
const validTimeZone = z.string().refine(item => { try { new Intl.DateTimeFormat('en', { timeZone: item }); return true; } catch { return false; } });
const payloadSchema = z.object({
  timezone: validTimeZone.optional().catch(undefined),
  current: z.object({ time: z.number().finite() }).catchall(z.unknown()),
  hourly: z.object({ time: z.array(z.number().finite()) }).catchall(z.unknown()),
});

export function offAirQuality(settings: Settings, scale: AirScale = settings.widgetData.airQuality.scale): AirQualityState {
  return { status: 'off', updatedAt: null, error: null, source: 'CAMS via Open-Meteo', sourceUrl: AIR_SOURCE_URL,
    location: structuredClone(settings.location), scale, current: null, hourly: [] };
}
function emptyAirQuality(settings: Settings, scale: AirScale): AirQualityState {
  return { ...offAirQuality(settings, scale), status: 'unavailable' };
}

export function normalizeAirQuality(payload: unknown, settings: Settings, scale: AirScale, now: number): AirQualityState {
  const data = payloadSchema.parse(payload);
  const read = (source: Record<string, unknown>, key: string) => value.parse(source[key]);
  const series = (key: string) => {
    const values = data.hourly[key];
    // A missing or misaligned series cannot be matched to its hours.
    if (!Array.isArray(values) || values.length !== data.hourly.time.length) throw new Error(`Incomplete air-quality series ${key}`);
    return values.map(item => value.parse(item));
  };
  const aqiSeries = series(`${scale}_aqi`), uvSeries = series('uv_index');
  const state = emptyAirQuality(settings, scale);
  if (settings.location.timezone === 'auto' && data.timezone) state.location.timezone = data.timezone;
  const subIndices = AIR_SUB_INDICES[scale].map(pollutant => ({ pollutant, index: read(data.current, `${scale}_aqi_${pollutant}`) }));
  let dominant: AirPollutant | null = null, highest = -Infinity;
  for (const { pollutant, index } of subIndices) if (index !== null && index > highest) { highest = index; dominant = pollutant; }
  state.status = 'fresh'; state.updatedAt = new Date(now).toISOString();
  state.current = {
    time: new Date(data.current.time * 1000).toISOString(), aqi: read(data.current, `${scale}_aqi`), dominant,
    pm2_5: read(data.current, 'pm2_5'), pm10: read(data.current, 'pm10'), uvIndex: read(data.current, 'uv_index'),
  };
  // Hourly values are instantaneous: keep the current hour and the upcoming ones.
  state.hourly = data.hourly.time.map((time, index) => ({ time: new Date(time * 1000).toISOString(), aqi: aqiSeries[index]!, uvIndex: uvSeries[index]! }))
    .filter(reading => Date.parse(reading.time) > now - 3600_000).slice(0, 24);
  return state;
}

interface Entry { state: AirQualityState; fetchedAt: number; retryAt: number; pending?: Promise<void> }
export class AirQualityService {
  #fetch: FetchLike;
  #now: () => number;
  #cache = new Map<string, Entry>();
  constructor(fetcher: FetchLike = fetch, now: () => number = Date.now) { this.#fetch = fetcher; this.#now = now; }

  async get(settings: Settings, scale: AirScale = settings.widgetData.airQuality.scale): Promise<AirQualityState> {
    const key = JSON.stringify([settings.location, scale]);
    let entry = this.#cache.get(key);
    if (!entry) {
      entry = { state: emptyAirQuality(settings, scale), fetchedAt: 0, retryAt: 0 };
      if (this.#cache.size >= MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(key, entry);
    }
    if (this.#now() >= entry.retryAt && (!entry.state.updatedAt || this.#now() - entry.fetchedAt >= TTL)) {
      entry.pending ??= this.#refresh(settings, scale, entry).finally(() => { delete entry!.pending; });
      await entry.pending;
    }
    const result = structuredClone(entry.state);
    if (result.updatedAt && this.#now() - entry.fetchedAt >= TTL) result.status = 'stale';
    return result;
  }

  async #refresh(settings: Settings, scale: AirScale, entry: Entry): Promise<void> {
    const url = new URL(AIR_ENDPOINT);
    url.search = new URLSearchParams({
      latitude: String(settings.location.latitude), longitude: String(settings.location.longitude),
      timezone: settings.location.timezone || 'auto', timeformat: 'unixtime', forecast_hours: '24',
      current: airCurrentFields(scale).join(','), hourly: `${scale}_aqi,uv_index`,
    }).toString();
    try {
      const response = await this.#fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      entry.state = normalizeAirQuality(await response.json(), settings, scale, this.#now());
      entry.fetchedAt = this.#now(); entry.retryAt = entry.fetchedAt + TTL;
    } catch {
      entry.state.status = entry.state.updatedAt ? 'stale' : 'unavailable';
      entry.state.error = entry.state.updatedAt ? 'Air quality update failed. Showing the last successful reading.' : 'Air quality is unavailable. Check the connection and location settings.';
      entry.retryAt = this.#now() + RETRY;
    }
  }
}
