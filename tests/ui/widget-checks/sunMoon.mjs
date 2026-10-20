import assert from 'node:assert/strict';
import { formatTime, sunDay } from '../../../src/client/astronomy.ts';
import { intlPerTicks } from './clock.mjs';

export const id = 'sunMoon';
export const selectors = ['.sun-hero', '.sun-place', '.sun-daylight', '.moon-name', '.moon-next', '.sun-row'];

const compact = value => value.replace(/\s+/g, '');
async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

export async function family({ page, widget, size, density, viewport, state }) {
  const { latitude, longitude, timezone, name } = state.weather.location;
  const today = sunDay('2026-10-18', latitude, longitude);
  const text = compact(await widget.innerText());
  // 2026-10-18 13:00Z is 9:00 in Toronto: the next event is the sunset, in the weather timezone.
  if (size === 'small') {
    assert.match(text, /Sunset/); assert.ok(text.includes(compact(formatTime(today.sunset, timezone, '12h'))), `${density} small shows the sunset time: ${text}`);
    assert.ok(text.includes(compact(name)));
  } else {
    assert.ok(text.includes(compact(formatTime(today.sunrise, timezone, '12h'))) && text.includes(compact(formatTime(today.sunset, timezone, '12h'))), `${size} shows sunrise and sunset`);
    assert.match(text, /\d+h\d+mindaylight/); assert.match(text, /[−+±]\d+min/);
    // An outline moon with a dim lit fraction, never a filled bright disc.
    const moon = await widget.locator('.moon-glyph').evaluate(svg => ({
      glyph: svg.getAttribute('data-glyph'), tone: Boolean(svg.closest('.tone-time')),
      outline: getComputedStyle(svg.querySelector('.moon-outline')).fill, lit: Number(getComputedStyle(svg.querySelector('.moon-lit')).fillOpacity),
    }));
    assert.equal(moon.glyph, 'moon'); assert.equal(moon.tone, true, 'moon subtree is tone-time'); assert.equal(moon.outline, 'none'); assert.ok(moon.lit <= 0.35, `dim lit fraction ${moon.lit}`);
    assert.match(text, /Firstquarter/);
  }
  if (size === 'large') {
    assert.match(text, /Firstquarter·49%/); assert.match(text, /FullmoonMon,Oct26/);
    assert.equal(await widget.locator('.sun-arc .sun-dot[data-glyph="sun"]').count(), 1, 'sun dot while the sun is up');
    const arc = await widget.locator('.sun-arc-path').evaluate(group => ({ dots: group.querySelectorAll('circle').length, opacity: Number(getComputedStyle(group).opacity) }));
    assert.ok(arc.dots >= 20 && arc.opacity <= 0.5, `thin dim dotted arc ${JSON.stringify(arc)}`);
  }
  if (density !== 'balanced' || viewport.width !== 1920) return;
  const original = structuredClone(state.weather.location);
  // The weather location's timezone, not the browser's: 22:00 in Tokyo means the next sunrise there.
  state.weather.location = { name: 'Synthetic Tokyo', latitude: 35.68, longitude: 139.69, timezone: 'Asia/Tokyo' }; await reload(page);
  const tokyo = sunDay('2026-10-19', 35.68, 139.69);
  if (size === 'small') {
    const shown = compact(await page.locator('.ambient-sunMoon').innerText());
    assert.match(shown, /Sunrise/); assert.ok(shown.includes(compact(formatTime(tokyo.sunrise, 'Asia/Tokyo', '12h'))), shown);
  }
  if (size === 'large') assert.equal(await page.locator('.ambient-sunMoon .sun-dot').count(), 0, 'no sun dot after dark');
  // Polar cases read as text, with no invented times.
  for (const [latitude, phrase] of [[82.5, 'Sun stays down today'], [-82.5, 'Sun up all day']]) {
    state.weather.location = { name: 'Synthetic polar station', latitude, longitude: 0, timezone: 'UTC' }; await reload(page);
    const shown = await page.locator('.ambient-sunMoon').innerText();
    assert.match(shown, new RegExp(phrase), `${size} polar text`); assert.doesNotMatch(shown, /Sunrise\s+\d|Sunset\s+\d/);
  }
  // #324: one-second ticks within a minute construct no Intl formatter, with the zone resolved and while a device
  // location's zone is still `auto` (its fallback to this computer's zone builds one, so it is memoized).
  for (const timezone of ['America/Toronto', 'auto']) {
    state.weather.location = { ...original, timezone }; await reload(page);
    assert.equal(await intlPerTicks(page), 0, `${size} Sun & moon with the zone ${timezone} builds no Intl formatter per tick`);
  }
  state.weather.location = original; await reload(page);
}
