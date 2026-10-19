// Adaptive Weather (#74), ambient glyph sizing (#128) and the #264 polish (unbroken times, chart name,
// past days, last-known readings, formatter caching, an unresolved device zone) in production Edge. Synthetic weather only;
// screenshots stay in RAM unless --capture names a temporary folder for manual inspection.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings as previousDefaults } from '../../src/server/compat/bedca44/shared/defaults.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { GRID_DENSITIES, WIDGET_IDS } from '../../src/shared/widgets.ts';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-18T13:00:00Z'); // 9 AM in Toronto
const WET = { precipitationProbability: 60, precipitationAmount: 1, rainAmount: 1 };
function hours(count, at = () => ({})) {
  return Array.from({ length: count }, (_, index) => ({
    intervalStart: new Date(NOW + index * HOUR).toISOString(), intervalEnd: new Date(NOW + (index + 1) * HOUR).toISOString(),
    precipitationProbability: 10, precipitationAmount: 0, rainAmount: 0, ...at(index),
  }));
}
/** Each outlook mode with its expected Weather state and wording (America/Toronto, 12-hour clock). */
export const MODES = {
  calm: { hourly: hours(24), mode: 'calm', kind: 'calm', compact: '', full: '', confidence: '' },
  'now-bounded': { hourly: hours(24, index => index <= 2 ? WET : {}), mode: 'elevated', kind: 'now', compact: 'Rain likely until 12 PM', full: 'Rain likely until 12 PM', detail: 'Peak 60% · 3 mm rain', confidence: 'Forecast estimate', chart: 'Hourly precipitation chance, 9 AM to 9 PM: peak 60% at 9 AM' },
  'now-open': { hourly: hours(24, () => WET), mode: 'elevated', kind: 'now', compact: 'Rain likely now', full: 'Rain likely beyond 9 PM', detail: 'Peak 60% · 12 mm rain', confidence: 'Forecast estimate', chart: 'Hourly precipitation chance, 9 AM to 9 PM: peak 60% at 9 AM' },
  'soon-multi': { hourly: hours(24, index => [1, 2, 4, 5].includes(index) ? WET : {}), mode: 'elevated', kind: 'soon', compact: 'Rain likely from 10 AM', full: 'Rain likely on and off from 10 AM', detail: 'Peak 60% · 4 mm rain', confidence: 'Forecast estimate', chart: 'Hourly precipitation chance, 9 AM to 9 PM: peak 60% at 10 AM' },
  later: { hourly: hours(24, index => [8, 9].includes(index) ? WET : {}), mode: 'hint', kind: 'later', compact: 'Rain likely from 5 PM', full: 'Rain likely from 5 PM', confidence: 'Forecast estimate' },
  possible: { hourly: hours(24, index => index === 3 ? { precipitationProbability: 40 } : {}), mode: 'hint', kind: 'possible', compact: 'Precipitation possible · 40%', full: 'Precipitation possible · 40%', confidence: 'Forecast estimate' },
  'unknown-none': { hourly: [], mode: 'hint', kind: 'unknown', compact: 'Rain outlook unavailable', full: 'Rain outlook unavailable', confidence: '' },
  'unknown-rain-data': { hourly: hours(24, index => index === 4 ? { rainAmount: null } : {}), mode: 'hint', kind: 'unknown', compact: 'Rain timing unavailable', full: 'Rain timing unavailable', confidence: 'Partial data' },
  'partial-with-spell': { hourly: hours(6, index => [2, 3].includes(index) ? WET : {}), mode: 'elevated', kind: 'soon', compact: 'Rain likely 11 AM–1 PM', full: 'Rain likely 11 AM–1 PM', detail: 'Peak 60% · 2 mm rain', confidence: 'Partial forecast', chart: 'Hourly precipitation chance, 9 AM to 3 PM: peak 60% at 11 AM' },
};
const SIZES = ['small', 'medium', 'large'];
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
/** Copy is compared as read: no-break spaces and word joiners keep times together (#197) and are checked separately. */
const plain = text => text === null || text === undefined ? text : text.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '');
const MEANINGFUL = ['.ambient-label', '.current-temperature', '.weather-condition', '.weather-details', '.weather-hint', '.rain-timing', '.rain-detail', '.rain-bars', '.rain-hours', '.rain-confidence', '.weather-age', '.weather-credit', '.weather-metrics'].join(',');
/** CSS glyph boxes (#128) as [cqw, cqh] fractions of the widget's content box. */
function glyphFractions(size, mode) {
  if (size === 'medium') return [0.10, 0.22];
  if (size === 'large' && mode === 'elevated') return [0.13, 0.15];
  return [0.19, 0.25];
}

