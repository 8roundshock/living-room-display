import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AlertsProvider, AlertsSource, AlertsState, Settings, WeatherAlert } from '../shared/contracts.ts';
import { REFRESH_WAIT_MS, RefreshClock, waitAtMost, type FetchLike, type Stamp } from './weather.ts';

/**
 * Official weather alerts for the saved weather location (#437), for the Dynamic widget only.
 *
 * - Canada: Environment and Climate Change Canada through MSC GeoMet (api.weather.gc.ca). The place's
 *   public standard forecast zones are looked up once a day; an alert counts only when it names one of
 *   those zones, so a neighbouring zone's warning never reads as local.
 * - United States: the National Weather Service (api.weather.gov) by point; its first answer confirms
 *   coverage, and "out of bounds" means not covered.
 * - Anywhere else: `unsupported`, with no request at all.
 *
 * Only coordinates rounded to 0.01° leave this computer, and only to the provider whose region contains
 * them. Names are the provider's own words (ECCC's with only the first letter capitalised, as its licence
 * forbids altering content or intent). The state is API-only: never persisted, exported or logged.
 */
const APP_VERSION = String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? 'unknown');
export const ALERTS_USER_AGENT = `LivingRoomDisplay/${APP_VERSION} (local ambient display)`;
export const ALERT_SOURCES: Record<AlertsProvider, { source: AlertsSource; url: string }> = {
  eccc: { source: 'Environment and Climate Change Canada', url: 'https://weather.gc.ca/' },
  nws: { source: 'US National Weather Service', url: 'https://www.weather.gov/' },
};
export const ECCC_ZONES_URL = 'https://api.weather.gc.ca/collections/public-standard-forecast-zones/items';
export const ECCC_ALERTS_URL = 'https://api.weather.gc.ca/collections/weather-alerts/items';
export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
const MINUTE = 60_000, HOUR = 60 * MINUTE;
/** Every interval the service keeps; each counts by the monotonic-and-wall rule (#244). */
export const ALERTS_TIMING = {
  /** A successful check is repeated after this long. */
  refresh: 5 * MINUTE,
  /** A failed check is retried after this long. */
  retry: 2 * MINUTE,
  /** The last success is this old: the alerts read as saved. */
  stale: 15 * MINUTE,
  /** No success for this long and nothing still in effect: unavailable rather than saved. */
  unavailable: 2 * HOUR,
  /** A place's coverage (its ECCC zones, or that no provider covers it) is kept this long. */
  coverage: 24 * HOUR,
  /** A failed coverage lookup is retried after this long. */
  coverageRetry: 5 * MINUTE,
  /** Retry-After from a 429 or 503 is honoured up to this long. */
  retryAfterCap: HOUR,
} as const;
/** Requests to one provider in any hour, whatever the number of places. */
export const ALERTS_REQUESTS_PER_HOUR = 12;
export const ALERTS_TIMEOUT_MS = 8000;
export const ALERTS_BODY_LIMIT = 1024 * 1024;
const MAX_ENTRIES = 8, MAX_ALERTS = 10, NAME_LIMIT = 80, AREA_LIMIT = 100;
/** Each provider's region, as a box around its coverage; the provider itself has the last word. */
export const CANADA_BOX = { south: 41.6, north: 83.2, west: -141.1, east: -52.5 };
export const US_BOX = { south: 17.5, north: 71.6, west: -180, east: -64.5 };
const LEVEL_ORDER: WeatherAlert['level'][] = ['warning', 'watch', 'advisory', 'statement'];

/** The location key: the saved weather location rounded to 0.01°, the only precision any provider receives. */
export function roundedPoint(settings: Pick<Settings, 'location'>): { latitude: number; longitude: number } {
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  return { latitude: round(settings.location.latitude), longitude: round(settings.location.longitude) };
}
const inside = (box: typeof CANADA_BOX, latitude: number, longitude: number) => latitude >= box.south && latitude <= box.north && longitude >= box.west && longitude <= box.east;
/** The ± 0.005° box ECCC is asked about (minimum longitude, latitude, maximum longitude, latitude). */
function bbox(latitude: number, longitude: number): string {
  return [longitude - 0.005, latitude - 0.005, longitude + 0.005, latitude + 0.005].map(value => value.toFixed(3)).join(',');
}

