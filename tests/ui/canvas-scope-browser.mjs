// #313 Editor-canvas class scope in production Edge. The editor canvas renders the widget renderers
// inside `.studio`, so a renderer class that reuses a studio class name (for example `preview-frame`)
// picks up editor chrome on the canvas only, where the display-only checks cannot see it. This suite
// renders every active widget in every family (and the boards and placeholders around them) on the
// editor canvas and fails when any element inside `.preview-surface` matches a `.studio`-scoped rule,
// other than the universal `.studio *` rule and the rule shared with the ambient root. A studio
// selector that reaches the canvas through the canvas root (`.grid-ambient` or `.preview-surface`,
// for example the editor's drop-in motion, #76) styles the canvas on purpose: it is listed, not
// failed. Own loopback server on port 0, temporary data, synthetic state with a RAM-only snapshot;
// nothing is saved and no screenshots are taken.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture, photoFixture } from '../../src/server/fixtures.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_IDS, widgetSizes } from '../../src/shared/widgets.ts';
import { WIDGET_CHECKS } from './widget-checks/index.mjs';

/**
 * Whole rules (selector lists, whitespace-normalised, `*::before` written `::before` as the build does)
 * that every canvas element may match: the universal `.studio` rule and the custom properties the
 * studio shares with the ambient root. Any other `.studio`-scoped selector matching a canvas element fails.
 */
export const ALLOWED_RULES = ['.studio *, .studio ::before, .studio ::after', '.grid-ambient, .studio'];
/** Every active widget on one Balanced 12 x 8 board (as in palette-browser.mjs); a newly activated widget must be added here. */
const FULL_BOARD = {
  clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
  sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
  reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
  note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
};

/**
 * Runs in the page: every `.studio`-scoped selector that matches an element inside `.preview-surface`,
 * across every stylesheet and every grouping rule (a rule inside a media query that does not apply at
 * this viewport still counts: the collision is latent). A pseudo-element or user-action state
 * (`:hover`, `:focus-visible`, ...) is dropped before matching, so `.studio .x::before` and
 * `.studio .x:hover` are checked against `.x`.
 */
function studioMatches(allowed) {
  const surface = document.querySelector('.preview-surface');
  if (!surface) return { error: 'no .preview-surface on the page' };
  const elements = [surface, ...surface.querySelectorAll('*')];
  const split = (text) => {
    const parts = []; let depth = 0, start = 0, quote = null;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quote) { if (char === '\\') index++; else if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (char === ',' && depth === 0) { parts.push(text.slice(start, index).trim()); start = index + 1; }
    }
    parts.push(text.slice(start).trim());
    return parts;
  };
  const normalize = (text) => split(text).map((part) => part.replace(/\s+/g, ' ').replace(/\*::/g, '::')).join(', ');
  const studio = /\.studio(?![\w-])/, canvasRoot = /\.(grid-ambient|preview-surface)(?![\w-])/;
  const subject = (selector) => {
    let query = selector
      .replace(/::?(before|after|marker|placeholder|selection|backdrop|first-line|first-letter|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g, '')
      .replace(/:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g, '').trim();
    if (query === '' || /[\s>+~]$/.test(query)) query += '*';
    return query;
  };
  const describe = (element) => {
    const name = element.tagName.toLowerCase() + [...element.classList].map((item) => `.${item}`).join('');
    const widget = element.closest('[data-widget-id]')?.dataset.widgetId;
    return widget ? `${name} in ${widget}` : name;
  };
  const found = [], deliberate = [], skipped = [], nested = [];
  let rules = 0, selectors = 0;
  const walk = (list, origin) => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) {
        rules++;
        if (rule.cssRules?.length) nested.push(`${origin}: ${rule.selectorText}`);
        if (allowed.includes(normalize(rule.selectorText))) continue;
        for (const selector of split(rule.selectorText)) {
          if (!studio.test(selector)) continue;
          selectors++;
          const query = subject(selector);
          try { surface.matches(query); } catch { skipped.push(`${origin}: ${selector}`); continue; }
          const hits = elements.filter((element) => element.matches(query));
          if (!hits.length) continue;
          // Written for the canvas: after `.studio` the selector names the canvas root.
          if (canvasRoot.test(selector.slice(selector.search(studio)))) { deliberate.push(selector); continue; }
          found.push({ selector, rule: rule.selectorText, origin, elements: [...new Set(hits.map(describe))].slice(0, 8), count: hits.length });
        }
      } else if (rule instanceof CSSImportRule) { if (rule.styleSheet) walk(rule.styleSheet.cssRules, rule.href); }
      else if (rule.cssRules) walk(rule.cssRules, origin);
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, sheet.href ?? 'inline <style>');
  return { found, deliberate, skipped, nested, rules, selectors, elements: elements.length, widgets: [...surface.querySelectorAll('[data-widget-id]')].map((element) => element.dataset.widgetId) };
}

