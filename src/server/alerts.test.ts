// Official alerts (#437) with synthetic provider responses only; the real providers are never called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERTS_BODY_LIMIT, ALERTS_REQUESTS_PER_HOUR, ALERTS_TIMEOUT_MS, ALERTS_TIMING, ALERTS_USER_AGENT, AlertsService,
  normalizeEcccAlerts, normalizeNwsAlerts, nwsLevel, offAlerts, retryAfterMs, roundedPoint,
} from './alerts.ts';
import type { Settings } from '../shared/contracts.ts';

const NOW = Date.parse('2026-10-20T14:00:00Z');
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const at = (offset: number) => new Date(NOW + offset).toISOString();
const place = (name: string, latitude: number, longitude: number, timezone = 'America/Toronto'): Pick<Settings, 'location'> => ({ location: { name, latitude, longitude, timezone } });
const TORONTO = place('Toronto', 43.6532, -79.3832), BUFFALO = place('Buffalo', 42.8864, -78.8784, 'America/New_York');
const PARIS = place('Paris', 48.8566, 2.3522, 'Europe/Paris'), MEXICO_CITY = place('Mexico City', 19.4326, -99.1332, 'America/Mexico_City');

const ZONES = { type: 'FeatureCollection', features: [
  { id: 'fea1-1185', properties: { FEATURE_ID: 'fea1-1185', NAME: 'City of Toronto', NOM: 'ville de Toronto' } },
  { id: 'fea1-1186', properties: { FEATURE_ID: 'fea1-1186', NAME: 'Toronto Islands' } },
] };
function ecccFeature(id: string, zone: string, properties: Record<string, unknown> = {}) {
  return { id: `${id}_${zone}`, type: 'Feature', geometry: null, properties: {
    alert_code: 'WSW', alert_type: 'warning', alert_name_en: 'winter storm warning', alert_name_fr: 'avertissement de tempête hivernale',
    publication_datetime: at(-HOUR), expiration_datetime: at(11 * HOUR), validity_datetime: at(4 * HOUR), event_end_datetime: at(16 * HOUR),
    risk_colour_en: 'red', feature_id: zone, feature_name_en: zone === 'fea1-1185' ? 'City of Toronto' : 'Somewhere else', status_en: 'new', ...properties,
  } };
}
/** Our zone's warning (twice, once per zone), a neighbour's, ended, cancelled, expired, other levels and a malformed one. */
const ECCC_ALERTS = { type: 'FeatureCollection', features: [
  ecccFeature('1001', 'fea1-1185'),
  ecccFeature('1001', 'fea1-1186'),
  ecccFeature('2002', 'fea1-9999', { alert_name_en: 'tornado warning' }),
  ecccFeature('3003', 'fea1-1185', { alert_name_en: 'rainfall warning', status_en: 'ended' }),
  ecccFeature('3004', 'fea1-1185', { alert_name_en: 'wind warning', status_en: 'cancelled' }),
  ecccFeature('3005', 'fea1-1185', { alert_name_en: 'fog advisory', alert_type: 'advisory', expiration_datetime: at(-MINUTE) }),
  ecccFeature('3006', 'fea1-1185', { alert_name_en: 'frost advisory', alert_type: 'advisory', event_end_datetime: at(-MINUTE) }),
  ecccFeature('4004', 'fea1-1185', { alert_type: 'watch', alert_name_en: 'snowfall watch', validity_datetime: null }),
  ecccFeature('5005', 'fea1-1186', { alert_type: 'advisory', alert_name_en: 'freezing drizzle advisory' }),
  ecccFeature('6006', 'fea1-1185', { alert_type: 'statement', alert_name_en: 'special weather statement' }),
  ecccFeature('7007', 'fea1-1185', { alert_name_en: undefined }),
  { id: 'broken' },
] };