async function measure(widget, selectors) {
  return widget.evaluate((el, selectors) => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el), content = el.querySelector('.widget-content'), body = el.querySelector('.weather-body');
    const visible = node => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const clipped = [...el.querySelectorAll(selectors)].filter(child => visible(child)).filter(child => { const b = child.getBoundingClientRect(); return b.top < r.top - 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1 || b.right > r.right + 1; }).map(child => child.className);
    const glyph = el.querySelector('.weather-symbol'), g = glyph?.getBoundingClientRect();
    const text = selector => el.querySelector(selector)?.textContent?.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '') ?? null;
    return {
      rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      box: { width: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) },
      scale: new DOMMatrix(getComputedStyle(content).transform).a, border: style.borderWidth, background: style.backgroundColor, clipped,
      mode: body?.getAttribute('data-weather-mode'), kind: body?.getAttribute('data-rain-kind'),
      place: text('.weather-place'), age: text('.weather-age'), credit: text('.weather-credit'), confidence: text('.rain-confidence'),
      hint: text('.weather-hint'), timing: text('.rain-timing'), detail: text('.rain-detail'), condition: text('.weather-condition'), details: text('.weather-details'),
      ageVisible: (() => { const node = el.querySelector('.weather-age'); return Boolean(node && visible(node)); })(),
      bars: el.querySelectorAll('.rain-bar').length, spellBars: el.querySelectorAll('.rain-bar-spell').length, unknownBars: el.querySelectorAll('.rain-bar-unknown').length,
      barsHeight: el.querySelector('.rain-bars')?.getBoundingClientRect().height ?? 0,
      glyph: g ? { width: g.width, height: g.height, inline: glyph.getAttribute('style') ?? '', hero: glyph.hasAttribute('data-glyph-hero'), still: glyph.hasAttribute('data-glyph-still') } : null,
      wind: el.querySelector('.weather-metrics') !== null, highLow: text('.weather-high-low'), srOnly: [...el.querySelectorAll('.sr-only')].map(node => node.textContent),
      chart: el.querySelector('.rain-bars') ? { role: el.querySelector('.rain-bars').getAttribute('role'), label: el.querySelector('.rain-bars').getAttribute('aria-label')?.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '') } : null,
      lastKnown: text('.weather-last-known'),
    };
  }, selectors);
}

/**
 * The rendered lines of each rain timing and hint line (#197): no line may start with AM/PM, and none may
 * follow a line that ends with a lone “·” (or start with one), so a time or a “· 40%” never wraps alone.
 */
async function lineBoxes(widget) {
  return widget.evaluate(el => [...el.querySelectorAll('.rain-timing, .weather-hint')].map(node => {
    const lines = []; let top = null;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) for (let index = 0; index < text.data.length; index++) {
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1);
      const rect = [...range.getClientRects()].find(box => box.width > 0 || box.height > 0);
      if (!rect) { if (lines.length) lines[lines.length - 1] += text.data[index]; continue; }
      if (top === null || rect.top > top + rect.height / 2) { lines.push(''); top = rect.top; }
      lines[lines.length - 1] += text.data[index];
    }
    return { className: node.className, lines: lines.map(line => line.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2060/g, '')) };
  }));
}
function assertUnbrokenLines(blocks, label) {
  for (const { className, lines } of blocks) lines.forEach((line, index) => {
    assert.doesNotMatch(line, /^\s*(AM|PM)\b/, `${label} .${className} line ${index + 1} starts with AM/PM: ${JSON.stringify(lines)}`);
    assert.doesNotMatch(line, /^\s*·/, `${label} .${className} line ${index + 1} starts with a lone “·”: ${JSON.stringify(lines)}`);
    if (index) assert.doesNotMatch(lines[index - 1], /·\s*$/, `${label} .${className} line ${index + 1} follows a lone “·”: ${JSON.stringify(lines)}`);
  });
}

