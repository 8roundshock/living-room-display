import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import type { WeatherState } from '../shared/contracts.ts';
import type { BirthdayEntry } from '../shared/birthdays.ts';
import { shiftHolidayDate } from '../shared/holidays.ts';
import { THEME_SCENES, THEME_SCENE_IDS, type ThemeSceneId } from '../shared/theme-registry.ts';
import { sceneSchedule, sceneWhenLabel, themeDay, type SceneWhen, type ThemeDayInput } from '../shared/theme-schedule.ts';
import { resolveTheme, themeDayInput } from './ambient-theme.ts';

// #697: the editor's scene list shows the days each scene will be the season, holiday or birthday scene, resolved
// day by day exactly as the display resolves them. Birthdays here are fictional test entries.
const ALL: ThemeDayInput = { calendars: ['CA', 'KR', 'RU'], birthdays: [], hemisphere: 'north' };
const labels = (input: ThemeDayInput, today: string) => { const schedule = sceneSchedule(input, today); return Object.fromEntries(THEME_SCENE_IDS.map(id => [id, sceneWhenLabel(id, schedule[id], today)])) as Record<ThemeSceneId, string>; };
const birthday = (date: string, treatment: BirthdayEntry['treatment'], id = date): BirthdayEntry => ({ id: `00000000-0000-4000-8000-${id.replace('-', '').padStart(12, '0')}`, name: 'Test person', date, treatment });

test('2026-11-14 with all three calendars and no birthdays: every scene’s dates', () => {
  assert.deepEqual(labels(ALL, '2026-11-14'), {
    birthday: 'no birthday set', 'birthday-russian': 'no birthday set', 'birthday-korean': 'no birthday set',
    spring: 'Mar 1 – May 31', summer: 'Jun 1 – Aug 31', autumn: 'until Nov 14', winter: 'Jan 9 – Feb 28',
    christmas: 'Nov 15 – Dec 26', 'new-year': 'not with your calendars', 'new-year-tree': 'Dec 27 – Jan 8', 'orthodox-christmas': 'Jan 7',
    halloween: 'Oct 15 – 31', thanksgiving: 'Oct 4 – 11', 'canada-day': 'Jun 29 – Jul 1', easter: 'Mar 21 – 29',
    seollal: 'Jan 31 – Feb 8', chuseok: 'Sep 8 – 16', 'lotus-lanterns': 'May 10 – 13', maslenitsa: 'Mar 9 – 14', pascha: 'Apr 25 – May 2', mimosa: 'Mar 6 – 8',
    rain: 'when it rains', snow: 'when it snows', storm: 'in a storm', fog: 'in fog', wind: 'when windy',
  });
  const schedule = sceneSchedule(ALL, '2026-11-14');
  assert.deepEqual(schedule.autumn, { kind: 'current', start: '2026-09-01', end: '2026-11-14', more: 0 }, 'Autumn began Sep 1; Thanksgiving and Halloween only interrupt it');
  assert.deepEqual(schedule['orthodox-christmas'], { kind: 'next', start: '2027-01-07', end: '2027-01-07', more: 0 }, 'the New Year tree outranks it from Jan 1 to 6');
});

test('A calendar switched off changes the dates: plain New Year takes over without Russia, no holidays leave the seasons whole', () => {
  const noRussia = labels({ ...ALL, calendars: ['CA', 'KR'] }, '2026-11-14');
  assert.equal(noRussia['new-year'], 'Dec 27 – Jan 1'); assert.equal(noRussia['new-year-tree'], 'not with your calendars');
  for (const id of ['orthodox-christmas', 'maslenitsa', 'pascha', 'mimosa'] as const) assert.equal(noRussia[id], 'not with your calendars', id);
  assert.equal(noRussia.winter, 'Jan 2 – Feb 28', 'Winter begins after the plain New Year');
  const none = labels({ ...ALL, calendars: [] }, '2026-11-14');
  assert.equal(none.autumn, 'until Nov 30'); assert.equal(none.winter, 'Dec 1 – Feb 28'); assert.equal(none.christmas, 'not with your calendars');
  assert.ok(THEME_SCENE_IDS.filter(id => THEME_SCENES[id].group === 'Celebrations').every(id => none[id] === 'not with your calendars'));
});

