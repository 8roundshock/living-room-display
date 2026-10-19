import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { intlPerTicks } from './clock.mjs';

export const id = 'airQuality';
export const selectors = ['.air-context', '.air-age', '.air-credit', '.air-details', '.air-hours', '.air-uv-peak', '.air-hourly-missing', '.air-bars', '.air-qualifier'];
const HOUR = 3600_000;

/** What the widget's clock helpers print for an instant: "9:00 AM" (bar labels) or "1 PM" (UV peak). */
function label(at, timeZone, options) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, hour12: true, ...options }).formatToParts(new Date(at));
  return `${parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim()} ${parts.find(part => part.type === 'dayPeriod').value}`;
}

/** A synthetic fresh US reading with one unknown hour. */
export function airQualityFixture(now, location) {
  const hour = now - now % 3600_000;
  return {
    status: 'fresh', updatedAt: new Date(now - 12 * 60_000).toISOString(), error: null, source: 'CAMS via Open-Meteo', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    location: structuredClone(location), scale: 'us',
    current: { time: new Date(hour).toISOString(), aqi: 42, dominant: 'pm2_5', pm2_5: 12.2, pm10: 18, uvIndex: 3 },
    hourly: Array.from({ length: 24 }, (_, index) => ({ time: new Date(hour + index * 3600_000).toISOString(), aqi: index === 5 ? null : 40 + (index % 6), uvIndex: [3, 4, 5, 4, 3, 1][index] ?? 0 })),
  };
}

export function prepare(state, { now }) { state.airQuality = airQualityFixture(now, state.weather.location); }

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

/** Lines each never-breaking phrase (#221) occupies, its footer layout and the widget fit. */
function layout(widget) {
  return widget.evaluate(section => {
    const lines = element => new Set([...element.getClientRects()].map(rect => Math.round(rect.top))).size;
    const phrases = [...section.querySelectorAll('.air-phrase')].map(element => ({ text: element.textContent, lines: lines(element) }));
    const age = section.querySelector('.air-age').getBoundingClientRect(), credit = section.querySelector('.air-credit').getBoundingClientRect();
    return { fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a, phrases, footerRow: Math.abs(age.top - credit.top) <= 1, text: section.innerText };
  });
}

function assertLayout(result, { size, label: name, oneRow = size !== 'small' }) {
  if (size !== 'large') assert.equal(result.fit, 1, `${name}: fits at Text 100% without zooming out (${result.fit})`);
  assert.deepEqual(result.phrases.filter(phrase => phrase.lines !== 1), [], `${name}: number–unit pairs, ages and "Open-Meteo" never break`);
  assert.ok(result.phrases.some(phrase => phrase.text === 'Open-Meteo'), `${name}: credits Open-Meteo`);
  if (oneRow) assert.ok(result.footerRow, `${name}: age and credit share one footer row`);
}

/** Text in the caution (status) tone, as the stale age and the qualifier use. */
function cautionColor(locator) {
  return locator.evaluate(element => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; element.append(probe);
    const expected = getComputedStyle(probe).color; probe.remove(); return [getComputedStyle(element).color, expected];
  });
}