export async function runWeatherQa({ playwright, edge, capture } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-weather-'));
  const clientDirectory = fileURLToPath(new URL('../../dist/client', import.meta.url));
  const app = await createApplication({ dataDirectory: directory, clientDirectory, now: () => NOW, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [], shots = [];
  let migration;
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[1], timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    const source = await (await fetch(`${base}/api/state`)).json();
    assert.equal(source.weather.location.timezone, 'America/Toronto');
    let current = structuredClone(source), failing = false;
    await context.route('**/api/state', route => route.fulfill(failing ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic offline state' }) } : { status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    // A paused clock exactly on the hour: the 12-hour window then holds exactly twelve intervals.
    await page.clock.install({ time: new Date(NOW) }); await page.clock.pauseAt(new Date(NOW));
    const open = async (path = '/display', at = NOW) => { await page.clock.setSystemTime(new Date(at)); await page.goto(base + path); await page.locator(path === '/display' ? '.display-page' : '.preview-surface').waitFor(); };
    function only(size, mode, density = 'balanced', changes = state => state) {
      current = structuredClone(source);
      current.settings.appearance.motionEnabled = false; current.settings.widgetGrid.density = density;
      current.settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, id === 'weather']));
      current.settings.widgetGrid.placements.weather = { column: 0, row: 0, size };
      current.weather.hourly = structuredClone(MODES[mode].hourly);
      current = changes(current) ?? current;
    }
    const weather = () => page.locator('[data-widget-id="weather"]');

    // Every family × mode × density × viewport.
    let renders = 0;
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const density of Object.keys(GRID_DENSITIES)) for (const size of SIZES) for (const [mode, expected] of Object.entries(MODES)) {
        only(size, mode, density); await open(); await weather().waitFor();
        const label = `${size}/${mode}/${density}/${viewport.width}`, m = await measure(weather(), MEANINGFUL);
        assert.ok(m.rect.x >= 0 && m.rect.y >= 0 && m.rect.right <= viewport.width + 1 && m.rect.bottom <= viewport.height + 1, `${label} stays inside the display`);
        assert.ok(m.scale >= 0.75, `${label} fits by design, scale=${m.scale}`);
        assert.equal(m.border, '0px', label); assert.equal(m.background, 'rgba(0, 0, 0, 0)', label);
        assert.deepEqual(m.clipped, [], `${label} meaningful descendants stay visible`);
        assert.equal(m.mode, expected.mode, `${label} data-weather-mode`); assert.equal(m.kind, expected.kind, `${label} data-rain-kind`);
        assert.match(m.place, /Toronto · °C/, `${label} place and unit`); assert.ok(m.ageVisible, `${label} age visible`); assert.match(m.age, /Updated/, label);
        assert.equal(m.credit, 'Forecast by Open-Meteo', `${label} credit on the attribution widget`);
        const headline = size === 'small' ? expected.compact : expected.full;
        if (expected.mode === 'calm') { assert.equal(m.hint, null, label); assert.equal(m.timing, null, label); assert.equal(m.condition, 'Overcast', label); }
        else if (expected.mode === 'hint') { assert.equal(m.hint, headline, `${label} hint`); assert.equal(m.timing, null, label); }
        else { assert.equal(m.timing, headline, `${label} timing`); assert.equal(m.hint, null, label); }
        if (expected.mode === 'elevated' && size !== 'small') assert.equal(m.detail, expected.detail, `${label} detail`); else assert.equal(m.detail, null, `${label} detail only when elevated and wider`);
        if (expected.mode !== 'calm' && size !== 'large') assert.ok(m.srOnly.includes('Overcast') || m.condition === 'Overcast', `${label} condition kept for assistive tech`);
        const showConfidence = expected.mode !== 'calm' && expected.confidence !== '' && (size !== 'small' || expected.confidence !== 'Forecast estimate');
        assert.equal(m.confidence, showConfidence ? expected.confidence : null, `${label} confidence`);
        const elevatedLarge = size === 'large' && expected.mode === 'elevated';
        assert.equal(m.bars > 0, elevatedLarge, `${label} rain bars only in large elevated`);
        if (elevatedLarge) {
          // The chart summarises its data for assistive technology (#166); the bars stay presentational.
          assert.deepEqual(m.chart, { role: 'img', label: expected.chart }, `${label} chart accessible name`);
          assert.ok(m.barsHeight >= m.rect.height * 0.1, `${label} bars keep real height: ${m.barsHeight}/${m.rect.height}`);
          assert.equal(m.bars, expected.hourly.length >= 12 ? 12 : expected.hourly.length, `${label} one bar per window hour`);
          assert.equal(m.wind, false, `${label} wind and feels-like give way to rain`); assert.match(m.highLow, /^High 17° · Low 9°$/, label);
        }
        if (size === 'large' && expected.mode !== 'elevated') assert.equal(m.wind, true, `${label} keeps wind and high/low`);
        if (size !== 'small' && expected.mode === 'calm') assert.match(m.details, /Feels like 13°/, label);
        assert.ok(m.glyph?.hero && !m.glyph.still, `${label} hero glyph, animated only when fresh`);
        assert.doesNotMatch(m.glyph.inline, /width/, `${label} the glyph has no inline 20 px size (#128)`);
        const [cw, ch] = glyphFractions(size, expected.mode), want = Math.min(cw * m.box.width, ch * m.box.height) * m.scale;
        assert.ok(Math.abs(m.glyph.width - want) <= 1.5, `${label} glyph ${m.glyph.width} matches CSS ${want}`);
        renders++;
        if (capture && density === 'balanced') shots.push({ group: `${viewport.width}`, name: `${size} · ${mode}`, bytes: await weather().screenshot() });
      }
    }
    checks.push(`${renders} renders: 3 families × ${Object.keys(MODES).length} modes × 3 densities × 1280/1920/3840 widths: bounds, fit ≥0.75, no frame/fill, unclipped content, copy, data attributes, place/unit/age, credit, confidence, bars only in large elevated with their accessible summary (#166), CSS glyph boxes (#128)`);

    // Rendered line boxes (#197): medium and large at the owner's 1280×720, every density, Text 100% and 125%.
    await page.setViewportSize(VIEWPORTS[0]);
    let lineRenders = 0;
    for (const fontScale of [1, 1.25]) for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['medium', 'large']) for (const [mode, expected] of Object.entries(MODES)) {
      if (expected.mode === 'calm') continue;
      only(size, mode, density, state => { state.settings.appearance.fontScale = fontScale; });
      await open(); await weather().waitFor();
      const blocks = await lineBoxes(weather());
      assert.ok(blocks.length > 0, `${size}/${mode}/${density}/${fontScale} has a timing or hint line`);
      assertUnbrokenLines(blocks, `${size}/${mode}/${density}/${fontScale * 100}%`);
      lineRenders++;
    }
    // The QA example: the hint “Precipitation possible · 40%” in a narrow box keeps “· 40%” with its words.
    only('medium', 'possible', 'fine'); await open();
    assert.equal(await weather().locator('.weather-hint').textContent(), 'Precipitation possible\u00a0·\u00a040%');
    checks.push(`${lineRenders} line-box renders (medium/large × timing/hint modes × 3 densities × Text 100%/125% at 1280×720): no line starts with AM/PM or follows a lone “·” (#197)`);

    // 125% text, imperial, stale, offline, unavailable and partial data.
    await page.setViewportSize(VIEWPORTS[1]);
    for (const density of ['balanced', 'fine']) for (const size of SIZES) for (const mode of ['calm', 'now-open', 'soon-multi', 'possible', 'partial-with-spell']) {
      only(size, mode, density, state => { state.settings.appearance.fontScale = 1.25; state.weather.location.name = 'A deliberately long synthetic place name'; });
      await open(); const m = await measure(weather(), MEANINGFUL);
      assert.ok(m.scale >= 0.65, `125% ${size}/${mode}/${density} scale=${m.scale}`); assert.deepEqual(m.clipped, [], `125% ${size}/${mode}/${density} unclipped`);
    }
    for (const size of ['medium', 'large']) {
      only(size, 'now-bounded', 'balanced', state => { state.weather.units = { temperature: '°F', windSpeed: 'mph', precipitation: 'in' }; state.weather.hourly.forEach(hour => { if (hour.rainAmount) { hour.rainAmount = 0.05; hour.precipitationAmount = 0.05; } }); });
      await open(); assert.equal((await measure(weather(), MEANINGFUL)).detail, 'Peak 60% · 0.15 in rain', `${size} imperial rain amount`);
    }
    only('medium', 'now-open', 'balanced', state => { state.weather.status = 'stale'; state.weather.updatedAt = new Date(NOW - 3 * HOUR).toISOString(); });
    await open(); let m = await measure(weather(), MEANINGFUL);
    assert.equal(m.age, 'Saved forecast · Updated 3 hr ago'); assert.equal(m.mode, 'elevated', 'a saved forecast is classified from its intervals'); assert.ok(m.glyph.still, 'a saved forecast glyph is still');
    for (const size of SIZES) {
      only(size, 'now-bounded'); failing = false; await open();
      failing = true; await page.clock.runFor(31_000);
      await page.locator('.weather-age.stale').waitFor();
      m = await measure(weather(), MEANINGFUL);
      assert.match(m.age, /^Offline · Updated/, `${size} offline label`); assert.equal(m.mode, 'elevated'); assert.ok(m.glyph.still, `${size} offline glyph is still`);
      if (capture) shots.push({ group: 'states', name: `offline ${size}`, bytes: await weather().screenshot() });
      failing = false;
    }
    only('large', 'calm', 'balanced', state => { state.weather = { ...state.weather, status: 'unavailable', current: null, daily: [], hourly: [], updatedAt: null }; });
    await open(); m = await measure(weather(), MEANINGFUL);
    assert.match(await weather().innerText(), /Weather unavailable/); assert.equal(m.hint, null, 'unavailable weather shows no rain line'); assert.equal(m.glyph, null);
    only('large', 'now-open', 'balanced', state => { state.weather.hourly[10].precipitationProbability = null; state.weather.hourly[11].rainAmount = null; });
    await open(); m = await measure(weather(), MEANINGFUL);
    assert.equal(m.unknownBars, 1, 'one dotted unknown hour'); assert.equal(m.confidence, 'Partial data'); assert.equal(m.timing, 'Rain likely until 8 PM');
    assert.equal(await page.getByRole('img', { name: /^Hourly precipitation chance, 9\sAM to 9\sPM: peak 60% at 9\sAM, 1 hour unknown$/ }).count(), 1, 'the chart name counts the unknown hour');
    if (capture) shots.push({ group: 'states', name: 'large partial data', bytes: await weather().screenshot() });
    only('large', 'now-open'); await open('/display', NOW + 30 * 60_000); m = await measure(weather(), MEANINGFUL);
    assert.equal(m.bars, 13, 'mid-hour, the window overlaps thirteen hourly intervals'); assert.equal(m.timing, 'Rain likely beyond 10 PM'); assert.ok(m.scale >= 0.75);
    only('medium', 'now-bounded', 'balanced', state => { state.settings.widgets.forecast = true; state.settings.widgetGrid.placements.forecast = { column: 0, row: 6, size: 'large' }; });
    await open(); assert.equal((await measure(weather(), MEANINGFUL)).credit, null, 'Forecast carries the credit when shown');
    checks.push('125% text (scale ≥0.65), imperial “in rain”, stale saved forecast still classified, offline labels in elevated mode, unavailable weather, one dotted unknown bar with Partial data, credit only on the attribution widget');

    // Retired Rain never renders, even injected as enabled.
    only('medium', 'now-bounded', 'balanced', state => { state.settings.widgets.rain = true; state.settings.widgetGrid.placements.rain = { column: 4, row: 0, size: 'medium' }; });
    await open(); assert.equal(await page.locator('[data-widget-id="rain"]').count(), 0); assert.equal(await weather().count(), 1);
    checks.push('An injected widgets.rain = true never renders [data-widget-id=rain]');

    // Forecasts saved one and three days earlier (#243): no past day in any Forecast family, today's high/low
    // found by the city calendar, the hours-old reading qualified as last known, and nothing invented once
    // every saved day has passed.
    const DAY = 24 * HOUR, civil = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(at);
    function savedEarlier(state, days, status = 'stale') {
      const saved = NOW - days * DAY;
      state.weather.status = status; state.weather.updatedAt = new Date(saved).toISOString();
      state.weather.current = { ...state.weather.current, time: new Date(saved).toISOString() };
      state.weather.daily = Array.from({ length: 7 }, (_, index) => ({ date: civil(saved + index * DAY), weatherCode: 3, temperatureMax: 10 + index, temperatureMin: index, precipitationProbability: 10 * index, precipitationAmount: 0 }));
      state.weather.hourly = Array.from({ length: 24 }, (_, index) => ({ intervalStart: new Date(saved + index * HOUR).toISOString(), intervalEnd: new Date(saved + (index + 1) * HOUR).toISOString(), precipitationProbability: 10, precipitationAmount: 0, rainAmount: 0 }));
      return state;
    }
    function onlyForecast(size, changes) {
      only('small', 'calm', 'balanced', state => {
        state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, id === 'forecast']));
        state.settings.widgetGrid.placements.forecast = { column: 0, row: 0, size }; return changes(state);
      });
    }
    const forecastLabels = () => page.locator('[data-widget-id="forecast"] .forecast-day-label').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, full: node.getAttribute('aria-label') })));
    await page.setViewportSize(VIEWPORTS[0]);
    for (const [days, weekday, remaining] of [[1, 'Sat', 6], [3, 'Thu', 4]]) {
      for (const size of SIZES) {
        onlyForecast(size, state => savedEarlier(state, days)); await open();
        const labels = await forecastLabels(), want = Math.min(size === 'small' ? 3 : size === 'medium' ? 5 : 7, remaining);
        assert.equal(labels.length, want, `forecast saved ${days} days earlier, ${size}: ${JSON.stringify(labels)}`);
        assert.deepEqual(labels.slice(0, 2).map(label => label.text), ['Today', 'Mon'], `${days} days/${size} starts at today`);
        assert.ok(labels.every(label => label.full.slice(-10) >= '2026-10-18'), `${days} days/${size} shows no past day: ${JSON.stringify(labels)}`);
        assert.equal(labels[1].full, 'Tomorrow, 2026-10-19');
        assert.equal(await page.locator('[data-widget-id="forecast"] .ambient-label').textContent(), want === 7 ? 'The week' : `Next ${want} days`, 'the heading counts the days shown');
        assert.match(await page.locator('[data-widget-id="forecast"] .forecast-attribution').innerText(), new RegExp(`^Saved forecast\\s*(· )?Open-Meteo · Updated ${days} ${days === 1 ? 'day' : 'days'} ago$`));
      }
      for (const size of ['medium', 'large']) {
        only(size, 'calm', 'balanced', state => savedEarlier(state, days)); await open();
        const m = await measure(weather(), MEANINGFUL), text = await weather().innerText();
        assert.equal(m.lastKnown, `Last known · ${weekday} 9 AM`, `${days} days/${size} qualifies the temperature`);
        assert.equal(await weather().locator('.weather-last-known').evaluate(node => getComputedStyle(node).color), await weather().locator('.weather-age').evaluate(node => getComputedStyle(node).color), 'in the status tone');
        assert.equal(m.age, `Saved forecast · Updated ${days} ${days === 1 ? 'day' : 'days'} ago`, 'the age line stays (one day is singular, #280)');
        assert.ok(m.glyph.still, 'the glyph stays still'); assert.equal(m.hint, 'Rain outlook unavailable', 'every saved hour has passed');
        assert.ok(m.srOnly.includes('Overcast'), 'assistive text keeps the condition');
        if (size === 'large') assert.match(text, new RegExp(`High / low\\s+${10 + days}° / ${days}°`), `${days} days: today's high/low, not the first saved day's`);
      }
    }
    for (const size of SIZES) {
      onlyForecast(size, state => savedEarlier(state, 8)); await open();
      assert.equal(await forecastLabels().then(labels => labels.length), 0);
      assert.match(await page.locator('[data-widget-id="forecast"]').innerText(), /Forecast unavailable/, `${size}: no day left`);
    }
    only('large', 'calm', 'balanced', state => savedEarlier(state, 8)); await open();
    assert.match(await weather().innerText(), /High \/ low\s+Unavailable/, 'no saved day for today: high/low unavailable');
    // The boundary and offline: three hours exactly is not yet last known; an offline display qualifies an old reading.
    only('medium', 'calm', 'balanced', state => { state.weather.status = 'stale'; state.weather.updatedAt = new Date(NOW - 3 * HOUR).toISOString(); }); await open();
    m = await measure(weather(), MEANINGFUL); assert.equal(m.lastKnown, null); assert.equal(m.condition, 'Overcast'); assert.equal(m.age, 'Saved forecast · Updated 3 hr ago');
    // The age value never wraps inside ("5" / "hr ago"), even in the Fine small family (#221).
    for (const density of Object.keys(GRID_DENSITIES)) {
      only('small', 'calm', density, state => { state.weather.status = 'stale'; state.weather.updatedAt = new Date(NOW - 5 * HOUR).toISOString(); }); await open();
      assert.equal(await weather().locator('.weather-age-value').evaluate(node => new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size), 1, `small/${density} age stays on one line`);
    }
    only('medium', 'calm', 'balanced', state => { state.weather.updatedAt = new Date(NOW - 5 * HOUR).toISOString(); }); failing = false; await open();
    failing = true; await page.clock.runFor(31_000); await page.locator('.weather-age.stale').waitFor(); failing = false;
    m = await measure(weather(), MEANINGFUL); assert.equal(m.lastKnown, 'Last known · 4 AM'); assert.match(m.age, /^Offline · Updated 5 hr ago$/);
    if (capture) shots.push({ group: 'states', name: 'offline last known medium', bytes: await weather().screenshot() });
    checks.push('Forecasts saved 1 and 3 days earlier: every Forecast family starts at Today with no past day (Tomorrow kept in assistive text), Weather qualifies the reading “Last known · Sat/Thu 9 AM” in the status tone with a still glyph and today\'s high/low; 8 days earlier: Forecast unavailable and high/low unavailable; 3 h exactly is not last known; offline qualifies a 5 h old reading (#243)');

    // Formatter work per tick (#99): a re-render within the same minute constructs no Intl.DateTimeFormat in
    // Weather (large, elevated) or Forecast (large); a new minute reuses the cached formatters.
    await page.addInitScript(() => {
      const Original = Intl.DateTimeFormat; window.__dateFormats = 0;
      Intl.DateTimeFormat = new Proxy(Original, { construct(target, args) { window.__dateFormats++; return Reflect.construct(target, args); }, apply(target, self, args) { window.__dateFormats++; return Reflect.apply(target, self, args); } });
    });
    only('large', 'now-open', 'balanced', state => { state.settings.widgets.forecast = true; state.settings.widgetGrid.placements.forecast = { column: 0, row: 6, size: 'large' }; });
    await open(); await page.locator('[data-widget-id="forecast"] .forecast-day').first().waitFor();
    const constructed = () => page.evaluate(() => window.__dateFormats);
    assert.ok(await constructed() > 0, 'the spy sees the first render');
    const settledCount = await constructed();
    for (let tick = 0; tick < 5; tick++) await page.clock.runFor(1000);
    assert.equal(await constructed(), settledCount, 'five one-second ticks in the same minute construct no formatter');
    await page.clock.runFor(60_000);
    assert.equal(await constructed(), settledCount, 'a new minute reuses the cached formatters');
    checks.push('Weather large elevated and Forecast large construct no Intl.DateTimeFormat on one-second ticks or a minute change (#99)');

    // Glyph boxes in the editor canvas (#128): the authored default board, Weather and Forecast.
    current = structuredClone(source);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport); await open('/editor');
      const canvas = page.locator('.preview-surface');
      const glyphs = await canvas.evaluate(surface => [...surface.querySelectorAll('.ambient-weather, .ambient-forecast')].map(el => {
        const style = getComputedStyle(el), body = el.querySelector('.weather-body'), scale = new DOMMatrix(getComputedStyle(el.querySelector('.widget-content')).transform).a;
        const box = { width: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
        const glyph = el.querySelector('.weather-symbol, .forecast-day > .weather-glyph'); const r = glyph.getBoundingClientRect();
        return { id: el.getAttribute('data-widget-id'), size: el.getAttribute('data-widget-size'), mode: body?.getAttribute('data-weather-mode') ?? null, box, scale, width: r.width, inline: glyph.getAttribute('style') ?? '' };
      }));
      assert.equal(glyphs.length, 2);
      for (const glyph of glyphs) {
        const [cw, ch] = glyph.id === 'forecast' ? [0.10, 0.16] : glyphFractions(glyph.size, glyph.mode);
        const want = Math.min(cw * glyph.box.width, ch * glyph.box.height) * glyph.scale;
        assert.ok(Math.abs(glyph.width - want) <= 1.5, `editor ${viewport.width} ${glyph.id} glyph ${glyph.width} matches CSS ${want}`);
        assert.doesNotMatch(glyph.inline, /width/);
      }
      if (capture) shots.push({ group: 'editor', name: `editor ${viewport.width}`, bytes: await canvas.screenshot() });
    }
    for (const viewport of [VIEWPORTS[1], VIEWPORTS[2]]) {
      await page.setViewportSize(viewport); current = structuredClone(source); current.settings.appearance.motionEnabled = false; await open();
      const forecast = await page.locator('[data-widget-id="forecast"]').evaluate(el => {
        const style = getComputedStyle(el), scale = new DOMMatrix(getComputedStyle(el.querySelector('.widget-content')).transform).a, r = el.querySelector('.forecast-day > .weather-glyph').getBoundingClientRect();
        return { want: Math.min(0.10 * (el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), 0.16 * (el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))) * scale, width: r.width };
      });
      assert.ok(Math.abs(forecast.width - forecast.want) <= 1.5, `display ${viewport.width} forecast glyph ${forecast.width} matches ${forecast.want}`);
    }
    checks.push('Glyph boxes match the widget CSS on the display (1280/1920/3840) and in the editor canvas (1280/1920) for Weather and Forecast; no inline 20 px size (#128)');

    // The picker: no Rain entry; the Weather sample shows the elevated family.
    await page.setViewportSize(VIEWPORTS[1]); current = structuredClone(source); await open('/editor');
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click();
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Preview Rain', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Preview Weather', exact: true }).click();
    assert.match(await page.locator('.picker-detail-heading').innerText(), /Conditions now, with rain timing when rain is near/);
    for (const size of SIZES) {
      await page.getByRole('button', { name: `Weather ${size}`, exact: true }).click();
      assert.equal(await page.locator('.picker-sample .weather-body').getAttribute('data-weather-mode'), 'elevated', `picker ${size} sample`);
    }
    if (capture) shots.push({ group: 'editor', name: 'picker large', bytes: await page.locator('.picker-detail').screenshot() });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Weather', exact: true }).click();
    await page.getByText('Rain timing appears automatically when rain is near. It\'s a forecast estimate.', { exact: true }).waitFor();
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'browsing the picker and inspector changes nothing');
    checks.push('Picker lists no Rain; Weather description from the catalog; elevated synthetic sample in every family; inspector hint; no draft change');
    await context.close();

    migration = await migrationCheck({ browser, clientDirectory, errors });
    checks.push(...migration.checks);
    if (capture) shots.push(...migration.shots);
    const unresolved = await unresolvedZoneCheck({ browser, clientDirectory, errors, capture });
    checks.push(...unresolved.checks);
    shots.push(...unresolved.shots);
    assert.deepEqual(errors, []);
    if (capture) await writeMontages(browser, capture, shots);
    return { checks };
  } finally { await browser.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true }); }
}