test('Birthdays: the next one of each treatment, another within the year, today, a quiet date and February 29', () => {
  const entries = [birthday('07-15', 'classic'), birthday('03-03', 'classic'), birthday('12-01', 'korean'), birthday('11-11', 'russian')];
  const shown = labels({ ...ALL, birthdays: entries }, '2026-11-14');
  assert.equal(shown.birthday, 'Mar 3 + 1 more', 'the next classic birthday, and one more within a year of it');
  assert.equal(shown['birthday-korean'], 'Dec 1');
  assert.equal(shown['birthday-russian'], 'not in the next year', 'Remembrance Day is a quiet date: no birthday scene then');
  assert.equal(shown.christmas, 'Nov 15 – Dec 26', 'a birthday inside Christmas only interrupts it');
  assert.equal(labels({ ...ALL, birthdays: [birthday('11-14', 'classic')] }, '2026-11-14').birthday, 'today');
  assert.equal(labels({ ...ALL, birthdays: [birthday('02-29', 'classic')] }, '2026-11-14').birthday, 'not in the next year', 'the next February 29 is in 2028');
  assert.equal(labels({ ...ALL, birthdays: [birthday('02-29', 'classic')] }, '2027-11-14').birthday, 'Feb 29');
});

test('The southern hemisphere has its own seasons around the same holidays', () => {
  const south = labels({ ...ALL, hemisphere: 'south' }, '2026-11-14');
  assert.equal(south.spring, 'until Nov 14'); assert.equal(south.summer, 'Jan 9 – Feb 28'); assert.equal(south.autumn, 'Mar 1 – May 31'); assert.equal(south.winter, 'Jun 1 – Aug 31');
  assert.equal(south.christmas, 'Nov 15 – Dec 26');
});

test('A day inside a holiday that interrupts a season shows when the season comes back', () => {
  const shown = labels(ALL, '2026-10-20');
  assert.equal(shown.halloween, 'until Oct 31'); assert.equal(shown.autumn, 'Nov 1 – 14');
});

test('The dates: one day, the same month, two months, a year only beyond a year, more occurrences, the reasons', () => {
  const at = (when: SceneWhen, today = '2026-11-14', id: ThemeSceneId = 'christmas') => sceneWhenLabel(id, when, today);
  assert.equal(at({ kind: 'next', start: '2027-01-07', end: '2027-01-07', more: 0 }), 'Jan 7');
  assert.equal(at({ kind: 'next', start: '2027-10-15', end: '2027-10-31', more: 0 }), 'Oct 15 – 31');
  assert.equal(at({ kind: 'next', start: '2026-11-15', end: '2026-12-26', more: 0 }), 'Nov 15 – Dec 26');
  assert.equal(at({ kind: 'next', start: '2027-12-10', end: '2027-12-12', more: 0 }), 'Dec 10, 2027 – Dec 12, 2027', 'more than a year away: with the year');
  assert.equal(at({ kind: 'next', start: '2027-07-15', end: '2027-07-15', more: 2 }), 'Jul 15 + 2 more');
  assert.equal(at({ kind: 'current', start: '2026-09-01', end: '2026-11-14', more: 0 }), 'until Nov 14');
  assert.equal(at({ kind: 'current', start: '2026-11-14', end: '2026-11-14', more: 0 }), 'today');
  assert.equal(at({ kind: 'never', reason: 'calendars' }), 'not with your calendars'); assert.equal(at({ kind: 'never', reason: 'birthday' }), 'no birthday set');
  assert.equal(at({ kind: 'weather' }, '2026-11-14', 'fog'), 'in fog');
});

test('The display and the list cannot drift: resolveTheme’s scene is themeDay’s on every day, with every calendar choice and birthdays', () => {
  const settings = defaultSettings(); settings.appearance.theme.mode = 'seasonal';
  const weather = { status: 'unavailable', updatedAt: null, error: null, location: settings.location, units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' }, current: null, daily: [], hourly: [], details: [] } as unknown as WeatherState;
  settings.birthdays = [birthday('03-08', 'russian'), birthday('09-15', 'korean'), birthday('11-11', 'classic')];
  for (const calendars of [['CA', 'KR', 'RU'], ['KR'], []] as const) for (const latitude of [43.7, -33.9]) {
    settings.appearance.theme.calendars = [...calendars]; settings.location.latitude = latitude;
    for (let index = 0, date = '2026-10-01'; index < 400; index++, date = shiftHolidayDate(date, 3)) {
      const scene = resolveTheme(settings, weather, new Date(`${date}T12:00:00`), false, date)!;
      assert.equal(scene.motif, themeDay(themeDayInput(settings), date).scene, `${date} ${calendars.join('+')} ${latitude}`);
    }
  }
});