export function offAlerts(): AlertsState {
  return { status: 'off', provider: null, source: null, sourceUrl: null, area: null, checkedAt: null, error: null, alerts: [] };
}

/** An instant the provider gave, normalised to UTC ISO; anything unreadable fails the feature (or is null where optional). */
const instant = z.string().refine(value => Number.isFinite(Date.parse(value)), 'Not a time').transform(value => new Date(value).toISOString());
const optionalInstant = instant.nullish().catch(null).transform(value => value ?? null);
const optionalText = z.string().nullish().catch(null).transform(value => value?.trim() || null);
/** Cut to `limit` characters without splitting a surrogate pair; the provider's words are otherwise unchanged. */
function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const end = /[\uD800-\uDBFF]/.test(value[limit - 2]!) ? limit - 2 : limit - 1;
  return `${value.slice(0, end).trimEnd()}…`;
}
const featureList = z.object({ features: z.array(z.unknown()) });
const ecccZone = z.object({ properties: z.object({ FEATURE_ID: z.string().min(1), NAME: z.string().trim().min(1) }) });
const ecccAlert = z.object({
  id: z.string().min(1),
  properties: z.object({
    alert_type: z.enum(['warning', 'watch', 'advisory', 'statement']),
    alert_name_en: z.string().trim().min(1),
    feature_id: z.string().min(1),
    feature_name_en: optionalText,
    publication_datetime: instant,
    validity_datetime: optionalInstant,
    event_end_datetime: optionalInstant,
    expiration_datetime: optionalInstant,
    status_en: optionalText,
  }),
});
const nwsAlert = z.object({
  properties: z.object({
    id: z.string().min(1),
    areaDesc: optionalText,
    sent: instant,
    effective: optionalInstant,
    onset: optionalInstant,
    expires: optionalInstant,
    ends: optionalInstant,
    status: z.string(),
    messageType: z.string(),
    urgency: optionalText,
    event: z.string().trim().min(1),
  }),
});

/** Ended once its end or its expiry has passed. */
function ended(alert: Pick<WeatherAlert, 'endsAt' | 'expiresAt'>, now: number): boolean {
  return [alert.endsAt, alert.expiresAt].some(value => value !== null && Date.parse(value) <= now);
}
function byLevel(a: WeatherAlert, b: WeatherAlert): number {
  return LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
    || Date.parse(a.startsAt ?? a.issuedAt) - Date.parse(b.startsAt ?? b.issuedAt) || a.id.localeCompare(b.id);
}
/** "winter storm warning" → "Winter storm warning": only the first letter changes. */
function firstCapital(value: string): string { return value.charAt(0).toLocaleUpperCase('en-CA') + value.slice(1); }

/**
 * ECCC alerts for the place's zones. Each feature is one alert in one zone (`<alert id>_<zone id>`): a
 * feature outside the zone set (a neighbour's alert that the small box also touched) is left out, ended
 * and cancelled alerts and passed ones are dropped, and one alert covering several of the place's zones
 * counts once. Each feature is checked on its own (#246): a malformed one is skipped, not the list.
 */
export function normalizeEcccAlerts(payload: unknown, zones: ReadonlySet<string>, now: number): WeatherAlert[] {
  const seen = new Map<string, WeatherAlert>();
  for (const item of featureList.parse(payload).features) {
    const parsed = ecccAlert.safeParse(item);
    if (!parsed.success) continue;
    const { id, properties: p } = parsed.data;
    if (!zones.has(p.feature_id) || /ended|cancel/i.test(p.status_en ?? '')) continue;
    const key = id.split('_fea')[0]!;
    const alert: WeatherAlert = {
      id: key, level: p.alert_type, name: clip(firstCapital(p.alert_name_en), NAME_LIMIT), area: p.feature_name_en ? clip(p.feature_name_en, AREA_LIMIT) : null,
      // The validity time is when the alert's weather is expected to begin (pinned by the fixture in
      // alerts.test.ts); without it, the alert applies from its publication.
      issuedAt: p.publication_datetime, startsAt: p.validity_datetime ?? p.publication_datetime,
      endsAt: p.event_end_datetime, expiresAt: p.expiration_datetime,
    };
    if (ended(alert, now) || seen.has(key)) continue;
    seen.set(key, alert);
  }
  return [...seen.values()].sort(byLevel).slice(0, MAX_ALERTS);
}

