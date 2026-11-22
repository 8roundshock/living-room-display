import assert from 'node:assert/strict';
import { calendarDates } from '../../../src/client/calendar-dates.ts';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';
import { waitForWidgetFit } from '../lib/fit-readiness.mjs';
import { intlPerTick } from './countdown.mjs';

// The suites run at 2026-10-18 09:00 in Toronto, a Sunday. A Monday week start puts today in the
// last column; October 2026 needs five rows either way.
export const id = 'calendar';
// A next date that does not fit takes no layout (#716), so only a shown line counts for clipping.
export const selectors = ['.calendar-grid', '.calendar-day', '.calendar-date-number', '.calendar-mark', '.calendar-upcoming-row', '.calendar-next:not(.calendar-next-hidden)'];
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
// Synthetic people only: one birthday inside the suites' October, one across the turn of the year.
const BIRTHDAYS = [{ id: uuid(7161), name: 'Mina', date: '10-24', treatment: 'classic' }, { id: uuid(7162), name: 'Sam', date: '01-03', treatment: 'classic' }];
export function prepare(state) {
  state.settings.widgetData.calendar.weekStart = 'monday';
  state.settings.birthdays = structuredClone(BIRTHDAYS);
}

const OCTOBER = [
  ['', '', '', '1', '2', '3', '4'], ['5', '6', '7', '8', '9', '10', '11'], ['12', '13', '14', '15', '16', '17', '18'],
  ['19', '20', '21', '22', '23', '24', '25'], ['26', '27', '28', '29', '30', '31', ''],
];
const TODAY = { year: 2026, month: 10, day: 18 };

/** What the Calendar's model gives for the state under test (the model itself is unit-tested). */
function expectedDates(state, today = TODAY) {
  const settings = state.settings;
  return calendarDates({ calendars: settings.appearance.theme.calendars, birthdays: settings.birthdays, countdowns: settings.widgetData.countdowns }, today);
}

