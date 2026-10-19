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
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, isPlannedWidget, widgetSizes } from '../../src/shared/widgets.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';

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
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const density of Object.keys(GRID_DENSITIES)) for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
        current = structuredClone(source); current.settings.appearance.motionEnabled = false;
        current.settings.widgetGrid.density = density; current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id]));
        current.settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
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
        await WIDGET_CHECKS[id].family?.({ page, widget, size, density, viewport, state: current });
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
    for (const id of WIDGET_IDS.filter(isPlannedWidget)) {
      current = structuredClone(source); current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id || key === 'clock']));
      await open(); await page.locator('[data-widget-id="clock"]').waitFor();
      assert.equal(await page.locator(`[data-widget-id="${id}"]`).count(), 0, `planned ${id} never renders even when injected as enabled`);
    }
    checks.push('Planned widget ids injected as enabled render nothing');
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
    assert.deepEqual(errors, []); return { checks, images, clockFonts };
  } finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runWidgetQa(values); console.log(JSON.stringify({ checks: result.checks, clockFonts: result.clockFonts }, null, 2));
}
