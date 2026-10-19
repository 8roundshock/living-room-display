import assert from 'node:assert/strict';

export const id = 'airQuality';
export const selectors = ['.air-context', '.air-age', '.air-credit', '.air-details', '.air-hours', '.air-uv-peak', '.air-hourly-missing', '.air-bars'];
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

export async function family({ page, widget, size, density, viewport, state }) {
  const text = await widget.innerText();
  assert.match(text, /Air quality/); assert.match(text, /US AQI/); assert.match(text, /\b42\b/); assert.match(text, /Good/);
  // The page clock advances a few minutes across the suite.
  assert.match(text, /Model estimate · Updated 1\d min ago/);
  assert.match(text, /Air quality: CAMS via Open-Meteo/);
  if (size === 'small') assert.doesNotMatch(text, /Mostly/);
  else { assert.match(text, /Mostly PM2\.5 · 12 µg\/m³/); assert.match(text, /UV 3 · Moderate/); }
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
  state.airQuality = { ...structuredClone(fresh), status: 'stale', updatedAt: new Date(Date.parse(fresh.updatedAt) - 2 * 3600_000 + 12 * 60_000).toISOString() }; await reload(page);
  const stale = page.locator('.ambient-airQuality .air-age');
  assert.match(await stale.innerText(), /Saved reading · Updated 2 hr ago/);
  const [color, caution] = await stale.evaluate(element => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; element.append(probe);
    const expected = getComputedStyle(probe).color; probe.remove(); return [getComputedStyle(element).color, expected];
  });
  assert.equal(color, caution, 'stale age uses the caution token');
  // A saved reading fetched ten hours before the page clock keeps its old series: only the current
  // and later hours show, and the morning UV peak that has already happened is not today's peak.
  const timeZone = fresh.location.timezone, pageNow = await page.evaluate(() => Date.now());
  const thisHour = pageNow - pageNow % HOUR, fetched = thisHour - 10 * HOUR;
  const old = Array.from({ length: 24 }, (_, index) => ({ time: new Date(fetched + index * HOUR).toISOString(), aqi: 40 + index % 6, uvIndex: index === 8 ? 7 : index === 14 ? 4 : 0 }));
  state.airQuality = { ...structuredClone(fresh), status: 'stale', updatedAt: new Date(fetched + 30 * 60_000).toISOString(), current: { ...fresh.current, time: new Date(fetched).toISOString() }, hourly: old }; await reload(page);
  const saved = page.locator('.ambient-airQuality');
  assert.match(await saved.locator('.air-age').innerText(), /Saved reading · Updated 9 hr ago/);
  if (size === 'large') {
    const shownAt = await page.evaluate(() => Date.now());
    assert.equal(await saved.locator('.air-bar').count(), old.filter(reading => Date.parse(reading.time) > shownAt - HOUR).length, 'past hours are not drawn');
    assert.equal(await saved.locator('.air-hours span').first().innerText(), label(thisHour, timeZone, { hour: 'numeric', minute: '2-digit' }), 'the bars start at the current hour');
    const peak = await saved.locator('.air-uv-peak').innerText();
    assert.doesNotMatch(peak, /UV peaks 7/, 'no UV peak that has already happened');
    assert.equal(peak, `UV peaks 4 at ${label(fetched + 14 * HOUR, timeZone, { hour: 'numeric' })}`);
  } else assert.equal(await saved.locator('.air-bar').count(), 0);
  // With under two upcoming hours left there is no hourly estimate, not a stretched past series.
  const ended = thisHour - 23 * HOUR;
  state.airQuality = { ...state.airQuality, updatedAt: new Date(ended + 5 * 60_000).toISOString(), hourly: old.map((reading, index) => ({ ...reading, time: new Date(ended + index * HOUR).toISOString() })) }; await reload(page);
  const ending = await saved.innerText();
  if (size === 'large') {
    assert.match(ending, /Hourly estimate unavailable/); assert.equal(await saved.locator('.air-bar, .air-hours, .air-uv-peak').count(), 0);
  } else assert.doesNotMatch(ending, /Hourly estimate/);
  assert.match(ending, /Saved reading/);
  state.airQuality = { ...structuredClone(fresh), status: 'unavailable', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const unavailable = await page.locator('.ambient-airQuality').innerText();
  assert.match(unavailable, /Air quality unavailable/); assert.doesNotMatch(unavailable, /Good|\b42\b/, 'a failure never reads as clean air');
  assert.doesNotMatch(unavailable, /Model estimate/, 'no estimate label without a reading'); assert.match(unavailable, /Not updated yet/); assert.match(unavailable, /Air quality: CAMS via Open-Meteo/);
  state.airQuality = { ...structuredClone(fresh), status: 'off', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const off = await page.locator('.ambient-airQuality').innerText();
  assert.match(off, /not loaded yet/); assert.doesNotMatch(off, /Good|Model estimate/);
  state.airQuality = fresh; await reload(page);
}
