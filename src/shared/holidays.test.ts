import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayWindow, koreanCalendarAvailable, observancesForYear, orthodoxEaster, seasonForDate, shiftHolidayDate, westernEaster } from './holidays.ts';
import { holidayScenePolicy } from './theme-registry.ts';

test('Orthodox Pascha and Maslenitsa agree with published 2026–2030 dates', () => {
  const expected = [
    [2026, '2026-04-12', '2026-02-16', '2026-02-22'],
    [2027, '2027-05-02', '2027-03-08', '2027-03-14'],
    [2028, '2028-04-16', '2028-02-21', '2028-02-27'],
    [2029, '2029-04-08', '2029-02-12', '2029-02-18'],
    [2030, '2030-04-28', '2030-03-04', '2030-03-10'],
  ] as const;
  for (const [year, easter, start, end] of expected) {
    assert.equal(orthodoxEaster(year), easter);
    const values = observancesForYear(year, ['RU']);
    const pascha = values.find(value => value.id === 'ru:easter')!, week = values.find(value => value.id === 'ru:maslenitsa')!;
    assert.deepEqual([pascha.date, pascha.category], [easter, 'cultural']);
    assert.deepEqual([week.startDate, week.date, week.endDate, week.category], [start, end, end, 'cultural']);
    assert.notEqual(holidayWindow(shiftHolidayDate(start, -1), ['RU'])?.observance.id, 'ru:maslenitsa', 'no extra Maslenitsa anticipation');
    assert.equal(holidayWindow(end, ['RU'])?.observance.id, 'ru:maslenitsa');
    assert.notEqual(holidayWindow(shiftHolidayDate(end, 1), ['RU'])?.observance.id, 'ru:maslenitsa', 'ends after the Sunday');
  }
});

test('Orthodox calculation advances the Julian/Gregorian difference at2100 without a fixed13-day assumption', () => {
  assert.deepEqual([orthodoxEaster(1900), orthodoxEaster(2000), orthodoxEaster(2099), orthodoxEaster(2100), orthodoxEaster(2101)],
    ['1900-04-22', '2000-04-30', '2099-04-12', '2100-05-02', '2101-04-24']);
  for (let year = 1900; year <= 2199; year++) assert.equal(new Date(`${orthodoxEaster(year)}T12:00:00Z`).getUTCDay(), 0, `${year}: remains Sunday across century boundaries`);
});

test('the entire Maslenitsa week appears and exact major days take precedence, but civic cards do not', () => {
  for (let offset = 0; offset <= 6; offset++) assert.equal(holidayWindow(shiftHolidayDate('2026-02-16', offset), ['RU'])?.observance.id, 'ru:maslenitsa');
  assert.equal(holidayWindow('2027-03-08', ['RU'])?.observance.id, 'ru:women', 'Women’s Day beats the ongoing multi-day window');
  assert.equal(holidayWindow('2027-03-09', ['RU'])?.observance.id, 'ru:maslenitsa', 'the week resumes the next day');
  assert.equal(holidayWindow('2027-03-05', ['RU']), null);
  assert.equal(holidayWindow('2027-03-06', ['RU'])?.observance.id, 'ru:women', 'Women’s Day begins its two-day approach');
  assert.equal(holidayWindow('2027-03-07', ['RU'])?.phase, 'approaching');
  assert.equal(holidayWindow('2028-02-23', ['RU'])?.observance.id, 'ru:maslenitsa', 'Defender’s Day card does not evict the festival');
  assert.equal(holidayWindow('2026-04-05', ['RU'])?.observance.id, 'ru:easter', 'Pascha seven-day approach starts');
  assert.equal(holidayWindow('2026-04-13', ['RU']), null, 'Pascha ends after its day');
  assert.equal(observancesForYear(2026).length, 43, 'curated national and cultural coverage');
});

