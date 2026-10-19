import assert from 'node:assert/strict';

// Synthetic dates around the suites' clock (2026-10-18 in Toronto): six upcoming and one passed.
export const LONG_TITLE = 'A deliberately long synthetic title that wraps across lines';
export const id = 'countdown';
export const selectors = ['.countdown-value', '.countdown-title', '.countdown-row', '.countdown-more', '.countdown-date'];
export function prepare(state) {
  state.settings.widgetData.countdowns = [
    ['Holiday', '2026-12-24', false], ['Passed one-time', '2026-10-01', false], [LONG_TITLE, '2026-10-19', false],
    ['Weekend trip', '2026-10-30', false], ['Birthday', '1990-11-03', true], ['Synthetic today', '2026-10-18', false], ['Next spring', '2027-03-01', false],
  ].map(([title, date, repeatsYearly], index) => ({ id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`, title, date, repeatsYearly }));
}

const rowsOf = widget => widget.locator('.countdown-row').evaluateAll(rows => rows.map(row => [row.querySelector('.countdown-row-title').textContent, row.querySelector('.countdown-row-days').getAttribute('aria-label')]));
export async function family({ widget, size }) {
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
    assert.deepEqual(await rowsOf(widget), [['Synthetic today', 'Today'], [LONG_TITLE, 'Tomorrow'], ['Weekend trip', '12 days'], ['Birthday', '16 days'], ['Holiday', '67 days']]);
    assert.equal(await widget.locator('.countdown-more').innerText(), '+1 more', 'an honest remaining count');
    const right = await widget.locator('.countdown-row-days').evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().right)));
    assert.equal(new Set(right).size, 1, `days are right-aligned: ${right}`);
  }
}
