import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, mkdtemp, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { AppState, ClearCompletedResult, PreviewState, Reminder } from '../shared/contracts.ts';
import { REMINDER_HISTORY_LIMIT, REMINDER_LIMIT, RESTORE_BEFORE_EDITING, historyReminders, pruneHistory } from '../shared/reminders.ts';
import { needsAirQuality, needsAlerts, needsForecast } from '../shared/widgets.ts';
import { DataStore, SettingsConflict } from './store.ts';
import { persistableSettings } from './persistence.ts';
import { REFRESH_WAIT_MS, WeatherService, type FetchLike } from './weather.ts';
import { AirQualityService, offAirQuality } from './air.ts';
import { AlertsService, offAlerts } from './alerts.ts';
import { windowsStatus } from './windows.ts';
import { automaticLocationSchema, countdownCreateSchema, importSchema, mergeSettings, reminderCreateSchema, reminderPatchSchema, settingsPatchSchema, timerCreateSchema, timerPatchSchema, validationMessage, worldClockCreateSchema } from './validation.ts';
import { TimerError, TimerStore } from './timers.ts';
import { ScheduleError, ScheduleStore, scheduleBackupSchema, scheduleConfigSchema } from './schedule.ts';
import { scheduledSettings } from '../shared/schedule.ts';
import { TIMER_MAX_MS, TIMER_MESSAGES, TIMER_MIN_MS } from '../shared/timers.ts';
import { WIDGET_CATALOG, isActiveWidget } from '../shared/widgets.ts';
import { HOME_SHOWABLE_WIDGETS, showPlacement } from '../shared/show.ts';
import type { ChangeMarker, Settings, TimersResult, WidgetId } from '../shared/contracts.ts';
import { PREPARATION_MAX_OBSERVATION_GAP_MS, PreparationController, needsPreviewSupervision, type PreparationOptions, type PreparationView } from './preidle.ts';
import { SnapshotFile } from './snapshot-file.ts';
import { DisplayPresence } from './display-presence.ts';

