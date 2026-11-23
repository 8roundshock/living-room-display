import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { prepareCollection } from '../lib/collection-fixture.mjs';
import { assertNoSourceOrFreshAge } from '../lib/source-age.mjs';
export const id = 'weatherAlerts';
export const selectors = ['.collection-label', '.collection-value', '.collection-title', '.collection-footer', '.collection-hour-value'];
export function prepare(state, options) { prepareCollection(state, options); }
export async function family({ widget }) {
  assert.equal(await widget.locator('.collection-face').count(), 1, 'weatherAlerts owns its face');
  assert.ok((await widget.innerText()).trim().length > 0, 'weatherAlerts has real content or an honest empty state');
  assert.equal(await widget.locator('button, input, a, select').count(), 0, 'weatherAlerts stays passive');
}

const HOUR = 3600_000, MINUTE = 60_000;
/** A synthetic provider answer; `checked` is how long before the page's clock the last successful check was. */
const alertsState = (status, clock, checked, alerts = []) => ({
  status, provider: 'eccc', source: 'Environment and Climate Change Canada', sourceUrl: 'https://weather.gc.ca/', area: 'Sample area',
  checkedAt: checked === null ? null : new Date(clock - checked).toISOString(), error: null, alerts,
});
const warning = clock => ({ id: 'synthetic-warning', level: 'warning', name: 'Snowfall warning', area: 'Sample area', issuedAt: new Date(clock - HOUR).toISOString(), startsAt: null, endsAt: null, expiresAt: new Date(clock + 12 * HOUR).toISOString() });

/** What the widget shows: its lines, the status line's cue and the fit. */
function read(widget) {
  return widget.evaluate(section => {
    const probe = document.createElement('span'); probe.style.color = 'var(--ambient-caution)'; section.append(probe);
    const caution = getComputedStyle(probe).color; probe.remove();
    const plain = text => text.replace(/[  ]/g, ' ').trim();
    const status = section.querySelector('.collection-footer .collection-status'), age = section.querySelector('.collection-footer .collection-age');
    let opacity = 1; for (let at = status; at && at !== section.parentElement; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity);
    const outer = section.getBoundingClientRect(), box = status?.getBoundingClientRect();
    return {
      lines: plain(section.innerText).split('\n').map(line => line.trim()).filter(Boolean), footers: section.querySelectorAll('.collection-footer').length,
      status: status && { text: plain(status.textContent), shared: status.classList.contains('status-caution'), tone: getComputedStyle(status).color === caution, opacity,
        inside: box.left >= outer.left - 1 && box.right <= outer.right + 1 && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1 },
      ageLines: age ? new Set([...age.getClientRects()].map(rect => Math.round(rect.top))).size : 0,
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a, clock: Date.now(),
    };
  });
}

/**
 * #715: the Weather alerts status line in every state, with its exact words. Fresh alerts have no footer at all (no
 * issuer, no age). Saved, unavailable and offline alerts keep one status-tone line with the age of the last successful
 * check: "Saved alerts · 2 hr ago", "Updated 2 hr ago" under "Alerts unavailable", "Offline · Updated 7 min ago".
 * Both families, every density, at this viewport and (once) at 1280×720, at fit 1.
 */
