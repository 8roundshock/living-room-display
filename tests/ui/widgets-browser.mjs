// Isolated production renderer QA. Synthetic weather/images; screenshots remain RAM buffers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture, photoFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, isActiveWidget, widgetSizes } from '../../src/shared/widgets.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';

/** Renderers that read the weather or air-quality status or the connection; the others render the same when stale or offline. */
const STATUS_WIDGETS = { weather: ['stale', 'offline'], forecast: ['stale', 'offline'], airQuality: ['stale', 'offline'], reminders: ['offline'] };
/**
 * #221: at Text 100% a family with an element on a readability floor must render at fit 1. These families
 * still zoom out below it; each allowance names the ticket fixing it. An allowance no longer needed fails,
 * so it is removed when that work lands.
 */
const FLOOR_FIT_ALLOWANCES = { 'airQuality/small': '#271', 'airQuality/medium': '#271', 'weather/small': '#283', 'weather/medium': '#283', 'note/small': '#291' };
/**
 * #99: widgets that still construct Intl formatters on a one-second tick within the same minute, each with
 * the ticket caching them. An allowance no longer needed fails; with none left the full board must
 * construct none.
 */
const INTL_TICK_ALLOWANCES = { clock: '#271', preview: '#271' };
/** Every active widget on one Balanced 12 x 8 board (as in motion-browser.mjs). */
const FULL_BOARD = {
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
  reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
  note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
};

/** Counts ResizeObserver and Intl constructions and style changes on .widget-content (an init script). */
function instrumentFit() {
  const counts = window.__lrdFit = { resizeObservers: 0, intl: 0, styleMutations: 0 };
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer { constructor(callback) { super(callback); counts.resizeObservers++; } };
  for (const name of ['DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat']) {
    const Original = Intl[name];
    const Counted = function (...values) { counts.intl++; return new Original(...values); };
    Counted.prototype = Original.prototype; Counted.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
    Intl[name] = Counted;
  }
  new MutationObserver(records => { for (const record of records) if (record.target.classList?.contains('widget-content')) counts.styleMutations++; })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
}

/** The widget's fit scale, its floor sizes and the visible text elements whose computed size sits on a floor. */
function floorReport(widget) {
  return widget.evaluate(section => {
    const probe = expression => { const span = document.createElement('span'); span.style.cssText = `position:absolute;visibility:hidden;font-size:${expression}`; section.append(span); const size = parseFloat(getComputedStyle(span).fontSize); span.remove(); return size; };
    const text = probe('calc(var(--min-text) * var(--font-scale))'), data = probe('calc(var(--min-data) * var(--font-scale))');
    const content = section.querySelector('.widget-content');
    const floored = [...content.querySelectorAll('*')]
      .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && element.checkVisibility({ visibilityProperty: true }))
      .map(element => ({ name: String(element.className?.baseVal ?? element.className ?? element.tagName) || element.tagName, size: parseFloat(getComputedStyle(element).fontSize) }))
      .filter(({ size }) => text > 0 && (Math.abs(size - text) < 0.02 || Math.abs(size - data) < 0.02))
      .map(({ name, size }) => `${name} ${size.toFixed(2)}px`);
    return { fit: new DOMMatrix(getComputedStyle(content).transform).a, text, data, floored };
  });
}