// Read once at module load. src/server and the built dist/server both sit two
// levels below the package.json shipped with the app, so health matches it.
const APP_VERSION = String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? 'unknown');

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
/** Aborts a serialized reminder update whose patch matches the stored values, so nothing is written. */
class UnchangedReminder extends Error {
  reminder: Reminder;
  constructor(reminder: Reminder) { super('Reminder unchanged'); this.reminder = reminder; }
}
/** Aborts a serialized settings update that would change nothing (a widget already shown, an Undo already applied). */
class UnchangedSettings extends Error {
  settings: Settings;
  constructor(settings: Settings) { super('Settings unchanged'); this.settings = settings; }
}
export interface ApplicationOptions {
  dataDirectory: string; clientDirectory?: string; fetcher?: FetchLike; now?: () => number; development?: boolean;
  /** How long a request waits for a due weather, air-quality or alerts refresh before answering (#351). */
  refreshWaitMs?: number;
  /** Only the installed entrypoint supplies this factory; source starts and fixtures stay inert. */
  preparation?: PreparationOptions;
  /** Synthetic clock seam for preparation expiry and discontinuity regressions. */
  preparationMonotonic?: () => number;
  /** Explicit isolated fixture path, or the verified installed runtime path. Never a data backup. */
  snapshotDirectory?: string;
}
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function bytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new HttpError(413, 'Request body is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new HttpError(415, 'Use application/json');
  try { return JSON.parse((await bytes(request, 4 * 1024 * 1024)).toString('utf8')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON'); }
}
function json(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}
/** The settings revision as an HTTP entity tag (#287). */
const etag = (revision: string) => ({ ETag: `"${revision}"` });
/**
 * The revisions an `If-Match` header names (#287), or null without one or for `*`. Only strong,
 * quoted tags can match; anything else names no revision, so the patch is refused as stale.
 */
function ifMatch(request: IncomingMessage): string[] | null {
  const header = request.headers['if-match'];
  if (header === undefined || header.trim() === '*') return null;
  return header.split(',').flatMap(tag => { const match = /^"([^"]*)"$/.exec(tag.trim()); return match ? [match[1]!] : []; });
}

export async function createApplication(options: ApplicationOptions) {
  const store = await DataStore.open(options.dataDirectory);
  const now = options.now ?? Date.now;
  // Opened after the data store, whose startup removes stale timers.json temporary files (#438).
  const timers = await TimerStore.open(options.dataDirectory, now());
  const schedules = await ScheduleStore.open(options.dataDirectory);
  const effectiveSettings = () => { const settings = store.view().settings; return scheduledSettings(settings, schedules.snapshot(settings, now())); };
  let scheduleMarker = schedules.marker(store.view().settings, now()), scheduleChanges = 0;
  // GET /api/changes (#438): this process, then the settings/reminder writes, the timer writes and the preview changes.
  const bootId = randomBytes(6).toString('hex');
  let previewChanges = 0;
  const privateCache = options.snapshotDirectory ?? options.preparation?.snapshotDirectory;
  // Source/tests get a new ephemeral directory, never an installed-path fallback.
  const cacheDirectory = privateCache ?? await mkdtemp(join(tmpdir(), 'still-snapshot-source-'));
  const snapshotFile = await SnapshotFile.open(cacheDirectory, () => { previewChanges++; });
  const displayPresence = new DisplayPresence(options.preparationMonotonic);
  let captureEvent = { phase: 'not-observed', sequence: 0, attempts: 0, failures: 0 };
  const weather = new WeatherService(options.fetcher, now, undefined, options.refreshWaitMs ?? REFRESH_WAIT_MS);
  const air = new AirQualityService(options.fetcher, now, undefined, options.refreshWaitMs ?? REFRESH_WAIT_MS);
  const alerts = new AlertsService(options.fetcher, now, undefined, options.refreshWaitMs ?? REFRESH_WAIT_MS);
  let hostToken = randomBytes(32).toString('hex');
  let previewGeneration = 0;
  function clearPreview() {
    // Invalidate uploads that began before this clear, even if preview is later enabled again.
    previewGeneration++;
    void snapshotFile.clear().catch(() => {});
  }
  function previewState(): PreviewState {
    previewView();
    return snapshotFile.state();
  }
  let preparationBoundary = 0;
  let preparationObserved: { at: number; manual: string; schedule: string; marker: string } | null = null;
  function previewView(): PreparationView {
    const { settings, settingsRevision } = store.view(), at = now();
    const schedule = schedules.snapshot(settings, at), marker = schedules.marker(settings, at);
    const previous = preparationObserved;
    if (previous && previous.manual === settingsRevision && previous.schedule === schedules.revision) {
      if (at < previous.at || at - previous.at > PREPARATION_MAX_OBSERVATION_GAP_MS) { preparationBoundary++; clearPreview(); }
      else {
        // A hidden off interval must invalidate a pending frame even if the next poll
        // sees the original style again. Bound the scan to the frame's 90-second life.
        const times = [at];
        for (let minute = (Math.floor(previous.at / 60_000) + 1) * 60_000; minute <= at; minute += 60_000) times.push(minute);
        const override = schedules.snapshot(settings, previous.at).overrideUntil;
        if (override && Date.parse(override) > previous.at && Date.parse(override) <= at) times.push(Date.parse(override));
        let observed = previous.marker;
        for (const time of times.sort((a, b) => a - b)) {
          const next = schedules.marker(settings, time);
          if (next !== observed) preparationBoundary++;
          const during = scheduledSettings(settings, schedules.snapshot(settings, time));
          if (!during.preview.enabled || !during.widgets.preview) clearPreview();
          observed = next;
        }
      }
    }
    preparationObserved = { at, manual: settingsRevision, schedule: schedules.revision, marker };
    const effective = scheduledSettings(settings, schedule);
    if (!effective.preview.enabled || !effective.widgets.preview) clearPreview();
    const supervisionEnabled = needsPreviewSupervision(settings, schedule.config);
    return { settings: effective, supervisionEnabled,
      settingsRevision: createHash('sha256').update(JSON.stringify([settingsRevision, marker, preparationBoundary])).digest('hex') };
  }
  const preparation = new PreparationController(options.preparation, previewView, () => {}, now, options.preparationMonotonic, clearPreview);
  function preparationRequest(request: IncomingMessage) {
    if (request.headers.origin || Object.keys(request.headers).some(key => key.startsWith('sec-fetch-')) ||
        !preparation.authorized(request.headers['x-lrd-preparation'])) throw new HttpError(403, 'Preparation helper access only');
  }
  function nativeRequest(request: IncomingMessage, tokenRequired: boolean) {
    if (request.headers.origin || Object.keys(request.headers).some(key => key.startsWith('sec-fetch-'))) throw new HttpError(403, 'Native helper access only');
    if (!tokenRequired) {
      if (request.headers['x-lrd-native'] !== '1') throw new HttpError(403, 'Native helper header required');
    } else {
      const token = request.headers['x-lrd-token'];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(hostToken))) throw new HttpError(403, 'Invalid helper token');
    }
  }

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    void route(request, response).catch(error => {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof HttpError || error instanceof TimerError || error instanceof ScheduleError) json(response, error.status, { error: error.message });
      else if (error instanceof z.ZodError) json(response, 400, { error: validationMessage(error) });
      else json(response, 500, { error: 'The request could not be completed. Existing saved data has been preserved.' });
    });
  });
  server.on('close', clearPreview);
  server.on('close', () => preparation.close());
  server.on('listening', () => { const address = server.address(); if (address && typeof address === 'object') preparation.listening(address.port); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  async function route(request: IncomingMessage, response: ServerResponse) {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4318;
    const validHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!request.headers.host || !validHosts.has(request.headers.host)) throw new HttpError(403, 'Invalid local host');
    const origin = request.headers.origin;
    const origins = new Set([...validHosts].map(host => `http://${host}`));
    if (options.development) { origins.add('http://127.0.0.1:5173'); origins.add('http://localhost:5173'); }
    if (origin && !origins.has(origin)) throw new HttpError(403, 'Cross-origin access is not allowed');
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site access is not allowed');
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const method = request.method ?? 'GET';
    const path = url.pathname;
    // Only Settings may ask for device location; Home, the editor and display never do (#517).
    response.setHeader('Permissions-Policy', path === '/settings' || path.startsWith('/settings/') ? 'geolocation=(self)' : 'geolocation=()');

    if (method === 'POST' && path === '/api/preview/display') {
      const displayOrigin = origin === `http://${request.headers.host}` ||
        (options.development && (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173'));
      if (!displayOrigin || request.headers['sec-fetch-site'] !== 'same-origin' ||
          !['cors', 'same-origin'].includes(String(request.headers['sec-fetch-mode'])) || request.headers['sec-fetch-dest'] !== 'empty' ||
          request.headers['x-lrd-display'] !== '1') throw new HttpError(403, 'Same-origin display action required');
      const action = z.discriminatedUnion('action', [
        z.object({ action: z.literal('start') }).strict(),
        z.object({ action: z.literal('heartbeat'), id: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
        z.object({ action: z.literal('release'), id: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
        z.object({ action: z.literal('resume'), confirmedAllClosed: z.literal(true) }).strict(),
      ]).parse(await jsonBody(request));
      if (action.action === 'start') {
        const id = await snapshotFile.transition(() => displayPresence.start()); if (!id) throw new HttpError(409, 'Close browser displays, then resume snapshots from Home');
        json(response, 201, { id }); return;
      }
      if (action.action === 'heartbeat' && !displayPresence.heartbeat(action.id)) throw new HttpError(409, 'Close this display and resume snapshots from Home');
      if (action.action === 'release') await snapshotFile.transition(() => displayPresence.release(action.id));
      if (action.action === 'resume') await snapshotFile.transition(() => displayPresence.resume());
      json(response, 204); return;
    }

    if (method === 'GET' && path === '/api/health') { json(response, 200, { status: 'ok', version: APP_VERSION, storageWarning: store.warning }); return; }
    if (method === 'GET' && path === '/api/windows/status') { json(response, 200, await windowsStatus()); return; }
    if (method === 'GET' && path === '/api/state') {
      // Metadata only: the photo bytes are not copied for a poll (#353).
      const { settings, reminders, photo, settingsRevision } = store.view();
      const schedule = schedules.snapshot(settings, now());
      const effective = scheduledSettings(settings, schedule);
      // A manual editor canvas can need providers hidden by the scheduled board.
      // This read-only hint adds canonical manual needs; regular Home/display/native
      // requests stay effective-only, and unsaved visual needs use the explicit APIs.
      const editorView = request.headers['x-lrd-view'] === 'editor';
      if (!effective.preview.enabled || !effective.widgets.preview) clearPreview();
      // The forecast is refreshed only while a saved widget needs it (#352); air quality only while a saved
      // widget shows it (Air quality, or Dynamic with Air & UV, #437); official alerts only while Dynamic
      // shows them (#437). Each waits for a due refresh at most briefly (#351). Alerts are API-only: never
      // stored, exported or logged.
      const [weatherState, airQuality, alertsState] = await Promise.all([
        needsForecast(effective) || (editorView && needsForecast(settings)) ? weather.get(effective) : weather.peek(effective),
        needsAirQuality(effective) || (editorView && needsAirQuality(settings)) ? air.get(effective) : offAirQuality(effective),
        needsAlerts(effective) || (editorView && needsAlerts(settings)) ? alerts.get(effective) : offAlerts(),
      ]);
      const state: AppState = { settings, schedule, reminders, weather: weatherState, preview: previewState(), airQuality, alerts: alertsState, timers: timers.list(now()), timersWarning: timers.warning,
        photo: photo ? { available: true, ...photo } : { available: false, id: null, width: null, height: null, updatedAt: null } };
      json(response, 200, { ...state, storageWarning: store.warning }, etag(settingsRevision)); return;
    }
    if (method === 'PATCH' && path === '/api/settings') {
      const patch = settingsPatchSchema.parse(await jsonBody(request));
      let saved: Awaited<ReturnType<DataStore['commitSettings']>>;
      try { saved = await store.commitSettings(patch, now(), ifMatch(request)); } catch (error) {
        if (!(error instanceof SettingsConflict)) throw error;
        // A Save computed from outdated settings (#287): the editor merges these and tries again.
        json(response, 409, { error: error.message, settings: error.settings, revision: error.settingsRevision }, etag(error.settingsRevision)); return;
      }
      const effective = effectiveSettings();
      if (!effective.preview.enabled || !effective.widgets.preview) clearPreview();
      preparation.refresh();
      json(response, 200, saved.settings, etag(saved.settingsRevision)); return;
    }
    if (method === 'POST' && path === '/api/location') {
      const selection = automaticLocationSchema.parse(await jsonBody(request));
      const saved = await store.update(data => {
        // Check inside the serialized write, rather than trusting an earlier browser state.
        if (data.settings.locationSource === 'manual' && (selection.automatic || selection.source === 'fallback')) return;
        data.settings = mergeSettings(data.settings, selection.source === 'device'
          ? { locationSource: 'device', location: { name: 'Device area', latitude: selection.latitude, longitude: selection.longitude, timezone: 'auto' } }
          : { locationSource: 'fallback' });
      });
      json(response, 200, saved.settings); return;
    }
    // Settings and unsaved visual previews can ask for the saved area's forecast (#352/#517).
    if (method === 'GET' && path === '/api/weather') { json(response, 200, await weather.get(store.view().settings)); return; }
    if (method === 'GET' && path === '/api/air-quality') {
      // Editor preview before Save: the saved location, the requested (or saved) scale, the shared cache.
      const settings = store.view().settings;
      const scale = z.enum(['us', 'european']).optional().parse(url.searchParams.get('scale') ?? undefined) ?? settings.widgetData.airQuality.scale;
      json(response, 200, await air.get(settings, scale)); return;
    }
    if (method === 'GET' && path === '/api/locations') {
      const query = z.string().trim().min(2).max(100).parse(url.searchParams.get('q'));
      try { json(response, 200, await weather.locations(query)); } catch { throw new HttpError(502, 'City search is unavailable. Try again later.'); }
      return;
    }
    if (method === 'GET' && path === '/api/reminders') { json(response, 200, store.view().reminders); return; }
    if (method === 'POST' && path === '/api/reminders') {
      const input = reminderCreateSchema(now()).parse(await jsonBody(request));
      const timestamp = new Date(now()).toISOString();
      // Undo after a delete passes the original createdAt, so the reminder returns to its sorted place (#237).
      const reminder: Reminder = { id: randomUUID(), text: input.text, dueAt: input.dueAt ?? null, completed: false, createdAt: input.createdAt ?? timestamp, updatedAt: timestamp };
      await store.update(data => {
        if (data.reminders.length >= REMINDER_LIMIT) {
          // A full store makes way by dropping the oldest completed reminder; pending ones are never dropped.
          const oldest = historyReminders(data.reminders).at(-1);
          if (!oldest) throw new HttpError(409, 'Reminder limit reached');
          data.reminders = data.reminders.filter(item => item !== oldest);
        }
        data.reminders.push(reminder);
      });
      json(response, 201, reminder); return;
    }
    if (method === 'DELETE' && path === '/api/reminders/completed') {
      let deleted = 0;
      await store.update(data => {
        const pending = data.reminders.filter(item => !item.completed);
        deleted = data.reminders.length - pending.length;
        data.reminders = pending;
      });
      json(response, 200, { deleted } satisfies ClearCompletedResult); return;
    }
    const reminderMatch = /^\/api\/reminders\/([0-9a-f-]{36})$/i.exec(path);
    if (reminderMatch && (method === 'PATCH' || method === 'DELETE')) {
      const patch = method === 'PATCH' ? reminderPatchSchema.parse(await jsonBody(request)) : null;
      let changed: Reminder | undefined;
      try {
        await store.update(data => {
          const index = data.reminders.findIndex(item => item.id === reminderMatch[1]);
          if (index < 0) throw new HttpError(404, 'Reminder not found');
          const stored = data.reminders[index]!;
          if (!patch) { data.reminders.splice(index, 1); return; }
          const differs = (key: keyof typeof patch) => patch[key] !== undefined && patch[key] !== stored[key];
          // Retries and double taps write nothing, so a completion keeps its original time.
          if (!differs('text') && !differs('completed') && !differs('dueAt')) throw new UnchangedReminder(stored);
          if (stored.completed && patch.completed !== false && (differs('text') || differs('dueAt'))) throw new HttpError(409, RESTORE_BEFORE_EDITING);
          changed = { ...stored, ...patch, updatedAt: new Date(now()).toISOString() };
          data.reminders[index] = changed;
          if (changed.completed && !stored.completed) data.reminders = pruneHistory(data.reminders, REMINDER_HISTORY_LIMIT);
        });
      } catch (error) {
        if (!(error instanceof UnchangedReminder)) throw error;
        changed = error.reminder;
      }
      json(response, patch ? 200 : 204, changed); return;
    }
    // Scheduled styles (#514) are a local sidecar, with their own concurrency revision.
    if (path === '/api/schedule' && (method === 'GET' || method === 'PUT')) {
      if (method === 'PUT') await schedules.configure(scheduleConfigSchema.parse(await jsonBody(request)), ifMatch(request));
      preparation.refresh();
      json(response, 200, schedules.snapshot(store.view().settings, now()), etag(schedules.revision)); return;
    }
    if (path === '/api/schedule/override' && method === 'POST') {
      const { manual } = z.object({ manual: z.boolean() }).strict().parse(await jsonBody(request));
      await schedules.override(manual, now(), ifMatch(request));
      preparation.refresh();
      json(response, 200, schedules.snapshot(store.view().settings, now()), etag(schedules.revision)); return;
    }
    if (path === '/api/schedule/export' && method === 'GET') {
      json(response, 200, { version: 1, kind: 'still-schedule', config: schedules.snapshot(store.view().settings, now()).config }); return;
    }
    if (path === '/api/schedule/import' && method === 'POST') {
      const backup = scheduleBackupSchema.parse(await jsonBody(request));
      await schedules.restore(backup.config, ifMatch(request));
      preparation.refresh();
      json(response, 200, schedules.snapshot(store.view().settings, now()), etag(schedules.revision)); return;
    }
    // Home (#438) -------------------------------------------------------------------------------------
    if (method === 'GET' && path === '/api/changes') {
      const next = schedules.marker(store.view().settings, now());
      if (next !== scheduleMarker) { scheduleMarker = next; scheduleChanges++; }
      // Preserve the opaque four-part marker contract; schedule transitions join ephemeral display changes.
      json(response, 200, { change: `${bootId}.${store.changes}.${timers.changes}.${previewChanges + scheduleChanges}` } satisfies ChangeMarker); return;
    }
    if (method === 'GET' && path === '/api/timers') { json(response, 200, { timers: timers.list(now()), warning: timers.warning } satisfies TimersResult); return; }
    if (method === 'POST' && path === '/api/timers') {
      const input = await jsonBody(request);
      // A length outside 1 s – 24 h gets the sentence Home shows as is.
      const length = (input as { durationMs?: unknown } | null)?.durationMs;
      if (typeof length !== 'number' || !Number.isInteger(length) || length < TIMER_MIN_MS || length > TIMER_MAX_MS) throw new HttpError(400, TIMER_MESSAGES.range);
      json(response, 201, await timers.create(timerCreateSchema(now()).parse(input), now())); return;
    }
    if (method === 'DELETE' && path === '/api/timers/finished') { json(response, 200, { deleted: await timers.removeFinished(now()) } satisfies ClearCompletedResult); return; }
    const timerMatch = /^\/api\/timers\/([0-9a-f-]{36})$/i.exec(path);
    if (timerMatch && method === 'PATCH') { json(response, 200, await timers.patch(timerMatch[1]!, timerPatchSchema.parse(await jsonBody(request)), now())); return; }
    if (timerMatch && method === 'DELETE') { await timers.remove(timerMatch[1]!, now()); json(response, 204); return; }
    // One countdown or world clock at a time, inside the serialized write, so two pages never drop
    // each other's items (#287). Undo passes the removed item's id and index back.
    if (method === 'POST' && (path === '/api/countdowns' || path === '/api/world-clocks')) {
      const countdown = path === '/api/countdowns';
      const { id, index, ...fields } = countdown ? countdownCreateSchema.parse(await jsonBody(request)) : worldClockCreateSchema.parse(await jsonBody(request));
      const key = countdown ? 'countdowns' : 'worldClocks', limit = countdown ? 12 : 4;
      let saved: Settings;
      try {
        saved = (await store.update(data => {
          const list = data.settings.widgetData[key] as { id: string }[];
          if (id && list.some(item => item.id === id)) throw new UnchangedSettings(data.settings);
          if (list.length >= limit) throw new HttpError(409, countdown ? 'Up to 12 countdowns. Remove one to add another.' : 'Up to 4 cities. Remove one to add another.');
          const item = { id: id ?? randomUUID(), ...fields };
          list.splice(Math.min(index ?? list.length, list.length), 0, item);
          data.settings = mergeSettings(data.settings, { widgetData: { [key]: list } });
        })).settings;
      } catch (error) {
        if (!(error instanceof UnchangedSettings)) throw error;
        json(response, 200, error.settings); return;
      }
      json(response, 201, saved); return;
    }
    const itemMatch = /^\/api\/(countdowns|world-clocks)\/([0-9a-f-]{36})$/i.exec(path);
    if (itemMatch && method === 'DELETE') {
      const key = itemMatch[1] === 'countdowns' ? 'countdowns' : 'worldClocks';
      const saved = await store.update(data => {
        const list = data.settings.widgetData[key] as { id: string }[];
        if (!list.some(item => item.id === itemMatch[2])) throw new HttpError(404, key === 'countdowns' ? 'Countdown not found' : 'City not found');
        data.settings = mergeSettings(data.settings, { widgetData: { [key]: list.filter(item => item.id !== itemMatch[2]) } });
      });
      json(response, 200, saved.settings); return;
    }
    // "Show on my display" (#438): free cells only, never moving another widget; Edit display makes room.
    const showMatch = /^\/api\/widgets\/([A-Za-z]+)\/show$/.exec(path);
    if (showMatch && method === 'POST') {
      const id = showMatch[1] as WidgetId;
      if (!HOME_SHOWABLE_WIDGETS.includes(id) || !isActiveWidget(id)) throw new HttpError(400, 'Home can only show Clock, World clocks, Calendar, Reminders, Countdown and Note');
      let saved: Settings;
      try {
        saved = (await store.update(data => {
          if (data.settings.widgets[id]) throw new UnchangedSettings(data.settings);
          const placement = showPlacement(data.settings, id);
          if (!placement) throw new HttpError(409, `No room for ${WIDGET_CATALOG[id].name} on your display.`);
          data.settings = mergeSettings(data.settings, { widgets: { [id]: true }, widgetGrid: { placements: { [id]: { ...placement, span: placement.span ?? null } } } });
        })).settings;
      } catch (error) {
        if (!(error instanceof UnchangedSettings)) throw error;
        saved = error.settings;
      }
      json(response, 200, saved); return;
    }
    if (method === 'GET' && path === '/api/export') {
      response.setHeader('Content-Disposition', 'attachment; filename="living-room-display-backup.json"');
      const { version, settings, reminders } = store.view();
      // Exports omit additive defaults so the previous release can import them (#84).
      json(response, 200, { version, settings: persistableSettings(settings), reminders, exportedAt: new Date(now()).toISOString() }); return;
    }
    if (method === 'POST' && path === '/api/import') {
      const imported = importSchema.parse(await jsonBody(request));
      await store.update(data => { data.settings = imported.settings; data.reminders = imported.reminders; });
      preparation.invalidate(); clearPreview(); preparation.refresh(); json(response, 200, { status: 'imported' }); return;
    }
    if (method === 'GET' && path === '/api/host/session') {
      nativeRequest(request, false);
      preparation.config();
      // A replacement helper owns a fresh native-preview session. Delayed cleanup
      // or upload from its predecessor must not modify the replacement's pixels.
      // The separate preparer capability and pending pre-idle frame remain intact.
      await snapshotFile.transition(() => { hostToken = randomBytes(32).toString('hex'); });
      json(response, 200, { token: hostToken, settings: effectiveSettings(), displayUrl: `http://127.0.0.1:${port}/` }); return;
    }
    if (path === '/api/preview/preparation' && ['GET', 'POST', 'DELETE'].includes(method)) {
      preparationRequest(request);
      if (method === 'GET') {
        const event = z.enum(['capture-started', 'capture-uploaded', 'capture-failed', 'capture-skipped']).safeParse(request.headers['x-preparation-event']);
        if (event.success) {
          const count = (key: string) => z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(request.headers[key]);
          const sequence = count('x-preparation-event-sequence');
          if (sequence > captureEvent.sequence) {
            captureEvent = { phase: event.data, sequence, attempts: count('x-preparation-capture-attempts'), failures: count('x-preparation-capture-failures') };
            if (event.data === 'capture-started') snapshotFile.captureStarted();
          }
        }
        const config = preparation.config();
        if (request.headers['x-preparation-safe'] === '1' && config.enabled) {
          const session = z.coerce.number().int().min(0).max(0x7fffffff).parse(request.headers['x-session-id']);
          preparation.snapshot.observe(session);
          if (request.headers['x-preparation-freeze'] === '1') preparation.snapshot.freeze();
          else if (request.headers['x-preparation-capture-eligible'] === '1') preparation.snapshot.resume();
        } else preparation.invalidate(true);
        json(response, 200, { ...config, generation: preparation.snapshot.generation, frame: null,
          capturePaused: displayPresence.paused, captureRevision: displayPresence.revision }); return;
      }
      if (method === 'DELETE') {
        if (request.headers['x-invalidate-active-only'] === '1') { /* Ordinary input retains the latest file. */ }
        else preparation.invalidate(request.headers['x-invalidate-active'] === '1');
        json(response, 204); return;
      }
      if (request.headers['content-type'] !== 'image/png') throw new HttpError(415, 'Use image/png');
      const integerHeader = (name: string, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(0).max(max).parse(request.headers[name]);
      const captureRevision = integerHeader('x-preparation-capture-revision');
      const stamp = {
        generation: integerHeader('x-preparation-generation'), configuration: z.string().min(1).max(100).parse(request.headers['x-preparation-configuration']),
        inputTick: integerHeader('x-input-tick', 0xffffffff), sessionId: integerHeader('x-session-id', 0x7fffffff),
        desktopId: z.literal('Default').parse(request.headers['x-desktop-id']), capturedAt: z.iso.datetime({ offset: true }).parse(request.headers['x-captured-at']),
        completedAt: z.iso.datetime({ offset: true }).parse(request.headers['x-completed-at']), completedMonotonicMs: integerHeader('x-completed-monotonic-ms'),
        timeoutSeconds: integerHeader('x-idle-timeout-seconds', 0x7fffffff),
      };
      // Unlike the active preview, this slot is never reachable by state, image, export or Home polls.
      let content: Buffer | undefined;
      const chunks: Buffer[] = [];
      try {
        let total = 0;
        for await (const chunk of request) {
          total += chunk.length;
          if (total > 4 * 1024 * 1024) throw new HttpError(413, 'Request body is too large');
          chunks.push(Buffer.from(chunk));
        }
        content = Buffer.concat(chunks);
        if (content.length < 33 || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            content.toString('ascii', 12, 16) !== 'IHDR') throw new HttpError(400, 'Invalid PNG');
        const width = content.readUInt32BE(16), height = content.readUInt32BE(20);
        if (width < 1 || height < 1 || width > 640 || height > 360) throw new HttpError(400, 'Snapshot dimensions are too large');
        preparationRequest(request);
        const config = preparation.config();
        if (!preparation.snapshot.accepts(stamp, config.enabled)) throw new HttpError(409, 'Preparation was invalidated');
        const accepted = await snapshotFile.write(content, stamp.capturedAt, () => {
          preparationRequest(request);
          return !displayPresence.paused && captureRevision === displayPresence.revision && preparation.snapshot.accepts(stamp, preparation.config().enabled);
        });
        if (!accepted) throw new HttpError(409, 'Snapshot publication failed or was invalidated');
        // Keep scalar ordering/epoch validation only; pixels have one canonical file.
        preparation.snapshot.receive({ content: Buffer.alloc(0), capturedAt: stamp.capturedAt, width, height }, stamp, config.enabled);
        json(response, 201, { prepared: true }); return;
      } finally { for (const chunk of chunks) chunk.fill(0); content?.fill(0); }
    }
    if (method === 'POST' && path === '/api/preview/preparation/claim') {
      preparationRequest(request);
      throw new HttpError(410, 'The shared screenshot file does not require a native claim');
    }
    if (method === 'GET' && path === '/api/preview') { json(response, 200, { ...previewState(), pipeline: { ...snapshotFile.pipeline(), capture: captureEvent, display: displayPresence.status() } }); return; }
    if (method === 'GET' && path === '/api/photo/image') {
      // Decoded once per photo and shared until it changes (#353).
      const photo = store.photoImage();
      if (!photo || (url.searchParams.has('id') && url.searchParams.get('id') !== photo.id)) throw new HttpError(404, 'No selected photo is available');
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': photo.content.length }); response.end(photo.content); return;
    }
    // HEAD answers with GET's status and headers and no body (#124); Node sends no body for HEAD.
    if ((method === 'GET' || method === 'HEAD') && path === '/api/preview/image') {
      if (!previewState().available) throw new HttpError(404, 'No snapshot is available');
      const frame = await snapshotFile.read(url.searchParams.get('t') ?? undefined);
      if (!frame) throw new HttpError(404, 'No matching snapshot is available');
      const clear = () => frame.content.fill(0);
      response.once('finish', clear); response.once('close', clear);
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': frame.content.length }); response.end(frame.content); return;
    }
    if (path === '/api/preview' && (method === 'POST' || method === 'DELETE')) {
      nativeRequest(request, true);
      if (method === 'DELETE') { json(response, 204); return; }
      const settings = effectiveSettings();
      const uploadConfiguration = preparation.config().configuration;
      if (!settings.preview.enabled || !settings.widgets.preview) throw new HttpError(409, 'Preview is disabled');
      if (request.headers['content-type'] !== 'image/png') throw new HttpError(415, 'Use image/png');
      const capturedAt = z.iso.datetime({ offset: true }).parse(request.headers['x-captured-at']);
      if (Math.abs(now() - Date.parse(capturedAt)) > 5 * 60_000) throw new HttpError(400, 'Snapshot capture time must be recent');
      const uploadGeneration = previewGeneration;
      const content = await bytes(request, 4 * 1024 * 1024);
      if (content.length < 33 || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || content.toString('ascii', 12, 16) !== 'IHDR') throw new HttpError(400, 'Invalid PNG');
      const width = content.readUInt32BE(16); const height = content.readUInt32BE(20);
      if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304) throw new HttpError(400, 'Snapshot dimensions are too large');
      nativeRequest(request, true);
      const currentSettings = effectiveSettings();
      const currentConfiguration = preparation.config().configuration;
      if (uploadGeneration !== previewGeneration || uploadConfiguration !== currentConfiguration || !currentSettings.preview.enabled || !currentSettings.widgets.preview) {
        throw new HttpError(409, 'Snapshot upload was cleared or preview is disabled');
      }
      const saved = await snapshotFile.write(content, capturedAt, () => {
        nativeRequest(request, true);
        return uploadGeneration === previewGeneration && uploadConfiguration === preparation.config().configuration && !displayPresence.paused;
      });
      content.fill(0);
      if (!saved) throw new HttpError(409, 'Snapshot publication failed or was invalidated');
      json(response, 201, previewState()); return;
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'API endpoint not found');
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (!options.clientDirectory) throw new HttpError(503, 'The client build is unavailable');
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { throw new HttpError(400, 'Invalid path'); }
    const root = resolve(options.clientDirectory);
    const requested = resolve(root, `.${decoded}`);
    if (requested !== root && !requested.startsWith(root + sep)) throw new HttpError(403, 'Invalid path');
    const file = extname(requested) ? requested : join(root, 'index.html');
    let content: Buffer;
    try { content = await readFile(file); } catch { throw new HttpError(404, 'Client file not found. Build the application first.'); }
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600' });
    response.end(method === 'HEAD' ? undefined : content);
  }
  let closed = false;
  const closePreparation = () => {
    if (closed) return; closed = true;
    preparation.close();
    void snapshotFile.clear().then(async () => {
      if (privateCache) return;
      const absolute = resolve(cacheDirectory);
      if (!absolute.startsWith(resolve(tmpdir()) + sep) || (await lstat(absolute)).isSymbolicLink()) return;
      await rm(absolute, { recursive: true });
    }).catch(() => {});
  };
  server.once('close', closePreparation);
  return { server, store, weather, closePreparation };
}