/** An isolated app over a pre-#74 state.json: the merge shows at once without a draft or a write. */
async function migrationCheck({ browser, clientDirectory, errors }) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-weather-migration-'));
  const settings = JSON.parse(JSON.stringify(previousDefaults()));
  assert.equal(settings.widgets.rain, true); assert.deepEqual(settings.widgetGrid.placements.weather, { column: 8, row: 0, size: 'medium' }); assert.equal(settings.widgetGrid.revision, 2);
  const bytes = JSON.stringify({ version: 1, settings, reminders: [] }, null, 2);
  await writeFile(join(directory, 'state.json'), bytes);
  const app = await createApplication({ dataDirectory: directory, clientDirectory, now: () => NOW, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
  const shots = [];
  try {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(NOW) });
    await page.goto(base + '/editor'); await page.getByRole('tab', { name: 'Widgets', exact: true }).click(); await page.clock.runFor(300);
    const rows = await page.locator('.widget-list .widget-select').evaluateAll(buttons => buttons.map(button => button.textContent.replace('›', '').trim()));
    assert.ok(rows.includes('WeatherLarge'), `the editor lists a large Weather: ${rows}`); assert.equal(rows.some(row => row.startsWith('Rain')), false);
    await page.clock.runFor(31_000);
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'the migrated settings are the saved baseline, so Save/Cancel stays hidden');
    assert.equal(await page.locator('.preview-surface [data-widget-id="weather"]').getAttribute('data-widget-size'), 'large');
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), bytes, 'opening the editor does not write');
    // The display gets its own context (#202): the editor page has already advanced its context's fake clock, so
    // installing and pausing that shared clock again at NOW raced it ("Cannot fast-forward to the past").
    const displayContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
    try {
      const display = await displayContext.newPage(); display.on('pageerror', error => errors.push(error.message));
      await display.clock.setFixedTime(new Date(NOW));
      await display.goto(base + '/display'); await display.locator('.display-page').waitFor();
      assert.equal(await display.locator('[data-widget-id="weather"]').count(), 1); assert.equal(await display.locator('[data-widget-id="rain"]').count(), 0);
      assert.equal(await display.locator('[data-widget-id="weather"] .weather-body').getAttribute('data-weather-mode'), 'elevated');
      assert.match(await display.locator('[data-widget-id="weather"] .rain-timing').innerText(), /^Rain likely/);
      shots.push({ group: 'states', name: 'migrated display', bytes: await display.screenshot() });
    } finally { await displayContext.close(); }
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), bytes, 'state.json bytes stay unchanged until a save');
    await page.getByRole('button', { name: 'Clock', exact: true }).click();
    await page.getByRole('button', { name: 'Digital', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('.studio-savebar').waitFor({ state: 'detached' });
    const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings;
    assert.equal(saved.widgets.rain, false); assert.equal(saved.widgets.weather, true); assert.deepEqual(saved.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
    assert.equal(saved.appearance.clockStyle, 'digital');
    return { checks: ['Migration: a pre-#74 state.json (both medium, revision 2) opens as one large Weather in the editor list and canvas with no Rain and no Save/Cancel; the display shows one Weather with rain detail; the file is unchanged until an unrelated Save, which writes rain:false'], shots };
  } finally { await context.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true }); }
}