/** "Winter Storm Warning" → warning; anything without a level suffix is a statement. */
export function nwsLevel(event: string): WeatherAlert['level'] {
  return /warning$/i.test(event) ? 'warning' : /watch$/i.test(event) ? 'watch' : /advisory$/i.test(event) ? 'advisory' : 'statement';
}

/** NWS alerts in effect at the point: actual, not a test, not past, not a cancellation, not expired. */
export function normalizeNwsAlerts(payload: unknown, now: number): WeatherAlert[] {
  const seen = new Map<string, WeatherAlert>();
  for (const item of featureList.parse(payload).features) {
    const parsed = nwsAlert.safeParse(item);
    if (!parsed.success) continue;
    const p = parsed.data.properties;
    if (p.status !== 'Actual' || p.event === 'Test Message' || p.urgency === 'Past' || p.messageType === 'Cancel') continue;
    const area = p.areaDesc?.split(';')[0]?.trim() || null;
    const alert: WeatherAlert = {
      id: p.id, level: nwsLevel(p.event), name: clip(p.event, NAME_LIMIT), area: area ? clip(area, AREA_LIMIT) : null,
      issuedAt: p.sent, startsAt: p.onset ?? p.effective, endsAt: p.ends ?? p.expires, expiresAt: p.expires,
    };
    if (ended(alert, now) || seen.has(alert.id)) continue;
    seen.set(alert.id, alert);
  }
  return [...seen.values()].sort(byLevel).slice(0, MAX_ALERTS);
}

/** Seconds or an HTTP date, in milliseconds from `now`, capped; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, ALERTS_TIMING.retryAfterCap) : null;
}

/** Lets go of a body without waiting: a cancelled branch of a teed stream settles only when the other one is cancelled too. */
function release(body: ReadableStream | ReadableStreamDefaultReader | null | undefined): void {
  void body?.cancel().catch(() => undefined);
}

