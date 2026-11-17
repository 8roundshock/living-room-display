import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import type { WeatherState } from '../shared/contracts.ts';
import { observancesForYear, shiftHolidayDate } from '../shared/holidays.ts';
import { holidayScenePolicy } from '../shared/theme-registry.ts';
import { holidayLabel, resolveTheme } from './ambient-theme.ts';

// #707 (owner, 2026-11-17: "fix the new year labels too"): the editor's current-scene line names a holiday scene's
// days the way people say them, short, and like the Try a scene list where it can.
const noWeather = (latitude = 43.7) => ({ status: 'unavailable', updatedAt: null, error: null, location: { latitude, longitude: -79.4 }, units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' }, current: null, daily: [], hourly: [], details: [] }) as unknown as WeatherState;
function labelOn(date: string, calendars: readonly ('CA' | 'KR' | 'RU')[], mode: 'seasonal' | 'combined' = 'seasonal', weather = noWeather()) {
  const settings = defaultSettings(); settings.appearance.theme.mode = mode; settings.appearance.theme.calendars = [...calendars];
  return resolveTheme(settings, weather, new Date(`${date}T12:00:00`), false, date)!.label;
}
const days = (from: string, to: string) => { const list: string[] = []; for (let date = from; date <= to; date = shiftHolidayDate(date, 1)) list.push(date); return list; };

test('December to January, two years: every day’s name with all three calendars and with each one alone', () => {
  for (const year of [2026, 2027]) {
    const next = year + 1, at = (calendars: readonly ('CA' | 'KR' | 'RU')[]) => Object.fromEntries(days(`${year}-11-30`, `${next}-01-09`).map(date => [date.slice(5), labelOn(date, calendars)]));
    const all = at(['CA', 'KR', 'RU']);
    assert.deepEqual([all['11-30'], all['12-01'], all['12-23'], all['12-24'], all['12-25'], all['12-26']], ['Winter', 'Christmas season', 'Christmas season', 'Christmas Eve', 'Christmas', 'Boxing Day'], `${year} Christmas`);
    assert.deepEqual([all['12-27'], all['12-30'], all['12-31'], all['01-01'], all['01-02'], all['01-05']], ['New Year · Russia', 'New Year · Russia', 'New Year’s Eve', 'New Year’s Day', 'Winter', 'Winter'], `${year} New Year`);
    assert.deepEqual([all['01-06'], all['01-07'], all['01-08']], ['Orthodox Christmas Eve', 'Orthodox Christmas', 'Winter'], `${year} Orthodox Christmas`);
    const canada = at(['CA']);
    assert.deepEqual([canada['12-24'], canada['12-26'], canada['12-27'], canada['12-30'], canada['12-31'], canada['01-01'], canada['01-06'], canada['01-07']],
      ['Christmas Eve', 'Boxing Day', 'Winter', 'Winter', 'New Year’s Eve', 'New Year’s Day', 'Winter', 'Winter'], `${year} Canada`);
    const korea = at(['KR']);
    assert.deepEqual([korea['12-24'], korea['12-25'], korea['12-26'], korea['12-31'], korea['01-01'], korea['01-07']], ['Christmas Eve', 'Christmas', 'Winter', 'New Year’s Eve', 'New Year’s Day', 'Winter'], `${year} Korea`);
    const russia = at(['RU']);
    assert.deepEqual([russia['12-17'] ?? labelOn(`${year}-12-17`, ['RU']), labelOn(`${year}-12-18`, ['RU']), russia['12-30'], russia['12-31'], russia['01-01'], russia['01-02'], russia['01-06'], russia['01-07']],
      ['Winter', 'New Year · Russia', 'New Year · Russia', 'New Year’s Eve', 'New Year’s Day', 'Winter', 'Orthodox Christmas Eve', 'Orthodox Christmas'], `${year} Russia`);
    // Never "… season" except Christmas; never "New Year’s Day season" or "New Year holidays season".
    for (const [date, label] of Object.entries({ ...all, ...canada, ...korea, ...russia })) assert.ok(!/season$/.test(label) || label === 'Christmas season', `${year}-${date}: ${label}`);
  }
});

test('The other holidays: the day, and before it Holy Week, Halloween season or "soon"; quiet dates are unchanged', () => {
  const all = ['CA', 'KR', 'RU'] as const;
  assert.deepEqual(['2027-01-31', '2027-02-05', '2027-02-06', '2027-02-08'].map(date => labelOn(date, all)), ['Seollal soon', 'Seollal soon', 'Seollal', 'Seollal']);
  assert.deepEqual(['2027-03-06', '2027-03-08', '2027-03-09', '2027-03-14'].map(date => labelOn(date, all)), ['Women’s Day soon', 'Women’s Day', 'Maslenitsa', 'Maslenitsa']);
  assert.deepEqual(['2027-03-21', '2027-03-27', '2027-03-28', '2027-03-29'].map(date => labelOn(date, all)), ['Holy Week', 'Holy Week', 'Easter', 'Easter Monday'], 'Palm Sunday to Holy Saturday');
  assert.deepEqual(['2027-04-25', '2027-05-01', '2027-05-02'].map(date => labelOn(date, all)), ['Orthodox Holy Week', 'Orthodox Holy Week', 'Orthodox Easter']);
  assert.deepEqual(['2027-05-07', '2027-05-12', '2027-05-13'].map(date => labelOn(date, all)), ['Buddha’s Birthday soon', 'Buddha’s Birthday soon', 'Buddha’s Birthday']);
  assert.deepEqual(['2027-06-29', '2027-07-01'].map(date => labelOn(date, all)), ['Canada Day soon', 'Canada Day']);
  assert.deepEqual(['2027-09-08', '2027-09-13', '2027-09-14', '2027-09-16'].map(date => labelOn(date, all)), ['Chuseok soon', 'Chuseok soon', 'Chuseok', 'Chuseok']);
  assert.deepEqual(['2027-10-04', '2027-10-11', '2027-10-15', '2027-10-30', '2027-10-31'].map(date => labelOn(date, all)), ['Thanksgiving soon', 'Thanksgiving', 'Halloween season', 'Halloween season', 'Halloween']);
  // Quiet dates keep their label.
  assert.deepEqual(['2027-03-26', '2027-05-09', '2027-06-06', '2027-09-30', '2027-11-11'].map(date => labelOn(date, all)),
    ['Good Friday · quiet season', 'Victory Day · quiet season', 'Memorial Day · quiet season', 'Truth and Reconciliation · quiet season', 'Remembrance Day · quiet season']);
});

test('Every major holiday of every calendar has a natural name for each of its days, over three years', () => {
  for (const year of [2026, 2027, 2028]) for (const observance of observancesForYear(year)) {
    const policy = holidayScenePolicy(observance.id); if (policy.role !== 'major') continue;
    const today = holidayLabel({ observance, phase: 'today' }, observance.date), before = holidayLabel({ observance, phase: 'approaching' }, shiftHolidayDate(observance.date, -3));
    assert.ok(today && !/season|soon/.test(today), `${observance.id} on the day: ${today}`);
    assert.ok(!/ season$/.test(before) || ['Christmas season', 'Halloween season'].includes(before), `${observance.id} before: ${before}`);
    assert.ok(today.length <= 24 && before.length <= 24, `${observance.id}: short (${today}, ${before})`);
  }
  // A holiday the table does not know yet: its short name, "soon" before it.
  const unknown = { id: 'xx:test', name: 'Test Day', shortName: 'Test Day', date: '2027-04-10', startDate: '2027-04-10', endDate: '2027-04-10' } as unknown as Parameters<typeof holidayLabel>[0]['observance'];
  assert.deepEqual([holidayLabel({ observance: unknown, phase: 'today' }, '2027-04-10'), holidayLabel({ observance: unknown, phase: 'approaching' }, '2027-04-09')], ['Test Day', 'Test Day soon']);
});

test('Weather labels in Combined use the same names; over a quiet date the observance’s own name', () => {
  const rainy = (date: string) => { const weather = noWeather() as unknown as Record<string, unknown>;
    Object.assign(weather, { status: 'fresh', updatedAt: `${date}T16:30:00Z`, current: { time: `${date}T16:30:00Z`, temperature: 4, feelsLike: 2, weatherCode: 63, isDay: true, windSpeed: 8 } });
    const settings = defaultSettings(); settings.appearance.theme.mode = 'combined';
    return resolveTheme(settings, weather as unknown as WeatherState, new Date(`${date}T16:40:00Z`), false, date)!.label; };
  assert.equal(rainy('2026-12-31'), 'Rain now · New Year’s Eve');
  assert.equal(rainy('2026-12-28'), 'Rain now · New Year · Russia');
  assert.equal(rainy('2026-12-10'), 'Rain now · Christmas season');
  assert.equal(rainy('2027-01-06'), 'Rain now · Orthodox Christmas Eve');
  assert.equal(rainy('2026-11-11'), 'Rain now · Remembrance Day', 'a quiet date keeps the observance’s name');
});