function nwsFeature(id: string, properties: Record<string, unknown> = {}) {
  return { id: `https://api.weather.gov/alerts/${id}`, type: 'Feature', properties: {
    id, areaDesc: 'Northern Erie; Southern Erie', sent: at(-HOUR), effective: at(-HOUR), onset: at(2 * HOUR), expires: at(10 * HOUR), ends: at(20 * HOUR),
    status: 'Actual', messageType: 'Alert', urgency: 'Expected', event: 'Winter Storm Warning', ...properties,
  } };
}
const NWS_ALERTS = { type: 'FeatureCollection', features: [
  nwsFeature('urn:oid:1'),
  nwsFeature('urn:oid:2', { event: 'Lake Effect Snow Watch', onset: null, ends: null }),
  nwsFeature('urn:oid:3', { event: 'Wind Advisory', messageType: 'Update' }),
  nwsFeature('urn:oid:4', { event: 'Special Weather Statement' }),
  nwsFeature('urn:oid:5', { event: 'Test Message' }),
  nwsFeature('urn:oid:6', { event: 'Flood Warning', urgency: 'Past' }),
  nwsFeature('urn:oid:7', { event: 'Gale Warning', messageType: 'Cancel' }),
  nwsFeature('urn:oid:8', { event: 'Frost Advisory', status: 'Exercise' }),
  nwsFeature('urn:oid:9', { event: 'Heat Advisory', expires: at(-MINUTE), ends: at(-MINUTE) }),
  nwsFeature('urn:oid:10', { sent: 'not a time' }),
] };

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function harness(handler: Handler) {
  let now = NOW;
  const requests: { url: URL; init: RequestInit }[] = [];
  const service = new AlertsService(async (input, init = {}) => {
    const url = new URL(input); requests.push({ url, init });
    return handler(url, init);
  }, () => now);
  return { service, requests, advance(ms: number) { now += ms; }, get now() { return now; } };
}
/** A provider answering like MSC GeoMet (zones, then alerts) and the NWS. */
const providers = (overrides: { zones?: unknown; eccc?: unknown; nws?: () => Response } = {}): Handler => url => {
  if (url.hostname === 'api.weather.gc.ca' && url.pathname.includes('forecast-zones')) return Response.json(overrides.zones ?? ZONES);
  if (url.hostname === 'api.weather.gc.ca') return Response.json(overrides.eccc ?? ECCC_ALERTS);
  if (url.hostname === 'api.weather.gov') return overrides.nws?.() ?? Response.json(NWS_ALERTS);
  throw new Error(`Unexpected host ${url.hostname}`);
};

test('ECCC: only the place\'s zones count, ended, cancelled and passed alerts are dropped, and one alert counts once', () => {
  const alerts = normalizeEcccAlerts(ECCC_ALERTS, new Set(['fea1-1185', 'fea1-1186']), NOW);
  assert.deepEqual(alerts.map(alert => [alert.id, alert.level, alert.name]), [
    ['1001', 'warning', 'Winter storm warning'],
    ['4004', 'watch', 'Snowfall watch'],
    ['5005', 'advisory', 'Freezing drizzle advisory'],
    ['6006', 'statement', 'Special weather statement'],
  ], 'the neighbour zone, ended, cancelled, expired, finished and malformed features are left out; warnings first');
  const warning = alerts[0]!;
  assert.equal(warning.area, 'City of Toronto');
  assert.equal(warning.issuedAt, at(-HOUR));
  // The validity time is when the alert's weather is expected to begin (the GeoMet feed's validity_datetime,
  // later than publication); the event end and the message expiry are kept apart.
  assert.equal(warning.startsAt, at(4 * HOUR), 'startsAt is the validity time');
  assert.equal(warning.endsAt, at(16 * HOUR));
  assert.equal(warning.expiresAt, at(11 * HOUR));
  assert.equal(alerts[1]!.startsAt, at(-HOUR), 'without a validity time the alert applies from its publication');
  assert.ok(!JSON.stringify(alerts).includes('red'), 'the risk colour is ignored: no colour coding');
  assert.deepEqual(normalizeEcccAlerts(ECCC_ALERTS, new Set(['fea1-1186']), NOW).map(alert => alert.id), ['1001', '5005'], 'the zone set decides');
  // Only the first letter changes; the rest is the provider's own wording (its licence forbids altering it).
  assert.equal(normalizeEcccAlerts({ features: [ecccFeature('8', 'fea1-1185', { alert_name_en: 'arctic outflow warning in effect for B.C. coast' })] }, new Set(['fea1-1185']), NOW)[0]!.name, 'Arctic outflow warning in effect for B.C. coast');
  assert.equal(normalizeEcccAlerts({ features: [ecccFeature('9', 'fea1-1185', { alert_name_en: 'x'.repeat(120) })] }, new Set(['fea1-1185']), NOW)[0]!.name.length, 80, 'names stay within 80 characters');
  assert.throws(() => normalizeEcccAlerts({ nope: true }, new Set(), NOW), 'a body without features fails as a whole');
});

