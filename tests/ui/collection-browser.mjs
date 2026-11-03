// #565 collection acceptance: production assets, isolated server, synthetic state and RAM-only images.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { COLLECTION_WIDGET_IDS } from '../../src/client/collection.ts';
import { WIDGET_IDS, widgetSizes, gridProblem } from '../../src/shared/widgets.ts';
import { COLLECTION_BOARD } from './lib/boards.mjs';
import { prepareCollection } from './lib/collection-fixture.mjs';
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';
import { waitForWidgetFit } from './lib/fit-readiness.mjs';

export async function runCollectionQa({ playwright, edge, capture = false, captureOnly = false } = {}) {
  const require = createRequire(import.meta.url), { chromium } = require(resolve(playwright));
  const now = Date.parse('2026-10-19T13:00:00Z'), directory = await mkdtemp(join(tmpdir(), 'lrd-collection-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()), now: () => now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`, browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [], fitFailures = [];
  try {
    const source = await (await fetch(`${base}/api/state`)).json(); prepareCollection(source, { now });
    source.settings.widgetData.worldClocks = [{ id: 'synthetic-london', label: 'London', timezone: 'Europe/London', latitude: 51.51, longitude: -0.13 }];
    source.timers = [{ id: 'collection-timer', label: 'Tea', durationMs: 600000, endsAt: new Date(now + 480000).toISOString(), remainingMs: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }];
    source.reminders = Array.from({ length: 7 }, (_, index) => ({ id: `synthetic-${index}`, text: ['Water the plants', 'Return library books', 'Evening walk'][index % 3], dueAt: new Date(now + index * 86400_000 + 3600_000).toISOString(), completed: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }));
    let current = source;
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    await keepPagesLocal(context, base); await mockScreenWakeLock(context);
    await context.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.clock.install({ time: new Date(now) });
    const open = async path => { await page.goto(base + path); await page.locator('.ambient-widget').first().waitFor(); await page.clock.runFor(300); };
    const single = (id, size, density) => { current = structuredClone(source); current.settings.appearance.motionEnabled = false; current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id])); current.settings.widgetGrid.density = density; current.settings.widgetGrid.placements[id] = { column: 0, row: 0, size }; };
    const fit = async (id, label) => {
      await waitForWidgetFit(page, `[data-widget-id="${id}"]`, { label });
      const result = await page.locator(`[data-widget-id="${id}"]`).evaluate(section => {
        const content = section.querySelector('.widget-content'), box = section.getBoundingClientRect(), scale = new DOMMatrix(getComputedStyle(content).transform).a;
        const escaping = [...content.querySelectorAll('.collection-label,.collection-value,.collection-title,.collection-footer,.collection-hour-value,.collection-detail')].filter(element => { const rect = element.getBoundingClientRect(); return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1; }).map(element => element.className);
        return { scale, escaping, text: section.innerText };
      });
      if (result.scale < 0.995 || result.escaping.length) fitFailures.push({ label, ...result }); return result;
    };
    let families = 0;
    for (const viewport of captureOnly ? [{ width: 1280, height: 720 }] : [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const density of captureOnly ? ['balanced'] : ['spacious', 'balanced', 'fine']) for (const id of COLLECTION_WIDGET_IDS) for (const size of widgetSizes(id)) {
        single(id, size, density); await open('/display'); await fit(id, `${id}/${size}/${density}/${viewport.width}`); families++;
        if (capture && viewport.width === 1280 && density === 'balanced') images.push({ name: `${id}-${size}`, bytes: await page.locator(`[data-widget-id="${id}"]`).screenshot() });
      }
    }
    checks.push(`${families} supported-family/grid/viewport renders fit at 1 with contained content`);
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const id of COLLECTION_WIDGET_IDS) {
      single(id, widgetSizes(id)[0], 'balanced'); current.weather.status = 'unavailable'; current.weather.details = []; current.weather.hourly = []; current.reminders = []; current.timers = []; current.alerts = { ...current.alerts, status: 'unavailable', alerts: [] }; current.settings.widgetData.worldClocks = [];
      await open('/display'); await fit(id, `${id}/empty`);
      if (capture) images.push({ name: `${id}-empty`, bytes: await page.locator(`[data-widget-id="${id}"]`).screenshot() });
    }
    checks.push('All fifteen honest no-data states fit, with no render exceptions');
    // Data-heavy cases complement the complete geometry matrix: labels, explicit provider status,
    // and old readings must stay readable without hiding their provenance or shrinking the card.
    let scenarioCount = 0;
    const scenario = async (id, size, name, update, expected) => {
      for (const density of ['balanced', 'fine']) {
        single(id, size, density); update(current); await open('/display');
        const result = await fit(id, `${id}/${size}/${name}/${density}`);
        if (expected) assert.match(result.text, expected, `${id}/${name} honest content`);
        if (id === 'timers' && name === 'mixed') {
          const paint = await page.locator('.timers-digits.status-caution').evaluate(element => ({ color: getComputedStyle(element).color, caution: getComputedStyle(element.closest('.ambient')).getPropertyValue('--ambient-caution').trim(), stroke: getComputedStyle(element).webkitTextStrokeWidth }));
          const caution = Number.parseInt(paint.caution.slice(1), 16);
          assert.equal(paint.color, `rgb(${caution >> 16}, ${(caution >> 8) & 255}, ${caution & 255})`, 'Done is visibly painted in the shared status tone');
          assert.equal(paint.stroke, '0px', 'Done does not keep the running-timer outline');
        }
        scenarioCount++;
        if (capture && density === 'balanced') images.push({ name: `${id}-${name}`, bytes: await page.locator(`[data-widget-id="${id}"]`).screenshot() });
      }
    };
    for (const id of ['wind', 'humidity', 'pressure', 'visibility', 'cloudCover']) for (const size of widgetSizes(id)) {
      await scenario(id, size, 'saved', state => {
        state.weather.status = 'stale'; state.weather.updatedAt = new Date(now - 86400_000).toISOString();
        state.weather.details = state.weather.details.map(reading => ({ ...reading, time: new Date(Date.parse(reading.time) - 2 * 86400_000).toISOString() }));
      }, /Last known[\s\S]*Saved forecast/);
    }
    const provider = state => { state.alerts = { status: 'fresh', provider: 'eccc', source: 'Environment and Climate Change Canada', sourceUrl: 'https://weather.gc.ca/', area: 'Sample area', checkedAt: new Date(now).toISOString(), error: null, alerts: [] }; };
    for (const size of widgetSizes('weatherAlerts')) {
      await scenario('weatherAlerts', size, 'quiet', provider, /No current alerts/);
      await scenario('weatherAlerts', size, 'unsupported', state => { provider(state); state.alerts.status = 'unsupported'; }, /No provider for this area/);
      await scenario('weatherAlerts', size, 'saved-empty', state => { provider(state); state.alerts.status = 'stale'; }, /Current alerts unknown/);
      await scenario('weatherAlerts', size, 'active', state => {
        provider(state); state.settings.clockFormat = '24h'; state.weather.location.timezone = 'Europe/London';
        state.alerts.alerts = Array.from({ length: 5 }, (_, index) => ({ id: `alert-${index}`, level: 'warning', name: 'Heavy rainfall and strong coastal winds warning', area: 'Example coast and surrounding inland areas', issuedAt: new Date(now).toISOString(), startsAt: new Date(now + 3600_000).toISOString(), endsAt: null, expiresAt: new Date(now + 86400_000).toISOString() }));
      }, /starts Mon,? 15:00/);
    }
    for (const id of ['agenda', 'weekAhead']) for (const size of widgetSizes(id)) await scenario(id, size, 'long', state => {
      state.reminders = state.reminders.map(item => ({ ...item, text: 'Bring the library books and reusable shopping bags for the afternoon errands' }));
    });
    for (const size of widgetSizes('timers')) await scenario('timers', size, 'mixed', state => {
      state.timers = [0, 1, 2, 3, 4].map(index => ({ ...state.timers[0], id: `timer-${index}`, label: 'Vegetable soup and kitchen clean-up', endsAt: index === 1 ? null : new Date(now + (index === 0 ? -60000 : 480000)).toISOString(), remainingMs: index === 1 ? 240000 : null }));
    }, /Done/);
    await scenario('timeOverlap', 'large', 'four-cities', state => {
      state.settings.widgetData.worldClocks = ['Europe/London', 'America/New_York', 'America/Toronto', 'Europe/Paris'].map((timezone, index) => ({ id: `place-${index}`, label: `${index + 1} ${'W'.repeat(38)}`, timezone, latitude: 0, longitude: 0 }));
    }, /reference hours/);
    checks.push(`${scenarioCount} saved-weather, provider, populated-alert, long-reminder, mixed-timer and four-city renders fit honestly`);

    current = structuredClone(source); current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, id in COLLECTION_BOARD])); Object.assign(current.settings.widgetGrid.placements, COLLECTION_BOARD);
    assert.equal(gridProblem(current.settings.widgetGrid, current.settings.widgets), null);
    current.settings.appearance.motionEnabled = true; current.settings.appearance.rearrange = true; current.settings.appearance.motionIntervalSeconds = 15;
    await open('/display'); for (const id of COLLECTION_WIDGET_IDS) await fit(id, `${id}/board`);
    if (capture) images.push({ name: 'collection-board', bytes: await page.screenshot() });
    const before = await page.locator('.ambient-widget').evaluateAll(elements => elements.map(element => [element.dataset.widgetId, element.style.left, element.style.top]));
    await page.clock.runFor(18000);
    const after = await page.locator('.ambient-widget').evaluateAll(elements => elements.map(element => [element.dataset.widgetId, element.style.left, element.style.top]));
    assert.notDeepEqual(after, before, 'reduced motion still relocates the collection'); for (const id of COLLECTION_WIDGET_IDS) await fit(id, `${id}/after-swap`);
    checks.push('Collection board stays contained before and after a reduced-motion swap');
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 480 }]) {
      await page.setViewportSize(viewport); await open('/editor');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `editor no horizontal overflow at ${viewport.width}`);
      if (capture) images.push({ name: `collection-editor-${viewport.width}`, bytes: await page.screenshot() });
    }
    checks.push('Synthetic collection editor fits 390×844 and 320×480');
    assert.deepEqual(fitFailures, [], "Every collection family fits without shrinking or clipping"); assert.deepEqual(errors, []); await context.close(); return { checks, images };
  } finally { await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, sharp: { type: 'string' } } });
  const result = await runCollectionQa(values); console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks }, null, 2));
}
