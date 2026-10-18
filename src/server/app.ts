import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { AppState, PreviewState, Reminder } from '../shared/contracts.ts';
import { DataStore } from './store.ts';
import { WeatherService, type FetchLike } from './weather.ts';
import { windowsStatus } from './windows.ts';
import { automaticLocationSchema, importSchema, mergeSettings, reminderInputSchema, reminderPatchSchema, settingsPatchSchema, validationMessage } from './validation.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface ApplicationOptions { dataDirectory: string; clientDirectory?: string; fetcher?: FetchLike; now?: () => number; development?: boolean }
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
function json(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

export async function createApplication(options: ApplicationOptions) {
  const store = await DataStore.open(options.dataDirectory);
  const now = options.now ?? Date.now;
  const weather = new WeatherService(options.fetcher, now);
  const hostToken = randomBytes(32).toString('hex');
  let image: Buffer | null = null;
  let previewGeneration = 0;
  let preview: PreviewState = { available: false, capturedAt: null, width: null, height: null };
  function clearPreview() {
    // Invalidate uploads that began before this clear, even if preview is later enabled again.
    previewGeneration++;
    image = null; preview = { available: false, capturedAt: null, width: null, height: null };
  }
  function previewState(): PreviewState {
    if (preview.capturedAt && now() - Date.parse(preview.capturedAt) > 12 * 3600_000) clearPreview();
    return { ...preview };
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
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else if (error instanceof z.ZodError) json(response, 400, { error: validationMessage(error) });
      else json(response, 500, { error: 'The request could not be completed. Existing saved data has been preserved.' });
    });
  });
  server.on('close', clearPreview);
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
    response.setHeader('Permissions-Policy', path.startsWith('/display') ? 'geolocation=()' : 'geolocation=(self)');

    if (method === 'GET' && path === '/api/health') { json(response, 200, { status: 'ok', version: '0.1.0', storageWarning: store.warning }); return; }
    if (method === 'GET' && path === '/api/windows/status') { json(response, 200, await windowsStatus()); return; }
    if (method === 'GET' && path === '/api/state') {
      const { settings, reminders, photoAsset } = store.snapshot();
      const state: AppState = { settings, reminders, weather: await weather.get(settings), preview: previewState(),
        photo: photoAsset ? { available: true, id: photoAsset.id, width: photoAsset.width, height: photoAsset.height, updatedAt: photoAsset.updatedAt } : { available: false, id: null, width: null, height: null, updatedAt: null } };
      json(response, 200, { ...state, storageWarning: store.warning }); return;
    }
    if (method === 'PATCH' && path === '/api/settings') {
      const settings = await store.patchSettings(settingsPatchSchema.parse(await jsonBody(request)), now());
      if (!settings.preview.enabled || !settings.widgets.preview) clearPreview();
      json(response, 200, settings); return;
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
    if (method === 'GET' && path === '/api/weather') { json(response, 200, await weather.get(store.snapshot().settings)); return; }
    if (method === 'GET' && path === '/api/locations') {
      const query = z.string().trim().min(2).max(100).parse(url.searchParams.get('q'));
      try { json(response, 200, await weather.locations(query)); } catch { throw new HttpError(502, 'City search is unavailable. Try again later.'); }
      return;
    }
    if (method === 'GET' && path === '/api/reminders') { json(response, 200, store.snapshot().reminders); return; }
    if (method === 'POST' && path === '/api/reminders') {
      const input = reminderInputSchema.parse(await jsonBody(request));
      const timestamp = new Date(now()).toISOString();
      const reminder: Reminder = { id: randomUUID(), text: input.text, dueAt: input.dueAt ?? null, completed: false, createdAt: timestamp, updatedAt: timestamp };
      await store.update(data => { if (data.reminders.length >= 1000) throw new HttpError(409, 'Reminder limit reached'); data.reminders.push(reminder); });
      json(response, 201, reminder); return;
    }
    const reminderMatch = /^\/api\/reminders\/([0-9a-f-]{36})$/i.exec(path);
    if (reminderMatch && (method === 'PATCH' || method === 'DELETE')) {
      const patch = method === 'PATCH' ? reminderPatchSchema.parse(await jsonBody(request)) : null;
      let changed: Reminder | undefined;
      await store.update(data => {
        const index = data.reminders.findIndex(item => item.id === reminderMatch[1]);
        if (index < 0) throw new HttpError(404, 'Reminder not found');
        if (patch) { changed = { ...data.reminders[index]!, ...patch, updatedAt: new Date(now()).toISOString() }; data.reminders[index] = changed; }
        else data.reminders.splice(index, 1);
      });
      json(response, patch ? 200 : 204, changed); return;
    }
    if (method === 'GET' && path === '/api/export') {
      response.setHeader('Content-Disposition', 'attachment; filename="living-room-display-backup.json"');
      const { version, settings, reminders } = store.snapshot();
      json(response, 200, { version, settings, reminders, exportedAt: new Date(now()).toISOString() }); return;
    }
    if (method === 'POST' && path === '/api/import') {
      const imported = importSchema.parse(await jsonBody(request));
      await store.update(data => { data.settings = imported.settings; data.reminders = imported.reminders; });
      clearPreview(); json(response, 200, { status: 'imported' }); return;
    }
    if (method === 'GET' && path === '/api/host/session') {
      nativeRequest(request, false);
      json(response, 200, { token: hostToken, settings: store.snapshot().settings, displayUrl: `http://127.0.0.1:${port}/` }); return;
    }
    if (method === 'GET' && path === '/api/preview') { json(response, 200, previewState()); return; }
    if (method === 'GET' && path === '/api/photo/image') {
      const asset = store.snapshot().photoAsset;
      if (!asset || (url.searchParams.has('id') && url.searchParams.get('id') !== asset.id)) throw new HttpError(404, 'No selected photo is available');
      const content = Buffer.from(asset.pngBase64, 'base64');
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': content.length }); response.end(content); return;
    }
    if (method === 'GET' && path === '/api/preview/image') {
      if (!previewState().available || !image) throw new HttpError(404, 'No snapshot is available');
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': image.length }); response.end(image); return;
    }
    if (path === '/api/preview' && (method === 'POST' || method === 'DELETE')) {
      nativeRequest(request, true);
      if (method === 'DELETE') { clearPreview(); json(response, 204); return; }
      const settings = store.snapshot().settings;
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
      const currentSettings = store.snapshot().settings;
      if (uploadGeneration !== previewGeneration || !currentSettings.preview.enabled || !currentSettings.widgets.preview) {
        throw new HttpError(409, 'Snapshot upload was cleared or preview is disabled');
      }
      image = content; preview = { available: true, capturedAt, width, height };
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
  return { server, store, weather };
}