/** The #716 facts of one Calendar: its list or next line, its marks, the fit and the rendered sizes. */
function upcomingFacts(widget) {
  return widget.evaluate(section => {
    const content = section.querySelector('.widget-content'), face = section.querySelector('.calendar-face'), style = getComputedStyle(section);
    const scale = new DOMMatrix(getComputedStyle(content).transform).a, outer = section.getBoundingClientRect();
    const box = { width: section.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: section.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
    const inside = node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.top >= outer.top - 1 && rect.bottom <= outer.bottom + 1 && rect.left >= outer.left - 1 && rect.right <= outer.right + 1; };
    const probe = document.createElement('i'); section.append(probe);
    const resolve = value => { probe.style.color = ''; probe.style.color = value; return getComputedStyle(probe).color; };
    const accent = resolve('var(--ambient-accent)'), text = resolve('var(--ambient-text)');
    probe.remove();
    const line = row => {
      const when = row.querySelector('.calendar-upcoming-when'), name = row.querySelector('.calendar-upcoming-name'), range = document.createRange();
      range.selectNodeContents(name);
      // Every line box of the name, also one the one-line clip would hide: a fixture name must not need the clip.
      const nameBox = name.getBoundingClientRect(), nameLines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
      return {
        when: when.textContent, name: name.textContent, inside: inside(row) && inside(name), lines: nameLines,
        // One line: the row is as tall as one line of its own text.
        oneLine: row.getBoundingClientRect().height <= parseFloat(getComputedStyle(name).lineHeight) * scale + 1,
        whenColor: getComputedStyle(when).color, nameColor: getComputedStyle(name).color, size: parseFloat(getComputedStyle(name).fontSize) * scale,
        // The name starts after the date with a clear gap.
        gap: nameBox.left - when.getBoundingClientRect().right,
      };
    };
    const next = section.querySelector('.calendar-next');
    const marks = [...section.querySelectorAll('.calendar-grid td')].filter(cell => cell.querySelector('.calendar-mark')).map(cell => {
      const day = cell.querySelector('.calendar-day'), mark = cell.querySelector('.calendar-mark'), dayBox = day.getBoundingClientRect(), box = mark.getBoundingClientRect(), markStyle = getComputedStyle(mark);
      const digits = document.createRange(); digits.selectNodeContents(day.firstChild); const ink = digits.getBoundingClientRect();
      return {
        day: day.textContent, label: cell.getAttribute('aria-label'), state: [...day.classList].find(name => /^calendar-(past|today|future)$/.test(name)).slice('calendar-'.length),
        width: box.width, height: box.height, round: markStyle.borderTopLeftRadius, color: markStyle.backgroundColor, hidden: mark.getAttribute('aria-hidden'),
        // Centred under the number, starting below the digits and staying inside the widget.
        centred: Math.abs((box.left + box.right) / 2 - (dayBox.left + dayBox.right) / 2) <= 1, below: box.top >= ink.top + ink.height * 0.6, inside: inside(mark),
        opacity: Number(getComputedStyle(day).opacity),
      };
    });
    return {
      fit: scale, overflow: content.scrollHeight * scale - box.height, accent, text,
      floors: { text: parseFloat(style.getPropertyValue('--min-text')), data: parseFloat(style.getPropertyValue('--min-data')) },
      weeks: section.querySelectorAll('.calendar-grid tbody tr').length,
      day: parseFloat(getComputedStyle(section.querySelector('td .calendar-day')).fontSize) * scale,
      // A week row in units of its own font size: the day's line and its padding, and the gap under the weekday labels.
      rows: (() => {
        const day = getComputedStyle(section.querySelector('td .calendar-day')), head = getComputedStyle(section.querySelector('.calendar-grid th'));
        return { line: parseFloat(day.lineHeight) / parseFloat(day.fontSize), pad: parseFloat(day.paddingTop) / parseFloat(day.fontSize), gap: parseFloat(head.paddingBottom) / parseFloat(head.fontSize) };
      })(),
      classes: [...face.classList].filter(name => /^calendar-with-/.test(name)),
      list: [...section.querySelectorAll('.calendar-upcoming > .calendar-upcoming-row')].map(line),
      listLabel: section.querySelector('.calendar-upcoming')?.getAttribute('aria-label') ?? null,
      next: next ? { ...line(next), shown: !next.classList.contains('calendar-next-hidden') && next.getBoundingClientRect().height > 0 } : null,
      marks,
    };
  });
}

/** One upcoming line as shown: on one line, inside the widget, the date in the accent tone and the name in the text colour, at the text floor or above. */
function assertLine(line, expected, facts, label) {
  assert.deepEqual([line.when, line.name], [expected.when, expected.name], `${label}: the line`);
  assert.ok(line.oneLine && line.lines === 1, `${label}: “${line.name}” stays on one line ${JSON.stringify(line)}`);
  assert.ok(line.inside, `${label}: “${line.name}” stays inside the widget`);
  assert.equal(line.whenColor, facts.accent, `${label}: the date uses the accent tone`);
  assert.equal(line.nameColor, facts.text, `${label}: the name uses the text colour`);
  assert.ok(line.size >= facts.floors.text * 0.99, `${label}: the line keeps the text floor ${JSON.stringify({ size: line.size, floors: facts.floors })}`);
  assert.ok(line.gap >= line.size * 0.5, `${label}: a clear gap between the date and the name`);
}

/** The marks on the month grid: exactly the model's days, each a small round accent dot under its number, hidden from assistive technology, which reads the names on the cell. */
function assertMarks(facts, expected, label) {
  assert.deepEqual(facts.marks.map(mark => mark.day), [...expected.marks.keys()].map(String), `${label}: the marked days`);
  for (const mark of facts.marks) {
    assert.equal(mark.label, `${mark.day}, ${expected.marks.get(Number(mark.day)).join(', ')}`, `${label}: day ${mark.day} names its dates`);
    assert.ok(mark.width >= 1.5 && Math.abs(mark.width - mark.height) < 0.6 && mark.width <= facts.day * 0.3, `${label}: day ${mark.day} has a small round dot ${JSON.stringify(mark)}`);
    assert.equal(mark.color, facts.accent, `${label}: the dot uses the accent tone`);
    assert.ok(mark.centred && mark.below && mark.inside, `${label}: the dot sits centred under day ${mark.day}, inside the widget ${JSON.stringify(mark)}`);
    assert.equal(mark.hidden, 'true');
    assert.ok(Math.abs(mark.opacity - { past: 0.45, today: 1, future: 0.7 }[mark.state]) < 0.01, `${label}: the dot dims with its ${mark.state} day`);
  }
}

