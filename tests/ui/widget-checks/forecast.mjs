import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

export const id = 'forecast';
export const selectors = ['.forecast-strip', '.forecast-status-line'];
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
  // #715: a fresh forecast is the heading and the strip: no status line, no provider name, no update age.
  assert.equal(await widget.locator('.forecast-status-line, .forecast-attribution, .forecast-source, .forecast-age').count(), 0, `${size} fresh: nothing under the strip`);
  assert.equal(await widget.locator('.forecast-body.forecast-with-status').count(), 0, `${size} fresh: the strip keeps its full size`);
}

/** The status line, fit, strip size and line breaks of one Forecast render (#223, #221, #715). */
async function inspect(page) {
  return page.locator('[data-widget-id="forecast"]').evaluate(section => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const opacity = node => { let value = 1; for (let at = node; at && at !== section.parentElement; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
    const line = section.querySelector('.forecast-status-line'), status = section.querySelector('.forecast-status'), age = section.querySelector('.forecast-age');
    const lines = node => new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size;
    const cue = node => node && { text: node.textContent, color: getComputedStyle(node).color, opacity: opacity(node), display: getComputedStyle(node).display };
    const content = section.querySelector('.widget-content').getBoundingClientRect(), strip = section.querySelector('.forecast-strip').getBoundingClientRect();
    return {
      scale: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      caution, line: line && { ...cue(line), shared: line.classList.contains('status-caution') }, status: cue(status), age: age && { ...cue(age), lines: lines(age) },
      text: section.innerText, withStatus: section.querySelector('.forecast-body').classList.contains('forecast-with-status'), pageNow: Date.now(),
      // How tall the strip and one day's glyph are, as a share of the widget's content height.
      stripShare: strip.height / content.height, glyphShare: section.querySelector('.forecast-day > .weather-glyph').getBoundingClientRect().height / content.height,
      past: [...section.querySelectorAll('.forecast-day-label')].map(node => node.getAttribute('aria-label').slice(-10)), heading: section.querySelector('.ambient-label').textContent,
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
    await page.goto(base + '/display'); await page.locator('[data-widget-id="forecast"] .forecast-strip').waitFor(); await page.clock.runFor(100);
    if (status === 'offline') {
      await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic offline state' }) }));
      try { await page.clock.runFor(31_000); await page.locator('[data-widget-id="forecast"] .forecast-status', { hasText: 'Offline' }).waitFor(); }
      finally { await page.unroute('**/api/state'); }
    }
    return inspect(page);
  }
  let renders = 0;
  for (const size of ['small', 'medium', 'large']) for (const accentMode of ['native', 'color']) {
    const shares = {};
    for (const status of ['fresh', 'stale', 'offline']) {
      const label = `${viewport.width} ${size}/${accentMode}/${status}`;
      const m = await render({ size, density: 'balanced', status, accentMode }); renders++;
      shares[status] = m;
      assert.doesNotMatch(m.text, /Open-Meteo/, `${label}: no provider name (#715)`);
      if (status === 'fresh') {
        // #715: nothing under a fresh strip: no status line, no age.
        assert.deepEqual([m.line, m.status, m.age, m.withStatus], [null, null, null, false], `${label}: no status line and no age`);
        assert.doesNotMatch(m.text, /Updated|\bago\b|just now/, `${label}: no update age`);
        continue;
      }
      // The whole line is the shared status cue: the caution tone at full opacity (#223), label and age alike (#715).
      assert.equal(m.withStatus, true, label);
      assert.equal(m.line.shared, true, `${label}: the line carries the shared status class`);
      // The page clock advances across the suite (by more than an hour before the 4K pass), so the saved age is
      // read against it; the one-second tick may lag it by up to a second. The saved forecast is five hours older
      // than the fixture's now.
      const line = m.line.text.replace(/\s+/g, ' ');
      const savedHours = [m.pageNow, m.pageNow - 1000].map(at => Math.floor((at - (now - 5 * 3600_000)) / 3600_000));
      if (status === 'stale') assert.ok(savedHours.some(hours => line === `Saved forecast · Updated ${hours} hr ago`), `${label}: the label, then the age (${savedHours.join(' or ')} hr): ${line}`);
      else assert.match(line, /^Offline · Updated (just now|\d+ (min|hr) ago)$/, `${label}: the label, then the age`);
      assert.equal(m.status.text, status === 'stale' ? 'Saved forecast' : 'Offline', label);
      for (const [name, part] of [['line', m.line], ['label', m.status], ['age', m.age]]) {
        assert.equal(part.color, m.caution, `${label}: ${name} in the caution tone`);
        assert.equal(part.opacity, 1, `${label}: ${name} at full opacity`);
      }
      if (size === 'small') assert.equal(m.status.display, 'block', `${label}: small sets the label on its own line (#221)`);
    }
    // #715: the room the old footer held goes to the strip. Medium and large draw a fresh strip taller than a saved
    // one, whose status line needs the room; small keeps one size (its temperatures wrap onto two rows when cold).
    const label = `${viewport.width} ${size}/${accentMode}`;
    if (size === 'small') assert.ok(Math.abs(shares.fresh.glyphShare - shares.stale.glyphShare) < 0.005, `${label}: small keeps one strip size ${JSON.stringify([shares.fresh.glyphShare, shares.stale.glyphShare])}`);
    else {
      assert.ok(shares.fresh.glyphShare > shares.stale.glyphShare * 1.15, `${label}: a fresh strip's glyphs are taller ${JSON.stringify([shares.fresh.glyphShare, shares.stale.glyphShare])}`);
      assert.ok(shares.fresh.stripShare > shares.stale.stripShare * 1.08, `${label}: a fresh strip is taller ${JSON.stringify([shares.fresh.stripShare, shares.stale.stripShare])}`);
      assert.ok(Math.abs(shares.offline.stripShare - shares.stale.stripShare) < 0.005, `${label}: offline and saved strips share one size`);
    }
    for (const status of ['fresh', 'stale', 'offline']) assert.ok(shares[status].scale >= 0.999, `${label}/${status} fits without zooming out, scale=${shares[status].scale}`);
  }
  // Small keeps fit 1 at Text 100% in every density and state, at the owner's 720p as well (#221).
  const viewports = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  for (const size of viewports) {
    await page.setViewportSize(size);
    for (const density of Object.keys(GRID_DENSITIES)) for (const status of ['fresh', 'stale', 'offline']) {
      const label = `${size.width} small/${density}/${status}`;
      const m = await render({ size: 'small', density, status }); renders++;
      assert.ok(m.scale >= 0.999, `${label} fits without zooming out, scale=${m.scale}`);
      if (status === 'fresh') assert.equal(m.age, null, `${label}: no age while fresh (#715)`);
      else assert.equal(m.age.lines, 1, `${label}: "${m.age.text}" stays on one line`);
    }
  }
  await page.setViewportSize(viewport);
  // A forecast saved three days earlier still starts at today (#243).
  const saved = await render({ size: 'large', density: 'balanced', status: 'stale', daysEarlier: 3 }); renders++;
  assert.ok(saved.past.length > 0 && saved.past.every(date => date >= today), `no past day: ${saved.past}`);
  assert.equal(saved.heading, `Next ${saved.past.length} days`, 'the heading counts the days shown');
  reset();
  assert.ok(renders > 0);
  return `Forecast: Today then weekday labels with “Tomorrow, <date>” kept for assistive text (#256); fresh shows no provider name, no age and no line under the strip, and in medium and large the strip takes that room (#715); saved and offline keep “Saved forecast · Updated 5 hr ago”/“Offline · …” whole in the caution tone at full opacity in Native and colour (#223); small at fit 1 with an unbroken age in every density and state at 720p/1080p/4K (#221); no past day from a forecast saved 3 days earlier (#243)`;
}