/**
 * A saved device location before its first forecast (independent review of c99af30, #243): the settings
 * keep timezone 'auto' and, while the provider cannot be reached, the server reports that 'auto' in
 * weather.location with status unavailable. Formatting a date in 'auto' throws a RangeError, and with no
 * error boundary (#318) that blanked /display and /editor for good. Both widgets must say unavailable,
 * nothing may throw, the editor must render, and the display must show the forecast once it resolves.
 */
export async function unresolvedZoneCheck({ browser, clientDirectory, errors, capture }) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-weather-auto-zone-'));
  const settings = defaultSettings();
  settings.locationSource = 'device'; settings.location = { name: 'Device area', latitude: 43.7, longitude: -79.4, timezone: 'auto' };
  settings.appearance.motionEnabled = false;
  assert.ok(settings.widgets.weather && settings.widgets.forecast, 'the default board shows Weather and Forecast');
  await writeFile(join(directory, 'state.json'), JSON.stringify({ version: 1, settings, reminders: [] }, null, 2));
  let serverNow = NOW, offline = true, requests = 0;
  const fetcher = async () => { requests++; if (offline) throw new Error('Synthetic provider outage'); return Response.json(forecastFixture()); };
  const app = await createApplication({ dataDirectory: directory, clientDirectory, now: () => serverNow, fetcher });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const context = await browser.newContext({ viewport: VIEWPORTS[0], timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
  const shots = [], before = errors.length;
  try {
    // The real server state, not an injected one: the failing fetch leaves the device zone unresolved.
    const served = await (await fetch(`${base}/api/state`)).json();
    assert.equal(served.weather.status, 'unavailable'); assert.equal(served.weather.location.timezone, 'auto'); assert.ok(requests > 0, 'the server tried the provider');
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    // The automatic editor lookup must not prompt or change the draft: geolocation permission stays "prompt".
    await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
    await page.clock.install({ time: new Date(NOW) });
    await page.goto(base + '/editor'); await page.locator('.preview-surface').waitFor(); await page.clock.runFor(300);
    const canvas = page.locator('.preview-surface');
    assert.match(await canvas.locator('[data-widget-id="weather"]').innerText(), /Weather unavailable/, 'editor canvas: Weather unavailable');
    assert.match(await canvas.locator('[data-widget-id="forecast"]').innerText(), /Forecast unavailable/, 'editor canvas: Forecast unavailable');
    assert.ok(await page.getByRole('tab', { name: 'Widgets', exact: true }).isVisible(), 'the editor controls render');
    assert.equal(await page.locator('.studio-savebar').count(), 0, 'opening the editor changes nothing');
    await page.goto(base + '/display'); await page.locator('.display-page').waitFor();
    const weather = page.locator('[data-widget-id="weather"]'), forecast = page.locator('[data-widget-id="forecast"]');
    assert.match(await weather.innerText(), /Device area[\s\S]*Weather unavailable[\s\S]*Not updated yet/, 'display: Weather unavailable with its place and age');
    assert.match(await forecast.innerText(), /Forecast unavailable/, 'display: Forecast unavailable');
    assert.equal(await forecast.locator('.forecast-day').count(), 0, 'no invented day');
    if (capture) shots.push({ group: 'states', name: 'device zone unresolved', bytes: await page.screenshot() });
    assert.deepEqual(errors.slice(before), [], 'nothing throws while the zone is auto');
    // The provider returns after the one-minute retry back-off; two display polls later the city's zone is resolved.
    offline = false; serverNow = NOW + 61_000;
    await page.clock.runFor(61_000);
    await weather.locator('.current-temperature').waitFor();
    assert.equal(await forecast.locator('.forecast-day-label').first().textContent(), 'Today', 'the forecast starts at the resolved city\'s today');
    assert.ok(await forecast.locator('.forecast-day').count() > 0, 'the resolved forecast fills the strip');
    assert.match(await weather.locator('.weather-age').innerText(), /^Updated just now$/);
    assert.equal((await (await fetch(`${base}/api/state`)).json()).weather.location.timezone, 'America/Toronto', 'the forecast resolved the zone');
    if (capture) shots.push({ group: 'states', name: 'device zone resolved', bytes: await page.screenshot() });
    assert.deepEqual(errors.slice(before), [], 'nothing throws after the zone resolves');
    return { checks: ['Unresolved device zone: with location.timezone \'auto\' and status unavailable from a real failing provider, the editor canvas and display show Weather unavailable and Forecast unavailable with no page error and a rendered editor (no Save/Cancel); after the provider returns and two polls pass, the display shows the resolved forecast starting at Today (independent review of c99af30, #243)'], shots };
  } finally { await context.close(); await new Promise(done => app.server.close(done)); await rm(directory, { recursive: true, force: true }); }
}

/** Manual inspection only: one montage per group, written to the requested temporary folder. */
async function writeMontages(browser, folder, shots) {
  await mkdir(folder, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    for (const group of [...new Set(shots.map(shot => shot.group))]) {
      const tiles = shots.filter(shot => shot.group === group).map(shot => `<figure><img src="data:image/png;base64,${shot.bytes.toString('base64')}"><figcaption>${shot.name}</figcaption></figure>`).join('');
      await page.setContent(`<style>body{margin:0;background:#000;color:#888;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:10px;padding:10px;align-items:flex-start}figure{margin:0;outline:1px solid #222}img{display:block;max-width:${group === 'states' || group === 'editor' ? 760 : 500}px}</style>${tiles}`);
      await writeFile(join(folder, `weather-${group}.png`), await page.screenshot({ fullPage: true }));
    }
  } finally { await page.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' }, capture: { type: 'string' } } });
  const result = await runWeatherQa(values); console.log(JSON.stringify(result, null, 2));
}