/** Fit 1 with nothing outside the box, and day numbers at the data floor or above. */
function assertFits(facts, label) {
  assert.ok(facts.fit >= 0.995, `${label}: renders at fit 1 at Text 100% (fit ${facts.fit})`);
  assert.ok(facts.overflow <= 1, `${label}: the content stays inside its box (${facts.overflow}px over)`);
  assert.ok(facts.day >= facts.floors.data * 0.99, `${label}: day numbers keep the data floor ${JSON.stringify({ day: facts.day, floors: facts.floors })}`);
}

/** Large: up to three lines under the month. Medium: the next date where it fits, else nothing of it. Small: unchanged. */
function assertUpcoming(facts, expected, { size, nextShown, label }) {
  if (size === 'small') {
    assert.deepEqual([facts.list.length, facts.next, facts.marks.length, facts.classes], [0, null, 0, []], `${label}: the week strip has no list, next date or marks`);
    return;
  }
  assertMarks(facts, expected, label);
  if (size === 'large') {
    const lines = expected.upcoming.slice(0, 3);
    assert.equal(facts.list.length, lines.length, `${label}: up to three upcoming lines`);
    assert.deepEqual(facts.classes, lines.length ? ['calendar-with-upcoming'] : [], `${label}: the month makes room only when there is a list`);
    assert.equal(facts.listLabel, lines.length ? 'Upcoming dates' : null);
    lines.forEach((line, index) => assertLine(facts.list[index], line, facts, `${label} line ${index + 1}`));
    assert.equal(facts.next, null);
    return;
  }
  assert.equal(facts.list.length, 0, `${label}: medium has no list`);
  if (!expected.upcoming.length) { assert.deepEqual([facts.next, facts.classes], [null, []], `${label}: nothing upcoming, nothing added`); return; }
  assert.equal(facts.next.shown, nextShown, `${label}: the next date is ${nextShown ? 'shown' : 'left out where it does not fit'}`);
  assert.deepEqual(facts.classes, nextShown ? ['calendar-with-next'] : [], `${label}: a next date that does not fit changes nothing else`);
  if (nextShown) assertLine(facts.next, expected.upcoming[0], facts, `${label} next date`);
}

export async function family({ page, widget, size, density, viewport, state }) {
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
  // #716: the upcoming dates and the marks, from the holiday calendars (all three by default), the synthetic
  // birthdays above and the Countdown check's synthetic dates (one of them a 60-character title).
  const expected = expectedDates(state), label = `${size}/${density}/${viewport.width}`;
  assert.ok(expected.upcoming.length >= 3 && expected.upcoming.some(row => row.name.endsWith('…')) && expected.upcoming.some(row => row.when === 'Today'), 'the fixture has a Today line and a cut name');
  // October needs five weeks: the medium next date fits on Spacious and Balanced, and not beside five weeks on Fine.
  assertUpcoming(await upcomingFacts(widget), expected, { size, nextShown: density !== 'fine', label });
  // Weekday labels, month strings and the upcoming dates are built once per civil day (#193, #716): ticks construct no formatter.
  if (viewport.width === 1920 && density === 'balanced') await intlPerTick(page, `${size} Calendar`);
}

/**
 * #716 beyond October: a six-week month, a four-week month and the turn of the year, in every density, with the
 * sweep's own synthetic dates. Every family renders at fit 1; the lines are literal here, not read from the model.
 */