test('NWS: actual alerts in effect only, levels from the event suffix, the first area named', () => {
  const alerts = normalizeNwsAlerts(NWS_ALERTS, NOW);
  assert.deepEqual(alerts.map(alert => [alert.id, alert.level, alert.name]), [
    ['urn:oid:1', 'warning', 'Winter Storm Warning'],
    ['urn:oid:2', 'watch', 'Lake Effect Snow Watch'],
    ['urn:oid:3', 'advisory', 'Wind Advisory'],
    ['urn:oid:4', 'statement', 'Special Weather Statement'],
  ], 'Test Message, Past, Cancel, non-Actual, expired and malformed alerts are dropped');
  const [warning, watch] = alerts as [typeof alerts[0], typeof alerts[0]];
  assert.equal(warning.area, 'Northern Erie');
  assert.deepEqual([warning.startsAt, warning.endsAt, warning.expiresAt], [at(2 * HOUR), at(20 * HOUR), at(10 * HOUR)], 'onset and ends');
  assert.deepEqual([watch.startsAt, watch.endsAt], [at(-HOUR), at(10 * HOUR)], 'without onset or ends: effective and expires');
  assert.deepEqual(['Tornado Warning', 'Winter Storm Watch', 'Wind Advisory', 'Hazardous Weather Outlook', 'Dense Fog Advisory'].map(nwsLevel), ['warning', 'watch', 'advisory', 'statement', 'advisory']);
});

test('routing: Toronto asks ECCC by zone, Buffalo the NWS, Europe nobody, and an NWS "out of bounds" means unsupported', async () => {
  const toronto = harness(providers());
  const state = await toronto.service.get(TORONTO);
  assert.equal(state.status, 'fresh'); assert.equal(state.provider, 'eccc'); assert.equal(state.source, 'Environment and Climate Change Canada');
  assert.equal(state.area, 'City of Toronto'); assert.equal(state.checkedAt, at(0)); assert.equal(state.alerts.length, 4);
  assert.deepEqual(toronto.requests.map(request => `${request.url.origin}${request.url.pathname}`), [
    'https://api.weather.gc.ca/collections/public-standard-forecast-zones/items', 'https://api.weather.gc.ca/collections/weather-alerts/items',
  ]);
  // Exact parameters, rounded coordinates: only 0.01° leaves this computer.
  assert.deepEqual(Object.fromEntries(toronto.requests[0]!.url.searchParams), { f: 'json', skipGeometry: 'true', limit: '10', bbox: '-79.385,43.645,-79.375,43.655' });
  assert.deepEqual(Object.fromEntries(toronto.requests[1]!.url.searchParams), { f: 'json', lang: 'en', skipGeometry: 'true', limit: '100', bbox: '-79.385,43.645,-79.375,43.655' });
  assert.deepEqual(roundedPoint(TORONTO), { latitude: 43.65, longitude: -79.38 });

  // Buffalo lies inside the Canada box, but no ECCC zone covers it: the NWS does, by point.
  const buffalo = harness(providers({ zones: { type: 'FeatureCollection', features: [] } }));
  const us = await buffalo.service.get(BUFFALO);
  assert.equal(us.status, 'fresh'); assert.equal(us.provider, 'nws'); assert.equal(us.source, 'US National Weather Service'); assert.equal(us.area, 'Northern Erie');
  assert.equal(buffalo.requests.length, 2);
  assert.equal(buffalo.requests[1]!.url.origin + buffalo.requests[1]!.url.pathname, 'https://api.weather.gov/alerts/active');
  assert.deepEqual(Object.fromEntries(buffalo.requests[1]!.url.searchParams), { point: '42.89,-78.88', status: 'actual', message_type: 'alert,update' });

  const paris = harness(() => { throw new Error('no request expected'); });
  assert.deepEqual(await paris.service.get(PARIS), { ...offAlerts(), status: 'unsupported' }, 'outside both boxes: unsupported, never "no alerts"');
  assert.equal(paris.requests.length, 0, 'and no request at all');

  const mexico = harness(providers({ nws: () => Response.json({ title: 'Invalid Parameter', status: 400, detail: 'Parameter "point" is invalid: out of bounds' }, { status: 400 }) }));
  assert.equal((await mexico.service.get(MEXICO_CITY)).status, 'unsupported');
  assert.equal(mexico.requests.length, 1);
  mexico.advance(23 * HOUR); assert.equal((await mexico.service.get(MEXICO_CITY)).status, 'unsupported');
  assert.equal(mexico.requests.length, 1, 'kept for a day');
  mexico.advance(HOUR); await mexico.service.get(MEXICO_CITY);
  assert.equal(mexico.requests.length, 2, 'asked again after a day');
  const otherBadRequest = harness(providers({ zones: { features: [] }, nws: () => Response.json({ detail: 'Bad Request' }, { status: 400 }) }));
  assert.equal((await otherBadRequest.service.get(BUFFALO)).status, 'unavailable', 'any other 400 is a failure, not "not covered"');
});