test('Canadian moving dates follow Gregorian calendar rules across future years', () => {
  const dates = (year: number) => Object.fromEntries(observancesForYear(year, ['CA']).map(value => [value.id, value.date]));
  assert.equal(westernEaster(2010), '2010-04-04', 'USNO worked example');
  assert.equal(westernEaster(2026), '2026-04-05');
  assert.equal(westernEaster(2027), '2027-03-28');
  assert.deepEqual(['ca:good-friday', 'ca:easter-monday', 'ca:victoria', 'ca:labour', 'ca:thanksgiving'].map(id => dates(2026)[id]),
    ['2026-04-03', '2026-04-06', '2026-05-18', '2026-09-07', '2026-10-12']);
  assert.deepEqual(['ca:victoria', 'ca:labour', 'ca:thanksgiving'].map(id => dates(2027)[id]), ['2027-05-24', '2027-09-06', '2027-10-11']);
  for (const year of [2030, 2040, 2100, 2199]) {
    const values = observancesForYear(year, ['CA']);
    assert.equal(values.find(value => value.id === 'ca:christmas')?.date, `${year}-12-25`);
    assert.equal(new Date(`${values.find(value => value.id === 'ca:thanksgiving')!.date}T12:00:00Z`).getUTCDay(), 1);
  }
});

test('Korean dates use verified Dangi dates, including the 2027 Chinese/Korean divergence', () => {
  assert.equal(koreanCalendarAvailable(), true, 'the supported runtime must supply Korean Dangi');
  const dates = (year: number) => Object.fromEntries(observancesForYear(year, ['KR']).map(value => [value.id, value.date]));
  assert.deepEqual(['kr:seollal', 'kr:buddha', 'kr:chuseok'].map(id => dates(2026)[id]), ['2026-02-17', '2026-05-24', '2026-09-25']);
  assert.deepEqual(['kr:seollal', 'kr:buddha', 'kr:chuseok'].map(id => dates(2027)[id]), ['2027-02-07', '2027-05-13', '2027-09-15']);
  assert.deepEqual(['kr:daeboreum', 'kr:dano', 'kr:chilseok'].map(id => dates(2027)[id]), ['2027-02-21', '2027-06-09', '2027-08-08']);
  const seollal = observancesForYear(2027, ['KR']).find(value => value.id === 'kr:seollal')!;
  assert.deepEqual([seollal.startDate, seollal.endDate], ['2027-02-06', '2027-02-08']);
  const chuseok = observancesForYear(2027, ['KR']).find(value => value.id === 'kr:chuseok')!;
  assert.deepEqual([chuseok.startDate, chuseok.endDate], ['2027-09-14', '2027-09-16']);
});

test('Korean regular-month festivals never repeat during a leap month and future years remain computed', () => {
  for (const year of [2023, 2025, 2028, 2033, 2040]) {
    const values = observancesForYear(year, ['KR']);
    for (const id of ['kr:seollal', 'kr:buddha', 'kr:chuseok']) assert.equal(values.filter(value => value.id === id).length, 1, `${year} ${id}`);
    // A regular fourth month date must agree with Dangi, not a leap-fourth-month parseInt match.
    const date = values.find(value => value.id === 'kr:buddha')!.date;
    const parts = new Intl.DateTimeFormat('en-u-ca-dangi', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).formatToParts(new Date(`${date}T12:00:00Z`));
    assert.equal(parts.find(part => part.type === 'month')?.value, '4');
    assert.equal(parts.find(part => part.type === 'day')?.value, '8');
  }
});

test('Canadian major windows start and expire without minor dates evicting the season', () => {
  assert.equal(holidayWindow('2026-10-04', ['CA']), null);
  assert.equal(holidayWindow('2026-10-05', ['CA'])?.observance.id, 'ca:thanksgiving');
  assert.equal(holidayWindow('2026-10-12', ['CA'])?.phase, 'today');
  assert.equal(holidayWindow('2026-10-13', ['CA']), null);
  assert.equal(holidayWindow('2026-10-14', ['CA']), null);
  assert.equal(holidayWindow('2026-10-15', ['CA'])?.observance.id, 'ca:halloween');
  assert.equal(holidayWindow('2026-10-31', ['CA'])?.phase, 'today');
  assert.equal(holidayWindow('2026-11-01', ['CA']), null);
  assert.equal(holidayWindow('2026-11-04'), null, 'Unity Day retains its card without replacing autumn');
  assert.equal(holidayWindow('2026-11-05'), null);
  assert.equal(holidayWindow('2026-06-28', ['CA']), null);
  assert.equal(holidayWindow('2026-06-29', ['CA'])?.observance.id, 'ca:canada-day');
  assert.equal(holidayWindow('2026-07-01', ['CA'])?.phase, 'today');
  assert.equal(holidayWindow('2026-07-02', ['CA']), null);
});