const MONTHS = [
  // November 2026 starts on a Sunday: six rows with a Monday week start. The medium next date fits on Spacious and Balanced.
  { at: '2026-11-22T17:05:00Z', today: { year: 2026, month: 11, day: 22 }, weeks: 6, fineNext: false,
    lines: [['Nov 28', 'Mina’s birthday'], ['Dec 5', 'A deliberately long synthetic…'], ['Dec 25', 'Christmas']], marks: ['4', '11', '28'] },
  // February 2027 starts on a Monday and has 28 days: four rows, and room for the next date on Fine too.
  { at: '2027-02-10T17:05:00Z', today: { year: 2027, month: 2, day: 10 }, weeks: 4, fineNext: true,
    lines: [['Feb 14', 'Valentine’s Day'], ['Feb 15', 'Flag Day'], ['Feb 21', 'First Full Moon']], marks: ['7', '14', '15', '21', '23'] },
  // Late December: January's dates with no year, a holiday shared by three calendars once, and marks for December only.
  { at: '2026-12-28T17:05:00Z', today: { year: 2026, month: 12, day: 28 }, weeks: 5, fineNext: false,
    lines: [['Jan 1', 'New Year’s Day'], ['Jan 3', 'Sam’s birthday'], ['Jan 7', 'Orthodox Christmas']], marks: ['5', '25', '26'] },
  // Christmas Day: today's own date reads Today and its day carries both the ring and the dot.
  { at: '2026-12-25T17:05:00Z', today: { year: 2026, month: 12, day: 25 }, weeks: 5, fineNext: false,
    lines: [['Today', 'Christmas'], ['Dec 26', 'Boxing Day'], ['Jan 1', 'New Year’s Day']], marks: ['5', '25', '26'] },
];