export async function runWidgetQa({ playwright, edge, capture = false } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-widgets-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    const source = await (await fetch(`${base}/api/state`)).json();
    // Every active widget has a check module (tests/ui/widget-checks); their prepare hooks give it content.
    for (const id of ACTIVE_WIDGET_IDS) assert.ok(WIDGET_CHECKS[id], `${id} needs a tests/ui/widget-checks module`);
    for (const check of Object.values(WIDGET_CHECKS)) check.prepare?.(source, { now });
    const clippingSelectors = [...new Set(['.ambient-label', ...Object.values(WIDGET_CHECKS).flatMap(check => check.selectors ?? [])])].join(',');
    const familyCount = ACTIVE_WIDGET_IDS.reduce((total, id) => total + widgetSizes(id).length, 0);
    // Deliberately synthetic geometry, never a personal image or desktop capture.
    const pixels = Buffer.alloc((320 * 4 + 1) * 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const i = y * (320 * 4 + 1) + 1 + x * 4;
      pixels[i] = y > 120 - x / 5 ? 35 : 70; pixels[i + 1] = y > 120 - x / 5 ? 48 : 80; pixels[i + 2] = y > 120 - x / 5 ? 60 : 100; pixels[i + 3] = 255;
    }
    const image = photoFixture(320, 200, pixels);
    let current = structuredClone(source), mode = 'ready', release, imagesUnavailable = false;
    const pending = new Promise(resolve => { release = resolve; });
    await context.route('**/api/state', async route => { if (mode === 'loading') await pending; await route.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'error' ? { error: 'Synthetic unavailable state' } : current) }); });
    await context.route('**/api/photo/image?*', route => route.fulfill(imagesUnavailable ? { status: 404, body: 'Synthetic missing image' } : { contentType: 'image/png', body: image }));
    await context.route('**/api/preview/image?*', route => route.fulfill(imagesUnavailable ? { status: 404, body: 'Synthetic missing image' } : { contentType: 'image/png', body: image }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date(now) });
    const open = async (path = '/display') => { await page.goto(base + path); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); };
    const cursor = () => page.locator('html').evaluate(el => getComputedStyle(el).cursor);

    mode = 'loading'; await page.goto(base + '/display', { waitUntil: 'domcontentloaded' }); await page.locator('.loading-page').waitFor(); assert.notEqual(await cursor(), 'none');
    mode = 'error'; release(); await page.getByRole('button', { name: 'Try again' }).waitFor(); assert.notEqual(await cursor(), 'none');
    mode = 'ready'; await page.getByRole('button', { name: 'Try again' }).click(); await page.locator('.display-page').waitFor();
    await page.keyboard.press('f'); await page.waitForFunction(() => Boolean(document.fullscreenElement)); assert.notEqual(await cursor(), 'none');
    await page.keyboard.press('f'); await page.waitForFunction(() => !document.fullscreenElement);
    const guarded = await page.evaluate(() => {
      let calls = 0; const original = document.documentElement.requestFullscreen;
      document.documentElement.requestFullscreen = async () => { calls++; };
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'repeat']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, [modifier]: true }));
      const input = document.createElement('textarea'); document.body.append(input); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); input.remove();
      const edit = document.createElement('div'); edit.contentEditable = 'true'; document.body.append(edit); edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); edit.remove();
      document.documentElement.requestFullscreen = original; return calls;
    });
    assert.equal(guarded, 0); checks.push('Browser loading/error/display/fullscreen pointer; actual F enter/exit and editable/modifier/repeat guards');
    await open('/display?native=1'); assert.equal(await cursor(), 'none'); assert.equal(await page.locator('.display-help').count(), 0);
    await page.keyboard.press('f'); assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false); checks.push('Explicit native presentation hides only that document cursor and has no browser fullscreen shortcut');

    const clockFonts = {};
    /** One widget alone at the top-left corner of the chosen density, Soft motion off, Text 100%. */
    const familyState = (id, size, density) => {
      const state = structuredClone(source); state.settings.appearance.motionEnabled = false;
      state.settings.widgetGrid.density = density; state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id]));
      state.settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
      return state;
    };
    // #221: stale and offline variants render on their own page, so the main page's clock (which
    // the family hooks read) never moves for them. Chromium delays rendering frames, and with them
    // ResizeObserver delivery, in a background tab, so whichever page is in use is brought to the
    // front: the family hooks (the Reminders remeasure checks, #216) wait on real frames.
    const statusPage = await context.newPage(); statusPage.on('pageerror', error => errors.push(error.message));
    await statusPage.clock.install({ time: new Date(now) });
    await page.bringToFront();
    async function statusReport(id, size, density, viewport, status) {
      await statusPage.bringToFront();
      try { return await renderStatus(id, size, density, viewport, status); } finally { await page.bringToFront(); }
    }
    async function renderStatus(id, size, density, viewport, status) {
      current = familyState(id, size, density);
      if (status === 'stale') {
        current.weather = { ...current.weather, status: 'stale', updatedAt: new Date(now - 5 * 3_600_000).toISOString() };
        current.airQuality = { ...current.airQuality, status: 'stale', updatedAt: new Date(now - 2 * 3_600_000).toISOString() };
      }
      await statusPage.setViewportSize(viewport);
      // An offline display has loaded once and then failed its 30 s refresh.
      await statusPage.clock.setSystemTime(new Date(status === 'offline' ? now - 30_000 : now));
      await statusPage.goto(base + '/display'); await statusPage.locator('.display-page').waitFor(); await statusPage.clock.runFor(100);
      const widget = statusPage.locator(`[data-widget-id="${id}"]`); await widget.waitFor();
      if (status === 'offline') {
        mode = 'error'; await statusPage.clock.runFor(30_000);
        for (let attempt = 0; !/offline/i.test(await widget.innerText()); attempt++) { assert.ok(attempt < 100, `${id}/${size} shows its offline state`); await statusPage.waitForTimeout(20); }
        mode = 'ready';
      } else assert.match(await widget.innerText(), /Saved/, `${id}/${size} shows its stale state`);
      return floorReport(widget);
    }
    const floorFailures = [], allowancesUsed = new Set(), allowedCases = []; let floorCases = 0, flooredCases = 0;
    /** Fit within half a percent of 1 is the fit search resolving a sub-pixel overflow, not a zoom-out. */
    const floorCheck = (id, size, density, viewport, status, report) => {
      floorCases++;
      if (!report.floored.length) return;
      flooredCases++;
      if (report.fit >= 0.995) return;
      const detail = `${id}/${size} ${density} ${viewport.width}×${viewport.height} ${status}: fit ${report.fit.toFixed(3)} with ${report.floored.slice(0, 3).join(', ')} (floors ${report.text.toFixed(2)}/${report.data.toFixed(2)} px)`;
      if (FLOOR_FIT_ALLOWANCES[`${id}/${size}`]) { allowancesUsed.add(`${id}/${size}`); allowedCases.push(detail); return; }
      floorFailures.push(detail);
    };
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const density of Object.keys(GRID_DENSITIES)) for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
        current = familyState(id, size, density);
        await open(); const widget = page.locator(`[data-widget-id="${id}"]`); await widget.waitFor();
        const bounds = await widget.evaluate(el => { const r = el.getBoundingClientRect(); const content = el.querySelector('.widget-content'); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, scale: new DOMMatrix(getComputedStyle(content).transform).a, border: getComputedStyle(el).borderWidth, background: getComputedStyle(el).backgroundColor, tone: [...el.classList].filter(name => name.startsWith('tone-')), accentMode: el.closest('.ambient')?.getAttribute('data-accent-mode') }; });
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= viewport.width + 1 && bounds.bottom <= viewport.height + 1, `${id}/${size}/${density} stays inside display`);
        assert.ok(bounds.scale >= 0.75, `${id}/${size}/${density} should fit by design, scale=${bounds.scale}`);
        assert.equal(bounds.border, '0px'); assert.equal(bounds.background, 'rgba(0, 0, 0, 0)');
        assert.deepEqual(bounds.tone, [`tone-${WIDGET_CATALOG[id].tone}`]); assert.equal(bounds.accentMode, current.settings.appearance.accentMode);
        const clipped = await widget.evaluate((el, selectors) => {
          const outer = el.getBoundingClientRect();
          return [...el.querySelectorAll(selectors)].filter(child => { const r = child.getBoundingClientRect(); return r.top < outer.top - 1 || r.bottom > outer.bottom + 1 || r.left < outer.left - 1 || r.right > outer.right + 1; }).map(child => child.className);
        }, clippingSelectors);
        assert.deepEqual(clipped, [], `${id}/${size}/${density} meaningful descendants stay visible`);
        if (viewport.width === 1920 && density === 'balanced') {
          if (id === 'clock') clockFonts[size] = await widget.locator('.clock-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
          if (capture) images.push({ name: `${id}-${size}`, bytes: await widget.screenshot() });
        }
        floorCheck(id, size, density, viewport, 'fresh', await floorReport(widget));
        await WIDGET_CHECKS[id].family?.({ page, widget, size, density, viewport, state: current });
        for (const status of STATUS_WIDGETS[id] ?? []) floorCheck(id, size, density, viewport, status, await statusReport(id, size, density, viewport, status));
      }
      // Checks beyond the families (tests/ui/widget-checks sweep hooks) run once per viewport.
      for (const check of Object.values(WIDGET_CHECKS)) if (check.sweep) {
        current = structuredClone(source);
        const summary = await check.sweep({ page, viewport, state: current, base, now });
        if (summary && !checks.includes(summary)) checks.push(summary);
      }
    }
    assert.ok(clockFonts.large > clockFonts.medium * 1.4, `Large clock should be visibly larger: ${JSON.stringify(clockFonts)}`);
    checks.push(`All ${familyCount} widget families × 3 densities × 1080p/4K: bounds, useful content, no frames/fills, tone classes, photo crops, whole-screen snapshot`);
    await statusPage.close();
    assert.deepEqual(floorFailures, [], '#221: a family with an element on a floor renders at fit 1 at Text 100% (a tracked exception needs its own ticket and an allowance)');
    assert.deepEqual(Object.entries(FLOOR_FIT_ALLOWANCES).filter(([key]) => !allowancesUsed.has(key)).map(([key, ticket]) => `${key} (${ticket})`), [], 'these families now render at fit 1 whenever an element sits on a floor: remove their allowances');
    checks.push(`#221 floors at Text 100%: ${floorCases} family × density × 1080p/4K × fresh/stale/offline cases; all ${flooredCases} with an element on a floor render at fit 1, except ${allowedCases.length} tracked cases: ${allowedCases.join('; ')}`);
    // Every #78 id has shipped (#157, #171), so the inactive ids are retired ones (Rain, #74) plus any
    // future planned entry; the catalog contract says neither is ever rendered.
    const inactiveIds = WIDGET_IDS.filter(id => !isActiveWidget(id));
    assert.ok(inactiveIds.length > 0, 'at least one inactive id to inject');
    for (const id of inactiveIds) {
      current = structuredClone(source); current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id || key === 'clock']));
      await open(); await page.locator('[data-widget-id="clock"]').waitFor();
      assert.equal(await page.locator(`[data-widget-id="${id}"]`).count(), 0, `inactive ${id} never renders even when injected as enabled`);
    }
    checks.push(`Inactive widget ids (${inactiveIds.join(', ')}) injected as enabled render nothing`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const size of ['small', 'medium', 'large']) {
      current = structuredClone(source); current.settings.appearance.fontScale = 1.25;
      current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'weather']));
      current.settings.widgetGrid.placements.weather = { column: 0, row: 0, size };
      current.weather.location.name = 'A deliberately long synthetic place name';
      current.weather.current = { ...current.weather.current, weatherCode: null, temperature: null, feelsLike: null, windSpeed: null };
      await open(); assert.match(await page.locator('.ambient-weather').innerText(), /Conditions unavailable/); assert.equal(await page.locator('.current-weather-main .weather-symbol').count(), 0);
      assert.ok(await page.locator('.ambient-weather .widget-content').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a) >= 0.65);
      if (capture) images.push({ name: `weather-unknown-long-${size}`, bytes: await page.locator('.ambient-weather').screenshot() });
      current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'reminders']));
      current.settings.widgetGrid.placements.reminders = { column: 0, row: 0, size };
      current.reminders[0].text = 'A deliberately long synthetic reminder that wraps across the available line length';
      await open(); const longReminderScale = await page.locator('.ambient-reminders .widget-content').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a); assert.ok(longReminderScale >= 0.65, `${size} long reminders retain their scale: ${longReminderScale}`);
    }
    // Rain timing lives in Weather (#74); see tests/ui/weather-browser.mjs for every mode.
    current = structuredClone(source); current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'weather'])); current.settings.widgetGrid.placements.weather = { column: 0, row: 0, size: 'large' };
    current.weather.hourly[10].precipitationProbability = null; current.weather.hourly[11].rainAmount = null;
    await open(); assert.equal(await page.locator('.rain-bar-unknown').count(), 1); assert.match(await page.locator('.ambient-weather').innerText(), /Partial data/);
    if (capture) images.push({ name: 'rain-partial', bytes: await page.locator('.ambient-weather').screenshot() });
    checks.push('Long city/reminder text at125% type, unavailable measurements/condition without an invented icon, partial rain and unknown probability bars');
    for (const style of ['outline', 'digital', 'analog']) {
      current = structuredClone(source); current.settings.appearance.clockStyle = style; current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'clock']));
      await open(); if (capture) images.push({ name: `clock-style-${style}`, bytes: await page.locator('[data-widget-id="clock"]').screenshot() });
    }
    current = structuredClone(source); current.settings.clockFormat = '24h'; current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'preview'])); await open(); assert.doesNotMatch(await page.locator('.preview-caption').innerText(), /AM|PM/);
    current = structuredClone(source); current.weather.units.precipitation = 'in'; current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'weather'])); current.settings.widgetGrid.placements.weather.size = 'medium'; current.weather.hourly.forEach(hour => { hour.rainAmount = 0.03; }); await open(); assert.match(await page.locator('.ambient-weather').innerText(), /in rain/);
    current = structuredClone(source); current.settings.appearance.motionEnabled = false; await page.setViewportSize({ width: 1920, height: 1080 }); await open();
    const inset = await page.locator('.widget-grid-plane').evaluate(el => el.getBoundingClientRect().left / innerWidth); assert.ok(Math.abs(inset - 0.04) < 0.002);
    if (capture) images.push({ name: 'default-composition', bytes: await page.screenshot() });
    current.weather.status = 'stale'; current.weather.updatedAt = new Date(now - 3 * 3600000).toISOString(); await open(); assert.match(await page.locator('.ambient-weather').innerText(), /Saved forecast/);
    current.weather = { ...current.weather, status: 'unavailable', current: null, daily: [], hourly: [], updatedAt: null }; current.reminders = []; current.preview.available = false; current.photo.available = false; await open();
    assert.equal(await page.locator('.ambient-reminders').count(), 0); assert.equal(await page.locator('.ambient-preview').count(), 0); assert.match(await page.locator('.ambient-weather').innerText(), /Weather unavailable/); assert.match(await page.locator('.ambient-forecast').innerText(), /Forecast unavailable/);
    if (capture) images.push({ name: 'unavailable-composition', bytes: await page.screenshot() });
    checks.push('Outline/digital/analog clock, reduced-motion surface, 4% inset, saved/unavailable weather and default hidden empty reminders/snapshot');
    current = structuredClone(source); current.settings.widgets.photo = true; imagesUnavailable = true; await open();
    await page.getByText('Photo unavailable', { exact: true }).waitFor(); await page.getByText('Snapshot unavailable', { exact: true }).waitFor();
    imagesUnavailable = false; current = structuredClone(source); current.preview.available = false; current.photo.available = false;
    current.settings.widgets.photo = true;
    await page.goto(base + '/editor'); await page.locator('.preview-surface').waitFor();
    assert.match(await page.locator('.ambient-photo').innerText(), /Choose a photo/); assert.match(await page.locator('.ambient-preview').innerText(), /Captured on activation/);
    assert.notEqual(await cursor(), 'none');
    checks.push('Honest failed image placeholders, editor-only empty photo/snapshot placeholders, normal editor cursor, no source image or capture needed');

    // #99/#249: the full board at rest on the real clock. The one-second tick re-renders every widget, but
    // no widget re-creates an observer, refits or writes its style, and nothing extends beyond its box.
    const fitMetrics = {};
    for (const [label, viewport, deviceScaleFactor, fontScale] of [['1280×720 ×3, Text 125%', { width: 1280, height: 720 }, 3, 1.25], ['3840×2160 ×1, Text 100%', { width: 3840, height: 2160 }, 1, 1], ['3840×2160 ×1, Text 125%', { width: 3840, height: 2160 }, 1, 1.25]]) {
      const restContext = await browser.newContext({ viewport, deviceScaleFactor, timezoneId: 'America/Toronto' });
      try {
        const state = structuredClone(source); state.settings.appearance.fontScale = fontScale;
        state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key in FULL_BOARD])); state.settings.preview.enabled = true; state.settings.widgetGrid.density = 'balanced';
        Object.assign(state.settings.widgetGrid.placements, structuredClone(FULL_BOARD));
        await restContext.addInitScript(instrumentFit);
        await restContext.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
        await restContext.route(/\/api\/(photo|preview)\/image\?/, route => route.fulfill({ contentType: 'image/png', body: image }));
        const restPage = await restContext.newPage(); restPage.on('pageerror', error => errors.push(error.message));
        await restPage.goto(base + '/display'); await restPage.locator('.ambient-widget').first().waitFor(); await restPage.waitForTimeout(2_000);
        // Keep the window inside one wall-clock minute: a new minute legitimately changes text.
        const second = Date.now() % 60_000 / 1000; if (second > 50) await restPage.waitForTimeout((61 - second) * 1000);
        const session = await restContext.newCDPSession(restPage); await session.send('Performance.enable');
        const sample = async () => ({
          counts: await restPage.evaluate(() => ({ ...window.__lrdFit })),
          layouts: (await session.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value,
          widgets: await restPage.locator('.ambient-widget').evaluateAll(elements => elements.map(section => {
            const body = section.querySelector('.widget-content'), style = getComputedStyle(section), fit = new DOMMatrix(getComputedStyle(body).transform).a;
            const width = section.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height = section.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            return { id: section.dataset.widgetId, fit, inside: body.scrollHeight * fit <= height + 1 && body.scrollWidth * fit <= width + 1 };
          })),
        });
        const start = await sample(); const started = performance.now();
        await restPage.waitForTimeout(5_000);
        const end = await sample(); const seconds = (performance.now() - started) / 1000;
        const result = fitMetrics[label] = { widgets: end.widgets.length, belowFit1: end.widgets.filter(widget => widget.fit < 1).map(widget => `${widget.id} ${widget.fit.toFixed(4)}`), resizeObservers: end.counts.resizeObservers - start.counts.resizeObservers, styleMutations: end.counts.styleMutations - start.counts.styleMutations, layoutsPerSecond: Number(((end.layouts - start.layouts) / seconds).toFixed(2)) };
        assert.equal(result.widgets, ACTIVE_WIDGET_IDS.length, `${label}: the full board shows every widget`);
        assert.equal(result.resizeObservers, 0, `${label}: no ResizeObserver is created while the clock ticks ${JSON.stringify(result)}`);
        assert.equal(result.styleMutations, 0, `${label}: no widget refits or writes its style while nothing changes ${JSON.stringify(result)}`);
        assert.ok(result.layoutsPerSecond <= 0.5, `${label}: about zero layouts per second ${JSON.stringify(result)}`);
        assert.deepEqual(end.widgets.map(widget => widget.fit), start.widgets.map(widget => widget.fit), `${label}: fit scales stay unchanged`);
        for (const widget of end.widgets) assert.ok(widget.inside, `${label}: ${widget.id} stays inside its box at fit ${widget.fit}`);
      } finally { await restContext.close(); }
    }
    checks.push(`#99/#249 full board at rest over 5 s of real ticks: no ResizeObserver created, no fit style writes, fit scales unchanged, every widget inside its box: ${JSON.stringify(fitMetrics)}`);

    // #99: Intl formatter constructions per one-second tick with the minute unchanged, each widget alone at
    // its largest family (Clock medium), then the full board.
    const intlContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'America/Toronto' });
    const intlPerTick = {};
    try {
      let state;
      await intlContext.addInitScript(instrumentFit);
      await intlContext.route('**/api/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
      await intlContext.route(/\/api\/(photo|preview)\/image\?/, route => route.fulfill({ contentType: 'image/png', body: image }));
      const intlPage = await intlContext.newPage(); intlPage.on('pageerror', error => errors.push(error.message));
      await intlPage.clock.install({ time: new Date(now + 5_000) });
      const perTick = async () => {
        await intlPage.clock.setSystemTime(new Date(now + 5_000));
        await intlPage.goto(base + '/display'); await intlPage.locator('.ambient-widget').first().waitFor(); await intlPage.clock.runFor(200); await intlPage.waitForTimeout(50);
        const before = await intlPage.evaluate(() => window.__lrdFit.intl);
        for (let tick = 0; tick < 3; tick++) { await intlPage.clock.runFor(1_000); await intlPage.waitForTimeout(40); }
        return ((await intlPage.evaluate(() => window.__lrdFit.intl)) - before) / 3;
      };
      for (const id of ACTIVE_WIDGET_IDS) {
        state = structuredClone(source); state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id])); state.settings.preview.enabled = true;
        state.settings.widgetGrid.placements[id] = { column: 0, row: 0, size: id === 'clock' ? 'medium' : widgetSizes(id).at(-1) };
        intlPerTick[id] = await perTick();
        if (INTL_TICK_ALLOWANCES[id]) assert.ok(intlPerTick[id] > 0, `${id} constructs no Intl formatter per tick any more: remove its ${INTL_TICK_ALLOWANCES[id]} allowance`);
        else assert.equal(intlPerTick[id], 0, `${id} constructs ${intlPerTick[id]} Intl formatters per tick within one minute`);
      }
      state = structuredClone(source); state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key in FULL_BOARD])); state.settings.preview.enabled = true;
      Object.assign(state.settings.widgetGrid.placements, structuredClone(FULL_BOARD));
      intlPerTick.fullBoard = await perTick();
      if (!Object.keys(INTL_TICK_ALLOWANCES).length) assert.equal(intlPerTick.fullBoard, 0, 'the full board constructs no Intl formatter per tick within one minute');
    } finally { await intlContext.close(); }
    checks.push(`#99 Intl constructions per tick within one minute: ${JSON.stringify(intlPerTick)}; still allowed: ${Object.entries(INTL_TICK_ALLOWANCES).map(([id, ticket]) => `${id} (${ticket})`).join(', ')}`);
    assert.deepEqual(errors, []); return { checks, images, clockFonts, fitMetrics, intlPerTick };
  } finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runWidgetQa(values); console.log(JSON.stringify({ checks: result.checks, clockFonts: result.clockFonts, fitMetrics: result.fitMetrics, intlPerTick: result.intlPerTick }, null, 2));
}
