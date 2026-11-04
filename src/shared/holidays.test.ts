import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayWindow, koreanCalendarAvailable, observancesForYear, orthodoxEaster, seasonForDate, shiftHolidayDate, westernEaster } from './holidays.ts';

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
    assert.deepEqual([pascha.date, pascha.category, pascha.themeKey, pascha.leadDays], [easter, 'cultural', 'spring', 7]);
    assert.deepEqual([week.startDate, week.date, week.endDate, week.category], [start, end, end, 'cultural']);
    assert.equal(holidayWindow(shiftHolidayDate(start, -1), ['RU']), null, 'no extra Maslenitsa anticipation');
    assert.equal(holidayWindow(end, ['RU'])?.observance.id, 'ru:maslenitsa');
    assert.notEqual(holidayWindow(shiftHolidayDate(end, 1), ['RU'])?.observance.id, 'ru:maslenitsa', 'ends after the Sunday');
  }
});

test('Orthodox calculation advances the Julian/Gregorian difference at2100 without a fixed13-day assumption', () => {
  assert.deepEqual([orthodoxEaster(1900), orthodoxEaster(2000), orthodoxEaster(2099), orthodoxEaster(2100), orthodoxEaster(2101)],
    ['1900-04-22', '2000-04-30', '2099-04-12', '2100-05-02', '2101-04-24']);
  for (let year = 1900; year <= 2199; year++) assert.equal(new Date(`${orthodoxEaster(year)}T12:00:00Z`).getUTCDay(), 0, `${year}: remains Sunday across century boundaries`);
});

test('the entire Maslenitsa week appears, but exact-day holidays and quiet commemorations take precedence', () => {
  for (let offset = 0; offset <= 6; offset++) assert.equal(holidayWindow(shiftHolidayDate('2026-02-16', offset), ['RU'])?.observance.id, 'ru:maslenitsa');
  assert.equal(holidayWindow('2027-03-08', ['RU'])?.observance.id, 'ru:women', 'Women’s Day beats the ongoing multi-day window');
  assert.equal(holidayWindow('2027-03-09', ['RU'])?.observance.id, 'ru:maslenitsa', 'the week resumes the next day');
  assert.equal(holidayWindow('2028-02-23', ['RU'])?.observance.id, 'ru:defender', 'quiet commemoration stays first');
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

test('seasonal windows start before major holidays, expire, and cross New Year without stale decorations', () => {
  assert.equal(holidayWindow('2026-10-14', ['CA']), null);
  assert.equal(holidayWindow('2026-10-15', ['CA'])?.observance.id, 'ca:halloween');
  assert.equal(holidayWindow('2026-10-31', ['CA'])?.phase, 'today');
  assert.equal(holidayWindow('2026-11-01', ['CA']), null);
  assert.equal(holidayWindow('2026-11-30', ['CA']), null);
  assert.equal(holidayWindow('2026-12-01', ['CA'])?.observance.id, 'ca:christmas');
  assert.equal(holidayWindow('2026-12-25', ['CA'])?.observance.id, 'ca:christmas');
  assert.equal(holidayWindow('2026-12-26', ['CA'])?.observance.id, 'ca:boxing-day');
  assert.equal(holidayWindow('2026-12-27', ['CA'])?.observance.date, '2027-01-01');
  assert.equal(holidayWindow('2027-01-02', ['CA']), null);
  assert.equal(holidayWindow('2027-01-08', ['RU'])?.observance.id, 'ru:new-year');
  assert.equal(holidayWindow('2027-01-09', ['RU']), null);
});

test('actual observances and quiet commemorations deterministically override anticipation', () => {
  const all = ['CA', 'KR', 'RU'] as const;
  assert.equal(holidayWindow('2026-10-09', all)?.observance.id, 'kr:hangeul', 'actual day beats Canadian Thanksgiving approach');
  assert.equal(holidayWindow('2027-01-07', all)?.observance.id, 'ru:christmas', 'central Orthodox Christmas wins over the ongoing New Year');
  assert.equal(holidayWindow('2026-09-30', all)?.observance.kind, 'commemoration');
  assert.equal(holidayWindow('2026-11-11', all)?.observance.themeKey, 'remembrance');
  assert.deepEqual(holidayWindow('2026-12-25', all), holidayWindow('2026-12-25', [...all].reverse()), 'calendar selection order never changes a tie');
});

test('selected calendars, immutable cached records, invalid inputs and year limits stay bounded', () => {
  assert.equal(observancesForYear(2026, []).length, 0);
  assert.ok(observancesForYear(2026, ['KR']).every(value => value.region === 'KR'));
  assert.equal(observancesForYear(1899).length, 0);
  assert.equal(observancesForYear(2200).length, 0);
  assert.equal(observancesForYear(NaN).length, 0);
  assert.equal(holidayWindow('2026-02-30'), null);
  assert.equal(holidayWindow('not a date'), null);
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
