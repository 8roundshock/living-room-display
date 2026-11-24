// Hourly forecast (#714; stored id `hourlyTemperature`): Forecast's strip with one column per hour and a
// column of its own for a sunrise or sunset. Synthetic weather only.
import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { prepareCollection } from '../lib/collection-fixture.mjs';
import { waitForWidgetFit } from '../lib/fit-readiness.mjs';
import { withOwnClock } from '../lib/own-clock.mjs';

export const id = 'hourlyTemperature';
export const selectors = ['.hourly-heading', '.hourly-hour', '.hourly-temperature', '.hourly-rain', '.hourly-trend', '.forecast-status-line'];
export function prepare(state, options) { prepareCollection(state, options); }

const SLOTS = { medium: 6, large: 12 };
const SELECTOR = `[data-widget-id="${id}"]`;
const HOUR = 3_600_000, MINUTE = 60_000, DAY = 24 * HOUR;

/**
 * One strip's shared geometry, in layout pixels (the fit's scale taken out): the sizes widgets.css defines once for
 * Forecast and Hourly forecast (#720), the heading's height and the distances between the rows' tops.
 */
function stripOf(section) {
  const px = (node, property) => parseFloat(getComputedStyle(node)[property]);
  const content = section.querySelector('.widget-content'), scale = new DOMMatrix(getComputedStyle(content).transform).a || 1;
  const heading = section.querySelector('.forecast-heading'), day = section.querySelector('.forecast-day'), strip = section.querySelector('.forecast-strip');
  const label = day.querySelector('.forecast-day-label'), glyph = day.querySelector(':scope > :is(.weather-glyph, .forecast-unknown, .hourly-sun-glyph)'), value = day.querySelector('.forecast-temperatures, .hourly-temperature'), rain = section.querySelector('.forecast-rain');
  const droplet = section.querySelector('.forecast-rain svg');
  const top = node => (node.getBoundingClientRect().top - content.getBoundingClientRect().top) / scale;
  return {
    fit: scale, headingLabel: px(heading.querySelector('.ambient-label'), 'fontSize'), headingSlot: px(heading.querySelector('.weather-context'), 'fontSize'),
    headingHeight: heading.getBoundingClientRect().height / scale, headingGap: px(heading, 'marginBottom'),
    label: px(label, 'fontSize'), glyph: px(glyph, 'width'), value: px(value, 'fontSize'), chance: px(rain, 'fontSize'), chanceLine: px(rain, 'lineHeight'),
    droplet: droplet ? px(droplet, 'width') : null, dropletGap: droplet ? px(droplet.parentElement, 'columnGap') : null, rowGap: px(day, 'rowGap'),
    rhythm: [top(glyph) - top(label), top(value) - top(glyph)], stripTop: top(strip), stripHeight: strip.getBoundingClientRect().height / scale,
    status: section.querySelector('.forecast-status-line')?.textContent.replace(/\s+/g, ' ') ?? null,
  };
}

