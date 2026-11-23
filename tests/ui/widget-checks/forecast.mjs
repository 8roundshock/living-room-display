import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

export const id = 'forecast';
export const selectors = ['.forecast-strip', '.forecast-status-line', '.forecast-heading .weather-context'];
const weekday = date => new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const HOUR = 3600_000, MINUTE = 60_000;

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
  // #715: a fresh forecast is the heading and the strip: no status, no provider name, no update age; the heading's
  // right slot holds the place and unit, and nothing sits under the strip.
  assert.equal(await widget.locator('.forecast-status-line, .forecast-attribution, .forecast-source, .forecast-age').count(), 0, `${size} fresh: no status and no age`);
  assert.match(await widget.locator('.forecast-heading .weather-context').innerText(), /^.+ · °[CF]$/, `${size} fresh: the place and unit in the heading`);
  assert.equal(await widget.locator('.forecast-body > :last-child').getAttribute('class'), 'forecast-strip', `${size}: nothing under the strip`);
}

/** The heading's right slot, the status in it, the fit, and where and how large the strip is in one Forecast render (#223, #221, #715). */
async function inspect(page) {
  return page.locator('[data-widget-id="forecast"]').evaluate(section => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const opacity = node => { let value = 1; for (let at = node; at && at !== section.parentElement; at = at.parentElement) value *= Number(getComputedStyle(at).opacity); return value; };
    const line = section.querySelector('.forecast-status-line'), status = section.querySelector('.forecast-status'), age = section.querySelector('.forecast-age');
    const lines = node => new Set([...node.getClientRects()].map(rect => Math.round(rect.top))).size;
    const cue = node => node && { text: node.textContent, color: getComputedStyle(node).color, opacity: opacity(node), lines: lines(node) };
    const content = section.querySelector('.widget-content').getBoundingClientRect(), strip = section.querySelector('.forecast-strip').getBoundingClientRect();
    const heading = section.querySelector('.forecast-heading'), slot = heading.querySelector('.weather-context'), label = heading.querySelector('.ambient-label');
    const glyph = section.querySelector('.forecast-day > .weather-glyph').getBoundingClientRect(), dayLabel = section.querySelector('.forecast-day-label');
    return {
      scale: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      caution, line: line && { ...cue(line), shared: line.classList.contains('status-caution'), inHeading: line.parentElement === heading, isSlot: line === slot }, status: cue(status), age: cue(age),
      // What the right slot says, the size of its text and how many lines the heading's parts take.
      slot: { text: slot.textContent, size: parseFloat(getComputedStyle(slot).fontSize), lines: lines(slot) }, labelLines: lines(label), headingHeight: heading.getBoundingClientRect().height,
      text: section.innerText, pageNow: Date.now(), last: section.querySelector('.forecast-body').lastElementChild.className,
      // Where the strip sits and how large it and its parts are, in CSS pixels of the widget's content.
      strip: { top: strip.top - content.top, height: strip.height, width: strip.width }, glyph: glyph.height, dayLabel: parseFloat(getComputedStyle(dayLabel).fontSize),
      temperatures: parseFloat(getComputedStyle(section.querySelector('.forecast-temperatures')).fontSize), content: content.height,
      past: [...section.querySelectorAll('.forecast-day-label')].map(node => node.getAttribute('aria-label').slice(-10)), heading: label.textContent,
    };
  });
}

