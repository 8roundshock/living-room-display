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
import { ACCENT_SWATCHES, NATIVE_PALETTE, STATUS_TONES, WEATHER_GLYPH_TONE } from '../../src/shared/palette.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';
import { MODES } from './weather-browser.mjs';

const rgb = (hex) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
/** The current Sand swatch (#224) and the retired value older data may still store. */
const SAND = ACCENT_SWATCHES.find((swatch) => swatch.name === 'Sand').value;
const LEGACY_SAND = '#b8a17a';
/** Weather's rain visuals, the only elements that may paint the --weather-rain hook (#213). */
const RAIN_SELECTOR = '.weather-hint, .rain-detail, .rain-hours, .rain-bar, .rain-bar-unknown';
/** The first accent-coloured element of a widget: its label, else a caption, context line or unit. */
const ACCENT_SELECTOR = '.ambient-label, .preview-caption, .weather-context, .metric-label, .countdown-unit';
/** Widgets whose display face is primary content only (Note's text), so nothing in them is tinted; their section still resolves the tone. */
const TEXT_ONLY = new Set(['note']);
/** Every active widget on one Balanced 12 x 8 board, every cell used; a newly activated widget must be added here. */
const FULL_BOARD = {
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'medium' }, dynamic: { column: 0, row: 4, size: 'medium' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
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
 * --weather-rain inside Weather's rain visuals only, #213), the text colour, a status tone or black,
 * so no widget hard-codes a hue (for example AQI category colours) and Native redirects only the
 * accent group. Images are skipped. Returns the offending paints and the distinct accents in use.
 */
function paints(locator) {
  return locator.evaluate((section, [status, rainSelector]) => {
    const probe = document.createElement('i'); document.body.append(probe);
    const resolve = (value) => { probe.style.color = ''; probe.style.color = value; return getComputedStyle(probe).color; };
    const channels = (color) => { const parts = color.match(/[\d.]+/g); return parts && parts.length >= 3 ? { rgb: parts.slice(0, 3).map(Number).join(','), alpha: parts.length > 3 ? Number(parts[3]) : 1 } : null; };
    const fixed = [...status, '#000000'].map((value) => channels(resolve(value)).rgb);
    const bad = [], accents = new Set();
    for (const el of [section, ...section.querySelectorAll('*')]) {
      if (el.closest('img, image, defs, filter, mask, clipPath') || !el.checkVisibility({ visibilityProperty: true })) continue;
      const style = getComputedStyle(el);
      // --weather-rain is inherited by all of Weather; only the rain visuals may use it.
      const accent = style.getPropertyValue('--ambient-accent').trim(), rain = el.closest(rainSelector) ? style.getPropertyValue('--weather-rain').trim() : '';
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
  }, [Object.values(STATUS_TONES), RAIN_SELECTOR]);
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
    // #217: a valid mid-grey PNG (filter type 0 on every scanline, opaque), so Photo and Last screen
    // actually paint; the paint audit skips images, and the photo check below reads its pixels.
    const pixels = Buffer.alloc((320 * 4 + 1) * 200, 90);
    for (let row = 0; row < 200; row++) { pixels[row * (320 * 4 + 1)] = 0; for (let x = 0; x < 320; x++) pixels[row * (320 * 4 + 1) + 1 + x * 4 + 3] = 255; }
    const image = photoFixture(320, 200, pixels);
    let current = structuredClone(source), stateStatus = 200, photoMissing = false;
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    await context.route('**/api/state', (route) => route.fulfill(stateStatus === 200 ? { contentType: 'application/json', body: JSON.stringify(current) } : { status: stateStatus, contentType: 'application/json', body: '{"error":"Synthetic outage"}' }));
    await context.route('**/api/photo/image?*', (route) => route.fulfill(photoMissing ? { status: 404, body: 'Synthetic missing image' } : { contentType: 'image/png', body: image }));
    await context.route('**/api/preview/image?*', (route) => route.fulfill({ contentType: 'image/png', body: image }));
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date(now) });
    /**
     * Loads the display with `current`. A timeout (#305) names what was loading (widget and family or
     * board, mode, viewport) and every page error and console message so far, so a slow load can be told
     * from a page that stopped responding.
     */
    const open = async () => {
      const messages = [], listen = (message) => messages.push(`${message.type()}: ${message.text()}${message.location().url ? ` (${message.location().url})` : ''}`);
      page.on('console', listen);
      try { await page.goto(base + '/display'); await page.locator('.display-page').waitFor(); await page.clock.runFor(200); }
      catch (error) {
        const shown = Object.entries(current.settings.widgets).filter(([, on]) => on).map(([id]) => `${id} ${current.settings.widgetGrid.placements[id]?.size ?? ''}`.trim());
        const viewport = page.viewportSize();
        throw new Error(`open() failed loading /display (${error.message.split('\n')[0]}): ${shown.length === 1 ? `${shown[0]} alone` : `a board of ${shown.join(', ')}`}, ${current.settings.appearance.accentMode} mode, `
          + `${viewport.width}x${viewport.height}, state ${stateStatus}${photoMissing ? ', photo missing' : ''}. Page errors so far: ${JSON.stringify(errors)}. Console during this load: ${JSON.stringify(messages)}`, { cause: error });
      } finally { page.off('console', listen); }
    };
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
      // #213: outside its rain visuals Weather paints its sky tone. The audit only accepts the rain
      // hook there, so painting Weather's unit and metric labels with it (the review mutation) fails.
      current = weatherWith(mode, 'large', 'calm'); await open();
      assert.ok(await page.locator('.ambient-weather .metric-label').count() > 0, 'calm large Weather shows metric labels');
      assert.deepEqual((await paints(page.locator('[data-widget-id="weather"]'))).bad, [], `${mode} calm Weather paints no rain tone`);
      if (mode === 'native') {
        const mutation = await page.addStyleTag({ content: '.grid-ambient .ambient-weather .weather-unit, .grid-ambient .ambient-weather .metric-label { color: var(--weather-rain) !important; }' });
        const mutated = (await paints(page.locator('[data-widget-id="weather"]'))).bad;
        assert.ok(mutated.some((entry) => entry.includes('weather-unit')) && mutated.some((entry) => entry.includes('metric-label')), `the audit catches the rain tone on Weather's unit and metric labels: ${JSON.stringify(mutated)}`);
        await mutation.evaluate((element) => element.remove());
        assert.deepEqual((await paints(page.locator('[data-widget-id="weather"]'))).bad, [], 'removing the mutation restores a clean audit');
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
      // #438: the Clock's timer slot: the name (and a dim "+N") in the accent, the time in the text colour,
      // a paused mark in the text colour, and Done in the one status tone; nothing else is painted.
      for (const [kind, size] of [['running', 'large'], ['paused', 'medium'], ['done', 'small'], ['done', 'large']]) {
        current = state({ mode, only: 'clock', size });
        const at = (offset) => new Date(now + offset).toISOString();
        current.timers = [{ id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic tea', durationMs: 600_000, endsAt: kind === 'paused' ? null : at(kind === 'done' ? -60_000 : 480_000), remainingMs: kind === 'paused' ? 480_000 : null, createdAt: at(-120_000), updatedAt: at(-120_000) },
          // A second timer of the same kind that sorts after the first, so the slot also shows "+1".
          { id: '00000000-0000-4000-8000-000000000002', label: '', durationMs: 600_000, endsAt: kind === 'paused' ? null : at(590_000), remainingMs: kind === 'paused' ? 590_000 : null, createdAt: at(-120_000), updatedAt: at(-120_000) }];
        await open();
        const [section] = await sections(page);
        await assertSection(section, mode, `${mode} Clock ${size} with a ${kind} timer`, page.locator('[data-widget-id="clock"]'));
        assert.equal(await colorOf('.clock-timer-label'), expected(mode, 'time'), `${mode} ${kind} timer name in the accent`);
        assert.equal(await colorOf('.clock-timer-more'), expected(mode, 'time'), `${mode} "+1" in the accent`);
        assert.equal(await colorOf('.clock-timer-value'), kind === 'done' ? rgb(STATUS_TONES.caution) : text, `${mode} ${kind} timer value`);
        if (kind === 'paused') assert.equal(await colorOf('.clock-timer-paused i', 'backgroundColor'), text, `${mode} paused mark in the text colour`);
      }
    }
    checks.push("#438 Clock timer slot in both modes: running, paused and done (small and large) audit clean; the name and \"+1\" use the Clock's accent, the time the text colour, the paused mark the text colour and Done the amber status tone");
    checks.push("Merged renderers in both modes: Weather's --weather-rain hook, rain bars, unknown hours, detail, hours and hints in Sea glass with primary timing, and only there (#213: a rain-hook mutation on Weather's unit and metric labels fails the audit); Sun & moon Gold with a Lilac moon subtree; World clocks day/night icons Gold/Lilac; Air quality Mist bars with no category colour; Calendar weekday label, heads and today ring Lilac with a primary date; Countdown unit Rose and a primary Today word; Note text primary; Reminders dots and dates Rose with an amber Overdue");

    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const mode of ['native', 'color']) {
      current = state({ mode, only: 'photo' }); await open(); await page.locator('.ambient-photo-image').waitFor();
      const photo = await page.locator('.ambient-photo-image').evaluate((el) => ({ filter: getComputedStyle(el).filter, opacity: getComputedStyle(el).opacity }));
      assert.deepEqual(photo, { filter: 'saturate(0.3) brightness(0.45)', opacity: '0.45' }, `${mode} photo is never tinted`);
    }
    // #217: the synthetic photo and snapshot decode and paint their grey, so the image checks see a real image.
    const decoded = (selector) => page.locator(selector).first().evaluate(async (img) => {
      await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
      return { width: img.naturalWidth, height: img.naturalHeight, pixel: [...context.getImageData(160, 100, 1, 1).data] };
    });
    current = state({ mode: 'native', only: 'photo' }); await open(); await page.locator('.ambient-photo-image').waitFor();
    assert.deepEqual(await decoded('.ambient-photo-image'), { width: 320, height: 200, pixel: [90, 90, 90, 255] }, 'the synthetic photo paints');
    current = state({ mode: 'native', only: 'preview' }); await open(); await page.locator('.preview-image').waitFor();
    assert.deepEqual(await decoded('.preview-image'), { width: 320, height: 200, pixel: [90, 90, 90, 255] }, 'the synthetic last screen paints');
    // #224: data that stores the retired Sand renders the retuned Sand everywhere, root included.
    current = state({ mode: 'color' }); current.settings.appearance.accentColor = LEGACY_SAND; current.settings.widgets.photo = false; await open();
    assert.equal(await page.locator('.ambient').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--ambient-accent').trim().toLowerCase()), SAND, 'the ambient root renders the retuned Sand');
    for (const section of await sections(page)) await assertSection(section, 'color', 'stored retired Sand', page.locator(`[data-widget-id="${section.id}"]`));
    // #251: partly cloudy is its cloud's Stone with a Gold sun or Lilac moon part; fog Stone; drizzle Sea glass.
    const glyphs = [[0, true, 'sun', 'sun'], [0, false, 'moon', 'time'], [1, true, 'suncloud', 'stone'], [2, false, 'mooncloud', 'stone'], [3, true, 'cloud', 'stone'], [45, true, 'fog', 'stone'], [53, true, 'drizzle', 'water'], [63, true, 'rain', 'water'], [73, true, 'snow', 'sky'], [95, true, 'storm', 'water']];
    const PART_TONES = { suncloud: { core: 'sun', rays: 'sun', cloud: 'stone' }, mooncloud: { moon: 'time', cloud: 'stone' } };
    for (const mode of ['native', 'color']) {
      for (const [code, isDay, glyph, role] of glyphs) {
        current = state({ mode, only: 'weather' }); current.weather.current = { ...current.weather.current, weatherCode: code, isDay };
        await open();
        assert.equal(await page.locator('.weather-symbol').getAttribute('data-glyph'), glyph);
        assert.equal(await colorOf('.weather-symbol'), expected(mode, role), `${mode} weather code ${code} ${isDay ? 'day' : 'night'} glyph`);
        // Each part paints with its own sub-tone; the strokes follow it.
        const parts = await page.locator('.weather-symbol > .glyph-part').evaluateAll((els) => els.map((el) => [el.dataset.glyphPart, getComputedStyle(el).color, getComputedStyle(el.querySelector('svg > *')).stroke]));
        for (const [part, color, stroke] of parts) {
          const want = expected(mode, PART_TONES[glyph]?.[part] ?? role);
          assert.equal(color, want, `${mode} code ${code} ${glyph} part ${part}`); assert.equal(stroke, want, `${mode} code ${code} ${glyph} part ${part} stroke`);
        }
        // The label stays Mist (sky) while the glyph takes its own tone.
        assert.equal(await colorOf('.ambient-weather .ambient-label'), expected(mode, 'sky'));
      }
      current = state({ mode, only: 'forecast' }); current.weather.daily = current.weather.daily.map((day, index) => ({ ...day, weatherCode: [0, 1, 45, 53, 63, 73, 95][index] }));
      await open();
      const forecast = await page.locator('.forecast-day > .weather-glyph').evaluateAll((els) => els.map((el) => [el.dataset.glyph, getComputedStyle(el).color]));
      assert.ok(forecast.length >= 5);
      for (const [glyph, color] of forecast) assert.equal(color, expected(mode, { sun: 'sun', suncloud: 'stone', cloud: 'stone', fog: 'stone', drizzle: 'water', rain: 'water', snow: 'sky', storm: 'water' }[glyph]), `${mode} forecast ${glyph}`);
      // The chance droplet is Sea glass, like the rest of the precipitation chance.
      for (const color of await page.locator('.forecast-rain svg').evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke))) assert.equal(color, expected(mode, 'water'), `${mode} forecast chance droplet`);
      current = state({ mode, only: 'weather' }); current.weather.status = 'stale'; current.weather.updatedAt = new Date(now - 3 * 3600000).toISOString();
      await open();
      assert.match(await page.locator('.weather-age').innerText(), /Saved forecast/);
      assert.equal(await colorOf('.weather-age.stale'), rgb(STATUS_TONES.caution), `${mode} stale age stays amber`);
      current = state({ mode, only: 'weather' }); await open();
      stateStatus = 503; await page.clock.runFor(30001); await page.locator('.weather-age').filter({ hasText: 'Offline' }).waitFor(); stateStatus = 200;
      assert.equal(await colorOf('.weather-age.stale'), rgb(STATUS_TONES.caution), `${mode} offline age keeps the status tone`);
    }
    checks.push('Weather glyphs by code (clear day Gold, clear night Lilac, partly cloudy Stone with a Gold sun or Lilac moon part, cloud and fog Stone, drizzle/rain/storm Sea glass, snow Mist; #251) in Weather and Forecast, with a Sea glass chance droplet; stale and offline ages stay amber; photos are never tinted and the synthetic photo and snapshot actually paint (#217); color mode keeps the single accent everywhere, and a stored retired Sand renders the retuned Sand (#224)');

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
    await p.locator('input[aria-label="Choose a custom colour"]').fill('#123456');
    assert.equal(await heading(p), 'Custom'); assert.equal(await pressed(p, 'Native colours'), false); assert.equal(await canvasMode(p), 'color');
    await save(p); assert.equal(appearance().accentMode, 'color'); assert.equal(appearance().accentColor, '#123456');
    checks.push('Cancel restores Native; a swatch after Native selects color with that swatch; the custom colour input switches to color');

    // #151: the kept custom colour is a pressed swatch. After Native, one activation (no colour input,
    // so nothing relies on fill() of an unchanged value) restores it; the Save bar follows the saved state.
    const CUSTOM = 'Custom colour #123456', custom = () => swatch(p, CUSTOM);
    assert.equal(await pressed(p, CUSTOM), true, 'the saved custom colour shows as a pressed swatch');
    assert.equal(await custom().getAttribute('title'), CUSTOM);
    await nativeSwatch.click(); await saveBar(p).waitFor();
    assert.equal(await pressed(p, CUSTOM), false); assert.equal(await heading(p), 'Native');
    await custom().click();
    assert.equal(await pressed(p, CUSTOM), true); assert.equal(await heading(p), 'Custom'); assert.equal(await canvasMode(p), 'color');
    await saveBar(p).waitFor({ state: 'detached' });
    await nativeSwatch.click(); await save(p);
    assert.deepEqual([appearance().accentMode, appearance().accentColor], ['native', '#123456'], 'Native keeps the custom colour');
    await p.reload(); await p.getByRole('tab', { name: 'Style', exact: true }).click();
    assert.equal(await pressed(p, CUSTOM), false); assert.equal(await pressed(p, 'Native colours'), true);
    await custom().click(); await saveBar(p).waitFor();
    assert.equal(await p.locator('.preview-surface .ambient-clock .ambient-label').evaluate((el) => getComputedStyle(el).color), rgb('#123456'), 'the canvas shows the restored custom colour');
    await save(p); assert.deepEqual([appearance().accentMode, appearance().accentColor], ['color', '#123456']);
    // A swatch replaces the colour in the draft; the saved custom colour stays one activation away until another colour is saved.
    await swatch(p, 'Mist').click(); await saveBar(p).waitFor();
    assert.equal(await pressed(p, CUSTOM), false, 'the saved custom colour is still offered');
    await custom().click(); await saveBar(p).waitFor({ state: 'detached' });
    checks.push('#151 a kept custom colour is a named, pressed swatch; from Native (also after reload) one activation restores it, the Save bar appears only while the restored state differs, and it stays offered while a swatch is only a draft');

    for (const preset of ['Phone', 'Room', 'Night']) {
      await p.getByRole('combobox', { name: 'Style', exact: true }).selectOption(`builtin:${preset.toLowerCase()}`);
      assert.equal(await pressed(p, 'Native colours'), true, `${preset} applies Native`); assert.equal(await canvasMode(p), 'native');
      const tones = await p.locator('.preview-surface .ambient').evaluate(element => ['time', 'sky', 'personal'].map(role => getComputedStyle(element).getPropertyValue(`--tone-${role}`).trim()));
      assert.deepEqual(tones, [NATIVE_PALETTE.time.hex, NATIVE_PALETTE.sky.hex, NATIVE_PALETTE.personal.hex], `${preset} canvas tones`);
      await save(p);
    }
    assert.deepEqual({ preset: appearance().preset, accentMode: appearance().accentMode, brightness: appearance().brightness, accentColor: appearance().accentColor }, { preset: 'night', accentMode: 'native', brightness: 0.28, accentColor: '#9990b7' });
    assert.equal(await p.getByRole('button', { name: /^Custom colour/ }).count(), 0, "a built-in style's own single colour is not offered as a custom colour (#151)");
    checks.push('Phone, Room and Night apply and save Native with their own brightness and accent colour; the canvas resolves Lilac, Mist and Rose tones');

    await p.getByRole('button', { name: /^Save as new/ }).click();
    await p.getByRole('textbox', { name: 'New style', exact: true }).fill('Synthetic native');
    await p.getByRole('button', { name: 'Save new style', exact: true }).click(); await saveBar(p).waitFor({ state: 'detached' });
    assert.equal(app.store.snapshot().settings.savedPresets[0].visual.appearance.accentMode, 'native');
    // Edit Current display so saving Sage does not update the selected saved style in place.
    await p.getByRole('combobox', { name: 'Style', exact: true }).selectOption('');
    await swatch(p, 'Sage').click(); await save(p); assert.equal(appearance().accentMode, 'color');
    await p.getByRole('combobox', { name: 'Style', exact: true }).selectOption({ label: 'Synthetic native' });
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
    // #224: data that stores the retired Sand reads as Sand and renders the retuned value. Returning to
    // Sand from Native or another swatch is not an edit, and the stored value is never rewritten.
    await studio.close();
    await app.store.update((data) => { data.settings.appearance.accentMode = 'color'; data.settings.appearance.accentColor = LEGACY_SAND; });
    ({ studio, page: p } = await editor());
    assert.equal(await pressed(p, 'Sand'), true); assert.equal(await heading(p), 'Sand');
    assert.equal(await p.getByRole('button', { name: /^Custom colour/ }).count(), 0, 'the retired Sand is not a custom colour');
    assert.equal(await saveBar(p).count(), 0, 'reading it is not an edit');
    assert.equal(await p.locator('.preview-surface .ambient-clock .ambient-label').evaluate((el) => getComputedStyle(el).color), rgb(SAND), 'the canvas renders the retuned Sand');
    await swatch(p, 'Native colours').click(); await saveBar(p).waitFor();
    await swatch(p, 'Sand').click(); await saveBar(p).waitFor({ state: 'detached' });
    await swatch(p, 'Mist').click(); await saveBar(p).waitFor();
    await swatch(p, 'Sand').click(); await saveBar(p).waitFor({ state: 'detached' });
    assert.equal(appearance().accentColor, LEGACY_SAND, 'the stored value is unchanged');
    await studio.close();
    checks.push('#224 a stored retired Sand is selected as Sand (no custom swatch) and renders the retuned value; Native or Mist and back to Sand is not an edit; the stored value is unchanged');

    // #303: data saved by Night before Native colours (#75) has Night's own colour as a single accent.
    // It is the accent, so it stays offered as the Custom colour swatch: after Native one activation
    // restores it (no edit), and it goes only once another colour is saved.
    await app.store.update((data) => { data.settings = defaultSettings(); data.settings.appearance = { ...data.settings.appearance, accentMode: 'color', accentColor: '#9990b7', preset: 'night' }; });
    ({ studio, page: p } = await editor());
    const NIGHT = 'Custom colour #9990b7';
    assert.equal(await pressed(p, NIGHT), true, 'older colour-mode Night data shows its colour as a pressed swatch');
    assert.equal(await heading(p), 'Custom');
    await swatch(p, 'Native colours').click(); await saveBar(p).waitFor();
    assert.equal(await pressed(p, NIGHT), false, 'after Native the saved colour is still offered');
    await swatch(p, NIGHT).click(); await saveBar(p).waitFor({ state: 'detached' });
    assert.equal(await pressed(p, NIGHT), true, 'one activation restores it, which is not an edit');
    await swatch(p, 'Mist').click(); await saveBar(p).waitFor();
    assert.equal(await pressed(p, NIGHT), false, 'a swatch only in the draft keeps it offered');
    await save(p);
    assert.equal(await p.getByRole('button', { name: /^Custom colour/ }).count(), 0, 'once another colour is saved it is gone');
    await studio.close();
    checks.push("#303 older colour-mode data with Night's own colour as the accent offers it as \"Custom colour #9990b7\" (pressed); after Native one activation restores it without an edit, a draft swatch keeps it offered and saving another colour removes it; the picker is \"Choose a custom colour\"");

    // #137: every accent control (Native, the five colours, a kept custom colour and the picker on the
    // heading line) keeps a 44 x 44 hit area with no overlap. At 1280 x 720 the row stays one line and
    // the Style tab's default contents still fit; nothing overflows at 760, 390 or 320 px.
    const fits = () => p.evaluate(() => {
      const panel = document.querySelector('.inspector-panel'), panelBox = panel.getBoundingClientRect(), group = document.querySelector('.swatches').closest('.inspector-group').getBoundingClientRect();
      return { overflow: panel.scrollHeight - panel.clientHeight, scrolled: panel.scrollTop, accentInside: group.top >= panelBox.top && group.bottom <= panelBox.bottom, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    const accentTargets = () => p.evaluate(() => {
      const row = document.querySelector('.swatches'), rowBox = row.getBoundingClientRect();
      const controls = [...row.children, document.querySelector('.accent-heading .custom-color')];
      const boxes = controls.map((el) => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') ?? el.querySelector('input')?.getAttribute('aria-label'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
      const overlaps = [];
      for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(a.name + ' / ' + b.name);
      return { boxes, overlaps, rows: new Set([...row.children].map((child) => Math.round(child.getBoundingClientRect().top))).size, overflow: row.scrollWidth - row.clientWidth,
        outside: [...row.children].filter((child) => { const r = child.getBoundingClientRect(); return r.left < rowBox.left - 1 || r.right > rowBox.right + 1; }).length, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    for (const kept of [false, true]) {
      await reset();
      if (kept) await app.store.update((data) => { data.settings.appearance.accentMode = 'native'; data.settings.appearance.accentColor = '#123456'; });
      for (const viewport of [{ width: 1280, height: 720 }, { width: 760, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
        ({ studio, page: p } = await editor(viewport));
        const label = viewport.width + 'x' + viewport.height + (kept ? ' with a kept custom colour' : '');
        const targets = await accentTargets();
        assert.deepEqual(targets.boxes.map((box) => box.name), ['Native colours', ...ACCENT_SWATCHES.map((item) => item.name), ...(kept ? ['Custom colour #123456'] : []), 'Choose a custom colour'], label);
        for (const box of targets.boxes) assert.ok(box.width >= 43.99 && box.height >= 43.99, label + ': ' + box.name + ' hit area ' + box.width + 'x' + box.height);
        assert.deepEqual(targets.overlaps, [], label + ': hit areas do not overlap');
        assert.ok(targets.overflow <= 0 && targets.outside === 0 && targets.pageOverflow <= 0, label + ': ' + JSON.stringify(targets));
        if (viewport.width === 1280) {
          assert.equal(targets.rows, 1, label + ': one line of accent targets');
          const atDesktop = await fits();
          assert.ok(atDesktop.overflow <= 1 && atDesktop.accentInside && atDesktop.pageOverflow <= 0, label + ': the Style tab fits ' + JSON.stringify(atDesktop));
          await keep('style-tab-1280x720' + (kept ? '-custom' : ''), await p.screenshot());
          await p.setViewportSize({ width: 1280, height: 600 });
          const atShort = await fits();
          assert.ok(atShort.scrolled === 0 && atShort.accentInside && atShort.pageOverflow <= 0, 'Accent row visible without scrolling at 1280x600: ' + JSON.stringify(atShort));
        }
        if (viewport.width === 390) assert.equal(targets.rows, 1, label + ': one line at 390 px');
        if (viewport.width === 320) assert.ok(targets.rows >= 2, label + ': the row wraps at 320 px');
        if (viewport.width <= 390) await keep('style-tab-' + viewport.width + (kept ? '-custom' : ''), await p.locator('.inspector-group').filter({ has: p.locator('.swatches') }).screenshot());
        await studio.close();
      }
    }
    checks.push('#137 every accent control (Native, five colours, a kept custom colour, the heading-line picker) has a 44x44 hit area without overlap at 1280x720, 760x900, 390 and 320 px; one line at 1280x720 and 390 px, wrapping at 320 px, no horizontal overflow; the Style tab still fits at 1280x720 and shows the Accent row at 1280x600');

    // Picker samples start from a saved Native draft.
    await reset(); await app.store.update((data) => { data.settings.appearance.accentMode = 'native'; });
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
