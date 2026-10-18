// Native colours (#75) in production Edge: own ephemeral loopback server and data, synthetic
// state only. Screenshots stay RAM buffers unless --capture names a temporary directory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture, photoFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_IDS } from '../../src/shared/widgets.ts';
import { NATIVE_PALETTE, STATUS_TONES } from '../../src/shared/palette.ts';

const rgb = (hex) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
const SAND = '#b8a17a';
/** The first accent-coloured element of a widget: its label, else a caption or context line. */
const ACCENT_SELECTOR = '.ambient-label, .preview-caption, .weather-context, .metric-label';

export async function runPaletteQa({ playwright, edge, capture } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-palette-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], images = [], errors = [];
  const keep = async (name, bytes) => { images.push({ name, bytes }); if (capture) await writeFile(join(capture, `${name}.png`), bytes); };
  try {
    // ---- Ambient display: injected synthetic state, one widget at a time and the default composition.
    const fresh = await (await fetch(`${base}/api/state`)).json();
    assert.equal(fresh.settings.appearance.accentMode, 'native', 'a fresh data folder starts with native colours');
    const source = structuredClone(fresh);
    const at = new Date(now - 20 * 60000).toISOString();
    source.reminders = [{ id: 'synthetic-1', text: 'Synthetic reminder', completed: false, dueAt: null, createdAt: at, updatedAt: at }];
    source.preview = { available: true, capturedAt: at, width: 320, height: 200 };
    source.photo = { available: true, id: 'synthetic-photo', width: 320, height: 200, updatedAt: at };
    const image = photoFixture(320, 200, Buffer.alloc((320 * 4 + 1) * 200, 90));
    let current = structuredClone(source), stateStatus = 200, photoMissing = false;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    await context.route('**/api/state', (route) => route.fulfill(stateStatus === 200 ? { contentType: 'application/json', body: JSON.stringify(current) } : { status: stateStatus, contentType: 'application/json', body: '{"error":"Synthetic outage"}' }));
    await context.route('**/api/photo/image?*', (route) => route.fulfill(photoMissing ? { status: 404, body: 'Synthetic missing image' } : { contentType: 'image/png', body: image }));
    await context.route('**/api/preview/image?*', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date(now) });
    const open = async () => { await page.goto(base + '/display'); await page.locator('.display-page').waitFor(); await page.clock.runFor(200); };
    const state = ({ mode, only, brightness }) => {
      const next = structuredClone(source);
      Object.assign(next.settings.appearance, { accentMode: mode, accentColor: SAND, motionEnabled: false }, brightness ? { brightness } : {});
      if (only) {
        next.settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key === only]));
        next.settings.widgetGrid.placements[only] = { column: 0, row: 0, size: WIDGET_CATALOG[only].defaultSize };
      }
      return next;
    };
    const expected = (mode, role) => rgb(mode === 'native' ? NATIVE_PALETTE[role].hex : SAND);
    const colorOf = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
    const sections = () => page.locator('.ambient-widget').evaluateAll((els, selector) => els.map((el) => {
      const accent = el.querySelector(selector), style = getComputedStyle(el);
      return { id: el.dataset.widgetId, accent: accent ? getComputedStyle(accent).color : null, background: style.backgroundColor, border: style.borderTopWidth, outline: style.outlineStyle, shadow: style.boxShadow };
    }), ACCENT_SELECTOR);
    const plane = () => page.locator('.ambient-content').evaluate((el) => getComputedStyle(el).filter);

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      const filters = {};
      for (const mode of ['native', 'color']) {
        for (const id of ACTIVE_WIDGET_IDS) {
          current = state({ mode, only: id }); photoMissing = id === 'photo';
          await open(); await page.locator(`[data-widget-id="${id}"]`).waitFor();
          const [section] = await sections();
          assert.ok(section?.accent, `${id} has an accent element (${ACCENT_SELECTOR}); extend ACCENT_SELECTOR for a new widget`);
          assert.equal(section.accent, expected(mode, WIDGET_CATALOG[id].tone), `${mode} ${id} accent at ${viewport.width}px`);
          assert.equal(section.background, 'rgba(0, 0, 0, 0)'); assert.equal(section.border, '0px'); assert.equal(section.outline, 'none'); assert.equal(section.shadow, 'none');
        }
        current = state({ mode }); photoMissing = false; current.settings.widgets.photo = false;
        await open();
        filters[mode] = await plane();
        for (const section of await sections()) {
          assert.equal(section.accent, expected(mode, WIDGET_CATALOG[section.id].tone), `${mode} composition ${section.id}`);
          assert.equal(section.background, 'rgba(0, 0, 0, 0)'); assert.equal(section.border, '0px');
        }
        assert.equal(await colorOf('.forecast-rain'), expected(mode, 'water'), `${mode} forecast rain chance`);
        // Primary content keeps the text colour in both modes.
        for (const selector of ['.clock-time', '.current-temperature', '.weather-condition', '.ambient-reminder-title', '.forecast-temperatures']) assert.equal(await colorOf(selector), rgb(current.settings.appearance.textColor), `${mode} ${selector} keeps the text colour`);
        assert.equal(await page.locator('.ambient-photo-image').count(), 0);
      }
      assert.equal(filters.native, filters.color, 'the brightness filter is identical in both modes');
      assert.equal(filters.native, `brightness(${source.settings.appearance.brightness})`);
    }
    checks.push(`Native and color modes at 1080p/4K: each of ${ACTIVE_WIDGET_IDS.length} active widgets and the default composition tint the same accent elements with the role tone or the accent; Forecast rain is Sea glass; primary text, transparent unframed sections and the brightness filter are unchanged`);

    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const mode of ['native', 'color']) {
      current = state({ mode, only: 'photo' }); await open(); await page.locator('.ambient-photo-image').waitFor();
      const photo = await page.locator('.ambient-photo-image').evaluate((el) => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity }));
      assert.deepEqual(photo, { filter: 'saturate(0.3) brightness(0.45)', opacity: '0.45' }, `${mode} photo is never tinted`);
    }
    const glyphs = [[0, true, 'sun', 'sun'], [0, false, 'moon', 'time'], [3, true, 'cloud', 'stone'], [63, true, 'rain', 'water'], [73, true, 'snow', 'sky'], [95, true, 'storm', 'water']];
    for (const mode of ['native', 'color']) {
      for (const [code, isDay, glyph, role] of glyphs) {
        current = state({ mode, only: 'weather' }); current.weather.current = { ...current.weather.current, weatherCode: code, isDay };
        await open();
        assert.equal(await page.locator('.weather-symbol').getAttribute('data-glyph'), glyph);
        assert.equal(await colorOf('.weather-symbol'), expected(mode, role), `${mode} weather code ${code} ${isDay ? 'day' : 'night'} glyph`);
        // The label stays Mist (sky) while the glyph takes its own tone.
        assert.equal(await colorOf('.ambient-weather .ambient-label'), expected(mode, 'sky'));
      }
      current = state({ mode, only: 'forecast' }); current.weather.daily = current.weather.daily.map((day, index) => ({ ...day, weatherCode: [0, 3, 63, 73, 95, 0, 3][index] }));
      await open();
      const forecast = await page.locator('.forecast-day [data-glyph]').evaluateAll((els) => els.map((el) => [el.dataset.glyph, getComputedStyle(el).color]));
      assert.ok(forecast.length >= 5);
      for (const [glyph, color] of forecast) assert.equal(color, expected(mode, { sun: 'sun', cloud: 'stone', rain: 'water', snow: 'sky', storm: 'water' }[glyph]), `${mode} forecast ${glyph}`);
      current = state({ mode, only: 'weather' }); current.weather.status = 'stale'; current.weather.updatedAt = new Date(now - 3 * 3600000).toISOString();
      await open();
      assert.match(await page.locator('.weather-age').innerText(), /Saved forecast/);
      assert.equal(await colorOf('.weather-age.stale'), rgb(STATUS_TONES.caution), `${mode} stale age stays amber`);
      current = state({ mode, only: 'weather' }); await open();
      stateStatus = 503; await page.clock.runFor(30001); await page.locator('.weather-age').filter({ hasText: 'Offline' }).waitFor(); stateStatus = 200;
      assert.equal(await colorOf('.weather-age.stale'), rgb(STATUS_TONES.caution), `${mode} offline age keeps the status tone`);
    }
    checks.push('Weather glyphs by code (clear day Gold, clear night Lilac, cloud Stone, rain/storm Sea glass, snow Mist) in Weather and Forecast; stale and offline ages stay amber; photos are never tinted; color mode keeps the single accent everywhere');

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const [preset, brightness] of [['room', 0.55], ['night', 0.28]]) for (const mode of ['native', 'color']) {
        current = state({ mode, brightness }); current.settings.widgets.photo = false; await open();
        await keep(`composition-${mode}-${preset}-${viewport.width}`, await page.screenshot());
      }
    }
    checks.push('Native and color compositions captured in RAM at 1080p/4K at Room and Night brightness for visual inspection');
    await context.close();

    // ---- Editor: real server and data, so Save, reload, polling and saved styles are exercised end to end.
    async function reset() {
      await app.store.update((data) => { data.settings = defaultSettings(); data.settings.appearance.accentMode = 'color'; data.reminders = []; });
    }
    async function editor(viewport = { width: 1280, height: 720 }) {
      const studio = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
      const editorPage = await studio.newPage();
      editorPage.on('pageerror', (error) => errors.push(error.message));
      await editorPage.clock.install({ time: new Date(now) });
      await editorPage.goto(base + '/editor'); await editorPage.locator('.clock-time').first().waitFor();
      await editorPage.getByRole('tab', { name: 'Style', exact: true }).click(); await editorPage.locator('.swatches').waitFor();
      return { studio, page: editorPage };
    }
    const swatch = (p, name) => p.getByRole('button', { name, exact: true });
    const pressed = async (p, name) => (await swatch(p, name).getAttribute('aria-pressed')) === 'true';
    const heading = (p) => p.locator('.accent-current').innerText();
    const saveBar = (p) => p.locator('.studio-savebar');
    const save = async (p) => { await p.getByRole('button', { name: 'Save changes', exact: true }).click(); await saveBar(p).waitFor({ state: 'detached' }); };
    const cancel = async (p) => { await p.getByRole('button', { name: 'Cancel', exact: true }).click(); await saveBar(p).waitFor({ state: 'detached' }); };
    const canvasMode = (p) => p.locator('.preview-surface .ambient').getAttribute('data-accent-mode');
    const appearance = () => app.store.snapshot().settings.appearance;

    await reset();
    let { studio, page: p } = await editor();
    const nativeSwatch = swatch(p, 'Native colours');
    assert.equal(await nativeSwatch.getAttribute('title'), 'Each widget uses its own colour');
    assert.equal(await pressed(p, 'Native colours'), false); assert.equal(await pressed(p, 'Mist'), true); assert.equal(await heading(p), 'Mist');
    assert.equal(await saveBar(p).count(), 0);
    await nativeSwatch.click();
    assert.equal(await pressed(p, 'Native colours'), true); assert.equal(await pressed(p, 'Mist'), false); assert.equal(await heading(p), 'Native');
    await saveBar(p).waitFor(); assert.equal(await canvasMode(p), 'native');
    assert.equal(await p.locator('.preview-surface .ambient-clock .ambient-label').evaluate((el) => getComputedStyle(el).color), rgb(NATIVE_PALETTE.time.hex), 'the live canvas shows the draft mode');
    // Reverting to the saved colour hides the bar again.
    await swatch(p, 'Mist').click(); await saveBar(p).waitFor({ state: 'detached' });
    await nativeSwatch.click(); await save(p);
    assert.equal(appearance().accentMode, 'native'); assert.equal(appearance().accentColor, '#8aa8c2');
    await p.reload(); await p.getByRole('tab', { name: 'Style', exact: true }).click();
    assert.equal(await pressed(p, 'Native colours'), true); assert.equal(await heading(p), 'Native');
    checks.push('Native swatch: accessible name/title, aria-pressed and heading, effective-only Save bar, live canvas, Save persists and reload shows Native');

    await swatch(p, 'Mist').click(); await saveBar(p).waitFor(); assert.equal(await heading(p), 'Mist');
    await cancel(p); assert.equal(await pressed(p, 'Native colours'), true); assert.equal(await heading(p), 'Native'); assert.equal(await canvasMode(p), 'native');
    await swatch(p, 'Sand').click();
    assert.equal(await pressed(p, 'Sand'), true); assert.equal(await pressed(p, 'Native colours'), false); assert.equal(await heading(p), 'Sand'); assert.equal(await canvasMode(p), 'color');
    await save(p); assert.equal(appearance().accentMode, 'color'); assert.equal(appearance().accentColor, SAND);
    await nativeSwatch.click(); await save(p);
    await p.locator('input[aria-label="Custom accent color"]').fill('#123456');
    assert.equal(await heading(p), 'Custom'); assert.equal(await pressed(p, 'Native colours'), false); assert.equal(await canvasMode(p), 'color');
    await save(p); assert.equal(appearance().accentMode, 'color'); assert.equal(appearance().accentColor, '#123456');
    checks.push('Cancel restores Native; a swatch after Native selects color with that swatch; the custom colour input switches to color');

    for (const preset of ['Phone', 'Room', 'Night']) {
      await p.getByRole('button', { name: preset, exact: true }).click();
      assert.equal(await pressed(p, 'Native colours'), true, `${preset} applies Native`); assert.equal(await canvasMode(p), 'native');
      const bars = await p.locator(`.miniature-${preset.toLowerCase()} i`).evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      assert.deepEqual(bars, [NATIVE_PALETTE.time.hex, NATIVE_PALETTE.sky.hex, NATIVE_PALETTE.personal.hex].map(rgb), `${preset} miniature bars`);
    }
    await save(p);
    assert.deepEqual({ preset: appearance().preset, accentMode: appearance().accentMode, brightness: appearance().brightness, accentColor: appearance().accentColor }, { preset: 'night', accentMode: 'native', brightness: 0.28, accentColor: '#9990b7' });
    checks.push('Phone, Room and Night apply Native with their own brightness and accent colour; miniatures show Lilac, Mist and Rose bars');

    await p.getByText('Saved styles', { exact: true }).click();
    await p.getByPlaceholder('Evening').fill('Synthetic native');
    await p.getByRole('button', { name: 'Add style', exact: true }).click(); await save(p);
    assert.equal(app.store.snapshot().settings.savedPresets[0].visual.appearance.accentMode, 'native');
    await swatch(p, 'Sage').click(); await save(p); assert.equal(appearance().accentMode, 'color');
    await p.locator('.disclosure select').filter({ has: p.locator('option', { hasText: 'Synthetic native' }) }).selectOption({ label: 'Synthetic native' });
    assert.equal(await pressed(p, 'Native colours'), true); await save(p);
    assert.equal(appearance().accentMode, 'native');
    checks.push('A saved style stores and restores Native');

    await swatch(p, 'Lilac').click(); await save(p);
    await nativeSwatch.click(); await saveBar(p).waitFor();
    await app.store.patchSettings({ appearance: { brightness: 0.4 } });
    await p.clock.runFor(30001);
    await p.waitForFunction(() => document.querySelector('input[aria-label="Brightness"]')?.value === '40');
    assert.equal(await pressed(p, 'Native colours'), true, 'polling keeps the local Native choice');
    await save(p);
    assert.equal(appearance().accentMode, 'native'); assert.equal(appearance().brightness, 0.4);
    checks.push('A polling rebase keeps a local Native choice while the saved brightness changes');
    // Default contents: a fresh editor with every disclosure closed.
    await studio.close(); ({ studio, page: p } = await editor());

    const fits = () => p.evaluate(() => {
      const panel = document.querySelector('.inspector-panel'), panelBox = panel.getBoundingClientRect(), group = document.querySelector('.swatches').closest('.inspector-group').getBoundingClientRect();
      return { overflow: panel.scrollHeight - panel.clientHeight, scrolled: panel.scrollTop, accentInside: group.top >= panelBox.top && group.bottom <= panelBox.bottom, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    const atDesktop = await fits();
    assert.ok(atDesktop.overflow <= 1 && atDesktop.accentInside && atDesktop.pageOverflow <= 0, `Style tab fits at 1280x720: ${JSON.stringify(atDesktop)}`);
    await keep('style-tab-1280x720-native', await p.screenshot());
    await p.setViewportSize({ width: 1280, height: 600 });
    const atShort = await fits();
    assert.ok(atShort.scrolled === 0 && atShort.accentInside && atShort.pageOverflow <= 0, `Accent row visible without scrolling at 1280x600: ${JSON.stringify(atShort)}`);
    await studio.close();
    checks.push('Style tab fits without scrolling at 1280x720; at 1280x600 presets through the Accent row are visible without scrolling');

    for (const width of [390, 320]) {
      ({ studio, page: p } = await editor({ width, height: 844 }));
      const row = await p.locator('.swatches').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { overflow: el.scrollWidth - el.clientWidth, outside: [...el.children].filter((child) => { const r = child.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).length, rows: new Set([...el.children].map((child) => Math.round(child.getBoundingClientRect().top))).size, pageOverflow: document.documentElement.scrollWidth - innerWidth, smallest: Math.min(...[...el.children].map((child) => child.getBoundingClientRect().width)) };
      });
      assert.ok(row.overflow <= 0 && row.outside === 0 && row.pageOverflow <= 0 && row.smallest >= 36, `${width}px swatch row: ${JSON.stringify(row)}`);
      if (width === 320) assert.ok(row.rows >= 2, `320px swatch row wraps: ${JSON.stringify(row)}`);
      await keep(`style-tab-${width}`, await p.locator('.inspector-group').filter({ has: p.locator('.swatches') }).screenshot());
      await studio.close();
    }
    checks.push('The swatch row stays inside the panel without horizontal overflow at 390px and wraps at 320px');

    ({ studio, page: p } = await editor({ width: 1280, height: 720 }));
    await p.getByRole('button', { name: 'Add widget to display' }).click();
    for (const mode of ['native', 'color']) {
      if (mode === 'color') { await p.getByRole('button', { name: 'Close widget picker' }).click(); await p.getByRole('tab', { name: 'Style', exact: true }).click(); await swatch(p, 'Sand').click(); await p.getByRole('button', { name: 'Add widget to display' }).click(); }
      for (const id of ACTIVE_WIDGET_IDS) {
        await p.getByRole('button', { name: `Preview ${WIDGET_CATALOG[id].name}`, exact: true }).click();
        const sample = p.locator('.picker-sample');
        assert.equal(await sample.getAttribute('data-accent-mode'), mode);
        const accent = await sample.evaluate((el, selector) => { const target = el.querySelector(selector); return target ? getComputedStyle(target).color : null; }, ACCENT_SELECTOR);
        if (accent) assert.equal(accent, expected(mode, WIDGET_CATALOG[id].tone), `${mode} picker sample ${id}`);
        else assert.ok(id === 'photo', `${id} sample has an accent element`);
      }
    }
    await studio.close();
    checks.push('Picker samples follow the draft mode: role tones in native, the chosen accent in color');
    assert.deepEqual(errors, []);
    return { checks, images };
  } finally {
    await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, sharp: { type: 'string' }, capture: { type: 'string' } } });
  const result = await runPaletteQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, images: values.capture ? `written to ${values.capture}` : 'RAM buffers only; visual inspection is a separate check.' }, null, 2));
}