export async function sweep({ page, viewport, state, base, now }) {
  // The route serves this very object, so every case edits it in place from a pristine copy.
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: pristine.weather.location.timezone }).format(now);
  /**
   * The weather a status stands for. `refreshing` is what the server answers while a due refresh takes over a second
   * (#351): stale, 16 minutes old by the page's own clock (which the suite advances, so `now` would not do), with a
   * refresh in flight and no failure yet. `retrying` is a later attempt after a failed one.
   */
  const pageClock = () => page.evaluate(() => Date.now()).catch(() => now);
  const WEATHER = {
    fresh: () => {},
    stale: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now - 5 * HOUR).toISOString() }),
    offline: () => {},
    refreshing: (weather, clock) => Object.assign(weather, { status: 'stale', updatedAt: new Date(clock - 16 * MINUTE).toISOString(), error: null, refreshing: true }),
    retrying: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now - 5 * HOUR).toISOString(), error: 'Weather update failed. Showing the last successful forecast.', refreshing: true }),
  };
  function arrange({ size, density, status, accentMode = 'native', daysEarlier = 0 }, clock) {
    reset();
    state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.appearance.accentMode = accentMode;
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'forecast']));
    state.settings.widgetGrid.placements.forecast = { column: 0, row: 0, size };
    WEATHER[status](state.weather, clock);
    if (daysEarlier) state.weather.daily = state.weather.daily.map(day => { const date = new Date(`${day.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - daysEarlier); return { ...day, date: date.toISOString().slice(0, 10) }; });
  }
  async function render(options) {
    arrange(options, await pageClock());
    await page.goto(base + '/display'); await page.locator('[data-widget-id="forecast"] .forecast-strip').waitFor(); await page.clock.runFor(100);
    if (options.status === 'offline') {
      await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic offline state' }) }));
      try { await page.clock.runFor(31_000); await page.locator('[data-widget-id="forecast"] .forecast-status', { hasText: 'Offline' }).waitFor(); }
      finally { await page.unroute('**/api/state'); }
    }
    return inspect(page);
  }
  /** The saved age as the display counts it. The page clock advances across the suite (by more than an hour before the 4K pass), and the one-second tick may lag it by a second. */
  const savedAges = m => [m.pageNow, m.pageNow - 1000].map(at => `${Math.floor((at - (now - 5 * HOUR)) / HOUR)} hr ago`);
  const sameStrip = (a, b) => Math.abs(a.strip.top - b.strip.top) <= 0.5 && Math.abs(a.strip.height - b.strip.height) <= 0.5 && Math.abs(a.glyph - b.glyph) <= 0.1 && Math.abs(a.dayLabel - b.dayLabel) <= 0.05 && Math.abs(a.temperatures - b.temperatures) <= 0.05;
  const geometry = m => ({ strip: m.strip, glyph: m.glyph, dayLabel: m.dayLabel, temperatures: m.temperatures, heading: m.headingHeight });
  let renders = 0;
  for (const size of ['small', 'medium', 'large']) for (const accentMode of ['native', 'color']) {
    const shown = {};
    for (const status of ['fresh', 'stale', 'offline', 'refreshing', 'retrying']) {
      // Colour mode repeats the tone checks; the refresh states do not depend on it.
      if (accentMode === 'color' && (status === 'refreshing' || status === 'retrying')) continue;
      const label = `${viewport.width} ${size}/${accentMode}/${status}`;
      const m = await render({ size, density: 'balanced', status, accentMode }); renders++;
      shown[status] = m;
      assert.doesNotMatch(m.text, /Open-Meteo/, `${label}: no provider name (#715)`);
      assert.equal(m.last, 'forecast-strip', `${label}: nothing sits under the strip`);
      assert.ok(m.scale >= 0.999, `${label} fits without zooming out, scale=${m.scale}`);
      assert.equal(m.labelLines, 1, `${label}: the heading label keeps its line`);
      if (status === 'fresh' || status === 'refreshing') {
        // #715: fresh shows no status and no age, and a forecast whose refresh is still running is not a saved one.
        assert.deepEqual([m.line, m.status, m.age], [null, null, null], `${label}: no status and no age`);
        assert.equal(m.slot.text, 'Toronto · °C', `${label}: the place and unit in the heading's right slot`);
        assert.doesNotMatch(m.text, /Saved|Updated|\bago\b|just now/, `${label}: no update age`);
        continue;
      }
      // The status takes the heading's right slot, in place of the place and unit, whole in the shared status cue:
      // the caution tone at full opacity (#223), label and age alike (#715).
      assert.deepEqual([m.line.inHeading, m.line.isSlot, m.line.shared], [true, true, true], `${label}: the status is the heading's right slot, with the shared status class`);
      assert.doesNotMatch(m.text, /Toronto/, `${label}: the status replaces the place`);
      const line = m.line.text.replace(/\s+/g, ' ');
      if (status === 'offline') assert.match(line, /^Offline · Updated (just now|\d+ (min|hr) ago)$/, `${label}: "Updated" stays after Offline`);
      else assert.ok(savedAges(m).some(age => line === `Saved forecast · ${age}`), `${label}: the label, then the short age (${savedAges(m).join(' or ')}): ${line}`);
      assert.equal(m.status.text, status === 'offline' ? 'Offline' : 'Saved forecast', label);
      for (const [name, part] of [['line', m.line], ['label', m.status], ['age', m.age]]) {
        assert.equal(part.color, m.caution, `${label}: ${name} in the caution tone`);
        assert.equal(part.opacity, 1, `${label}: ${name} at full opacity`);
      }
      // Neither phrase breaks inside (#221), and on the Balanced grid the slot stays one line, as the place is.
      assert.deepEqual([m.status.lines, m.age.lines, m.slot.lines], [1, 1, 1], `${label}: unbroken phrases on one line`);
    }
    // No size switch (#715): the slot keeps the place's typography, so the heading keeps its height and the strip its
    // size and position, whatever the state. A status that comes or goes resizes nothing.
    const label = `${viewport.width} ${size}/${accentMode}`;
    for (const [status, m] of Object.entries(shown)) {
      assert.equal(m.slot.size, shown.fresh.slot.size, `${label}/${status}: the slot's text size is the place's`);
      assert.ok(Math.abs(m.headingHeight - shown.fresh.headingHeight) <= 0.5, `${label}/${status}: the heading keeps its height ${JSON.stringify([m.headingHeight, shown.fresh.headingHeight])}`);
      assert.ok(sameStrip(m, shown.fresh), `${label}/${status}: the strip has the fresh strip's size and position ${JSON.stringify([geometry(m), geometry(shown.fresh)])}`);
    }
    // Medium and large took the room the old footer held: 20cqh glyphs (16cqh before #715), in every state.
    if (size !== 'small') assert.ok(Math.abs(shown.stale.glyph / shown.stale.content - 0.20) < 0.004, `${label}: saved glyphs are 20% of the content height ${shown.stale.glyph}/${shown.stale.content}`);
  }
  // Live: a display that is already open gains and loses the status on its 30 s poll without the strip moving or
  // resizing (the reviewer's finding on the earlier size switch), in every family.
  for (const size of ['small', 'medium', 'large']) {
    const label = `${viewport.width} ${size} live`;
    const before = await render({ size, density: 'balanced', status: 'fresh' }); renders++;
    // The next poll answers `stale` and `refreshing` (a due refresh that outlasts the server's one-second wait): still fresh.
    WEATHER.refreshing(state.weather, await pageClock());
    await page.clock.runFor(30_500);
    const during = await inspect(page);
    assert.equal(during.line, null, `${label}: a refresh in flight shows no status`);
    assert.ok(sameStrip(during, before), `${label}: nothing moves while a refresh runs ${JSON.stringify([geometry(during), geometry(before)])}`);
    // The refresh fails: now it is a saved forecast, in the slot, and the strip still has not moved.
    Object.assign(state.weather, { error: 'Weather update failed. Showing the last successful forecast.' }); delete state.weather.refreshing;
    await page.clock.runFor(30_500);
    await page.locator('[data-widget-id="forecast"] .forecast-status-line').waitFor();
    const saved = await inspect(page);
    assert.match(saved.line.text.replace(/\s+/g, ' '), /^Saved forecast · \d+ min ago$/, `${label}: the failed refresh reads as saved`);
    assert.ok(sameStrip(saved, before) && Math.abs(saved.headingHeight - before.headingHeight) <= 0.5 && saved.scale === before.scale, `${label}: the status arrives without a resize ${JSON.stringify([geometry(saved), geometry(before)])}`);
    // And back to fresh.
    Object.assign(state.weather, structuredClone(pristine.weather));
    await page.clock.runFor(30_500);
    await page.locator('[data-widget-id="forecast"] .forecast-status-line').waitFor({ state: 'detached' });
    const after = await inspect(page);
    assert.equal(after.slot.text, 'Toronto · °C', `${label}: the place returns`);
    assert.ok(sameStrip(after, before), `${label}: the status leaves without a resize`);
  }
  // Small keeps fit 1 at Text 100% in every density and state, at the owner's 720p as well (#221). Its heading is
  // two lines; the status is the second one and may wrap between its phrases on a narrow grid, never inside one.
  const viewports = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  for (const size of viewports) {
    await page.setViewportSize(size);
    for (const density of Object.keys(GRID_DENSITIES)) for (const status of ['fresh', 'stale', 'offline']) {
      const label = `${size.width} small/${density}/${status}`;
      const m = await render({ size: 'small', density, status }); renders++;
      assert.ok(m.scale >= 0.999, `${label} fits without zooming out, scale=${m.scale}`);
      if (status === 'fresh') assert.equal(m.age, null, `${label}: no age while fresh (#715)`);
      else assert.deepEqual([m.status.lines, m.age.lines], [1, 1], `${label}: "${m.status.text}" and "${m.age.text}" each stay on one line`);
    }
  }
  await page.setViewportSize(viewport);
  // A forecast saved three days earlier still starts at today (#243).
  const saved = await render({ size: 'large', density: 'balanced', status: 'stale', daysEarlier: 3 }); renders++;
  assert.ok(saved.past.length > 0 && saved.past.every(date => date >= today), `no past day: ${saved.past}`);
  assert.equal(saved.heading, `Next ${saved.past.length} days`, 'the heading counts the days shown');
  reset();
  assert.ok(renders > 0);
  return `Forecast: Today then weekday labels with “Tomorrow, <date>” kept for assistive text (#256); fresh shows no provider name and no age, and nothing sits under the strip (#715); a saved or offline forecast says “Saved forecast · 5 hr ago”/“Offline · Updated …” in the heading's right slot in place of the place, whole in the caution tone at full opacity in Native and colour (#223); the strip has one size and position in every state and across a live poll, 20cqh glyphs in medium and large; a refresh in flight shows no status and a failed one does; small at fit 1 with unbroken phrases in every density and state at 720p/1080p/4K (#221); no past day from a forecast saved 3 days earlier (#243)`;
}
