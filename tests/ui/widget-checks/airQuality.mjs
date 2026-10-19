import assert from 'node:assert/strict';

export const id = 'airQuality';
export const selectors = ['.air-context', '.air-age', '.air-credit', '.air-details', '.air-hours', '.air-uv-peak', '.air-bars'];

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
  state.airQuality = { ...structuredClone(fresh), status: 'unavailable', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const unavailable = await page.locator('.ambient-airQuality').innerText();
  assert.match(unavailable, /Air quality unavailable/); assert.doesNotMatch(unavailable, /Good|\b42\b/, 'a failure never reads as clean air');
  assert.doesNotMatch(unavailable, /Model estimate/, 'no estimate label without a reading'); assert.match(unavailable, /Not updated yet/); assert.match(unavailable, /Air quality: CAMS via Open-Meteo/);
  state.airQuality = { ...structuredClone(fresh), status: 'off', updatedAt: null, current: null, hourly: [] }; await reload(page);
  const off = await page.locator('.ambient-airQuality').innerText();
  assert.match(off, /not loaded yet/); assert.doesNotMatch(off, /Good|Model estimate/);
  state.airQuality = fresh; await reload(page);
}
