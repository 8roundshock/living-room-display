import assert from 'node:assert/strict';

export const id = 'worldClocks';
export const selectors = ['.wc-time', '.wc-relation', '.wc-more'];

// Synthetic cities. The suite's browser is in America/Toronto and its page clock starts at 2026-10-18 13:00Z.
export const CITIES = [
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000001', label: 'London', timezone: 'Europe/London', latitude: 51.51, longitude: -0.13 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000002', label: 'Tokyo', timezone: 'Asia/Tokyo', latitude: 35.68, longitude: 139.69 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000003', label: 'Vancouver', timezone: 'America/Vancouver', latitude: 49.28, longitude: -123.12 },
  { id: '0b6f8a62-1d1c-4d0e-9a51-000000000004', label: 'Sydney', timezone: 'Australia/Sydney', latitude: -33.87, longitude: 151.21 },
];
const LOCAL_ZONE = 'America/Toronto', MINUTE = 60_000;

/**
 * Everything a city shows is worked out here from the page's own clock, independently of the widget: the suite's
 * page clock is shared by every check and moves on as they run, so nothing may assume it is still in its first
 * hour (#741: "London 2:xx PM" failed once the clock passed 10:00 in Toronto, and Vancouver's sunrise is 98
 * minutes after the start). The widget works per minute and its one-second tick may lag the clock by a second,
 * so each fact is taken at this minute and at the one before, and the widget must show one of them.
 */
async function pageMinutes(page) {
  const pageNow = await page.evaluate(() => Date.now());
  return [...new Set([pageNow, pageNow - 1000].map(at => Math.floor(at / MINUTE) * MINUTE))];
}

/** What a clock in `timeZone` reads at an instant: "2:07PM" or "14:07". */
function clockTime(at, timeZone, hourCycle) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: hourCycle === 'h23' ? '2-digit' : 'numeric', minute: '2-digit', hourCycle }).format(at).replace(/\s/g, '');
}

/** A zone's civil date and its offset from UTC in minutes at an instant, from Intl alone. */
function zoneFacts(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(part => [part.type, part.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, offset: Math.round((wall - Math.floor(at / MINUTE) * MINUTE) / MINUTE) };
}

/** "Today · +5 h", "Tomorrow · +15 h", "Today · −3 h" or "Same time": the city's day and offset against the browser's zone. */
function relation(at, timeZone) {
  const city = zoneFacts(at, timeZone), local = zoneFacts(at, LOCAL_ZONE), difference = city.offset - local.offset;
  if (difference === 0) return 'Same time';
  const hours = Math.floor(Math.abs(difference) / 60), rest = Math.abs(difference) % 60;
  return `${city.date > local.date ? 'Tomorrow' : city.date < local.date ? 'Yesterday' : 'Today'} \u00b7 ${difference > 0 ? '+' : '\u2212'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''} h`;
}

/**
 * The sun's altitude in degrees at an instant and place, from the low-precision almanac formula (mean longitude,
 * mean anomaly, sidereal time), not the widget's own series; the two agree within 0.02° through 2026 for these cities.
 */
function sunAltitude(at, latitude, longitude) {
  const rad = Math.PI / 180, days = at / 86_400_000 - 10957.5; // days since 2000-01-01 12:00 UTC
  const anomaly = (357.528 + 0.9856003 * days) * rad;
  const ecliptic = (280.460 + 0.9856474 * days + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * rad, obliquity = (23.439 - 0.0000004 * days) * rad;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic)), declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const hourAngle = ((18.697374558 + 24.06570982441908 * days) * 15 + longitude) * rad - rightAscension;
  return Math.asin(Math.sin(latitude * rad) * Math.sin(declination) + Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle)) / rad;
}

/** The day or night glyphs a city may show: the sun's upper limb clears the horizon at −0.833°; within half a degree of that either is right. */
function glyphs(at, { latitude, longitude }) {
  const above = sunAltitude(at, latitude, longitude) + 0.833;
  return Math.abs(above) < 0.5 ? ['sun', 'moon'] : [above > 0 ? 'sun' : 'moon'];
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
  const minutes = await pageMinutes(page);
  for (const [index, row] of rows.entries()) {
    const city = CITIES[index];
    assert.equal(row.label, city.label);
    const times = minutes.map(at => clockTime(at, city.timezone, 'h12'));
    assert.match(row.time, /^\d{1,2}:\d\d\s*[AP]M$/, `${row.label} time`);
    assert.ok(times.includes(row.time.replace(/\s/g, '')), `${row.label} reads ${row.time}, page clock ${times.join(' or ')}`);
    const relations = minutes.map(at => relation(at, city.timezone));
    assert.ok(relations.includes(row.relation), `${row.label} relation "${row.relation}", page clock "${relations.join('" or "')}"`);
    const dayNight = minutes.flatMap(at => glyphs(at, city));
    assert.ok(dayNight.includes(row.glyph), `${row.label} day/night ${row.glyph}, sun ${sunAltitude(minutes[0], city.latitude, city.longitude).toFixed(2)}\u00b0 at the page clock`);
    assert.equal(row.weight, '400', 'regular-weight numerals'); assert.ok(!row.stroke || row.stroke === '0px', 'no outline numerals');
  }
  const more = await widget.locator('.wc-more').allTextContents();
  assert.deepEqual(more, size === 'large' ? [] : [`+${4 - count}`]);
  if (size !== 'small' || density !== 'balanced' || viewport.width !== 1920) return;
  // 24-hour setting.
  state.settings.clockFormat = '24h'; await reload(page);
  const time24 = (await page.locator('.ambient-worldClocks .wc-time').first().textContent()).trim();
  assert.match(time24, /^\d\d:\d\d$/);
  assert.ok((await pageMinutes(page)).map(at => clockTime(at, CITIES[0].timezone, 'h23')).includes(time24), `London 24-hour ${time24}`);
  // With no cities the display hides the widget (the editor shows a placeholder; see catalog-sky-browser).
  state.settings.clockFormat = '12h'; state.settings.widgetData.worldClocks = []; await reload(page);
  await page.locator('.ambient-content').waitFor();
  assert.equal(await page.locator('.ambient-worldClocks').count(), 0, 'hidden on the display without cities');
  state.settings.widgetData.worldClocks = structuredClone(CITIES); await reload(page);
  assert.equal(await page.locator('.ambient-worldClocks').count(), 1);
}
