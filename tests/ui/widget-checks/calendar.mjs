import assert from 'node:assert/strict';
import { intlPerTick } from './countdown.mjs';

// The suites run at 2026-10-18 09:00 in Toronto, a Sunday. A Monday week start puts today in the
// last column; October 2026 needs five rows either way.
export const id = 'calendar';
export const selectors = ['.calendar-grid', '.calendar-day', '.calendar-date-number'];
export function prepare(state) { state.settings.widgetData.calendar.weekStart = 'monday'; }

const OCTOBER = [
  ['', '', '', '1', '2', '3', '4'], ['5', '6', '7', '8', '9', '10', '11'], ['12', '13', '14', '15', '16', '17', '18'],
  ['19', '20', '21', '22', '23', '24', '25'], ['26', '27', '28', '29', '30', '31', ''],
];

export async function family({ page, widget, size, density, viewport }) {
  const grid = widget.locator('table.calendar-grid');
  const headers = await grid.locator('th').evaluateAll(cells => cells.map(cell => cell.textContent.trim()));
  assert.deepEqual(headers, size === 'large' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'], `${size} honours the Monday week start`);
  assert.deepEqual(await grid.locator('th').evaluateAll(cells => cells.map(cell => cell.getAttribute('abbr'))), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], `${size} names each weekday in full for assistive technology`);
  const rows = await grid.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent.trim())));
  if (size === 'small') {
    assert.deepEqual(rows, [['12', '13', '14', '15', '16', '17', '18']], 'small shows this week as a strip');
    assert.equal(await widget.locator('.calendar-month').innerText(), 'October');
  } else {
    assert.deepEqual(rows, OCTOBER, `${size} shows only the five weeks October needs, neighbouring days blank`);
    if (size === 'medium') assert.equal(await widget.locator('.calendar-date-number').innerText(), '18');
    else assert.match(await widget.locator('.calendar-heading').innerText(), /October\s+2026/);
  }
  const today = await grid.locator('td[aria-current="date"] .calendar-day').evaluateAll(days => days.map(day => {
    const style = getComputedStyle(day);
    return { text: day.textContent, border: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor, background: style.backgroundColor, opacity: Number(style.opacity) };
  }));
  assert.equal(today.length, 1); assert.equal(today[0].text, '18');
  assert.ok(today[0].border >= 1 && today[0].borderColor !== 'rgba(0, 0, 0, 0)', `${size} rings today with an outline: ${JSON.stringify(today[0])}`);
  assert.equal(today[0].background, 'rgba(0, 0, 0, 0)', `${size} never fills today`);
  assert.equal(today[0].opacity, 1);
  const opacity = async state => Number(await grid.locator(`.calendar-${state}`).first().evaluate(day => getComputedStyle(day).opacity));
  assert.ok(Math.abs(await opacity('past') - 0.45) < 0.01, 'past days are dim');
  if (size !== 'small') assert.ok(Math.abs(await opacity('future') - 0.7) < 0.01, 'days ahead are brighter than past days');
  // The rendered size (font size x the shared fit scale) keeps the data floor in every family.
  const rendered = await widget.evaluate(el => {
    const day = el.querySelector('td .calendar-day'), scale = new DOMMatrix(getComputedStyle(el.querySelector('.widget-content')).transform).a;
    return { size: parseFloat(getComputedStyle(day).fontSize) * scale, floor: parseFloat(getComputedStyle(el).getPropertyValue('--min-data')) };
  });
  assert.ok(rendered.size >= rendered.floor * 0.99, `${size} day numbers keep the data floor: ${JSON.stringify(rendered)}`);
  // Weekday labels and month strings are built once per civil day (#193): ticks construct no formatter.
  if (viewport.width === 1920 && density === 'balanced') await intlPerTick(page, `${size} Calendar`);
}