test('Christmas starts November15 by product policy and BoxingDay belongs only to the Canadian selection', () => {
  for (const region of ['CA', 'KR'] as const) {
    assert.equal(holidayWindow('2026-11-14', [region]), null);
    assert.equal(holidayWindow('2026-11-15', [region])?.phase, 'approaching');
    assert.equal(holidayWindow('2026-11-15', [region])?.observance.id, `${region.toLowerCase()}:christmas`);
    assert.equal(holidayWindow('2026-12-24', [region])?.phase, 'approaching');
    assert.equal(holidayWindow('2026-12-25', [region])?.phase, 'today');
    assert.equal(observancesForYear(2026, [region]).find(value => value.id.endsWith(':christmas'))?.startDate, '2026-12-25', 'anticipation never changes factual calendar cards');
  }
  assert.equal(holidayWindow('2026-12-26', ['CA'])?.observance.id, 'ca:boxing-day');
  assert.equal(holidayWindow('2026-12-26', ['KR']), null);
  assert.equal(holidayWindow('2026-12-26', ['RU']), null);
  assert.equal(holidayWindow('2026-12-26', ['CA', 'KR'])?.observance.id, 'ca:boxing-day');
});

test('NewYear crosses the year boundary and ends on the selected ordinary holiday end', () => {
  for (const region of ['CA', 'KR'] as const) {
    assert.equal(holidayWindow('2026-12-27', [region])?.observance.date, '2027-01-01');
    assert.equal(holidayWindow('2027-01-01', [region])?.phase, 'today');
    assert.equal(holidayWindow('2027-01-02', [region]), null);
  }
  assert.equal(holidayWindow('2026-12-27', ['RU'])?.observance.id, 'ru:new-year');
  assert.equal(holidayWindow('2027-01-01', ['RU'])?.observance.id, 'ru:new-year');
  assert.equal(holidayWindow('2027-01-06', ['RU'])?.observance.id, 'ru:new-year', 'ongoing holiday beats Orthodox Christmas anticipation');
  assert.equal(holidayWindow('2027-01-07', ['RU'])?.observance.id, 'ru:christmas', 'central Orthodox Christmas wins');
  assert.equal(holidayWindow('2027-01-08', ['RU'])?.observance.id, 'ru:new-year');
  assert.equal(holidayWindow('2027-01-09', ['RU']), null);
  assert.equal(holidayWindow('2027-01-14', ['RU']), null, 'Old New Year card does not restart the background');
});

test('only selected exact quiet days constrain scenes; card classification remains independent', () => {
  const quietDays = [
    ['2026-04-03', 'CA', 'ca:good-friday'], ['2026-09-30', 'CA', 'ca:reconciliation'],
    ['2026-11-11', 'CA', 'ca:remembrance'], ['2026-06-06', 'KR', 'kr:memorial'], ['2026-05-09', 'RU', 'ru:victory'],
  ] as const;
  for (const [date, region, id] of quietDays) {
    const window = holidayWindow(date, [region]);
    assert.equal(window?.observance.id, id);
    assert.equal(window?.policy.role, 'quiet');
    assert.equal(window?.phase, 'today');
    assert.notEqual(holidayWindow(shiftHolidayDate(date, -1), [region])?.policy.role, 'quiet');
    assert.notEqual(holidayWindow(shiftHolidayDate(date, 1), [region])?.policy.role, 'quiet');
    assert.equal(holidayWindow(date, []), null);
    assert.notEqual(holidayWindow(date, (['CA', 'KR', 'RU'] as const).filter(value => value !== region))?.observance.id, id);
  }
  assert.equal(holidayWindow('2026-04-02', ['CA'])?.observance.id, 'ca:easter');
  assert.equal(holidayWindow('2026-04-04', ['CA'])?.observance.id, 'ca:easter', 'festive anticipation resumes after Good Friday');
  assert.equal(holidayWindow('2026-04-06', ['CA'])?.observance.id, 'ca:easter-monday');
  assert.equal(holidayWindow('2026-04-07', ['CA']), null);
  assert.equal(holidayWindow('2026-03-01', ['KR']), null);
  assert.equal(holidayWindow('2026-02-23', ['RU']), null);
  assert.equal(observancesForYear(2026, ['KR']).find(value => value.id === 'kr:independence-movement')?.kind, 'commemoration');
  assert.equal(observancesForYear(2026, ['RU']).find(value => value.id === 'ru:defender')?.kind, 'commemoration');
});