export async function family({ page, widget, size, density, viewport, state }) {
  const text = await widget.innerText();
  assert.match(text, /Air quality/); assert.match(text, /US AQI/); assert.match(text, /\b42\b/); assert.match(text, /Good/);
  // The page clock advances across the suite, and further as the merged catalog grows (#73, #157), so
  // the age is read against the page clock; the one-second tick may lag it by up to a second.
  const clockNow = await page.evaluate(() => Date.now());
  const ages = [clockNow, clockNow - 1000].map(at => Math.floor((at - Date.parse(state.airQuality.updatedAt)) / 60_000));
  assert.ok(ages.some(age => text.includes(`Model est. · ${age} min ago`)), `age matches the page clock (${ages.join(' or ')} min): ${text}`);
  assert.match(text, /CAMS · Open-Meteo/); assert.doesNotMatch(text, /Saved estimate|Last known/, 'a fresh reading is not qualified');
  assert.equal(await widget.locator('.air-reading').getAttribute('data-air-reading'), 'current');
  if (size === 'small') assert.doesNotMatch(text, /Mostly/);
  else { assert.match(text, /Mostly PM2\.5 · 12 µg\/m³/); assert.match(text, /UV 3 · Moderate/); }
  assertLayout(await layout(widget), { size, label: `air ${size}/${density} ${viewport.width} fresh` });
  if (size === 'large') {
    assert.equal(await widget.locator('.air-bar').count(), 24); assert.equal(await widget.locator('.air-bar-unknown').count(), 1, 'unknown hour is dotted');
    assert.match(text, /UV peaks 5 at 11 AM/);
    assert.equal(await page.getByRole('img', { name: 'US AQI estimate for the next 24 hours: 40 to 45, 1 unknown', exact: true }).count(), 1, 'the bar chart exposes its name');
  } else assert.equal(await widget.locator('.air-bar').count(), 0);
  // No category colours: the reading uses the ordinary text colour.
  assert.equal(await widget.locator('.air-category').evaluate(element => getComputedStyle(element).color), await widget.locator('.air-aqi').evaluate(element => getComputedStyle(element.closest('.ambient')).color));
  if (density !== 'balanced' || viewport.width !== 1920) return;
  const fresh = structuredClone(state.airQuality);
  state.settings.clockFormat = '24h'; state.airQuality.current.aqi = 120; await reload(page);
  const unhealthy = await page.locator('.ambient-airQuality').innerText();
  assert.match(unhealthy, size === 'small' ? /Sensitive groups/ : /Unhealthy for sensitive groups/);
  if (size === 'large') assert.match(unhealthy, /UV peaks 5 at 11:00/);
  state.settings.clockFormat = '12h';
  state.airQuality = { ...structuredClone(fresh), status: 'stale', updatedAt: new Date(Date.parse(fresh.updatedAt) - 2 * HOUR + 12 * 60_000).toISOString() }; await reload(page);
  const stale = page.locator('.ambient-airQuality .air-age');
  assert.match(await stale.innerText(), /^Saved reading · 2 hr ago$/);
  const [color, caution] = await cautionColor(stale);
  assert.equal(color, caution, 'stale age uses the caution token');
  assert.doesNotMatch(await page.locator('.ambient-airQuality').innerText(), /Saved estimate|Last known/, 'values under 3 hours old still stand');
  // A saved reading fetched ten hours before the page clock keeps its old series: only the current
  // and later hours show, the morning UV peak that has already happened is not today's peak, and
  // its values are over 3 hours old, so this hour's saved estimate replaces them (#188).
  const timeZone = fresh.location.timezone, pageNow = await page.evaluate(() => Date.now());
  const thisHour = pageNow - pageNow % HOUR, fetched = thisHour - 10 * HOUR;
  const old = Array.from({ length: 24 }, (_, index) => ({ time: new Date(fetched + index * HOUR).toISOString(), aqi: 40 + index % 6, uvIndex: index === 8 ? 7 : index === 14 ? 4 : 0 }));
  state.airQuality = { ...structuredClone(fresh), status: 'stale', updatedAt: new Date(fetched + 30 * 60_000).toISOString(), current: { ...fresh.current, time: new Date(fetched).toISOString(), aqi: 42, uvIndex: 7 }, hourly: old }; await reload(page);
  const saved = page.locator('.ambient-airQuality');
  const estimate = await saved.innerText();
  assert.match(await saved.locator('.air-age').innerText(), /^Saved reading · 9 hr ago$/);
  assert.match(estimate, /\b44\b/, 'the AQI is this hour\'s saved estimate'); assert.doesNotMatch(estimate, /\b42\b/);
  assert.equal(await saved.locator('.air-qualifier').innerText(), 'Saved estimate');
  assert.equal(await saved.locator('.air-reading').getAttribute('data-air-reading'), 'estimate');
  assert.deepEqual(await cautionColor(saved.locator('.air-qualifier')).then(([a, b]) => a === b), true, 'the qualifier uses the status tone');
  assert.doesNotMatch(estimate, /Mostly/, 'the fetch-time pollutant is not shown as current');
  if (size !== 'small') { assert.match(estimate, /UV 0 · Low/); assert.doesNotMatch(estimate, /UV 7/); }
  if (size === 'large') {
    const shownAt = await page.evaluate(() => Date.now());
    assert.equal(await saved.locator('.air-bar').count(), old.filter(reading => Date.parse(reading.time) > shownAt - HOUR).length, 'past hours are not drawn');
    assert.equal(await saved.locator('.air-hours span').first().innerText(), label(thisHour, timeZone, { hour: 'numeric', minute: '2-digit' }), 'the bars start at the current hour');
    const peak = await saved.locator('.air-uv-peak').innerText();
    assert.doesNotMatch(peak, /UV peaks 7/, 'no UV peak that has already happened');
    assert.equal(peak, `UV peaks 4 at ${label(fetched + 14 * HOUR, timeZone, { hour: 'numeric' })}`);
  } else assert.equal(await saved.locator('.air-bar').count(), 0);
  assertLayout(await layout(saved), { size, label: `air ${size} saved estimate`, oneRow: false });
  // With under two upcoming hours left there is no hourly estimate, not a stretched past series.
  const ended = thisHour - 23 * HOUR;
  state.airQuality = { ...state.airQuality, updatedAt: new Date(ended + 5 * 60_000).toISOString(), hourly: old.map((reading, index) => ({ ...reading, time: new Date(ended + index * HOUR).toISOString() })) }; await reload(page);
  const ending = await saved.innerText();
  if (size === 'large') {
    assert.match(ending, /Hourly estimate unavailable/); assert.equal(await saved.locator('.air-bar, .air-hours, .air-uv-peak').count(), 0);
  } else assert.doesNotMatch(ending, /Hourly estimate/);
  assert.match(ending, /Saved reading/);
  // A series that has ended: the old AQI stays, qualified with the hour it describes; UV is hidden.
  const gone = thisHour - 30 * HOUR;
  state.airQuality = { ...state.airQuality, updatedAt: new Date(gone + 5 * 60_000).toISOString(), current: { ...state.airQuality.current, time: new Date(gone).toISOString() }, hourly: old.map((reading, index) => ({ ...reading, time: new Date(gone + index * HOUR).toISOString() })) }; await reload(page);
  const lastKnown = await saved.innerText();
  const goneDay = new Intl.DateTimeFormat('en', { timeZone, weekday: 'short' }).format(new Date(gone));
  assert.equal((await saved.locator('.air-qualifier').innerText()).replace(/\s+/g, ' '), `Last known · ${goneDay} ${label(gone, timeZone, { hour: 'numeric' })}`);
  assert.match(lastKnown, /\b42\b/); assert.doesNotMatch(lastKnown, /\bUV\b|Mostly/, 'no UV or pollutant from a day-old reading');
  assert.equal(await saved.locator('.air-reading').getAttribute('data-air-reading'), 'lastKnown');
  assertLayout(await layout(saved), { size, label: `air ${size} last known`, oneRow: false });
  // #188 at night: a reading fetched at 9:00 with daytime UV, shown at 22:30, reads this hour's
  // saved estimate and never the morning's UV as current.
  if (size !== 'small') {
    const before = await page.evaluate(() => Date.now()), morning = before - before % HOUR;
    state.airQuality = { ...airQualityFixture(morning + 5 * 60_000, fresh.location), status: 'stale', updatedAt: new Date(morning + 5 * 60_000).toISOString() };
    await page.clock.setSystemTime(morning + 13.5 * HOUR);
    try {
      await reload(page);
      const night = await saved.innerText();
      assert.match(night, /Saved estimate/); assert.match(night, /UV 0 · Low/); assert.doesNotMatch(night, /UV 3|Moderate/, `no daytime UV at night: ${night}`);
      assert.match(await saved.locator('.air-age').innerText(), /^Saved reading · 13 hr ago$/);
    } finally { await page.clock.setSystemTime(before + 1000); }
  }
  state.airQuality = { ...structuredClone(fresh), status: 'unavailable', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const unavailable = await page.locator('.ambient-airQuality').innerText();
  assert.match(unavailable, /Air quality unavailable/); assert.doesNotMatch(unavailable, /Good|\b42\b/, 'a failure never reads as clean air');
  assert.doesNotMatch(unavailable, /Model est/, 'no estimate label without a reading'); assert.match(unavailable, /Not updated yet/); assert.match(unavailable, /CAMS · Open-Meteo/);
  state.airQuality = { ...structuredClone(fresh), status: 'off', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const off = await page.locator('.ambient-airQuality').innerText();
  assert.match(off, /not loaded yet/); assert.doesNotMatch(off, /Good|Model est/);
  state.airQuality = fresh; await reload(page);
}

/**
 * #221: small and medium keep fit 1 at Text 100% in every density, fresh, stale and offline, at this
 * viewport and (once) at 1280×720; #185: no Intl formatter per tick.
 */
export async function sweep({ page, viewport, state, now }) {
  const views = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  const states = {
    fresh: () => airQualityFixture(now, state.weather.location),
    stale: () => ({ ...airQualityFixture(now, state.weather.location), status: 'stale', updatedAt: new Date(now - 2 * HOUR).toISOString() }),
    offline: () => airQualityFixture(now, state.weather.location),
  };
  let cases = 0;
  for (const view of views) {
    await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['small', 'medium']) for (const [name, reading] of Object.entries(states)) {
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'airQuality']));
      state.settings.widgetGrid.density = density; state.settings.widgetGrid.placements.airQuality = { column: 0, row: 0, size };
      state.settings.appearance.fontScale = 1; state.settings.appearance.motionEnabled = false; state.airQuality = reading();
      await reload(page);
      const widget = page.locator('[data-widget-id="airQuality"]');
      if (name === 'offline') {
        await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' }));
        try {
          await page.clock.runFor(30_000);
          for (let attempt = 0; attempt < 100 && !/Offline/.test(await widget.innerText()); attempt++) await page.waitForTimeout(40);
        } finally { await page.unroute('**/api/state'); }
        assert.match(await widget.locator('.air-age').innerText(), /^Offline · Model est\. · \d+ min ago$/);
      }
      assertLayout(await layout(widget), { size, label: `air ${size}/${density} ${view.width} ${name}` });
      cases++;
    }
  }
  await page.setViewportSize(viewport);
  if (viewport.width === 1920) {
    state.settings.widgetGrid.placements.airQuality = { column: 0, row: 0, size: 'large' }; state.airQuality = airQualityFixture(now, state.weather.location); await reload(page);
    assert.equal(await intlPerTicks(page), 0, 'large Air quality builds no Intl formatter per tick');
  }
  return `Air quality small/medium fit 1 at Text 100% with unbroken phrases and a one-row footer in every density, fresh/stale/offline, at 720p/1080p/4K (${cases} cases at ${viewport.width}); large builds no Intl formatter per tick`;
}
