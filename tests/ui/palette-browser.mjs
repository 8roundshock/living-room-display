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
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_IDS, widgetSizes } from '../../src/shared/widgets.ts';
import { NATIVE_PALETTE, STATUS_TONES, WEATHER_GLYPH_TONE } from '../../src/shared/palette.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';
import { MODES } from './weather-browser.mjs';

const rgb = (hex) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
const SAND = '#b8a17a';
/** The first accent-coloured element of a widget: its label, else a caption, context line or unit. */
const ACCENT_SELECTOR = '.ambient-label, .preview-caption, .weather-context, .metric-label, .countdown-unit';
/** Widgets whose display face is primary content only (Note's text), so nothing in them is tinted; their section still resolves the tone. */
const TEXT_ONLY = new Set(['note']);
/** Every active widget on one Balanced 12 x 8 board, every cell used; a newly activated widget must be added here. */
const FULL_BOARD = {
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
  reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
  note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
};
const PALETTE_RGB = new Set(Object.values(NATIVE_PALETTE).map((tone) => rgb(tone.hex)));

/** Each widget section under `root`: its id, resolved --ambient-accent, first accent element colour and box styling. */
function sections(root) {
  return root.locator('.ambient-widget').evaluateAll((els, selector) => els.map((el) => {
    const accent = el.querySelector(selector), style = getComputedStyle(el);
    const probe = document.createElement('i'); document.body.append(probe); probe.style.color = style.getPropertyValue('--ambient-accent').trim();
    const tone = getComputedStyle(probe).color; probe.remove();
    const id = el.dataset.widgetId ?? [...el.classList].find((name) => name.startsWith('ambient-') && name !== 'ambient-widget')?.slice('ambient-'.length);
    return { id, tone, accent: accent ? getComputedStyle(accent).color : null, background: style.backgroundColor, border: style.borderTopWidth, outline: style.outlineStyle, shadow: style.boxShadow };
  }), ACCENT_SELECTOR);
}

/**
 * Every colour a widget paints on screen: text, backgrounds, SVG fill and stroke, visible borders and
 * text strokes. Each must be the element's own resolved accent (--ambient-accent, or #74's
 * --weather-rain), the text colour, a status tone or black, so no widget hard-codes a hue (for
 * example AQI category colours) and Native redirects only the accent group. Images are skipped.
 * Returns the offending paints and the distinct accents in use.
 */
