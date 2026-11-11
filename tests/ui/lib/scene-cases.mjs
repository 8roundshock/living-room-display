// Shared by the themes suite, the scene3d suite and tools/scene-sheet.mjs: how to make the app show each
// registered scene from synthetic settings, dates and weather, and how to launch Edge with or without WebGL.
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../../../src/server/app.ts';
import { forecastFixture } from '../../../src/server/fixtures.ts';
import { defaultSettings } from '../../../src/shared/defaults.ts';
import { keepPagesLocal } from './local-only.mjs';
import { mockScreenWakeLock } from './windows-fixture.mjs';

/** [scene id, civil date, weather code, calendars (default all), birthday treatment]. Every registered scene once. */
export const SCENE_CASES = [
  ['birthday', '2026-01-10', 0, [], 'classic'], ['birthday-russian', '2026-01-10', 0, [], 'russian'], ['birthday-korean', '2026-06-12', 0, [], 'korean'],
  ['spring', '2026-04-25', 0], ['summer', '2026-07-20', 0], ['autumn', '2026-11-04', 0], ['winter', '2026-02-01', 0],
  ['christmas', '2026-12-20', 0], ['new-year', '2026-12-29', 0, ['CA', 'KR']], ['new-year-tree', '2026-12-29', 0], ['orthodox-christmas', '2027-01-07', 0],
  ['halloween', '2026-10-25', 0], ['thanksgiving', '2026-10-12', 0], ['canada-day', '2026-07-01', 0], ['easter', '2026-04-05', 0, ['CA']],
  ['seollal', '2027-02-07', 0], ['chuseok', '2027-09-15', 0], ['lotus-lanterns', '2027-05-13', 0], ['maslenitsa', '2026-02-16', 0, ['RU']], ['pascha', '2026-04-12', 0, ['RU']], ['mimosa', '2026-03-08', 0],
  ['rain', '2026-12-20', 63], ['snow', '2026-12-20', 73], ['storm', '2026-12-20', 95], ['fog', '2026-12-20', 45], ['wind', '2026-12-20', 0],
];
export const WEATHER_IDS = ['rain', 'snow', 'storm', 'fog', 'wind'];
/** A current-weather reading that resolves to each weather kind. */
export const WEATHER_READING = { rain: { code: 63, wind: 8 }, snow: { code: 73, wind: 8 }, storm: { code: 95, wind: 8 }, fog: { code: 45, wind: 8 }, wind: { code: 0, wind: 40 } };

/** Edge launch arguments. `off` is the supported fallback path (no WebGL at all); `software` allows
 * SwiftShader so WebGL also works on a runner without a GPU; `gpu` asks for the machine's real GPU. */
export const WEBGL_ARGS = {
  off: ['--disable-3d-apis'],
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  gpu: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
};

/** An isolated source server on an ephemeral loopback port with temporary synthetic data. */
export async function startSceneServer() {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-scene-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  return { app, base: `http://127.0.0.1:${app.server.address().port}`,
    async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}

/**
 * Save synthetic settings that resolve to `scene` (a registered id), optionally with `weather` over it
 * (Combined mode) and a saved Transparency (#670, 0-100), and open a page on it. The page's Date is fixed to the scene's day; timers and
 * animation frames run in real time. `prepare(context)` and `onPage(page)` run before the page loads.
 * Returns { context, page, date }.
 */
export async function openScene(browser, server, { scene, weather = null, path = '/display', viewport = { width: 1920, height: 1080 }, brightness = .36, animation = 'subtle', reduced = 'no-preference', mode, transparency, empty = false, allowSoftware = false, pageErrors, prepare, onPage } = {}) {
  const found = SCENE_CASES.find(([id]) => id === scene);
  if (!found) throw new Error(`Unknown scene ${scene}; known: ${SCENE_CASES.map(([id]) => id).join(', ')}`);
  const [, civil, code, calendars = ['CA', 'KR', 'RU'], birthday] = found, date = `${civil}T18:30:00Z`, own = WEATHER_IDS.includes(scene);
  const reading = weather ? WEATHER_READING[weather] : own ? WEATHER_READING[scene] : { code, wind: 8 };
  const settings = defaultSettings();
  settings.appearance.theme = { mode: mode ?? (weather ? 'combined' : own ? 'weather' : 'seasonal'), calendars, ...(transparency === undefined ? {} : { transparency }) };
  settings.appearance.animation = animation; settings.appearance.brightness = brightness; settings.appearance.motionEnabled = false;
  if (birthday) settings.birthdays = [{ id: '00000000-0000-4000-8000-000000000600', name: 'Birthday A', date: civil.slice(5), treatment: birthday }];
  if (empty) { for (const id of Object.keys(settings.widgets)) settings.widgets[id] = false; settings.preview.enabled = false; }
  await server.app.store.update(data => { data.settings = settings; data.reminders = []; });
  const source = await (await fetch(`${server.base}/api/state`)).json();
  source.weather = { ...source.weather, status: 'fresh', updatedAt: date, error: null, location: settings.location, details: [], daily: [], hourly: [], current: { time: date, temperature: 4, feelsLike: 2, weatherCode: reading.code, isDay: true, windSpeed: reading.wind } };
  const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion: reduced });
  await keepPagesLocal(context, server.base); await mockScreenWakeLock(context);
  // The app refuses a software rasteriser for 3D scenes; a source check on a machine without a GPU asks for it.
  if (allowSoftware) await context.addInitScript(() => { window.__lrdScene3dAllowSoftware = true; });
  await context.route('**/api/state', route => route.fulfill({ json: { ...source, settings: server.app.store.snapshot().settings } }));
  await context.route('**/api/weather', route => route.fulfill({ json: source.weather }));
  await prepare?.(context);
  const page = await context.newPage();
  if (pageErrors) page.on('pageerror', error => pageErrors.push(error.message));
  await onPage?.(page);
  await page.clock.setFixedTime(new Date(date));
  await page.goto(server.base + path);
  await page.locator(path === '/editor' ? '.studio-header' : '.widget-grid-plane').waitFor();
  return { context, page, date };
}
