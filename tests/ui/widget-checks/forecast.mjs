import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

export const id = 'forecast';
export const selectors = ['.forecast-strip', '.forecast-attribution'];
const weekday = date => new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export async function family({ widget, size }) {
  const count = size === 'small' ? 3 : size === 'medium' ? 5 : 7;
  assert.equal(await widget.locator('.forecast-day').count(), count);
  assert.equal(await widget.locator('.forecast-day > .weather-glyph[data-glyph]').count(), count, 'day glyphs use WeatherGlyph');
  // Today, then weekdays (#256): tomorrow is named by its weekday; assistive text and the title keep "Tomorrow, <date>".
  const labels = await widget.locator('.forecast-day-label').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, full: node.getAttribute('aria-label'), title: node.getAttribute('title') })));
  assert.equal(labels[0].text, 'Today', `${size} starts at today`);
  assert.match(labels[1].full, /^Tomorrow, \d{4}-\d{2}-\d{2}$/); assert.equal(labels[1].title, labels[1].full);
  assert.equal(labels[1].text, weekday(labels[1].full.slice(-10)), `${size} names tomorrow by its weekday`);
  assert.ok(labels.every(label => label.text !== 'Tom.'), `${size} never abbreviates Tomorrow`);
}

/** The status cue, fit and line breaks of one Forecast render (#223, #221). */
async function inspect(page) {
  return page.locator('[data-widget-id="forecast"]').evaluate(section => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const opacity = node => { let value = 1; for (let at = node; at && at !== section.parentElement; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
    const status = section.querySelector('.forecast-status'), source = section.querySelector('.forecast-source'), age = section.querySelector('.forecast-age');
    const lines = node => new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size;
    return {
      scale: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      caution, status: status && { text: status.textContent, color: getComputedStyle(status).color, opacity: opacity(status), display: getComputedStyle(status).display },
      sourceOpacity: opacity(source), ageText: age.textContent, ageLines: lines(age), past: [...section.querySelectorAll('.forecast-day-label')].map(node => node.getAttribute('aria-label').slice(-10)), heading: section.querySelector('.ambient-label').textContent,
    };
  });
}

export async function sweep({ page, viewport, state, base, now }) {
  // The route serves this very object, so every case edits it in place from a pristine copy.
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: pristine.weather.location.timezone }).format(now);
  async function render({ size, density, status, accentMode = 'native', daysEarlier = 0 }) {
    reset();
    state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.appearance.accentMode = accentMode;
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'forecast']));
    state.settings.widgetGrid.placements.forecast = { column: 0, row: 0, size };
    if (status === 'stale') { state.weather.status = 'stale'; state.weather.updatedAt = new Date(now - 5 * 3600_000).toISOString(); }
    if (daysEarlier) state.weather.daily = state.weather.daily.map(day => { const date = new Date(`${day.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - daysEarlier); return { ...day, date: date.toISOString().slice(0, 10) }; });
    await page.goto(base + '/display'); await page.locator('[data-widget-id="forecast"] .forecast-attribution').waitFor(); await page.clock.runFor(100);
    if (status === 'offline') {
      await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic offline state' }) }));
      try { await page.clock.runFor(31_000); await page.locator('[data-widget-id="forecast"] .forecast-status', { hasText: 'Offline' }).waitFor(); }
      finally { await page.unroute('**/api/state'); }
    }
    return inspect(page);
  }
  let renders = 0;
  for (const size of ['small', 'medium', 'large']) for (const accentMode of ['native', 'color']) for (const status of ['fresh', 'stale', 'offline']) {
    const label = `${viewport.width} ${size}/${accentMode}/${status}`;
    const m = await render({ size, density: 'balanced', status, accentMode }); renders++;
    assert.equal(m.sourceOpacity, 0.65, `${label}: source and age stay dim`);
    if (status === 'fresh') { assert.equal(m.status, null, `${label}: no status prefix`); continue; }
    // The status prefix is the shared status cue: the caution tone at full opacity (#223).
    assert.equal(m.status.text, status === 'stale' ? 'Saved forecast' : 'Offline', label);
    assert.equal(m.status.color, m.caution, `${label}: prefix in the caution tone`);
    assert.equal(m.status.opacity, 1, `${label}: prefix at full opacity`);
    if (size === 'small') assert.equal(m.status.display, 'block', `${label}: small sets the prefix on its own line (#221)`);
  }
  // Small keeps fit 1 at Text 100% in every density and state, at the owner's 720p as well (#221).
  const viewports = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  for (const size of viewports) {
    await page.setViewportSize(size);
    for (const density of Object.keys(GRID_DENSITIES)) for (const status of ['fresh', 'stale', 'offline']) {
      const label = `${size.width} small/${density}/${status}`;
      const m = await render({ size: 'small', density, status }); renders++;
      assert.ok(m.scale >= 0.999, `${label} fits without zooming out, scale=${m.scale}`);
      assert.equal(m.ageLines, 1, `${label}: "${m.ageText}" stays on one line`);
    }
  }
  await page.setViewportSize(viewport);
  // A forecast saved three days earlier still starts at today (#243).
  const saved = await render({ size: 'large', density: 'balanced', status: 'stale', daysEarlier: 3 }); renders++;
  assert.ok(saved.past.length > 0 && saved.past.every(date => date >= today), `no past day: ${saved.past}`);
  assert.equal(saved.heading, `Next ${saved.past.length} days`, 'the heading counts the days shown');
  reset();
  assert.ok(renders > 0);
  return `Forecast: Today then weekday labels with “Tomorrow, <date>” kept for assistive text (#256); the Saved forecast/Offline prefix in the caution tone at full opacity in Native and colour (#223); small at fit 1 with an unbroken age in every density and state at 720p/1080p/4K (#221); no past day from a forecast saved 3 days earlier (#243)`;
}