/** What one render shows: columns, heading, its right slot and status, trend geometry, fit and the status cue. */
function inspect(widget) {
  return widget.evaluate((section, stripSource) => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const opacity = node => { let value = 1; for (let at = node; at && at !== section.parentElement; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
    const text = node => node?.textContent.replace(/[  ]/g, ' ') ?? null;
    // The lines a node's text takes: its line boxes, counted as tops more than 2px apart (as Forecast's check counts them).
    const lines = node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const tops = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.top).sort((a, b) => a - b);
      return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 2).length;
    };
    const cue = node => node && { text: text(node), color: getComputedStyle(node).color, opacity: opacity(node), lines: lines(node) };
    const strip = section.querySelector('.hourly-strip'), trend = section.querySelector('.hourly-trend');
    const heading = section.querySelector('.hourly-heading'), slot = heading.querySelector('.weather-context'), line = heading.querySelector('.forecast-status-line');
    const columns = [...section.querySelectorAll('.hourly-hour')].map(column => {
      const box = column.getBoundingClientRect(), value = column.querySelector('.hourly-temperature'), cell = value.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(value); const ink = range.getBoundingClientRect();
      return {
        kind: column.dataset.hourlyColumn, label: text(column.querySelector('.forecast-day-label')), value: text(value), chance: text(column.querySelector('.hourly-rain')),
        glyph: column.querySelector('.weather-glyph')?.dataset.glyph ?? null, sunGlyph: column.querySelector('svg.hourly-sun-glyph')?.dataset.glyph ?? null,
        unknown: column.querySelectorAll('.forecast-unknown').length, droplets: column.querySelectorAll('.hourly-rain svg').length,
        centre: box.left + box.width / 2, width: box.width, cellTop: cell.top, cellHeight: cell.height, valueBottom: ink.bottom,
        // How far the value's text reaches past its column on either side (a sun word must stay inside).
        spill: Math.max(box.left - ink.left, ink.right - box.right),
      };
    });
    const trendBox = trend?.getBoundingClientRect();
    return {
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      heading: text(heading.querySelector('.ambient-label')), labelLines: lines(heading.querySelector('.ambient-label')), facts: [...section.querySelectorAll('.hourly-fact')].map(text),
      slot: slot && { text: text(slot), size: parseFloat(getComputedStyle(slot).fontSize), lines: lines(slot) }, headingChildren: heading.children.length,
      status: line && { ...cue(line), isSlot: line === slot, shared: line.classList.contains('status-caution'), label: cue(line.querySelector('.forecast-status')), age: cue(line.querySelector('.forecast-age')) },
      caution, columns, paths: [...section.querySelectorAll('.hourly-trend path')].map(path => path.getAttribute('d')),
      trend: trendBox ? { left: trendBox.left, right: trendBox.right, top: trendBox.top, bottom: trendBox.bottom } : null,
      strip: strip ? (() => { const box = strip.getBoundingClientRect(); return { left: box.left, right: box.right }; })() : null,
      geometry: strip ? new Function(`return (${stripSource})`)()(section) : null,
      unavailable: text(section.querySelector('.forecast-unavailable-line')), unavailableAge: cue(section.querySelector('.forecast-unavailable-age')),
      innerText: section.innerText, interactive: section.querySelectorAll('button, input, a, select').length,
    };
  }, stripOf.toString());
}