/** Bounds both success and error bodies before parsing or retaining any provider text. */
async function readLimitedText(response: Response, limit = ALERTS_BODY_LIMIT): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { release(response.body); throw new Error('Provider response is too large'); }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { release(reader); throw new Error('Provider response is too large'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

/** Reads at most `limit` bytes of a JSON body; a longer one fails rather than filling memory. */
export async function readLimitedJson(response: Response, limit = ALERTS_BODY_LIMIT): Promise<unknown> {
  return JSON.parse(await readLimitedText(response, limit));
}

class ProviderError extends Error {
  status: number | null; retryAfter: number | null; body: string;
  constructor(message: string, status: number | null = null, retryAfter: number | null = null, body = '') { super(message); this.status = status; this.retryAfter = retryAfter; this.body = body; }
}

interface Coverage {
  provider: AlertsProvider | null; area: string | null; zones: Set<string>;
  /** Neither provider covers the place (until `checked` is a day old). */
  unsupported: boolean;
  checked: Stamp | null; failed: Stamp | null;
}
interface Entry {
  latitude: number; longitude: number; coverage: Coverage;
  /** Kept from the last success; each is dropped once its own end or expiry passes. */
  alerts: WeatherAlert[]; checkedAt: string | null;
  fetched: Stamp | null; failed: Stamp | null; error: string | null;
  pending?: Promise<void>;
}

export class AlertsService {
  #fetch: FetchLike;
  #clock: RefreshClock;
  #userAgent: string;
  #waitMs: number;
  #cache = new Map<string, Entry>();
  /** Request times per provider over the last hour, and a Retry-After pause. */
  #requests: Record<AlertsProvider, Stamp[]> = { eccc: [], nws: [] };
  #paused: Record<AlertsProvider, { since: Stamp; ms: number } | null> = { eccc: null, nws: null };
  constructor(fetcher: FetchLike = fetch, now: () => number = Date.now, monotonic?: () => number, waitMs = REFRESH_WAIT_MS, userAgent = ALERTS_USER_AGENT) {
    this.#fetch = fetcher; this.#clock = new RefreshClock(now, monotonic); this.#waitMs = waitMs; this.#userAgent = userAgent;
  }

  /**
   * The alerts for the saved location, checked first when due, waiting for that at most `waitMs` like the
   * forecast (#351); a check still running carries on and the state says `refreshing` meanwhile.
   */
  async get(settings: Pick<Settings, 'location'>): Promise<AlertsState> {
    const { latitude, longitude } = roundedPoint(settings);
    const key = `${latitude},${longitude}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      entry = { latitude, longitude, coverage: { provider: null, area: null, zones: new Set(), unsupported: false, checked: null, failed: null }, alerts: [], checkedAt: null, fetched: null, failed: null, error: null };
      if (this.#cache.size >= MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(key, entry);
    }
    if (this.#due(entry)) {
      const current = entry;
      current.pending ??= this.#refresh(current).finally(() => { delete current.pending; });
      await waitAtMost(current.pending, this.#waitMs);
    }
    return this.#read(entry);
  }

  #coverageDue(coverage: Coverage): boolean {
    if (coverage.failed && this.#clock.since(coverage.failed) < ALERTS_TIMING.coverageRetry) return false;
    return !coverage.checked || this.#clock.since(coverage.checked) >= ALERTS_TIMING.coverage;
  }
  #due(entry: Entry): boolean {
    if (this.#coverageDue(entry.coverage)) return true;
    const { coverage } = entry;
    if (!coverage.checked || coverage.unsupported || !coverage.provider) return false;
    if (entry.failed && this.#clock.since(entry.failed) < ALERTS_TIMING.retry) return false;
    return !entry.fetched || this.#clock.since(entry.fetched) >= ALERTS_TIMING.refresh;
  }
  /** Whether one more request to `provider` stays within its hourly budget and any Retry-After pause. */
  #allowed(provider: AlertsProvider): boolean {
    const pause = this.#paused[provider];
    if (pause && this.#clock.since(pause.since) < pause.ms) return false;
    this.#requests[provider] = this.#requests[provider].filter(stamp => this.#clock.since(stamp) < HOUR);
    return this.#requests[provider].length < ALERTS_REQUESTS_PER_HOUR;
  }
  async #request(provider: AlertsProvider, url: URL): Promise<unknown> {
    this.#requests[provider].push(this.#clock.stamp());
    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(ALERTS_TIMEOUT_MS), redirect: 'error',
      headers: { 'User-Agent': this.#userAgent, Accept: 'application/geo+json, application/json' },
    });
    if (!response.ok) {
      const retryAfter = response.status === 429 || response.status === 503 ? retryAfterMs(response.headers.get('retry-after'), this.#clock.wall()) : null;
      const body = response.status === 400 ? (await readLimitedText(response).catch(() => '')).slice(0, 2000) : '';
      if (response.status !== 400) release(response.body);
      throw new ProviderError(`Provider returned ${response.status}`, response.status, retryAfter, body);
    }
    return readLimitedJson(response);
  }
  #pause(provider: AlertsProvider, error: unknown) {
    if (error instanceof ProviderError && error.retryAfter) this.#paused[provider] = { since: this.#clock.stamp(), ms: error.retryAfter };
  }

  async #refresh(entry: Entry): Promise<void> {
    const { coverage } = entry;
    if (this.#coverageDue(coverage) && !(await this.#resolveCoverage(entry))) return;
    if (coverage.unsupported || !coverage.provider) return;
    const provider = coverage.provider;
    if (!this.#allowed(provider)) return;
    try {
      const now = this.#clock.wall();
      if (provider === 'eccc') {
        const url = new URL(ECCC_ALERTS_URL);
        url.search = new URLSearchParams({ f: 'json', lang: 'en', skipGeometry: 'true', limit: '100', bbox: bbox(entry.latitude, entry.longitude) }).toString();
        entry.alerts = normalizeEcccAlerts(await this.#request('eccc', url), coverage.zones, now);
      } else {
        const url = new URL(NWS_ALERTS_URL);
        url.search = new URLSearchParams({ point: `${entry.latitude},${entry.longitude}`, status: 'actual', message_type: 'alert,update' }).toString();
        let payload: unknown;
        try { payload = await this.#request('nws', url); } catch (error) {
          // The NWS answers a point outside its area with 400 "out of bounds": not covered, for a day.
          if (error instanceof ProviderError && error.status === 400 && /out of bounds/i.test(error.body)) {
            Object.assign(coverage, { provider: null, area: null, unsupported: true, checked: this.#clock.stamp(), failed: null });
            entry.alerts = []; entry.fetched = null; entry.failed = null; entry.error = null; entry.checkedAt = null;
            return;
          }
          throw error;
        }
        entry.alerts = normalizeNwsAlerts(payload, now);
        coverage.area = entry.alerts.find(alert => alert.area)?.area ?? null;
      }
      entry.checkedAt = new Date(now).toISOString(); entry.fetched = this.#clock.stamp(); entry.failed = null; entry.error = null;
    } catch (error) {
      this.#pause(provider, error);
      entry.failed = this.#clock.stamp();
      entry.error = entry.fetched ? 'Weather alerts could not be checked. Showing the last alerts received.' : 'Weather alerts are unavailable. Check the connection.';
    }
  }

  /** Finds who covers the place: ECCC zones inside the Canada box, else the NWS inside the US box, else nobody. */
  async #resolveCoverage(entry: Entry): Promise<boolean> {
    const { coverage, latitude, longitude } = entry;
    const settle = (provider: AlertsProvider | null, area: string | null, zones: Set<string>) => {
      const changed = coverage.provider !== provider || [...zones].join() !== [...coverage.zones].join();
      Object.assign(coverage, { provider, area, zones, unsupported: provider === null, checked: this.#clock.stamp(), failed: null });
      // Alerts kept for other zones or another provider never carry over.
      if (changed) { entry.alerts = []; entry.fetched = null; entry.checkedAt = null; entry.failed = null; entry.error = null; }
      return true;
    };
    if (inside(CANADA_BOX, latitude, longitude)) {
      if (!this.#allowed('eccc')) return false;
      try {
        const url = new URL(ECCC_ZONES_URL);
        url.search = new URLSearchParams({ f: 'json', skipGeometry: 'true', limit: '10', bbox: bbox(latitude, longitude) }).toString();
        const zones = featureList.parse(await this.#request('eccc', url)).features.flatMap(item => {
          const parsed = ecccZone.safeParse(item);
          return parsed.success ? [{ id: parsed.data.properties.FEATURE_ID, name: parsed.data.properties.NAME }] : [];
        });
        if (zones.length) return settle('eccc', clip(zones[0]!.name, AREA_LIMIT), new Set(zones.map(zone => zone.id)));
      } catch (error) {
        this.#pause('eccc', error);
        coverage.failed = this.#clock.stamp(); entry.failed = coverage.failed;
        entry.error = entry.fetched ? 'Weather alerts could not be checked. Showing the last alerts received.' : 'Weather alerts are unavailable. Check the connection.';
        return false;
      }
    }
    // The NWS's first answer confirms the point (a 400 "out of bounds" marks it unsupported).
    if (inside(US_BOX, latitude, longitude)) return settle('nws', null, new Set());
    return settle(null, null, new Set());
  }

  #read(entry: Entry): AlertsState {
    const { coverage } = entry;
    const refreshing = entry.pending ? { refreshing: true } : {};
    if (coverage.unsupported) return { ...offAlerts(), status: 'unsupported', ...refreshing };
    const provider = coverage.provider, now = this.#clock.wall();
    const alerts = entry.alerts.filter(alert => !ended(alert, now));
    let status: AlertsState['status'] = 'unavailable';
    if (entry.fetched && provider) {
      const age = this.#clock.since(entry.fetched);
      status = age < ALERTS_TIMING.stale ? 'fresh' : age >= ALERTS_TIMING.unavailable && !alerts.length ? 'unavailable' : 'stale';
    }
    return {
      status, provider, source: provider ? ALERT_SOURCES[provider].source : null, sourceUrl: provider ? ALERT_SOURCES[provider].url : null,
      area: coverage.area, checkedAt: entry.checkedAt, error: status === 'fresh' ? null : entry.error,
      alerts: status === 'unavailable' ? [] : structuredClone(alerts), ...refreshing,
    };
  }
}