function paints(locator) {
  return locator.evaluate((section, status) => {
    const probe = document.createElement('i'); document.body.append(probe);
    const resolve = (value) => { probe.style.color = ''; probe.style.color = value; return getComputedStyle(probe).color; };
    const channels = (color) => { const parts = color.match(/[\d.]+/g); return parts && parts.length >= 3 ? { rgb: parts.slice(0, 3).map(Number).join(','), alpha: parts.length > 3 ? Number(parts[3]) : 1 } : null; };
    const fixed = [...status, '#000000'].map((value) => channels(resolve(value)).rgb);
    const bad = [], accents = new Set();
    for (const el of [section, ...section.querySelectorAll('*')]) {
      if (el.closest('img, image, defs, filter, mask, clipPath') || !el.checkVisibility({ visibilityProperty: true })) continue;
      const style = getComputedStyle(el);
      const accent = style.getPropertyValue('--ambient-accent').trim(), rain = style.getPropertyValue('--weather-rain').trim();
      const own = [accent, rain].filter(Boolean).map(resolve);
      for (const value of own) accents.add(value);
      const allowed = new Set([...own, resolve(style.getPropertyValue('--ambient-text').trim())].map((value) => channels(value).rgb).concat(fixed));
      const painted = [['color', style.color], ['background', style.backgroundColor]];
      if (el instanceof SVGElement) painted.push(['fill', style.fill], ['stroke', style.stroke]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (style[`border${side}Style`] !== 'none' && parseFloat(style[`border${side}Width`]) > 0) painted.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
      if (parseFloat(style.webkitTextStrokeWidth) > 0) painted.push(['text-stroke', style.webkitTextStrokeColor]);
      for (const [property, value] of painted) {
        const parsed = channels(value);
        if (!parsed || parsed.alpha === 0 || allowed.has(parsed.rgb)) continue;
        bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${property} ${value}`);
      }
    }
    probe.remove();
    return { bad: [...new Set(bad)], accents: [...accents].sort() };
  }, Object.values(STATUS_TONES));
}

/** One widget section: its resolved tone, its accent element (or that it is text-only), and no stray colour. */
async function assertWidgetSection(section, mode, label, locator, expected) {
  const role = WIDGET_CATALOG[section.id].tone;
  assert.equal(section.tone, expected(mode, role), `${label}: ${section.id} resolves its accent to ${mode === 'native' ? role : 'the accent'}`);
  if (TEXT_ONLY.has(section.id)) assert.equal(section.accent, null, `${label}: ${section.id} is listed as text-only but has an accent element`);
  else if (section.accent !== null || section.id !== 'photo') {
    assert.ok(section.accent, `${label}: ${section.id} has an accent element (${ACCENT_SELECTOR}); extend ACCENT_SELECTOR or TEXT_ONLY for a new widget`);
    assert.equal(section.accent, expected(mode, role), `${label}: ${section.id} accent element`);
  }
  const audit = await paints(locator);
  assert.deepEqual(audit.bad, [], `${label}: ${section.id} paints only its accent, the text colour or a status tone`);
  if (mode === 'color') assert.deepEqual(audit.accents, [rgb(SAND)], `${label}: color mode keeps one accent everywhere in ${section.id}`);
  else for (const accent of audit.accents) assert.ok(PALETTE_RGB.has(accent), `${label}: ${section.id} accent ${accent} is a palette tone`);
}

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
    // ---- Ambient display: injected synthetic state, each widget in every family, the default composition and a full board.
    const fresh = await (await fetch(`${base}/api/state`)).json();
    assert.equal(fresh.settings.appearance.accentMode, 'native', 'a fresh data folder starts with native colours');
    const source = structuredClone(fresh);
    // Every active widget gets its synthetic content (cities, countdowns, a note, an air reading, reminders)
    // from its tests/ui/widget-checks module, so a widget with no module fails here, loudly.
    for (const id of ACTIVE_WIDGET_IDS) assert.ok(WIDGET_CHECKS[id], `${id} needs a tests/ui/widget-checks module`);
    for (const check of Object.values(WIDGET_CHECKS)) check.prepare?.(source, { now });
    assert.deepEqual(Object.keys(FULL_BOARD).sort(), [...ACTIVE_WIDGET_IDS].sort(), 'FULL_BOARD places every active widget; add a new one there');
    const at = new Date(now - 20 * 60000).toISOString();
    source.reminders[0].dueAt = new Date(now - 26 * 3600000).toISOString(); // one overdue row: "Overdue" keeps the status tone
    // Countdown's "Today" and "Tomorrow" are words with no unit, so the sweep counts days (the word case is checked below).
    const countdowns = source.settings.widgetData.countdowns;
    source.settings.widgetData.countdowns = countdowns.filter((event) => !['2026-10-18', '2026-10-19'].includes(event.date));
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
    const state = ({ mode, only, size, brightness, board }) => {
      const next = structuredClone(source);
      Object.assign(next.settings.appearance, { accentMode: mode, accentColor: SAND, motionEnabled: false }, brightness ? { brightness } : {});
      if (only) {
        next.settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key === only]));
        next.settings.widgetGrid.placements[only] = { column: 0, row: 0, size: size ?? WIDGET_CATALOG[only].defaultSize };
      }
      if (board) {
        next.settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key in FULL_BOARD]));
        next.settings.preview.enabled = true; next.settings.widgetGrid.density = 'balanced';
        Object.assign(next.settings.widgetGrid.placements, structuredClone(FULL_BOARD));
      }
      return next;
    };
    const expected = (mode, role) => rgb(mode === 'native' ? NATIVE_PALETTE[role].hex : SAND);
    const colorOf = (selector, property = 'color') => page.locator(selector).first().evaluate((el, name) => getComputedStyle(el)[name], property);
    const plane = () => page.locator('.ambient-content').evaluate((el) => getComputedStyle(el).filter);
    const assertSection = (section, mode, label, locator) => assertWidgetSection(section, mode, label, locator, expected);

    let families = 0;
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      const filters = {};
      for (const mode of ['native', 'color']) {
        for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
          current = state({ mode, only: id, size }); photoMissing = id === 'photo';
          await open(); await page.locator(`[data-widget-id="${id}"]`).waitFor();
          const [section] = await sections(page);
          await assertSection(section, mode, `${mode} ${id} ${size} at ${viewport.width}px`, page.locator(`[data-widget-id="${id}"]`));
          assert.equal(section.background, 'rgba(0, 0, 0, 0)'); assert.equal(section.border, '0px'); assert.equal(section.outline, 'none'); assert.equal(section.shadow, 'none');
          families++;
        }
        current = state({ mode }); photoMissing = false; current.settings.widgets.photo = false;
        await open();
        filters[mode] = await plane();
        for (const section of await sections(page)) {
          await assertSection(section, mode, `${mode} composition at ${viewport.width}px`, page.locator(`[data-widget-id="${section.id}"]`));
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
    checks.push(`Native and color modes at 1080p/4K: all ${ACTIVE_WIDGET_IDS.length} active widgets in all ${families / 4} families and the default composition resolve the role tone or the accent, tint their accent element (Note is text-only), paint nothing but that accent, the text colour or a status tone, and stay transparent and unframed; Forecast rain is Sea glass; the brightness filter is unchanged`);

    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const mode of ['native', 'color']) {
        current = state({ mode, board: true }); photoMissing = false;
        await open();
        const all = await sections(page);
        assert.deepEqual(all.map((section) => section.id).sort(), [...ACTIVE_WIDGET_IDS].sort(), `${mode} full board at ${viewport.width}px renders every active widget`);
        for (const section of all) await assertSection(section, mode, `${mode} full board at ${viewport.width}px`, page.locator(`[data-widget-id="${section.id}"]`));
        await keep(`full-board-${mode}-${viewport.width}`, await page.screenshot());
      }
    }
    checks.push(`A full Balanced board with all ${ACTIVE_WIDGET_IDS.length} active widgets at 1280x720, 1080p and 4K in both modes: every section's tone, accent element and paints as above; captured in RAM for visual inspection`);

    // Sub-tones inside the merged renderers (#73, #74, #78), in both modes: colour mode keeps the one accent.
    await page.setViewportSize({ width: 1920, height: 1080 });
    const weatherWith = (mode, size, outlook) => { const next = state({ mode, only: 'weather', size }); next.weather.hourly = structuredClone(MODES[outlook].hourly); return next; };
    const text = rgb(source.settings.appearance.textColor);
    for (const mode of ['native', 'color']) {
      // Adaptive Weather (#74): the --weather-rain hook is Sea glass; timing stays primary text; the label stays Mist.
      current = weatherWith(mode, 'large', 'now-open'); await open();
      assert.equal(await page.locator('.weather-body').getAttribute('data-weather-mode'), 'elevated');
      assert.equal((await page.locator('.ambient-weather').evaluate((el) => getComputedStyle(el).getPropertyValue('--weather-rain'))).trim().toLowerCase(), mode === 'native' ? NATIVE_PALETTE.water.hex : SAND, `${mode} --weather-rain`);
      const bars = await page.locator('.rain-bar').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      assert.ok(bars.length >= 12, `${bars.length} hourly bars`); for (const bar of bars) assert.equal(bar, expected(mode, 'water'), `${mode} rain bar`);
      assert.equal(await colorOf('.rain-detail'), expected(mode, 'water'), `${mode} rain detail`);
      assert.equal(await colorOf('.rain-hours'), expected(mode, 'water'), `${mode} rain hours`);
      assert.equal(await colorOf('.rain-timing'), text, `${mode} rain timing is primary text`);
      assert.equal(await colorOf('.rain-confidence'), expected(mode, 'sky'), `${mode} confidence`);
      assert.equal(await colorOf('.ambient-weather .ambient-label'), expected(mode, 'sky'));
      current = weatherWith(mode, 'large', 'now-open'); current.weather.hourly[5].precipitationProbability = null; await open();
      assert.ok(await page.locator('.rain-bar-unknown').count() > 0, 'an hour without a chance draws an unknown bar');
      assert.equal(await colorOf('.rain-bar-unknown', 'borderBottomColor'), expected(mode, 'water'), `${mode} unknown rain hour`);
      for (const size of ['small', 'medium', 'large']) {
        current = weatherWith(mode, size, 'later'); await open();
        assert.equal(await page.locator('.weather-body').getAttribute('data-weather-mode'), 'hint');
        assert.equal(await colorOf('.weather-hint'), expected(mode, 'water'), `${mode} ${size} rain hint`);
      }
      // Sun & moon (#78): Gold label, arc and sun dot; the moon subtree is Lilac; the moon name is primary text.
      current = state({ mode, only: 'sunMoon', size: 'large' }); await open();
      assert.equal(await colorOf('.ambient-sunMoon .ambient-label'), expected(mode, 'sun'));
      assert.equal(await colorOf('.sun-dot[data-glyph="sun"]', 'fill'), expected(mode, 'sun'), `${mode} sun dot`);
      assert.equal(await colorOf('.sun-arc-path', 'fill'), expected(mode, 'sun'), `${mode} day arc`);
      assert.equal(await colorOf('.moon-block.tone-time'), expected(mode, 'time'), `${mode} moon block`);
      assert.equal(await colorOf('.moon-glyph[data-glyph="moon"]'), expected(mode, 'time'), `${mode} moon glyph`);
      assert.equal(await colorOf('.moon-lit', 'fill'), expected(mode, 'time'), `${mode} lit moon fraction`);
      assert.equal(await colorOf('.moon-name'), text, `${mode} moon name`);
      current = state({ mode, only: 'sunMoon', size: 'small' }); await open();
      const icon = await page.locator('.ambient-sunMoon .ambient-label [data-glyph]').evaluate((el) => ({ glyph: el.dataset.glyph, color: getComputedStyle(el).color }));
      assert.equal(icon.color, expected(mode, WEATHER_GLYPH_TONE[icon.glyph]), `${mode} small Sun & moon ${icon.glyph} icon`);
      // World clocks (#78): Lilac labels; day icons Gold and night icons Lilac; times primary text.
      current = state({ mode, only: 'worldClocks', size: 'large' }); await open();
      const clocks = await page.locator('.wc-daynight').evaluateAll((els) => els.map((el) => [el.dataset.glyph, getComputedStyle(el).color]));
      assert.deepEqual(clocks.map(([glyph]) => glyph), ['sun', 'moon', 'moon', 'moon']);
      for (const [glyph, color] of clocks) assert.equal(color, expected(mode, WEATHER_GLYPH_TONE[glyph]), `${mode} world clock ${glyph} icon`);
      assert.equal(await colorOf('.wc-name'), expected(mode, 'time')); assert.equal(await colorOf('.wc-time'), text);
      // Air quality (#78): Mist bars; the AQI and its category word are never coloured by category.
      current = state({ mode, only: 'airQuality', size: 'large' }); await open();
      const airBars = await page.locator('.air-bar:not(.air-bar-unknown)').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      assert.ok(airBars.length >= 2); for (const bar of airBars) assert.equal(bar, expected(mode, 'sky'), `${mode} air bar`);
      assert.equal(await colorOf('.air-aqi'), text);
      assert.ok([text, expected(mode, 'sky')].includes(await colorOf('.air-category')), `${mode} AQI category word has no category colour`);
      // Calendar (#78, time): the weekday label, weekday heads and the today ring; the date stays primary text.
      current = state({ mode, only: 'calendar', size: 'medium' }); await open();
      assert.equal(await colorOf('.calendar-weekday'), expected(mode, 'time'));
      assert.equal(await colorOf('.calendar-grid th'), expected(mode, 'time'), `${mode} weekday heads`);
      assert.equal(await colorOf('.calendar-date-number'), text);
      assert.equal(await colorOf('.calendar-today', 'borderTopColor'), expected(mode, 'time'), `${mode} today ring`);
      // Countdown and Note (#78, personal); Note is text only, its section still resolves Rose (checked above).
      current = state({ mode, only: 'countdown', size: 'small' }); await open();
      assert.equal(await colorOf('.ambient-countdown .countdown-unit'), expected(mode, 'personal'), `${mode} countdown unit`);
      current = state({ mode, only: 'countdown', size: 'small' }); current.settings.widgetData.countdowns = countdowns; await open();
      assert.equal(await page.locator('.countdown-hero .countdown-value').innerText(), 'Today');
      assert.equal(await page.locator('.ambient-countdown .countdown-unit').count(), 0, 'a Today countdown has no unit');
      assert.equal(await colorOf('.countdown-hero .countdown-value'), text, `${mode} the word Today is primary text`);
      current = state({ mode, only: 'note', size: 'medium' }); await open();
      assert.equal(await colorOf('.note-text'), text, `${mode} note text`);
      // Reminders (#73): Rose dots and dates; the Overdue word keeps the status tone.
      current = state({ mode, only: 'reminders', size: 'large' }); await open();
      assert.equal(await colorOf('.ambient-reminder-dot', 'borderTopColor'), expected(mode, 'personal'));
      assert.equal(await colorOf('.ambient-reminder-date'), expected(mode, 'personal'));
      assert.equal(await colorOf('.ambient-reminder-overdue'), rgb(STATUS_TONES.caution), `${mode} Overdue stays amber`);
    }
    checks.push("Merged renderers in both modes: Weather's --weather-rain hook, rain bars, unknown hours, detail, hours and hints in Sea glass with primary timing; Sun & moon Gold with a Lilac moon subtree; World clocks day/night icons Gold/Lilac; Air quality Mist bars with no category colour; Calendar weekday label, heads and today ring Lilac with a primary date; Countdown unit Rose and a primary Today word; Note text primary; Reminders dots and dates Rose with an amber Overdue");

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

    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
      await page.setViewportSize(viewport);
      for (const [preset, brightness] of [['room', 0.55], ['night', 0.28]]) for (const mode of ['native', 'color']) {
        current = state({ mode, brightness }); current.settings.widgets.photo = false; await open();
        await keep(`composition-${mode}-${preset}-${viewport.width}`, await page.screenshot());
      }
    }
    checks.push('Native and color compositions captured in RAM at 1280x720, 1080p and 4K at Room and Night brightness for visual inspection');
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
    const sampleExpected = (mode, role) => rgb(mode === 'native' ? NATIVE_PALETTE[role].hex : SAND);
    await p.getByRole('button', { name: 'Add widget to display' }).click();
    let samples = 0;
    for (const mode of ['native', 'color']) {
      if (mode === 'color') { await p.getByRole('button', { name: 'Close widget picker' }).click(); await p.getByRole('tab', { name: 'Style', exact: true }).click(); await swatch(p, 'Sand').click(); await p.getByRole('button', { name: 'Add widget to display' }).click(); }
      for (const id of ACTIVE_WIDGET_IDS) {
        await p.getByRole('button', { name: new RegExp(`^Preview ${WIDGET_CATALOG[id].name}(, on your display)?$`) }).click();
        for (const size of widgetSizes(id)) {
          await p.getByRole('button', { name: `${WIDGET_CATALOG[id].name} ${size}`, exact: true }).click();
          const sample = p.locator('.picker-sample');
          await sample.locator(`.ambient-${id}.widget-size-${size}`).waitFor();
          assert.equal(await sample.getAttribute('data-accent-mode'), mode);
          const [section] = await sections(sample);
          assert.equal(section.id, id);
          await assertWidgetSection(section, mode, `${mode} picker sample ${id} ${size}`, sample.locator('.ambient-widget'), sampleExpected);
          samples++;
        }
      }
      if (mode === 'native') await keep('picker-native-1280x720', await p.screenshot());
    }
    await studio.close();
    checks.push(`Picker samples follow the draft mode in all ${samples / 2} families: each resolves its role tone in native and the chosen accent in color, tints its accent element and paints no stray colour`);

    // The live canvas with every active widget on a native draft, as the owner edits at 1280x720.
    await app.store.update((data) => {
      const settings = defaultSettings();
      settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key in FULL_BOARD]));
      Object.assign(settings.widgetGrid.placements, structuredClone(FULL_BOARD));
      for (const id of ['worldClocks', 'calendar', 'countdown']) WIDGET_CHECKS[id].prepare({ settings });
      settings.widgetData.note = { text: '' };
      const created = new Date(now).toISOString();
      data.settings = settings; data.reminders = [{ id: '00000000-0000-4000-8000-000000000075', text: 'Synthetic reminder', completed: false, dueAt: null, createdAt: created, updatedAt: created }];
    });
    ({ studio, page: p } = await editor({ width: 1280, height: 720 }));
    const canvas = p.locator('.preview-surface');
    assert.equal(await canvas.locator('.ambient').getAttribute('data-accent-mode'), 'native');
    const onCanvas = await sections(canvas);
    assert.deepEqual(onCanvas.map((section) => section.id).sort(), [...ACTIVE_WIDGET_IDS].sort(), 'the canvas renders every active widget');
    for (const section of onCanvas) assert.equal(section.tone, sampleExpected('native', WIDGET_CATALOG[section.id].tone), `canvas ${section.id} tone`);
    // An empty Note shows its editor-only placeholder, whose label takes the personal tone.
    assert.equal(await canvas.locator('.ambient-note .note-placeholder .ambient-label').evaluate((el) => getComputedStyle(el).color), sampleExpected('native', 'personal'), 'empty Note placeholder label');
    await keep('editor-full-board-native-1280x720', await p.screenshot());
    await studio.close();
    checks.push('Editor canvas at 1280x720: a native draft with every active widget resolves each role tone; the empty Note placeholder label is Rose');
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