/** Every render: the strip's shared geometry and the rules that hold in any state. */
function assertStrip(m, label) {
  assert.equal(m.heading, 'Hourly', `${label}: the heading promises no hour count`);
  assert.equal(m.interactive, 0, `${label}: passive`);
  assert.equal(m.headingChildren, 2, `${label}: the heading always has its right slot, so it keeps one height`);
  const widths = m.columns.map(column => column.width);
  assert.ok(Math.max(...widths) - Math.min(...widths) < 0.6, `${label}: every column has the same width`);
  assert.ok(new Set(m.columns.map(column => Math.round(column.cellHeight * 4))).size === 1 && new Set(m.columns.map(column => Math.round(column.cellTop * 4))).size === 1, `${label}: the temperature row has one height and one top for every column`);
  for (const column of m.columns) {
    if (column.kind === 'sunrise' || column.kind === 'sunset') {
      assert.match(column.label, /^\d{1,2}:\d{2}( [AP]M)?$/, `${label}: a sun column is labelled with its exact time`);
      assert.equal(column.value, column.kind === 'sunset' ? 'Sunset' : 'Sunrise', `${label}: the word takes the temperature's place`);
      assert.ok(column.spill <= 0.5, `${label}: "${column.value}" stays inside its column (${column.spill.toFixed(1)} px past it)`);
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

/** The same strip as another render: heading height, strip position and size, and every shared size. */
function assertSameStrip(m, base, label) {
  const a = m.geometry, b = base.geometry;
  assert.ok(Math.abs(a.headingHeight - b.headingHeight) <= 0.5, `${label}: the heading keeps its height ${JSON.stringify([a.headingHeight, b.headingHeight])}`);
  assert.ok(Math.abs(a.stripTop - b.stripTop) <= 0.5 && Math.abs(a.stripHeight - b.stripHeight) <= 0.5, `${label}: the strip keeps its size and position ${JSON.stringify([[a.stripTop, a.stripHeight], [b.stripTop, b.stripHeight]])}`);
  assert.equal(m.slot.size, base.slot.size, `${label}: the slot's text size is the same in every state`);
}

/** #720: Forecast's and Hourly forecast's strips of one family share every size, the heading and the rows' rhythm. */
function assertOneFamily(forecast, hourly, label) {
  for (const key of ['headingLabel', 'headingSlot', 'headingGap', 'label', 'glyph', 'value', 'chance', 'chanceLine', 'droplet', 'dropletGap', 'rowGap']) {
    assert.ok(typeof forecast[key] === 'number' && typeof hourly[key] === 'number' && Math.abs(forecast[key] - hourly[key]) <= 0.02, `${label}: Forecast's and Hourly forecast's ${key} differ ${JSON.stringify([forecast[key], hourly[key]])}`);
  }
  assert.ok(Math.abs(forecast.headingHeight - hourly.headingHeight) <= 0.5, `${label}: one heading height ${JSON.stringify([forecast.headingHeight, hourly.headingHeight])}`);
  for (const index of [0, 1]) assert.ok(Math.abs(forecast.rhythm[index] - hourly.rhythm[index]) <= 0.5, `${label}: one rhythm from label to glyph to value ${JSON.stringify([forecast.rhythm, hourly.rhythm])}`);
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
    // The fixture's 6 PM is clear and its 7 PM partly cloudy, so each glyph names the sky: the sun before the sunset, the moon after it.
    assert.equal(m.columns[index - 1].glyph, 'sun', 'the hour before sunset draws the day glyph');
    assert.equal(m.columns[index + 1].glyph, 'mooncloud', 'the hour after sunset draws the night glyph');
    assert.deepEqual(m.facts, [], 'the heading does not repeat the sunset the strip shows');
  } else {
    assert.deepEqual(suns, []); assert.equal(m.facts.length, 1); assert.match(m.facts[0], /^Sunset 6:\d\d PM$/);
  }
  assert.equal(m.paths.length, 1, `${label}: one unbroken trend line, through the sun column`);
  assert.ok(m.columns.every(column => column.chance === '' || column.chance === '60%'), `${label}: the fixture's 60% chance in every hour`);
}

/** Independent display contract for an age: minutes below an hour, then whole hours and days. */
function elapsed(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * Every render here is on a page with a paused clock of its own (tests/ui/lib/own-clock.mjs, #741): the cases are set
 * at instants of their own (a summer night, a winter evening), the offline ones run the 30 s state poll, and the live
 * case runs three polls, none of which may move the suite's shared page clock.
 */
export async function sweep({ page, viewport, state, base, now }) {
  // The route serves this very object, so every case edits it in place from a pristine copy.
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const zone = pristine.weather.location.timezone;
  /** A clear, dry, calm spell: hourly instants and their intervals from the hour containing `at`, and a mild week from its civil date. */
  const hours = (at, isDay) => {
    const start = Math.floor(at / HOUR) * HOUR, iso = index => new Date(start + index * HOUR).toISOString();
    state.weather.details = Array.from({ length: 25 }, (_, index) => ({ time: iso(index), weatherCode: 0, temperature: 22 - index * 0.7, humidity: 60, dewPoint: 8, pressure: 1012, visibility: 20000, cloudCover: 10, windSpeed: 9, windDirection: 270, windGust: 15 }));
    state.weather.hourly = Array.from({ length: 25 }, (_, index) => ({ intervalStart: iso(index), intervalEnd: iso(index + 1), precipitationProbability: 0, precipitationAmount: 0, rainAmount: 0 }));
    state.weather.daily = Array.from({ length: 7 }, (_, index) => ({ date: new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at + index * DAY)), weatherCode: [0, 2, 3, 61, 2, 1, 0][index], temperatureMax: 9 - index, temperatureMin: 1 - index, precipitationProbability: [0, 10, 30, 70, 20, 10, 0][index], precipitationAmount: 0 }));
    state.weather.updatedAt = new Date(at - 4 * MINUTE).toISOString(); state.weather.current = { ...state.weather.current, time: new Date(at).toISOString(), temperature: 22, weatherCode: 0, isDay };
  };
  const failed = 'Weather update failed. Showing the last successful forecast.';
  /**
   * The states both strips present (#715): `refreshing` is what the server answers while a due refresh takes over a
   * second (#351), still fresh on the display; `retrying` is a later attempt after a failed one; `unknown` is dated
   * ten minutes ahead of the clock, so no age can be told (#244); `offlineLong` has the longest age wording.
   */
  const WEATHER = {
    fresh: () => {},
    stale: at => Object.assign(state.weather, { status: 'stale', updatedAt: new Date(at - 5 * HOUR).toISOString() }),
    offline: () => {},
    refreshing: at => Object.assign(state.weather, { status: 'stale', updatedAt: new Date(at - 16 * MINUTE).toISOString(), error: null, refreshing: true }),
    retrying: at => Object.assign(state.weather, { status: 'stale', updatedAt: new Date(at - 5 * HOUR).toISOString(), error: failed, refreshing: true }),
    unknown: at => Object.assign(state.weather, { status: 'stale', updatedAt: new Date(at + 10 * MINUTE).toISOString() }),
    offlineUnknown: at => Object.assign(state.weather, { updatedAt: new Date(at + 10 * MINUTE).toISOString() }),
    offlineLong: at => Object.assign(state.weather, { updatedAt: new Date(at - 364 * DAY).toISOString() }),
  };
  const OFFLINE = new Set(['offline', 'offlineUnknown', 'offlineLong']);
  /** The exact words in the heading's right slot, Forecast's in medium and large; null for none. The offline poll ends 31.1 s after `at`. */
  const WORDS = {
    fresh: () => null, refreshing: () => null,
    stale: () => 'Saved forecast · 5 hr ago', retrying: () => 'Saved forecast · 5 hr ago',
    offline: at => `Offline · Updated ${elapsed(Math.floor((at + 31_100 - (at - 4 * MINUTE)) / MINUTE))}`,
    unknown: () => 'Saved forecast · Update time unknown', offlineUnknown: () => 'Offline · Update time unknown',
    offlineLong: () => 'Offline · Updated 364 days ago',
  };
  const plain = text => text?.replace(/\s+/g, ' ') ?? null;
  let renders = 0;
  try {
    await withOwnClock(page, { viewport, state, now }, async (own, clock) => {
      const widget = own.locator(SELECTOR);
      /** One render at `at`, Hourly forecast alone at the top-left or, with `pair`, under a Forecast of the same family. */
      async function render({ size = 'large', density = 'balanced', at, isDay = false, setup, status = 'fresh', pair = false }) {
        reset();
        state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.clockFormat = '24h';
        state.settings.widgetGrid.density = density;
        state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === id || (pair && key === 'forecast')]));
        state.settings.widgetGrid.placements[id] = { column: 0, row: pair ? 2 : 0, size };
        if (pair) state.settings.widgetGrid.placements.forecast = { column: 0, row: 0, size };
        hours(at, isDay); setup?.(state); WEATHER[status](at);
        await own.clock.setSystemTime(new Date(at));
        await own.goto(base + '/display'); await widget.waitFor(); await own.clock.runFor(100);
        if (OFFLINE.has(status)) {
          clock.setOffline(true);
          try { await own.clock.runFor(31_000); await widget.locator('.forecast-status', { hasText: 'Offline' }).waitFor(); }
          finally { clock.setOffline(false); }
        }
        await waitForWidgetFit(own, SELECTOR, { label: `hourly sweep ${size}/${density}/${status}` });
        if (pair) await waitForWidgetFit(own, '[data-widget-id="forecast"]', { label: `forecast beside hourly ${size}/${density}/${status}` });
        renders++;
        const m = await inspect(widget);
        if (pair) m.forecast = await own.locator('[data-widget-id="forecast"]').evaluate((section, source) => new Function(`return (${source})`)()(section), stripOf.toString());
        return m;
      }
      // A summer evening in Toronto (21 June: sunset about 21:02, sunrise about 05:36): both events are columns.
      const summer = Date.parse('2026-06-22T00:10:00Z');
      const views = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
      for (const view of views) {
        await own.setViewportSize(view);
        for (const density of Object.keys(GRID_DENSITIES)) for (const family of ['medium', 'large']) {
          const label = `${view.width} ${family}/${density} summer night`;
          const m = await render({ size: family, density, at: summer, isDay: true });
          assertStrip(m, label);
          assert.ok(m.fit >= 0.995, `${label}: fit 1 at Text 100% with sun columns, got ${m.fit}`);
          assert.equal(m.columns.length, SLOTS[family], `${label}: sun columns take slots, the strip keeps its length`);
          assert.deepEqual(m.columns.map(column => column.kind), family === 'large'
            ? ['now', 'hour', 'sunset', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'hour', 'sunrise']
            : ['now', 'hour', 'sunset', 'hour', 'hour', 'hour'], label);
          assert.match(m.columns[2].label, /^21:0\d$/, `${label}: the sunset's exact time on the 24-hour clock`);
          assert.equal(m.columns[1].glyph, 'sun'); assert.equal(m.columns[3].glyph, 'moon', `${label}: glyphs switch from day to night around the sunset`);
          assert.deepEqual(m.facts, [], `${label}: no sun fact while the strip shows the next event`);
          assert.equal(m.slot.text, ' ', `${label}: an empty right slot holds its line`);
          assert.equal(m.paths.length, 1, `${label}: the line passes through the sunset column`);
          // In the Monospace typeface "Sunrise" is widest; it still stays inside its column (assertStrip).
          const mono = await render({ size: family, density, at: summer, isDay: true, setup: () => { state.settings.appearance.fontFamily = 'mono'; } });
          assertStrip(mono, `${label} Monospace`); assert.ok(mono.fit >= 0.995, `${label} Monospace: fit ${mono.fit}`);
        }
      }
      await own.setViewportSize(viewport);
      // The line ends at the last hour: a sunrise in the final column has no point of its own.
      const both = await render({ at: summer, isDay: true });
      assert.match(both.paths[0], / 90\.91,[\d.]+$/, 'the trend stops at the eleventh column');
      assert.match(both.columns[11].label, /^05:3\d$/);
      // On the 24-hour clock the hours are bare and only the sun columns show minutes.
      assert.deepEqual(both.columns.filter(column => column.kind === 'hour').map(column => column.label), ['21', '22', '23', '00', '01', '02', '03', '04', '05']);

      // Twelve-hour labels: the hour columns are compact, the sun column keeps its minutes.
      const twelve = await render({ at: summer, isDay: true, setup: () => { state.settings.clockFormat = '12h'; } });
      assert.deepEqual([twelve.columns[0].label, twelve.columns[1].label, twelve.columns[3].label], ['Now', '9 PM', '10 PM']);
      assert.match(twelve.columns[2].label, /^9:0\d PM$/); assert.ok(twelve.fit >= 0.995);

      // After sunset the next event is beyond the strip, so the heading names it; notable gusts join it.
      const evening = Date.parse('2026-11-22T23:20:00Z');
      const windy = await render({ at: evening, setup: () => { state.weather.details[5].windGust = 54.6; } });
      assertStrip(windy, 'winter evening');
      assert.ok(windy.columns.every(column => column.kind === 'now' || column.kind === 'hour'), 'no sun column in a winter night');
      assert.equal(windy.facts.length, 2); assert.match(windy.facts[0], /^Sunrise 07:2\d$/); assert.equal(windy.facts[1], ' · Gusts 55 km/h');
      assert.ok(windy.columns.slice(1).every(column => column.glyph === 'moon'), 'clear night hours draw the moon');
      assert.ok(windy.columns.every(column => column.chance === ''), 'a dry stretch shows no droplet or chance at all');
      const calm = await render({ at: evening, setup: () => { state.weather.details[5].windGust = 39; } });
      assert.equal(calm.facts.length, 1, 'gusts under 40 km/h are not named');
      assertSameStrip(windy, calm, 'one fact or two');

      // A chance shows from 10%; below it the cell is empty; unknown is a dash.
      const chances = await render({ at: evening, setup: () => { [9, 10, 100].forEach((value, index) => { state.weather.hourly[index + 1].precipitationProbability = value; }); state.weather.hourly[4].precipitationProbability = null; } });
      assert.deepEqual(chances.columns.slice(1, 5).map(column => column.chance), ['', '10%', '100%', '—']);
      assert.ok(chances.fit >= 0.995);

      // Unknown values: a dash where the temperature is unknown, the line broken around it, never joined across.
      const gaps = await render({ at: evening, setup: () => { state.weather.details[4].temperature = null; state.weather.details[7].weatherCode = null; state.weather.details.splice(9, 1); } });
      assertStrip(gaps, 'unknown values');
      assert.equal(gaps.columns[4].value, '—'); assert.equal(gaps.columns[7].unknown, 1, 'an unknown condition is a dash, not an invented glyph');
      assert.deepEqual([gaps.columns[9].value, gaps.columns[9].unknown], ['—', 1], 'an hour the forecast lacks keeps its column with unknown values');
      assert.equal(gaps.paths.length, 3, 'three runs of known temperatures');
      assert.ok(gaps.fit >= 0.995);

      // Every state, with a Forecast of the same family above (the board the owner stacks, #714), in every family and
      // density at the owner's 720p as well (#721, #715, #720):
      // - the status is Forecast's, word for word, in the heading's right slot, whole in the caution tone at full
      //   opacity; a refresh in flight shows none on either strip (presentedStatus);
      // - the slot stays one line up to the longest wording, so the heading keeps the fresh height and the strip
      //   its size and position: nothing moves when a status comes or goes;
      // - an hours-old reading is never called Now;
      // - the two strips share every size, the heading and the rows' rhythm (#720), all at fit 1 at Text 100%.
      for (const view of views) {
        await own.setViewportSize(view);
        for (const density of Object.keys(GRID_DENSITIES)) for (const family of ['medium', 'large']) {
          let fresh = null;
          for (const status of ['fresh', 'stale', 'offline', 'refreshing', 'retrying', 'unknown', 'offlineUnknown', 'offlineLong']) {
            const label = `${view.width} ${family}/${density}/${status}`;
            // One hour with a 30% chance, so both strips draw a droplet to compare.
            const m = await render({ size: family, density, at: evening, status, pair: true, setup: () => { state.weather.hourly[3].precipitationProbability = 30; } });
            fresh ??= m;
            assertStrip(m, label);
            assert.ok(m.fit >= 0.995 && m.forecast.fit >= 0.995, `${label}: both strips at fit 1 at Text 100% ${JSON.stringify([m.fit, m.forecast.fit])}`);
            assert.equal(m.columns.length, SLOTS[family], label);
            assert.equal(m.labelLines, 1, `${label}: the heading label keeps its line`);
            assertOneFamily(m.forecast, m.geometry, label);
            const words = WORDS[status](evening);
            assert.equal(plain(m.status?.text), words, `${label}: the exact words`);
            assert.equal(plain(m.forecast.status), words, `${label}: the same words as the Forecast above it`);
            if (words) {
              assert.deepEqual([m.status.isSlot, m.status.shared], [true, true], `${label}: the status is the heading's right slot, with the shared status class`);
              for (const [name, part] of [['line', m.status], ['label', m.status.label], ['age', m.status.age]]) {
                assert.equal(part.color, m.caution, `${label}: ${name} in the caution tone`); assert.equal(part.opacity, 1, `${label}: ${name} at full opacity`);
              }
              assert.deepEqual([m.status.label.lines, m.status.age.lines, m.slot.lines], [1, 1, 1], `${label}: "${m.status.text}" stays on one line, unbroken`);
              assert.deepEqual(m.facts, [], `${label}: the status replaces the facts`);
            } else assert.deepEqual([m.status, m.facts.length], [null, 1], `${label}: no status, and the next sunrise in the slot`);
            // An hours-old reading (five hours, or a year) is never called Now; an unknown age is not hours old.
            assert.equal(m.columns[0].kind, ['stale', 'retrying', 'offlineLong'].includes(status) ? 'hour' : 'now', `${label}: Now only for a current reading`);
            assertSameStrip(m, fresh, label);
          }
        }
      }
      await own.setViewportSize(viewport);

      // Live: a display that is already open gains and loses the status on its 30 s poll without the strip moving or
      // resizing, and a refresh in flight shows none, in both families.
      for (const family of ['medium', 'large']) {
        const label = `${viewport.width} ${family} live`;
        const before = await render({ size: family, at: evening });
        WEATHER.refreshing(evening);
        await own.clock.runFor(30_500);
        const during = await inspect(widget);
        assert.equal(during.status, null, `${label}: a refresh in flight shows no status`);
        assertSameStrip(during, before, `${label} refreshing`);
        Object.assign(state.weather, { error: failed }); delete state.weather.refreshing;
        await own.clock.runFor(30_500);
        await widget.locator('.forecast-status-line').waitFor();
        const saved = await inspect(widget);
        assert.match(plain(saved.status.text), /^Saved forecast · 1[67] min ago$/, `${label}: the failed refresh reads as saved`);
        assertSameStrip(saved, before, `${label} saved`); assert.equal(saved.fit, before.fit, `${label}: no refit`);
        hours(evening, false); Object.assign(state.weather, { status: 'fresh', error: null, updatedAt: new Date(evening + 60 * 1000).toISOString() });
        await own.clock.runFor(30_500);
        await widget.locator('.forecast-status-line').waitFor({ state: 'detached' });
        const after = await inspect(widget);
        assert.equal(after.facts.length, 1, `${label}: the facts return`);
        assertSameStrip(after, before, `${label} fresh again`);
      }

      // Nothing to show: Forecast's unavailable treatment, with no strip; a saved forecast whose hours have all passed
      // keeps its age, in the status tone, as Forecast's does.
      const gone = await render({ at: evening, setup: () => { state.weather = { ...state.weather, status: 'unavailable', current: null, daily: [], hourly: [], details: [], updatedAt: null }; } });
      assert.equal(gone.unavailable, 'Hourly forecast unavailable · retrying'); assert.equal(gone.columns.length, 0); assert.equal(gone.heading, 'Hourly'); assert.ok(gone.fit >= 0.995);
      assert.equal(gone.unavailableAge, null, 'no age without an update time');
      const passed = await render({ at: evening, setup: () => { state.weather.status = 'stale'; state.weather.updatedAt = new Date(evening - 2 * DAY).toISOString(); state.weather.details = state.weather.details.map(reading => ({ ...reading, time: new Date(Date.parse(reading.time) - 2 * DAY).toISOString() })); } });
      assert.equal(passed.unavailable, 'Hourly forecast unavailable · retrying'); assert.equal(passed.columns.length, 0);
      assert.deepEqual([passed.unavailableAge?.text, passed.unavailableAge?.color === passed.caution], ['Updated 2 days ago', true], 'the age of a saved forecast whose hours have passed, in the status tone');
    });
  } finally { reset(); }
  assert.ok(renders > 0);
  return `Hourly forecast (#714): sunset and sunrise as their own columns on a summer night with the strip's length unchanged, at fit 1 in both families and every density at 720p/1080p/4K, "Sunrise" inside its column in every typeface; day and night glyphs around the sunset; the trend through a sun column and broken only at unknown values; chances from 10%; the next sun event and notable gusts in the heading only when the strip does not show them; under a Forecast of the same family in every state (fresh, saved, offline, a refresh in flight, a failed retry, no update time to tell, the longest age), both families and every density at 720p/1080p/4K: Forecast's status word for word in the heading's right slot in the caution tone, on one line, with one heading height and one strip size and position, no Now from an hours-old reading, and the same sizes, heading and rhythm as the Forecast (#715, #720); the status arriving and leaving on a live poll without a resize; the unavailable state, with the age of a forecast whose hours have passed; all on a clock of its own (#741)`;
}
