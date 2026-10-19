import assert from 'node:assert/strict';

export const id = 'worldClocks';
export const selectors = ['.wc-time', '.wc-relation', '.wc-more'];

// Synthetic cities; at 2026-10-18 13:00Z with the browser in America/Toronto (UTC−4).
export const CITIES = [
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000001', label: 'London', timezone: 'Europe/London', latitude: 51.51, longitude: -0.13 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000002', label: 'Tokyo', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000003', label: 'Vancouver', timezone: 'America/Vancouver', latitude: 49.28, longitude: -123.12 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000004', label: 'Sydney', timezone: 'Australia/Sydney', latitude: -33.87, longitude: 151.21 },
];
const EXPECTED = [
  // The hour each city shows near the page clock's start; exact minutes are read from the page clock.
  { label: 'London', time: /^2:\d\d\s*PM$/, relation: 'Today · +5 h', glyph: 'sun' },
  { label: 'Tokyo', time: /^10:\d\d\s*PM$/, relation: 'Today · +13 h', glyph: 'moon' },
  { label: 'Vancouver', time: /^6:\d\d\s*AM$/, relation: 'Today · −3 h', glyph: 'moon' },
  { label: 'Sydney', time: /^12:\d\d\s*AM$/, relation: 'Tomorrow · +15 h', glyph: 'moon' },
];

/**
 * What a city's clock reads at the page clock. The page clock advances across the suite, and further
 * as the merged catalog grows (#73, #157); the widget's one-second tick may lag it by up to a second.
 */
async function pageClockTimes(page, timeZone, hourCycle) {
  const pageNow = await page.evaluate(() => Date.now());
  const format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hourCycle });
  return [pageNow, pageNow - 1000].map(at => format.format(at).replace(/\s/g, ''));
}

export function prepare(state) { state.settings.widgetData.worldClocks = structuredClone(CITIES); }

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

export async function family({ page, widget, size, density, viewport, state }) {
  const count = size === 'small' ? 1 : size === 'medium' ? 2 : 4;
  const rows = await widget.locator('.wc-city, .wc-row').evaluateAll(elements => elements.map(element => ({
    label: element.querySelector('.wc-name').textContent, time: element.querySelector('.wc-time').textContent.trim(),
    relation: element.querySelector('.wc-relation').textContent, glyph: element.querySelector('.wc-daynight').getAttribute('data-glyph'),
    weight: getComputedStyle(element.querySelector('.wc-time')).fontWeight, stroke: getComputedStyle(element.querySelector('.wc-time')).webkitTextStrokeWidth,
  })));
  assert.equal(rows.length, count, `${size}/${density} shows ${count} cities`);
  for (const [index, row] of rows.entries()) {
    const expected = EXPECTED[index];
    assert.equal(row.label, expected.label); assert.match(row.time, expected.time, `${row.label} time`); assert.equal(row.relation, expected.relation); assert.equal(row.glyph, expected.glyph, `${row.label} day/night`);
    const times = await pageClockTimes(page, CITIES[index].timezone, 'h12');
    assert.ok(times.includes(row.time.replace(/\s/g, '')), `${row.label} reads ${row.time}, page clock ${times.join(' or ')}`);
    assert.equal(row.weight, '400', 'regular-weight numerals'); assert.ok(!row.stroke || row.stroke === '0px', 'no outline numerals');
  }
  const more = await widget.locator('.wc-more').allTextContents();
  assert.deepEqual(more, size === 'large' ? [] : [`+${4 - count}`]);
  if (size !== 'small' || density !== 'balanced' || viewport.width !== 1920) return;
  // 24-hour setting.
  state.settings.clockFormat = '24h'; await reload(page);
  const time24 = (await page.locator('.ambient-worldClocks .wc-time').first().textContent()).trim();
  assert.match(time24, /^14:\d\d$/);
  assert.ok((await pageClockTimes(page, CITIES[0].timezone, 'h23')).includes(time24), `London 24-hour ${time24}`);
  // With no cities the display hides the widget (the editor shows a placeholder; see catalog-sky-browser).
  state.settings.clockFormat = '12h'; state.settings.widgetData.worldClocks = []; await reload(page);
  await page.locator('.ambient-content').waitFor();
  assert.equal(await page.locator('.ambient-worldClocks').count(), 0, 'hidden on the display without cities');
  state.settings.widgetData.worldClocks = structuredClone(CITIES); await reload(page);
  assert.equal(await page.locator('.ambient-worldClocks').count(), 1);
}
