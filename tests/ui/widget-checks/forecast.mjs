import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { withOwnClock } from '../lib/own-clock.mjs';

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
    // The lines a node's text takes: the line boxes of its contents (a block has one box of its own however its text
    // wraps), counted as tops more than 2px apart.
    const lines = node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const tops = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.top).sort((a, b) => a - b);
      return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 2).length;
    };
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

/** Independent display contract for an age: minutes below an hour, then whole hours and days. */
function elapsed(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * Every render here is on a page with a paused clock of its own (tests/ui/lib/own-clock.mjs): the offline cases and
 * the live polls run the 30 s state poll, which must not move the suite's shared page clock, and each render starts
 * at `now`, so the ages are exact.
 */
export async function sweep({ page, viewport, state, base, now }) {
  // The route serves this very object, so every case edits it in place from a pristine copy.
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: pristine.weather.location.timezone }).format(now);
  const failed = 'Weather update failed. Showing the last successful forecast.';
  /**
   * The weather a state stands for. `refreshing` is what the server answers while a due refresh takes over a second
   * (#351): stale, 16 minutes old, with a refresh in flight and no failure yet. `retrying` is a later attempt after a
   * failed one. `unknown` is dated ten minutes ahead of the clock, so no age can be told (#244). `long` has the
   * longest age wording.
   */
  const WEATHER = {
    fresh: () => {},
    stale: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now - 5 * HOUR).toISOString() }),
    offline: () => {},
    refreshing: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now - 16 * MINUTE).toISOString(), error: null, refreshing: true }),
    retrying: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now - 5 * HOUR).toISOString(), error: failed, refreshing: true }),
    unknown: weather => Object.assign(weather, { status: 'stale', updatedAt: new Date(now + 10 * MINUTE).toISOString() }),
    offlineUnknown: weather => Object.assign(weather, { updatedAt: new Date(now + 10 * MINUTE).toISOString() }),
    offlineLong: weather => Object.assign(weather, { updatedAt: new Date(now - 364 * 24 * HOUR).toISOString() }),
  };
  const OFFLINE = new Set(['offline', 'offlineUnknown', 'offlineLong']);
  /** The exact words in the heading's right slot, or null for the place and unit. Small has no room for "Update time unknown". */
  const offlineAge = elapsed(Math.floor((now + 31_100 - Date.parse(pristine.weather.updatedAt)) / MINUTE));
  const WORDS = {
    fresh: () => null, refreshing: () => null,
    stale: () => 'Saved forecast · 5 hr ago', retrying: () => 'Saved forecast · 5 hr ago',
    offline: () => `Offline · Updated ${offlineAge}`,
    unknown: size => size === 'small' ? 'Saved forecast' : 'Saved forecast · Update time unknown',
    offlineUnknown: size => size === 'small' ? 'Offline' : 'Offline · Update time unknown',
    offlineLong: () => 'Offline · Updated 364 days ago',
  };
  function arrange({ size, density, status, accentMode = 'native', daysEarlier = 0 }) {
    reset();
    state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.appearance.accentMode = accentMode;
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'forecast']));
    state.settings.widgetGrid.placements.forecast = { column: 0, row: 0, size };
    WEATHER[status](state.weather);
    if (daysEarlier) state.weather.daily = state.weather.daily.map(day => { const date = new Date(`${day.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - daysEarlier); return { ...day, date: date.toISOString().slice(0, 10) }; });
  }
  const sameStrip = (a, b) => Math.abs(a.strip.top - b.strip.top) <= 0.5 && Math.abs(a.strip.height - b.strip.height) <= 0.5 && Math.abs(a.glyph - b.glyph) <= 0.1 && Math.abs(a.dayLabel - b.dayLabel) <= 0.05 && Math.abs(a.temperatures - b.temperatures) <= 0.05;
  const geometry = m => ({ strip: m.strip, glyph: m.glyph, dayLabel: m.dayLabel, temperatures: m.temperatures, heading: m.headingHeight });
  const plain = text => text.replace(/\s+/g, ' ');
  let renders = 0;
  try {
    await withOwnClock(page, { viewport, state, now }, async (own, clock) => {
      async function render(options) {
        arrange(options); await clock.restart();
        await own.goto(base + '/display'); await own.locator('[data-widget-id="forecast"] .forecast-strip').waitFor(); await own.clock.runFor(100);
        if (OFFLINE.has(options.status)) {
          clock.setOffline(true);
          try { await own.clock.runFor(31_000); await own.locator('[data-widget-id="forecast"] .forecast-status', { hasText: 'Offline' }).waitFor(); }
          finally { clock.setOffline(false); }
        }
        renders++;
        return inspect(own);
      }
      for (const size of ['small', 'medium', 'large']) for (const accentMode of ['native', 'color']) {
        const shown = {};
        for (const status of ['fresh', 'stale', 'offline', 'refreshing', 'retrying']) {
          // Colour mode repeats the tone checks; the refresh states do not depend on it.
          if (accentMode === 'color' && (status === 'refreshing' || status === 'retrying')) continue;
          const label = `${viewport.width} ${size}/${accentMode}/${status}`;
          const m = await render({ size, density: 'balanced', status, accentMode });
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
          assert.doesNotMatch(m.text, /Toronto|°[CF]/, `${label}: the status replaces the place and the unit`);
          assert.equal(plain(m.line.text), WORDS[status](size), `${label}: the label, then the age ("Updated" stays after Offline)`);
          assert.equal(m.status.text, status === 'offline' ? 'Offline' : 'Saved forecast', label);
          for (const [name, part] of [['line', m.line], ['label', m.status], ['age', m.age]]) {
            assert.equal(part.color, m.caution, `${label}: ${name} in the caution tone`);
            assert.equal(part.opacity, 1, `${label}: ${name} at full opacity`);
          }
          assert.deepEqual([m.status.lines, m.age.lines, m.slot.lines], [1, 1, 1], `${label}: unbroken phrases on one line`);
        }
        // No size switch (#715): the slot keeps the place's typography, so the heading keeps its height and the strip its
        // size and position, whatever the state. A status that comes or goes resizes nothing.
        for (const [status, m] of Object.entries(shown)) {
          const label = `${viewport.width} ${size}/${accentMode}/${status}`;
          assert.equal(m.slot.size, shown.fresh.slot.size, `${label}: the slot's text size is the place's`);
          assert.ok(Math.abs(m.headingHeight - shown.fresh.headingHeight) <= 0.5, `${label}: the heading keeps its height ${JSON.stringify([m.headingHeight, shown.fresh.headingHeight])}`);
          assert.ok(sameStrip(m, shown.fresh), `${label}: the strip has the fresh strip's size and position ${JSON.stringify([geometry(m), geometry(shown.fresh)])}`);
        }
        // Medium and large took the room the old footer held: 20cqh glyphs (16cqh before #715), in every state.
        if (size !== 'small') assert.ok(Math.abs(shown.stale.glyph / shown.stale.content - 0.20) < 0.004, `${viewport.width} ${size}/${accentMode}: saved glyphs are 20% of the content height ${shown.stale.glyph}/${shown.stale.content}`);
      }
      // Live: a display that is already open gains and loses the status on its 30 s poll without the strip moving or
      // resizing (the reviewer's finding on the earlier size switch), in every family.
      for (const size of ['small', 'medium', 'large']) {
        const label = `${viewport.width} ${size} live`;
        const before = await render({ size, density: 'balanced', status: 'fresh' });
        // The next poll answers `stale` and `refreshing` (a due refresh that outlasts the server's one-second wait): still fresh.
        WEATHER.refreshing(state.weather);
        await own.clock.runFor(30_500);
        const during = await inspect(own);
        assert.equal(during.line, null, `${label}: a refresh in flight shows no status`);
        assert.ok(sameStrip(during, before), `${label}: nothing moves while a refresh runs ${JSON.stringify([geometry(during), geometry(before)])}`);
        // The refresh fails: now it is a saved forecast, in the slot, and the strip still has not moved.
        Object.assign(state.weather, { error: failed }); delete state.weather.refreshing;
        await own.clock.runFor(30_500);
        await own.locator('[data-widget-id="forecast"] .forecast-status-line').waitFor();
        const saved = await inspect(own);
        assert.match(plain(saved.line.text), /^Saved forecast · 1[67] min ago$/, `${label}: the failed refresh reads as saved`);
        assert.ok(sameStrip(saved, before) && Math.abs(saved.headingHeight - before.headingHeight) <= 0.5 && saved.scale === before.scale, `${label}: the status arrives without a resize ${JSON.stringify([geometry(saved), geometry(before)])}`);
        // And back to fresh.
        Object.assign(state.weather, structuredClone(pristine.weather));
        await own.clock.runFor(30_500);
        await own.locator('[data-widget-id="forecast"] .forecast-status-line').waitFor({ state: 'detached' });
        const after = await inspect(own);
        assert.equal(after.slot.text, 'Toronto · °C', `${label}: the place and unit return`);
        assert.ok(sameStrip(after, before), `${label}: the status leaves without a resize`);
      }
      // One heading height and one strip in every state (#715), in every family and density, at the owner's 720p as
      // well: the slot keeps the place's typography and stays on one line whatever it says, up to the longest wording
      // ("Offline · Updated 364 days ago"). Small's slot is its heading's second line and has no room for "Saved
      // forecast · Update time unknown", so there a status with no update time to tell is the label alone. All at
      // fit 1 at Text 100% (#221).
      const views = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
      for (const view of views) {
        await own.setViewportSize(view);
        for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['small', 'medium', 'large']) {
          const fresh = await render({ size, density, status: 'fresh' });
          assert.ok(fresh.scale >= 0.999, `${view.width} ${size}/${density}/fresh fits without zooming out, scale=${fresh.scale}`);
          assert.deepEqual([fresh.line, fresh.age, fresh.slot.text, fresh.slot.lines], [null, null, 'Toronto · °C', 1], `${view.width} ${size}/${density}/fresh: the place and unit, no status and no age`);
          for (const status of ['stale', 'offline', 'unknown', 'offlineUnknown', 'offlineLong']) {
            const label = `${view.width} ${size}/${density}/${status}`;
            const m = await render({ size, density, status });
            assert.ok(m.scale >= 0.999, `${label} fits without zooming out, scale=${m.scale}`);
            assert.equal(plain(m.line.text), WORDS[status](size), `${label}: the exact words`);
            assert.deepEqual([m.line.isSlot, m.line.shared, m.line.color === m.caution, m.line.opacity], [true, true, true, 1], `${label}: the status is the slot, in the status tone`);
            assert.deepEqual([m.status.lines, m.age?.lines ?? 1, m.slot.lines], [1, 1, 1], `${label}: "${m.line.text}" stays on one line, unbroken`);
            assert.equal(m.slot.size, fresh.slot.size, `${label}: the slot's text size is the place's`);
            assert.ok(Math.abs(m.headingHeight - fresh.headingHeight) <= 0.5, `${label}: the heading keeps its height ${JSON.stringify([m.headingHeight, fresh.headingHeight])}`);
            assert.ok(sameStrip(m, fresh), `${label}: the strip has the fresh strip's size and position ${JSON.stringify([geometry(m), geometry(fresh)])}`);
          }
        }
      }
      await own.setViewportSize(viewport);
      // A forecast saved three days earlier still starts at today (#243).
      const saved = await render({ size: 'large', density: 'balanced', status: 'stale', daysEarlier: 3 });
      assert.ok(saved.past.length > 0 && saved.past.every(date => date >= today), `no past day: ${saved.past}`);
      assert.equal(saved.heading, `Next ${saved.past.length} days`, 'the heading counts the days shown');
    });
  } finally { reset(); }
  assert.ok(renders > 0);
  return `Forecast: Today then weekday labels with “Tomorrow, <date>” kept for assistive text (#256); fresh shows no provider name and no age, and nothing sits under the strip (#715); a saved or offline forecast says “Saved forecast · 5 hr ago”/“Offline · Updated …” in the heading's right slot in place of the place and unit, whole in the caution tone at full opacity in Native and colour (#223); one heading height and one strip size and position in every state (saved, offline, no update time to tell, the longest age) in every family and density at 720p/1080p/4K at fit 1 (#221), and across a live poll; 20cqh glyphs in medium and large; a refresh in flight shows no status and a failed one does; no past day from a forecast saved 3 days earlier (#243)`;
}