test('every request sends the User-Agent, an 8 s timeout and redirect: error, and no no-cache header', async () => {
  const toronto = harness(providers()), buffalo = harness(providers({ zones: { features: [] } }));
  await toronto.service.get(TORONTO); await buffalo.service.get(BUFFALO);
  assert.match(ALERTS_USER_AGENT, /^LivingRoomDisplay\/\d+\.\d+\.\d+ \(local ambient display\)$/);
  assert.equal(ALERTS_TIMEOUT_MS, 8000);
  for (const { init } of [...toronto.requests, ...buffalo.requests]) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('user-agent'), ALERTS_USER_AGENT);
    assert.match(headers.get('accept') ?? '', /application\/geo\+json/);
    assert.equal(headers.get('cache-control'), null); assert.equal(headers.get('pragma'), null);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal, 'a timeout signal');
  }
});

test('cadence: refreshed every 5 minutes, retried 2 minutes after a failure, stale at 15 minutes, unavailable after 2 hours with nothing in effect', async () => {
  let fail = false;
  const clock = harness(url => { if (fail && !url.pathname.includes('zones')) return new Response('down', { status: 500 }); return providers()(url, {}); });
  assert.equal((await clock.service.get(TORONTO)).status, 'fresh'); assert.equal(clock.requests.length, 2);
  clock.advance(4 * MINUTE); await clock.service.get(TORONTO); assert.equal(clock.requests.length, 2, 'within 5 minutes the check is kept');
  clock.advance(MINUTE); await clock.service.get(TORONTO); assert.equal(clock.requests.length, 3, 'after 5 minutes it is repeated (the zones are kept for a day)');
  fail = true;
  clock.advance(5 * MINUTE); const failed = await clock.service.get(TORONTO);
  assert.equal(clock.requests.length, 4); assert.equal(failed.status, 'fresh', 'the last success is 5 minutes old: still fresh');
  assert.equal(failed.checkedAt, at(5 * MINUTE));
  clock.advance(MINUTE); await clock.service.get(TORONTO); assert.equal(clock.requests.length, 4, 'no retry within 2 minutes');
  clock.advance(MINUTE); await clock.service.get(TORONTO); assert.equal(clock.requests.length, 5, 'retried after 2 minutes');
  clock.advance(8 * MINUTE); const stale = await clock.service.get(TORONTO);
  assert.equal(stale.status, 'stale', 'the last success is 15 minutes old'); assert.match(stale.error ?? '', /last alerts/);
  assert.equal(stale.alerts.length, 4, 'retained alerts stay');
  // Retained alerts stay until their own end; the advisory ends with the warning, 16 hours on.
  clock.advance(110 * MINUTE); const saved = await clock.service.get(TORONTO);
  assert.equal(saved.status, 'stale', 'over 2 hours, but alerts are still in effect'); assert.equal(saved.alerts.length, 4);
  clock.advance(15 * HOUR); const ended = await clock.service.get(TORONTO);
  assert.equal(ended.status, 'unavailable', 'over 2 hours without a success and nothing still in effect'); assert.deepEqual(ended.alerts, []);
  fail = false; clock.advance(2 * MINUTE);
  assert.equal((await clock.service.get(TORONTO)).status, 'fresh', 'a success restores it');
  assert.deepEqual({ ...ALERTS_TIMING }, { refresh: 5 * MINUTE, retry: 2 * MINUTE, stale: 15 * MINUTE, unavailable: 2 * HOUR, coverage: 24 * HOUR, coverageRetry: 5 * MINUTE, retryAfterCap: HOUR });
});

test('never a success: unavailable; a zone lookup failure is retried after 5 minutes', async () => {
  let zonesUp = false;
  const clock = harness(url => url.pathname.includes('zones') && !zonesUp ? new Response('no', { status: 502 }) : providers()(url, {}));
  const first = await clock.service.get(TORONTO);
  assert.equal(first.status, 'unavailable'); assert.equal(first.provider, null); assert.match(first.error ?? '', /unavailable/);
  zonesUp = true;
  clock.advance(4 * MINUTE); await clock.service.get(TORONTO); assert.equal(clock.requests.length, 1, 'no zone retry within 5 minutes');
  clock.advance(MINUTE); assert.equal((await clock.service.get(TORONTO)).status, 'fresh');
});

