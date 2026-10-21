import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

// Synthetic dates around the suites' clock (2026-10-18 in Toronto): six upcoming and one passed.
export const LONG_TITLE = 'A deliberately long synthetic title that wraps across lines';
export const id = 'countdown';
// Large hides the rows that do not fit (#221), so only shown rows count for clipping.
export const selectors = ['.countdown-hero .countdown-value', '.countdown-title', '.countdown-hero .countdown-date', '.countdown-row:not(.countdown-overflow)', '.countdown-row:not(.countdown-overflow) :is(.countdown-value, .countdown-date)', '.countdown-more'];
export function prepare(state) {
  state.settings.widgetData.countdowns = [
    ['Holiday', '2026-12-24', false], ['Passed one-time', '2026-10-01', false], [LONG_TITLE, '2026-10-19', false],
    ['Weekend trip', '2026-10-30', false], ['Birthday', '1990-11-03', true], ['Synthetic today', '2026-10-18', false], ['Next spring', '2027-03-01', false],
  ].map(([title, date, repeatsYearly], index) => ({ id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`, title, date, repeatsYearly }));
}

/** Every upcoming date, soonest first, as the large rows show them. */
const UPCOMING = [['Synthetic today', 'Today'], [LONG_TITLE, 'Tomorrow'], ['Weekend trip', '12 days'], ['Birthday', '16 days'], ['Holiday', '67 days'], ['Next spring', '134 days']];

const rowsOf = widget => widget.locator('.countdown-row:not(.countdown-overflow)').evaluateAll(rows => rows.map(row => [row.querySelector('.countdown-row-title').textContent, row.querySelector('.countdown-row-days').getAttribute('aria-label')]));

async function reopen(page) {
  await page.reload();
  await page.locator('.display-page').waitFor();
  await page.clock.runFor(100);
}

/** The measured large list: shown rows, the exact remainder, completeness, scale and rendered sizes. */
function largeFacts(widget) {
  return widget.evaluate(element => {
    const outer = element.getBoundingClientRect();
    const inside = node => { const rect = node.getBoundingClientRect(); return rect.top >= outer.top - 1 && rect.bottom <= outer.bottom + 1 && rect.left >= outer.left - 1 && rect.right <= outer.right + 1; };
    const rows = [...element.querySelectorAll('.countdown-list > .countdown-row')];
    const shown = rows.filter(row => !row.classList.contains('countdown-overflow'));
    const scale = new DOMMatrix(getComputedStyle(element.querySelector('.widget-content')).transform).a;
    const rendered = selector => Math.min(...shown.map(row => parseFloat(getComputedStyle(row.querySelector(selector)).fontSize) * scale));
    const more = element.querySelector('.countdown-more');
    const style = getComputedStyle(element);
    return {
      rows: shown.map(row => [row.querySelector('.countdown-row-title').textContent, row.querySelector('.countdown-row-days').getAttribute('aria-label')]),
      outside: shown.filter(row => !inside(row)).length,
      overflowRendered: rows.filter(row => row.classList.contains('countdown-overflow') && (getComputedStyle(row).display !== 'none' || row.getBoundingClientRect().height > 0)).length,
      more: more ? more.textContent : null,
      moreInside: more ? inside(more) : true,
      scale,
      date: rendered('.countdown-date'), title: rendered('.countdown-row-title'),
      floors: { data: parseFloat(style.getPropertyValue('--min-data')), text: parseFloat(style.getPropertyValue('--min-text')) },
      right: shown.map(row => Math.round(row.querySelector('.countdown-row-days').getBoundingClientRect().right)),
    };
  });
}

function assertLarge(facts, label) {
  assert.ok(facts.rows.length >= 3, `${label}: a large Countdown lists several dates ${JSON.stringify(facts)}`);
  assert.deepEqual(facts.rows, UPCOMING.slice(0, facts.rows.length), `${label}: soonest first`);
  const hidden = UPCOMING.length - facts.rows.length;
  assert.equal(facts.more, hidden > 0 ? `+${hidden} more` : null, `${label}: an exact remaining count`);
  assert.equal(facts.outside, 0, `${label}: every shown row is complete ${JSON.stringify(facts)}`);
  assert.equal(facts.overflowRendered, 0, `${label}: rows that do not fit take no layout`);
  assert.ok(facts.moreInside, `${label}: "+N more" stays inside`);
  assert.equal(facts.scale, 1, `${label}: Text size 100% fits without zooming out`);
  assert.ok(facts.date >= facts.floors.data * 0.99 && facts.title >= facts.floors.text * 0.99, `${label}: dates and titles keep their floors ${JSON.stringify(facts)}`);
  assert.equal(new Set(facts.right).size, 1, `${label}: days are right-aligned: ${facts.right}`);
}

/** #193: with the date and settings unchanged, one-second ticks construct no Intl formatter. */
export async function intlPerTick(page, label) {
  await page.evaluate(() => {
    window.__intlConstructions = 0;
    for (const name of ['DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'Locale']) {
      const Original = Intl[name];
      Intl[name] = new Proxy(Original, {
        construct(target, args) { window.__intlConstructions++; return Reflect.construct(target, args); },
        apply(target, self, args) { window.__intlConstructions++; return Reflect.apply(target, self, args); },
      });
    }
  });
  await page.clock.runFor(5000);
  assert.equal(await page.evaluate(() => window.__intlConstructions), 0, `${label}: five ticks construct no Intl formatter`);
}

export async function family({ page, widget, size, density, viewport, state }) {
  assert.equal(LONG_TITLE.length <= 60, true);
  assert.doesNotMatch(await widget.innerText(), /Passed one-time/, 'past one-time events are ignored on the display');
  if (size !== 'large') {
    assert.equal(await widget.locator('.countdown-count').getAttribute('aria-label'), 'Today');
    assert.equal(await widget.locator('.countdown-title').innerText(), 'Synthetic today');
    assert.equal(await widget.locator('.countdown-hero .countdown-date').innerText(), 'Sun, Oct 18');
  }
  if (size === 'small') assert.equal(await widget.locator('.countdown-row').count(), 0);
  if (size === 'medium') assert.deepEqual(await rowsOf(widget), [[LONG_TITLE, 'Tomorrow'], ['Weekend trip', '12 days']], 'medium lists the next two');
  if (size === 'large') {
    // As many rows as fit, then an exact "+N more" (#221), in every density, also with Monospace in Balanced.
    assertLarge(await largeFacts(widget), `large/${density}/${viewport.width}p`);
    if (density === 'balanced') {
      const fontFamily = state.settings.appearance.fontFamily;
      state.settings.appearance.fontFamily = 'mono';
      try { await reopen(page); assertLarge(await largeFacts(widget), `large/${density}/${viewport.width}p mono`); } finally { state.settings.appearance.fontFamily = fontFamily; await reopen(page); }
    }
  }
  if (viewport.width === 1920 && density === 'balanced') await intlPerTick(page, `${size} Countdown`);
}

/** #221 at the owner's 1280×720 CSS viewport (the 4K TV at 300%): large fits every density, Monospace in Balanced too. */
export async function sweep({ page, viewport, state, base }) {
  if (viewport.width !== 1920) return null;
  const widget = page.locator('[data-widget-id="countdown"]');
  await page.setViewportSize({ width: 1280, height: 720 });
  try {
    for (const density of Object.keys(GRID_DENSITIES)) for (const fontFamily of density === 'balanced' ? ['sans', 'mono'] : ['sans']) {
      state.settings.appearance.motionEnabled = false; state.settings.appearance.fontFamily = fontFamily; state.settings.appearance.fontScale = 1;
      state.settings.widgetGrid.density = density;
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'countdown']));
      state.settings.widgetGrid.placements.countdown = { column: 0, row: 0, size: 'large' };
      await page.goto(`${base}/display`); await page.locator('.display-page').waitFor(); await page.clock.runFor(100);
      assertLarge(await largeFacts(widget), `large/${density}/1280p ${fontFamily}`);
    }
  } finally {
    await page.setViewportSize(viewport);
  }
  return 'Countdown large lists as many dates as fit with an exact "+N more" at Text 100% and fit 1 in every density at 720p/1080p/4K (Monospace in Balanced too), dates and titles at their floors; ticks with an unchanged date construct no Intl formatter';
}