export async function sweep({ page, viewport, state, base }) {
  const widget = page.locator('[data-widget-id="calendar"]');
  const before = await page.evaluate(() => Date.now());
  const show = async (size, density) => {
    state.settings.widgetGrid.density = density;
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'calendar']));
    state.settings.widgetGrid.placements.calendar = { column: 0, row: 0, size };
    await page.goto(`${base}/display`); await page.locator('.display-page').waitFor(); await page.clock.runFor(100);
    await waitForWidgetFit(page, '[data-widget-id="calendar"]', { label: `calendar ${size}/${density}` });
    return upcomingFacts(widget);
  };
  Object.assign(state.settings.appearance, { motionEnabled: false, fontScale: 1, fontFamily: 'sans' });
  state.settings.widgetData.calendar.weekStart = 'monday';
  let cases = 0;
  // Large day-number sizes per density and viewport, to show that the list costs spare height rather than type size.
  const numbers = { five: {}, six: {} };
  try {
    // The owner's 1280×720 TV is covered from the 1080p pass, like the other sweeps.
    for (const view of viewport.width === 1920 ? [{ width: 1280, height: 720 }, viewport] : [viewport]) {
      await page.setViewportSize(view);
      state.settings.appearance.theme = { ...state.settings.appearance.theme, calendars: ['CA', 'KR', 'RU'] };
      state.settings.birthdays = [{ id: uuid(7163), name: 'Mina', date: '11-28', treatment: 'classic' }, { id: uuid(7164), name: 'Sam', date: '01-03', treatment: 'classic' }];
      state.settings.widgetData.countdowns = [{ id: uuid(7165), title: 'A deliberately long synthetic countdown title that goes on', date: '2026-12-05', repeatsYearly: false }];
      for (const month of MONTHS) {
        await page.clock.setSystemTime(new Date(month.at));
        const expected = expectedDates(state, month.today);
        assert.deepEqual(expected.upcoming.slice(0, 3).map(row => [row.when, row.name]), month.lines, `${month.at}: the model gives the literal lines`);
        // The week strip does not depend on the month's length: once is enough.
        for (const density of Object.keys(GRID_DENSITIES)) for (const size of month.weeks === 6 ? ['small', 'medium', 'large'] : ['medium', 'large']) {
          const facts = await show(size, density), label = `${month.at.slice(0, 10)} ${size}/${density}/${view.width}`;
          assertFits(facts, label);
          if (size !== 'small') {
            assert.equal(facts.weeks, month.weeks, `${label}: only the weeks the month needs`);
            assert.deepEqual(facts.marks.map(mark => mark.day), month.marks, `${label}: the marked days`);
          }
          assertUpcoming(facts, expected, { size, nextShown: density !== 'fine' || month.fineNext, label });
          if (size === 'large') assert.deepEqual(facts.list.map(line => [line.when, line.name]), month.lines, `${label}: the three lines`);
          if (size === 'large' && month.weeks !== 4) numbers[month.weeks === 6 ? 'six' : 'five'][`${density}/${view.width}`] = facts.day;
          // Today's own date: the ring and the dot share the day.
          if (size !== 'small' && month.lines[0][0] === 'Today') {
            const ringed = facts.marks.find(mark => mark.day === String(month.today.day));
            assert.deepEqual([ringed.state, ringed.opacity, ringed.label], ['today', 1, `${month.today.day}, ${month.lines[0][1]}`], `${label}: today's holiday keeps its ring and its dot`);
          }
          cases++;
        }
      }
      // Nothing in range (no calendar, birthday or countdown): no list, no next date, no marks, and no room made for them.
      state.settings.appearance.theme = { ...state.settings.appearance.theme, calendars: [] };
      state.settings.birthdays = []; state.settings.widgetData.countdowns = [];
      await page.clock.setSystemTime(new Date('2026-11-22T17:05:00Z'));
      for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['medium', 'large']) {
        const facts = await show(size, density), label = `nothing upcoming ${size}/${density}/${view.width}`;
        assertFits(facts, label);
        assert.deepEqual([facts.weeks, facts.list.length, facts.next, facts.marks.length, facts.classes], [6, 0, null, 0, []], `${label}: the Calendar looks as it does without upcoming dates`);
        const key = `${density}/${view.width}`;
        if (size === 'large') {
          // With the list a five-week month keeps the numbers of a month with no list; only six weeks take slightly smaller ones.
          assert.ok(Math.abs(facts.day - numbers.five[key]) < 0.01, `${label}: a five-week month with the list keeps full-size numbers ${JSON.stringify({ none: facts.day, five: numbers.five[key] })}`);
          assert.ok(numbers.six[key] <= facts.day + 0.01 && numbers.six[key] >= facts.day * 0.93, `${label}: six weeks with the list take at most slightly smaller numbers ${JSON.stringify({ none: facts.day, six: numbers.six[key] })}`);
        // Six weeks with room to spare keep the rows of every other month, as before #716; on Fine they close up to fit.
        } else if (density !== 'fine') assert.ok(Math.abs(facts.rows.line - 1.1) < 0.005 && Math.abs(facts.rows.pad - 0.12) < 0.005 && Math.abs(facts.rows.gap - 0.35) < 0.01, `${label}: six medium weeks keep the usual rows where there is room ${JSON.stringify(facts.rows)}`);
        else assert.ok(facts.rows.pad < 0.115 && facts.rows.pad >= 0.029 && facts.rows.line >= 1.039 && facts.rows.gap >= 0.199, `${label}: six medium weeks close up on Fine without going under the digits' line ${JSON.stringify(facts.rows)}`);
        cases++;
      }
    }
  } finally {
    await page.clock.setSystemTime(before + 1000);
    await page.setViewportSize(viewport);
  }
  return `Calendar upcoming dates (#716): ${cases} family × density cases at ${viewport.width === 1920 ? '720p and 1080p' : '4K'} in four-, five- and six-week months and across the year turn render at fit 1 at Text 100% with day numbers and lines at their floors; large lists three one-line dates (a 60-character title cut after a whole word), medium adds the next date where it fits (not beside five or six weeks on Fine), marked days match the list and dim with their day, today's holiday keeps ring and dot, the list costs spare height and at most 7% of a six-week month's number size, and nothing upcoming adds nothing (a six-week medium month keeps its usual rows where there is room).`;
}