test('Retry-After on 429 and 503 pauses the provider, capped at an hour; at most 12 requests an hour per provider', async () => {
  assert.equal(retryAfterMs('600', NOW), 600_000);
  assert.equal(retryAfterMs('86400', NOW), HOUR, 'capped at an hour');
  assert.equal(retryAfterMs(new Date(NOW + 5 * MINUTE).toUTCString(), NOW), 5 * MINUTE);
  assert.equal(retryAfterMs('soon', NOW), null); assert.equal(retryAfterMs(null, NOW), null);
  let limited = true;
  const paused = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : limited ? new Response('slow down', { status: 429, headers: { 'Retry-After': '600' } }) : Response.json(ECCC_ALERTS));
  await paused.service.get(TORONTO); assert.equal(paused.requests.length, 2);
  limited = false;
  for (let minutes = 2; minutes < 10; minutes += 2) { paused.advance(2 * MINUTE); await paused.service.get(TORONTO); }
  assert.equal(paused.requests.length, 2, 'nothing for the 10 minutes Retry-After asked');
  paused.advance(2 * MINUTE); assert.equal((await paused.service.get(TORONTO)).status, 'fresh'); assert.equal(paused.requests.length, 3);

  const busy = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : new Response('down', { status: 500 }));
  for (let minute = 0; minute < 60; minute += 2) { await busy.service.get(TORONTO); busy.advance(2 * MINUTE); }
  assert.equal(busy.requests.length, ALERTS_REQUESTS_PER_HOUR, 'a failing provider is asked at most 12 times an hour (zones included)');
});

test('a body over 1 MiB, a redirect and a timeout each fail without breaking the next check', async () => {
  const big = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : new Response(JSON.stringify({ features: [], padding: 'x'.repeat(ALERTS_BODY_LIMIT) })));
  assert.equal((await big.service.get(TORONTO)).status, 'unavailable', 'an oversized body is refused');
  const declared = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : new Response('{}', { headers: { 'Content-Length': String(ALERTS_BODY_LIMIT + 1) } }));
  assert.equal((await declared.service.get(TORONTO)).status, 'unavailable', 'a declared oversized body is refused before reading');
  const redirected = harness(url => { if (url.pathname.includes('zones')) return Response.json(ZONES); throw new TypeError('fetch failed: redirect mode is set to error'); });
  assert.equal((await redirected.service.get(TORONTO)).status, 'unavailable');
  let timeout = true;
  const slow = harness(url => { if (url.pathname.includes('zones')) return Response.json(ZONES); if (timeout) throw new DOMException('The operation timed out.', 'TimeoutError'); return Response.json(ECCC_ALERTS); });
  assert.equal((await slow.service.get(TORONTO)).status, 'unavailable');
  timeout = false; slow.advance(2 * MINUTE);
  assert.equal((await slow.service.get(TORONTO)).status, 'fresh', 'the next check after the retry interval succeeds');
});

test('moving the saved location starts a new place; no alert carries over to another zone or provider', async () => {
  const both = harness(url => url.hostname === 'api.weather.gc.ca' && url.pathname.includes('zones') ? Response.json(url.searchParams.get('bbox')!.startsWith('-79') ? ZONES : { features: [] }) : providers()(url, {}));
  const toronto = await both.service.get(TORONTO), buffalo = await both.service.get(BUFFALO);
  assert.equal(toronto.provider, 'eccc'); assert.equal(buffalo.provider, 'nws');
  assert.ok(buffalo.alerts.every(alert => alert.id.startsWith('urn:')), 'Buffalo shows only NWS alerts');
  assert.equal((await both.service.get(TORONTO)).alerts[0]!.id, '1001', 'Toronto keeps its own');
});

test('a failed answer whose body is a teed stream (a cloned Response) never holds /api/state', async () => {
  // Cancelling one branch of a teed stream settles only when the other branch is cancelled too, so the
  // service lets go of a failed body without waiting for it.
  const failing = new Response('down', { status: 500 }), huge = new Response('x'.repeat(ALERTS_BODY_LIMIT + 10));
  const clock = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : failing.clone());
  const settled = await Promise.race([clock.service.get(TORONTO).then(state => state.status), new Promise(resolve => setTimeout(() => resolve('hung'), 2000))]);
  assert.equal(settled, 'unavailable');
  const big = harness(url => url.pathname.includes('zones') ? Response.json(ZONES) : huge.clone());
  assert.equal(await Promise.race([big.service.get(TORONTO).then(state => state.status), new Promise(resolve => setTimeout(() => resolve('hung'), 2000))]), 'unavailable');
});