test('eligible major scenes and quiet constraints resolve independently of calendar selection order', () => {
  const all = ['CA', 'KR', 'RU'] as const;
  assert.equal(holidayWindow('2026-10-09', all)?.observance.id, 'ca:thanksgiving', 'Hangeul Day card leaves the major approach intact');
  assert.equal(holidayWindow('2027-01-07', all)?.observance.id, 'ru:christmas', 'central Orthodox Christmas wins over the ongoing New Year');
  assert.equal(holidayWindow('2026-09-30', all)?.observance.kind, 'commemoration');
  for (const date of ['2026-09-30', '2026-10-09', '2026-12-25', '2026-12-28', '2027-01-01', '2027-01-07', '2027-03-08']) {
    const expected = holidayWindow(date, all);
    for (const regions of [['RU', 'KR', 'CA'], ['KR', 'CA', 'RU'], ['CA', 'RU', 'KR']] as const) {
      assert.deepEqual(holidayWindow(date, regions), expected, `${date}: stable overlap resolution`);
    }
  }
  assert.equal(holidayScenePolicy('future:new-observance').role, 'card', 'new factual dates need explicit scene eligibility');
});

test('Korean flagship scene windows preserve regular lunar dates and close after their ordinary holidays', () => {
  for (const [id, day, start, end] of [
    ['kr:seollal', '2027-02-07', '2027-01-31', '2027-02-08'],
    ['kr:chuseok', '2027-09-15', '2027-09-08', '2027-09-16'],
    ['kr:buddha', '2027-05-13', '2027-05-10', '2027-05-13'],
  ] as const) {
    assert.notEqual(holidayWindow(shiftHolidayDate(start, -1), ['KR'])?.observance.id, id);
    assert.equal(holidayWindow(start, ['KR'])?.observance.id, id);
    assert.equal(holidayWindow(start, ['KR'])?.phase, 'approaching');
    assert.equal(holidayWindow(day, ['KR'])?.phase, 'today');
    assert.equal(holidayWindow(end, ['KR'])?.observance.id, id);
    assert.notEqual(holidayWindow(shiftHolidayDate(end, 1), ['KR'])?.observance.id, id);
    assert.equal(holidayWindow(day, []), null);
  }
  for (const date of ['2027-02-21', '2027-06-09', '2027-08-08']) assert.equal(holidayWindow(date, ['KR']), null, 'other festivals remain cards');
});

test('selected calendars, immutable cached records, invalid inputs and year limits stay bounded', () => {
  assert.equal(observancesForYear(2026, []).length, 0);
  assert.ok(observancesForYear(2026, ['KR']).every(value => value.region === 'KR'));
  assert.equal(observancesForYear(1899).length, 0);
  assert.equal(observancesForYear(2200).length, 0);
  assert.equal(observancesForYear(NaN).length, 0);
  assert.equal(holidayWindow('2026-02-30'), null);
  assert.equal(holidayWindow('not a date'), null);
  assert.equal(holidayWindow('1899-12-27'), null);
  assert.equal(holidayWindow('2200-01-01'), null);
  assert.equal(holidayWindow('2026-12-25', []), null);
  const first = observancesForYear(2026)[0]!;
  assert.ok(Object.isFrozen(first));
  assert.equal(observancesForYear(2026)[0], first, 'repeated resolution reuses bounded year calculations');
  assert.equal(shiftHolidayDate('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftHolidayDate('2028-02-28', 1), '2028-02-29');
});

test('year-round meteorological seasons respect the selected weather hemisphere', () => {
  const dates = ['2026-01-01', '2026-03-01', '2026-06-01', '2026-09-01', '2026-12-01'];
  assert.deepEqual(dates.map(date => seasonForDate(date)), ['winter', 'spring', 'summer', 'autumn', 'winter']);
  assert.deepEqual(dates.map(date => seasonForDate(date, 'south')), ['summer', 'autumn', 'winter', 'spring', 'summer']);
});
