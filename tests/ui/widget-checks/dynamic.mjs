import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

// Dynamic (#437). The shared fixture rains every hour (60%, 0.8 mm), so Dynamic leads with the
// forecast's "Rain likely" card in focus mode, with the Weather kicker and a weather glyph.
export const id = 'dynamic';
export const selectors = ['.dynamic-headline', '.dynamic-detail', '.dynamic-value', '.dynamic-provenance', '.dynamic-status', '.dynamic-also li:not(.dynamic-overflow)', '.dynamic-more', '.dynamic-footer'];
const HOUR = 3600_000;

export function prepare(state) {
  // Official alerts are off in the shared fixture (a fresh data folder has Dynamic off); the
  // tests/ui/dynamic-browser.mjs suite covers them with its own synthetic providers.
  state.alerts = { status: 'off', provider: null, source: null, sourceUrl: null, area: null, checkedAt: null, error: null, alerts: [] };
}

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

export async function family({ widget, size }) {
  const body = widget.locator('.dynamic-body');
  assert.equal(await body.getAttribute('data-dynamic-mode'), 'focus', `${size}: rain now leads in focus mode`);
  assert.equal(await body.getAttribute('data-dynamic-kind'), 'rain-now');
  assert.equal(await body.getAttribute('data-dynamic-source'), 'weather');
  assert.equal(await widget.locator('.dynamic-card').count(), 1, 'one card at a time');
  assert.equal(await widget.locator('.dynamic-kicker').innerText(), 'Weather');
  assert.match(await widget.locator('.dynamic-headline').innerText(), /^Rain likely/);
  assert.equal(await widget.locator('.dynamic-card [data-glyph]').count(), 1, 'a weather glyph, never the hero');
  assert.equal(await widget.locator('[data-glyph-hero]').count(), 0);
  // The fixture's countdowns today and tomorrow are notable cards after the lead.
  if (size === 'large') {
    const rows = await widget.locator('.dynamic-also li:not(.dynamic-overflow)').count();
    assert.ok(rows >= 1 && rows <= 3, `large lists one to three whole rows (${rows})`);
  } else assert.match(await widget.locator('.dynamic-more').innerText(), /^· \+\d+ more$/);
  assert.match(await widget.locator('.dynamic-footer').innerText(), /Forecast estimate/, 'a forecast reads as an estimate');
  // Nothing loops, glows or blinks: no animation runs at rest.
  assert.equal(await widget.evaluate(section => section.getAnimations({ subtree: true }).length), 0);
}

/** The widget's fit scale. */
const fitOf = widget => widget.evaluate(section => new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a);

/**
 * #221 for Dynamic: every family renders at fit 1 at Text 100% in every density, fresh, stale and offline,
 * at 1280×720, the owner's TV in CSS pixels (once, on the 1080p pass). The harness's floor check covers
 * 1080p and 4K, and tests/ui/dynamic-browser.mjs checks fit at 4K in its scenarios.
 */
export async function sweep({ page, viewport, state, now }) {
  if (viewport.width !== 1920) return null;
  const views = [{ width: 1280, height: 720 }];
  const fresh = structuredClone(state.weather);
  let cases = 0;
  const failures = [];
  for (const view of views) {
    await page.setViewportSize(view);
    for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['small', 'medium', 'large']) for (const status of ['fresh', 'stale', 'offline']) {
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'dynamic']));
      state.settings.widgetGrid.density = density; state.settings.widgetGrid.placements.dynamic = { column: 0, row: 0, size };
      state.settings.appearance.fontScale = 1; state.settings.appearance.motionEnabled = false;
      state.weather = status === 'stale' ? { ...structuredClone(fresh), status: 'stale', updatedAt: new Date(now - 2 * HOUR).toISOString() } : structuredClone(fresh);
      await reload(page);
      const widget = page.locator('[data-widget-id="dynamic"]');
      if (status === 'offline') {
        await page.route('**/api/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' }));
        try {
          await page.clock.runFor(30_000);
          for (let attempt = 0; attempt < 100 && !/Offline/i.test(await widget.innerText()); attempt++) await page.waitForTimeout(40);
        } finally { await page.unroute('**/api/state'); }
        assert.match(await widget.innerText(), /Offline/i, `${size}/${density} offline says so`);
      }
      if (status === 'stale') assert.match(await widget.innerText(), /Saved forecast/, `${size}/${density} stale says so`);
      const fit = await fitOf(widget);
      if (fit < 0.995) failures.push(`${size}/${density} ${view.width}×${view.height} ${status}: fit ${fit.toFixed(3)}`);
      cases++;
    }
  }
  state.weather = fresh;
  await page.setViewportSize(viewport);
  assert.deepEqual(failures, [], 'Dynamic renders at fit 1 at Text 100%');
  return `Dynamic small/medium/large fit 1 at Text 100% in every density, fresh/stale/offline, at 1280×720 (${cases} cases)`;
}
