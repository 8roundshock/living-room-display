// Hourly forecast (#714; stored id `hourlyTemperature`): Forecast's strip with one column per hour and a
// column of its own for a sunrise or sunset. Synthetic weather only.
import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { prepareCollection } from '../lib/collection-fixture.mjs';
import { waitForWidgetFit } from '../lib/fit-readiness.mjs';

export const id = 'hourlyTemperature';
export const selectors = ['.hourly-heading', '.hourly-hour', '.hourly-temperature', '.hourly-rain', '.hourly-trend'];
export function prepare(state, options) { prepareCollection(state, options); }

const SLOTS = { medium: 6, large: 12 };
const SELECTOR = `[data-widget-id="${id}"]`;
const HOUR = 3_600_000;

/** What one render shows: columns, heading, trend geometry, fit and the status cue. */
function inspect(widget) {
  return widget.evaluate(section => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const opacity = node => { let value = 1; for (let at = node; at && at !== section.parentElement; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
    const text = node => node?.textContent.replace(/[  ]/g, ' ') ?? null;
    const strip = section.querySelector('.hourly-strip'), trend = section.querySelector('.hourly-trend'), status = section.querySelector('.hourly-status');
    const columns = [...section.querySelectorAll('.hourly-hour')].map(column => {
      const box = column.getBoundingClientRect(), value = column.querySelector('.hourly-temperature'), cell = value.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(value); const ink = range.getBoundingClientRect();
      return {
        kind: column.dataset.hourlyColumn, label: text(column.querySelector('.forecast-day-label')), value: text(value), chance: text(column.querySelector('.hourly-rain')),
        glyph: column.querySelector('.weather-glyph')?.dataset.glyph ?? null, sunGlyph: column.querySelector('svg.hourly-sun-glyph')?.dataset.glyph ?? null,
        unknown: column.querySelectorAll('.forecast-unknown').length, droplets: column.querySelectorAll('.hourly-rain svg').length,
        centre: box.left + box.width / 2, width: box.width, cellTop: cell.top, cellHeight: cell.height, valueBottom: ink.bottom,
      };
    });
    const line = trend?.getBoundingClientRect();
    return {
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      heading: text(section.querySelector('.hourly-heading .ambient-label')), facts: [...section.querySelectorAll('.hourly-fact')].map(text),
      status: status && { text: text(status), color: getComputedStyle(status).color, opacity: opacity(status) }, caution,
      columns, paths: [...section.querySelectorAll('.hourly-trend path')].map(path => path.getAttribute('d')),
      trend: line ? { left: line.left, right: line.right, top: line.top, bottom: line.bottom } : null,
      strip: strip ? (() => { const box = strip.getBoundingClientRect(); return { left: box.left, right: box.right }; })() : null,
      unavailable: text(section.querySelector('.forecast-unavailable-line')), innerText: section.innerText,
      interactive: section.querySelectorAll('button, input, a, select').length,
    };
  });
}

/** Every render: the strip's shared geometry and the rules that hold in any state. */
function assertStrip(m, label) {
  assert.equal(m.heading, 'Hourly', `${label}: the heading promises no hour count`);
  assert.equal(m.interactive, 0, `${label}: passive`);
  const widths = m.columns.map(column => column.width);
  assert.ok(Math.max(...widths) - Math.min(...widths) < 0.6, `${label}: every column has the same width`);
  assert.ok(new Set(m.columns.map(column => Math.round(column.cellHeight * 4))).size === 1 && new Set(m.columns.map(column => Math.round(column.cellTop * 4))).size === 1, `${label}: the temperature row has one height and one top for every column`);
  for (const column of m.columns) {
    if (column.kind === 'sunrise' || column.kind === 'sunset') {
      assert.match(column.label, /^\d{1,2}:\d{2}( [AP]M)?$/, `${label}: a sun column is labelled with its exact time`);
      assert.equal(column.value, column.kind === 'sunset' ? 'Sunset' : 'Sunrise', `${label}: the word takes the temperature's place`);
      assert.equal(column.sunGlyph, 'sun', `${label}: the sun symbol paints the sun's sub-tone`); assert.equal(column.glyph, null);
      assert.equal(column.chance, '', `${label}: no precipitation value in a sun column`); assert.equal(column.droplets, 0);
    } else {
      assert.match(column.value, /^(−?\d+°|—)$/, `${label}: a temperature or a dash, got ${column.value}`);
      assert.ok(column.glyph !== null || column.unknown === 1, `${label}: a WeatherGlyph or the unknown dash`);
      assert.match(column.chance, /^(|—|\d{2,3}%)$/, `${label}: a chance from 10%, a dash when unknown, or nothing`);
      assert.equal(column.droplets, /%$/.test(column.chance) ? 1 : 0, `${label}: the droplet shows only with a chance`);
    }
  }
  if (m.trend) {
    // The line runs from the first column's centre to the last one's, inside the temperature row, below every value.
    assert.ok(Math.abs(m.trend.left - m.columns[0].centre) < 1 && Math.abs(m.trend.right - m.columns.at(-1).centre) < 1, `${label}: the trend spans the column centres`);
    assert.ok(Math.abs(m.trend.bottom - (m.columns[0].cellTop + m.columns[0].cellHeight)) < 1, `${label}: the trend fills the bottom of the temperature row`);
    for (const path of m.paths) assert.doesNotMatch(path, /NaN|undefined/, `${label}: a drawable path`);
  }
}

export async function family({ widget, size, state }) {
  const m = await inspect(widget), label = `hourly ${size}`;
  assertStrip(m, label);
  assert.equal(m.columns.length, SLOTS[size], `${label}: the family's number of columns`);
  assert.equal(m.columns[0].kind, 'now'); assert.equal(m.columns[0].label, 'Now');
  // Fresh data shows no place, provider or update time (#715).
  assert.equal(m.status, null);
  assert.doesNotMatch(m.innerText, /Open-Meteo|Updated|ago\b|Saved/); assert.ok(!m.innerText.includes(state.weather.location.name), `${label}: no place name`);
  // The fixture is a Toronto morning in October (sunset about 6:28 PM): large reaches the sunset, medium names it in the heading.
  const suns = m.columns.filter(column => column.kind === 'sunset' || column.kind === 'sunrise');
  if (size === 'large') {
    assert.deepEqual(suns.map(column => column.kind), ['sunset']);
    const index = m.columns.indexOf(suns[0]);
    assert.equal(m.columns[index - 1].label, '6 PM'); assert.equal(m.columns[index + 1].label, '7 PM'); assert.match(suns[0].label, /^6:\d\d PM$/);
    assert.equal(m.columns[index - 1].glyph?.startsWith('moon'), false, 'the hour before sunset is a day glyph');
    assert.match(m.columns[index + 1].glyph, /^(moon|mooncloud|cloud)$/, 'the hour after sunset is a night glyph');
    assert.deepEqual(m.facts, [], 'the heading does not repeat the sunset the strip shows');
  } else {
    assert.deepEqual(suns, []); assert.equal(m.facts.length, 1); assert.match(m.facts[0], /^Sunset 6:\d\d PM$/);
  }
  assert.equal(m.paths.length, 1, `${label}: one unbroken trend line, through the sun column`);
  assert.ok(m.columns.every(column => column.chance === '' || column.chance === '60%'), `${label}: the fixture's 60% chance in every hour`);
}

export async function sweep({ page, viewport, state, base, now }) {
  // The route serves this very object, so every case edits it in place from a pristine copy.
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const widget = page.locator(SELECTOR);
  /** A clear, dry, calm spell: hourly instants and their intervals from the hour containing `at`. */
  const hours = (at, isDay) => {
    const start = Math.floor(at / HOUR) * HOUR, iso = index => new Date(start + index * HOUR).toISOString();
    state.weather.details = Array.from({ length: 25 }, (_, index) => ({ time: iso(index), weatherCode: 0, temperature: 22 - index * 0.7, humidity: 60, dewPoint: 8, pressure: 1012, visibility: 20000, cloudCover: 10, windSpeed: 9, windDirection: 270, windGust: 15 }));
    state.weather.hourly = Array.from({ length: 25 }, (_, index) => ({ intervalStart: iso(index), intervalEnd: iso(index + 1), precipitationProbability: 0, precipitationAmount: 0, rainAmount: 0 }));
    state.weather.updatedAt = new Date(at - 4 * 60_000).toISOString(); state.weather.current = { ...state.weather.current, time: new Date(at).toISOString(), temperature: 22, weatherCode: 0, isDay };
  };
  async function render({ size = 'large', density = 'balanced', at, isDay = false, setup }) {
    reset();
    state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.clockFormat = '24h';
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id]));
    state.settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
    hours(at, isDay); setup?.(state);
    await page.clock.setSystemTime(new Date(at));
    await page.goto(base + '/display'); await widget.waitFor(); await page.clock.runFor(100);
    await waitForWidgetFit(page, SELECTOR, { label: `hourly sweep ${size}/${density}` });
    return inspect(widget);
  }
  let renders = 0;
  try {
    // A summer evening in Toronto (21 June: sunset about 21:02, sunrise about 05:36): both events are columns.
    const summer = Date.parse('2026-06-22T00:10:00Z');
    const viewports = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
    for (const size of viewports) {
      await page.setViewportSize(size);
      for (const density of Object.keys(GRID_DENSITIES)) for (const family of ['medium', 'large']) {
        const label = `${size.width} ${family}/${density} summer night`;
        const m = await render({ size: family, density, at: summer, isDay: true }); renders++;
        assertStrip(m, label);
        assert.ok(m.fit >= 0.995, `${label}: fit 1 at Text 100% with sun columns, got ${m.fit}`);
        assert.equal(m.columns.length, SLOTS[family], `${label}: sun columns take slots, the strip keeps its length`);
        assert.deepEqual(m.columns.map(column => column.kind), family === 'large'
          ? ['now', 'hour', 'sunset', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'sunrise']
          : ['now', 'hour', 'sunset', 'hour', 'hour', 'hour'], label);
        assert.match(m.columns[2].label, /^21:0\d$/, `${label}: the sunset's exact time on the 24-hour clock`);
        assert.equal(m.columns[1].glyph, 'sun'); assert.equal(m.columns[3].glyph, 'moon', `${label}: glyphs switch from day to night around the sunset`);
        assert.deepEqual(m.facts, [], `${label}: no sun fact while the strip shows the next event`);
        assert.equal(m.paths.length, 1, `${label}: the line passes through the sunset column`);
      }
    }
    await page.setViewportSize(viewport);
    // The line ends at the last hour: a sunrise in the final column has no point of its own.
    const both = await render({ at: summer, isDay: true }); renders++;
    assert.match(both.paths[0], / 90\.91,[\d.]+$/, 'the trend stops at the eleventh column');
    assert.match(both.columns[11].label, /^05:3\d$/);
    // On the 24-hour clock the hours are bare and only the sun columns show minutes.
    assert.deepEqual(both.columns.filter(column => column.kind === 'hour').map(column => column.label), ['21', '22', '23', '00', '01', '02', '03', '04', '05']);

    // Twelve-hour labels: the hour columns are compact, the sun column keeps its minutes.
    const twelve = await render({ at: summer, isDay: true, setup: () => { state.settings.clockFormat = '12h'; } }); renders++;
    assert.deepEqual([twelve.columns[0].label, twelve.columns[1].label, twelve.columns[3].label], ['Now', '9 PM', '10 PM']);
    assert.match(twelve.columns[2].label, /^9:0\d PM$/); assert.ok(twelve.fit >= 0.995);

    // After sunset the next event is beyond the strip, so the heading names it; notable gusts join it.
    const evening = Date.parse('2026-11-22T23:20:00Z');
    const windy = await render({ at: evening, setup: () => { state.weather.details[5].windGust = 54.6; } }); renders++;
    assertStrip(windy, 'winter evening');
    assert.ok(windy.columns.every(column => column.kind === 'now' || column.kind === 'hour'), 'no sun column in a winter night');
    assert.equal(windy.facts.length, 2); assert.match(windy.facts[0], /^Sunrise 07:2\d$/); assert.equal(windy.facts[1], ' · Gusts 55 km/h');
    assert.ok(windy.columns.slice(1).every(column => column.glyph === 'moon'), 'clear night hours draw the moon');
    assert.ok(windy.columns.every(column => column.chance === ''), 'a dry stretch shows no droplet or chance at all');
    const calm = await render({ at: evening, setup: () => { state.weather.details[5].windGust = 39; } }); renders++;
    assert.equal(calm.facts.length, 1, 'gusts under 40 km/h are not named');

    // A chance shows from 10%; below it the cell is empty; unknown is a dash.
    const chances = await render({ at: evening, setup: () => { [9, 10, 100].forEach((value, index) => { state.weather.hourly[index + 1].precipitationProbability = value; }); state.weather.hourly[4].precipitationProbability = null; } }); renders++;
    assert.deepEqual(chances.columns.slice(1, 5).map(column => column.chance), ['', '10%', '100%', '—']);
    assert.ok(chances.fit >= 0.995);

    // Unknown values: a dash where the temperature is unknown, the line broken around it, never joined across.
    const gaps = await render({ at: evening, setup: () => { state.weather.details[4].temperature = null; state.weather.details[7].weatherCode = null; state.weather.details.splice(9, 1); } }); renders++;
    assertStrip(gaps, 'unknown values');
    assert.equal(gaps.columns[4].value, '—'); assert.equal(gaps.columns[7].unknown, 1, 'an unknown condition is a dash, not an invented glyph');
    assert.deepEqual([gaps.columns[9].value, gaps.columns[9].unknown], ['—', 1], 'an hour the forecast lacks keeps its column with unknown values');
    assert.equal(gaps.paths.length, 3, 'three runs of known temperatures');
    assert.ok(gaps.fit >= 0.995);

    // Saved for five hours: the status takes the heading's right side in the caution tone, and no column is called Now.
    for (const density of Object.keys(GRID_DENSITIES)) for (const family of ['medium', 'large']) {
      const stale = await render({ size: family, density, at: evening, setup: () => { state.weather.status = 'stale'; state.weather.updatedAt = new Date(evening - 5 * HOUR).toISOString(); } }); renders++;
      const label = `stale ${family}/${density}`;
      assert.equal(stale.status.text, 'Saved forecast · 5 hr ago', label); assert.equal(stale.status.color, stale.caution, `${label}: the caution tone`); assert.equal(stale.status.opacity, 1, `${label}: at full opacity`);
      assert.deepEqual(stale.facts, [], `${label}: the status replaces the facts`);
      assert.equal(stale.columns[0].kind, 'hour', `${label}: an hours-old reading is never called Now`); assert.equal(stale.columns[0].label, '19');
      assert.equal(stale.columns.length, SLOTS[family]); assert.ok(stale.fit >= 0.995, `${label}: fit ${stale.fit}`);
    }

    // Nothing to show: Forecast's unavailable treatment, with no strip.
    const gone = await render({ at: evening, setup: () => { state.weather = { ...state.weather, status: 'unavailable', current: null, daily: [], hourly: [], details: [], updatedAt: null }; } }); renders++;
    assert.equal(gone.unavailable, 'Hourly forecast unavailable · retrying'); assert.equal(gone.columns.length, 0); assert.equal(gone.heading, 'Hourly'); assert.ok(gone.fit >= 0.995);
  } finally { await page.clock.setSystemTime(new Date(now)); await page.setViewportSize(viewport); reset(); }
  assert.ok(renders > 0);
  return `Hourly forecast (#714): sunset and sunrise as their own columns on a summer night with the strip's length unchanged, at fit 1 in both families and every density at 720p/1080p/4K; day and night glyphs around the sunset; the trend through a sun column and broken only at unknown values; chances from 10%; the next sun event and notable gusts in the heading only when the strip does not show them; “Saved forecast · 5 hr ago” in the caution tone without a Now column; the unavailable state`;
}