export async function runCanvasScopeQa({ playwright, edge } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-canvas-scope-'));
  const now = Date.parse('2026-10-18T13:00:00Z');
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), now: () => now, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const checks = [], errors = [];
  try {
    const fresh = await (await fetch(`${base}/api/state`)).json();
    const source = structuredClone(fresh);
    // Every active widget gets its synthetic content (cities, countdowns, a note, an air reading,
    // reminders, a photo and a snapshot) from its tests/ui/widget-checks module.
    for (const id of ACTIVE_WIDGET_IDS) assert.ok(WIDGET_CHECKS[id], `${id} needs a tests/ui/widget-checks module`);
    for (const check of Object.values(WIDGET_CHECKS)) check.prepare?.(source, { now });
    assert.deepEqual(Object.keys(FULL_BOARD).sort(), [...ACTIVE_WIDGET_IDS].sort(), 'FULL_BOARD places every active widget; add a new one there');
    assert.ok(source.preview.available && source.photo.available, 'the synthetic state has a snapshot and a photo');
    // A valid mid-grey PNG (filter type 0 on every scanline, opaque), so Photo and Last screen paint.
    const pixels = Buffer.alloc((320 * 4 + 1) * 200, 90);
    for (let row = 0; row < 200; row++) { pixels[row * (320 * 4 + 1)] = 0; for (let x = 0; x < 320; x++) pixels[row * (320 * 4 + 1) + 1 + x * 4 + 3] = 255; }
    const image = photoFixture(320, 200, pixels);

    let current = structuredClone(source);
    /** One editor page per viewport and motion preference, its /api/state served from `current` (nothing is saved). */
    async function editor({ viewport = { width: 1280, height: 720 }, reducedMotion = 'no-preference' } = {}) {
      const context = await browser.newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion });
      await context.route('**/api/state', (route) => route.request().method() === 'GET'
        ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(current) })
        : route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Synthetic read-only state"}' }));
      await context.route('**/api/photo/image?*', (route) => route.fulfill({ contentType: 'image/png', body: image }));
      await context.route('**/api/preview/image?*', (route) => route.fulfill({ contentType: 'image/png', body: image }));
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${error.message} (${viewport.width}×${viewport.height})`));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} at ${message.location().url || 'unknown URL'} (${viewport.width}×${viewport.height})`); });
      await page.addInitScript(() => Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } }));
      await page.clock.install({ time: new Date(now) });
      return { page, close: () => context.close() };
    }
    const only = (id, size) => {
      const state = structuredClone(source);
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key === id]));
      if (id === 'preview') state.settings.preview.enabled = true;
      state.settings.widgetGrid.density = 'balanced';
      state.settings.widgetGrid.placements[id] = { column: 0, row: 0, size };
      return state;
    };
    const fullBoard = (mutate) => {
      const state = structuredClone(source);
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map((key) => [key, key in FULL_BOARD]));
      state.settings.preview.enabled = true; state.settings.widgetGrid.density = 'balanced';
      Object.assign(state.settings.widgetGrid.placements, structuredClone(FULL_BOARD));
      mutate?.(state);
      return state;
    };
    /** Every active widget on the board with no content of its own: the editor-only placeholders render. */
    const placeholders = (state) => {
      state.reminders = []; state.settings.widgetData.note = { text: '' }; state.settings.widgetData.worldClocks = []; state.settings.widgetData.countdowns = [];
      state.preview = { ...state.preview, available: false }; state.photo = { ...state.photo, available: false };
    };
    /** Saved weather and air quality: the stale status lines render. */
    const stale = (state) => {
      state.weather.status = 'stale'; state.weather.updatedAt = new Date(now - 3 * 3_600_000).toISOString();
      if (state.airQuality) state.airQuality.status = 'stale';
    };

    const failures = [], deliberate = new Set(), allowed = [...ALLOWED_RULES];
    let scenarios = 0, inspected = 0, studioSelectors = 0;
    /** Loads the editor with `state` and records every studio-scoped match on its canvas. */
    async function inspect(page, state, label, { expect = null, editLayout = false } = {}) {
      current = state;
      await page.goto(base + '/editor');
      await page.locator('.preview-surface .widget-grid-plane').waitFor();
      if (expect?.length) for (const id of expect) await page.locator(`.preview-surface [data-widget-id="${id}"]`).waitFor();
      if (editLayout) { await page.getByRole('button', { name: 'Edit layout', exact: true }).click(); await page.locator('.grid-editor').waitFor(); }
      await page.clock.runFor(500);
      // Images decode on their own schedule; the matches do not depend on pixels, only on the elements.
      const result = await page.evaluate(studioMatches, allowed);
      assert.equal(result.error, undefined, `${label}: ${result.error}`);
      assert.deepEqual(result.nested, [], `${label}: a nested style rule needs the guard extended to resolve its selector`);
      assert.deepEqual(result.skipped, [], `${label}: every studio-scoped selector can be matched`);
      if (expect) assert.deepEqual([...new Set(result.widgets)].sort(), [...expect].sort(), `${label}: the canvas renders the expected widgets`);
      for (const selector of result.deliberate) deliberate.add(selector);
      for (const hit of result.found) failures.push(`${label}: ${hit.selector} (rule "${hit.rule}" in ${hit.origin}) matches ${hit.count} canvas element(s): ${hit.elements.join(', ')}`);
      scenarios++; inspected += result.elements; studioSelectors = Math.max(studioSelectors, result.selectors);
      assert.ok(result.rules > 100 && result.selectors > 50, `${label}: the guard read the studio stylesheet (${result.rules} rules, ${result.selectors} studio selectors)`);
    }

    // Every active widget alone in every family at the owner's TV size (1280×720), at the default
    // Subtle level and with reduced motion (Animation Off on the studio root).
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const view = await editor({ reducedMotion });
      let families = 0;
      for (const id of ACTIVE_WIDGET_IDS) for (const size of widgetSizes(id)) {
        await inspect(view.page, only(id, size), `${id} ${size} at 1280×720 (${reducedMotion})`, { expect: [id] });
        families++;
      }
      await view.close();
      checks.push(`every active widget in every family on the editor canvas at 1280×720, reduced motion ${reducedMotion}: ${ACTIVE_WIDGET_IDS.length} widgets, ${families} families`);
    }

    // The full board with a snapshot and a photo, its stale variant, the placeholders and Edit layout,
    // at 1280×720 and a phone width.
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const view = await editor({ viewport });
      const label = `${viewport.width}×${viewport.height}`;
      await inspect(view.page, fullBoard(), `full board with a snapshot and a photo at ${label}`, { expect: ACTIVE_WIDGET_IDS });
      await inspect(view.page, fullBoard(stale), `full board with saved weather and air quality at ${label}`, { expect: ACTIVE_WIDGET_IDS });
      await inspect(view.page, fullBoard(placeholders), `full board of editor-only placeholders at ${label}`);
      await inspect(view.page, fullBoard(), `full board in Edit layout at ${label}`, { expect: ACTIVE_WIDGET_IDS, editLayout: true });
      await inspect(view.page, structuredClone(source), `default board at ${label}`);
      await view.close();
    }
    checks.push('the full board (every active widget, a snapshot and a photo), its saved-weather variant, a board of editor-only placeholders, the full board in Edit layout and the default board on the editor canvas at 1280×720 and 390×844');

    assert.deepEqual(failures, [], `#313: a widget renderer element on the editor canvas matches a .studio-scoped rule (allowed: ${ALLOWED_RULES.map((rule) => `"${rule}"`).join(' and ')}). Rename the renderer class so it does not reuse a studio class name`);
    checks.push(`no element on the editor canvas matches a .studio-scoped rule other than ${ALLOWED_RULES.map((rule) => `"${rule}"`).join(' and ')}: ${scenarios} canvases, ${inspected} elements, ${studioSelectors} studio-scoped selectors`);
    checks.push(`studio selectors written for the canvas through its root (listed, not failed): ${[...deliberate].join('; ') || 'none'}`);
    assert.deepEqual(errors, []);
    return { checks, images: 'none taken' };
  } finally {
    await browser.close(); app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { playwright: { type: 'string' }, edge: { type: 'string' } } });
  const result = await runCanvasScopeQa(values);
  console.log(JSON.stringify({ passed: result.checks.length, checks: result.checks, images: result.images }, null, 2));
}