export async function sweep({ page, viewport, state, base }) {
  const pristine = structuredClone(state);
  const reset = () => { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, structuredClone(pristine)); };
  const widget = page.locator('[data-widget-id="weatherAlerts"]');
  async function render({ size, density, alerts, offline = false }) {
    reset();
    const clock = await page.evaluate(() => Date.now()).catch(() => Date.parse(pristine.weather.updatedAt));
    state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1;
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'weatherAlerts']));
    state.settings.widgetGrid.placements.weatherAlerts = { column: 0, row: 0, size };
    state.alerts = alerts(clock);
    await page.goto(base + '/display'); await widget.locator('.collection-face').waitFor(); await page.clock.runFor(100);
    if (offline) {
      await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' }));
      try { await page.clock.runFor(31_000); await widget.locator('.collection-status', { hasText: 'Offline' }).waitFor(); }
      finally { await page.unroute('**/api/state'); }
    }
    return read(widget);
  }
  const CASES = [
    { name: 'fresh, none in effect', alerts: clock => alertsState('fresh', clock, 4 * MINUTE), lines: ['Weather alerts', 'No current alerts'], status: null },
    { name: 'fresh, one in effect', alerts: clock => alertsState('fresh', clock, 4 * MINUTE, [warning(clock)]), lines: size => ['Weather alerts', 'warning', 'Snowfall warning', ...(size === 'large' ? ['Sample area'] : [])], status: null },
    { name: 'saved', alerts: clock => alertsState('stale', clock, 2 * HOUR), lines: ['Weather alerts', 'Current alerts unknown', 'Saved alerts · 2 hr ago'], status: 'Saved alerts · 2 hr ago' },
    { name: 'saved, one in effect', alerts: clock => alertsState('stale', clock, 2 * HOUR, [warning(clock)]), lines: size => ['Weather alerts', 'warning', 'Snowfall warning', ...(size === 'large' ? ['Sample area'] : []), 'Saved alerts · 2 hr ago'], status: 'Saved alerts · 2 hr ago' },
    { name: 'saved, never checked', alerts: clock => alertsState('stale', clock, null), lines: ['Weather alerts', 'Current alerts unknown', 'Saved alerts'], status: 'Saved alerts' },
    { name: 'unavailable, last checked 2 h ago', alerts: clock => alertsState('unavailable', clock, 2 * HOUR), lines: ['Weather alerts', 'Alerts unavailable', 'Updated 2 hr ago'], status: 'Updated 2 hr ago' },
    { name: 'unavailable, last checked 26 h ago', alerts: clock => alertsState('unavailable', clock, 26 * HOUR), lines: ['Weather alerts', 'Alerts unavailable', 'Updated 1 day ago'], status: 'Updated 1 day ago' },
    { name: 'unavailable, never checked', alerts: clock => alertsState('unavailable', clock, null), lines: ['Weather alerts', 'Alerts unavailable'], status: null },
    { name: 'unsupported', alerts: clock => ({ ...alertsState('unsupported', clock, null), provider: null, source: null }), lines: ['Weather alerts', 'No provider for this area'], status: null },
    // Offline: the last answer was fresh and checked two hours before; the age keeps its "Updated" after "Offline".
    { name: 'offline', offline: true, alerts: clock => alertsState('fresh', clock, 2 * HOUR), lines: ['Weather alerts', 'Current alerts unknown', 'Offline · Updated 2 hr ago'], status: 'Offline · Updated 2 hr ago' },
    { name: 'offline, one in effect', offline: true, alerts: clock => alertsState('fresh', clock, 2 * HOUR, [warning(clock)]), lines: size => ['Weather alerts', 'warning', 'Snowfall warning', ...(size === 'large' ? ['Sample area'] : []), 'Offline · Updated 2 hr ago'], status: 'Offline · Updated 2 hr ago' },
    { name: 'offline, unavailable', offline: true, alerts: clock => alertsState('unavailable', clock, 2 * HOUR), lines: ['Weather alerts', 'Alerts unavailable', 'Offline · Updated 2 hr ago'], status: 'Offline · Updated 2 hr ago' },
    { name: 'offline, never checked', offline: true, alerts: clock => alertsState('fresh', clock, null), lines: ['Weather alerts', 'Current alerts unknown', 'Offline'], status: 'Offline' },
  ];
  const views = viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport];
  let renders = 0;
  for (const view of views) {
    await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['medium', 'large']) for (const item of CASES) {
      // The exact words are the same in every grid; the two smaller grids repeat only the states that have a line.
      if (density !== 'balanced' && item.status === null) continue;
      const label = `weatherAlerts ${size}/${density}/${view.width} ${item.name}`;
      const m = await render({ size, density, alerts: item.alerts, offline: item.offline });
      renders++;
      assert.deepEqual(m.lines, typeof item.lines === 'function' ? item.lines(size) : item.lines, `${label}: exactly these lines`);
      if (item.status === null) {
        assert.deepEqual([m.footers, m.status], [0, null], `${label}: no footer and no status line`);
      } else {
        assert.equal(m.status.text, item.status, `${label}: the exact status wording`);
        assert.deepEqual([m.status.shared, m.status.tone, m.status.opacity, m.status.inside], [true, true, 1, true], `${label}: one status-tone line at full opacity, inside the widget`);
        assert.ok(m.ageLines <= 1, `${label}: the age never breaks inside`);
      }
      assert.ok(m.fit >= 0.995, `${label}: fit 1 (${m.fit})`);
      await assertNoSourceOrFreshAge(widget, label, { fresh: item.status === null, id: 'weatherAlerts' });
    }
  }
  await page.setViewportSize(viewport);
  reset();
  return `Weather alerts status line (#715): no footer while fresh or unsupported; "Saved alerts · 2 hr ago", "Updated 2 hr ago"/"Updated 1 day ago" under "Alerts unavailable", and "Offline · Updated 2 hr ago" as exact words in the status tone at full opacity, with and without an alert in effect, medium and large in every density at fit 1 (${renders} renders at ${viewport.width}${viewport.width === 1920 ? ' and 1280' : ''})`;
}
