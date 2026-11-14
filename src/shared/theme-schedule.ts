import { birthdayTreatmentForDate, type BirthdayEntry, type BirthdayTreatment } from './birthdays.ts';
import { holidayWindow, seasonForDate, shiftHolidayDate, type HolidayRegion, type HolidayWindow, type Season } from './holidays.ts';
import { BIRTHDAY_SCENES, THEME_SCENES, THEME_SCENE_IDS, type ThemeSceneId } from './theme-registry.ts';

/** What decides the season, holiday or birthday scene of a day: the selected holiday calendars, the birthdays and
 * the hemisphere of the weather location (north is the documented fallback when there is no location). */
export interface ThemeDayInput { calendars: readonly HolidayRegion[]; birthdays: readonly BirthdayEntry[]; hemisphere: 'north' | 'south' }
/** `scene` is the base scene of the day: the birthday's, else a major holiday's, else the season. A quiet date keeps the
 * season, drawn quiet, and takes no birthday. */
export interface ThemeDay { scene: ThemeSceneId; season: Season; holiday: HolidayWindow | null; birthday: BirthdayTreatment | null; quiet: boolean }

export const themeHemisphere = (latitude: number): 'north' | 'south' => latitude < 0 ? 'south' : 'north';

/**
 * The date-only part of the display's theme (#697): which season, holiday or birthday scene a civil day shows.
 * `resolveTheme` calls this for the display and the editor; `sceneSchedule` walks it day by day for the scene list,
 * so the two cannot drift. `seasonal` is false in Weather mode: no holiday or birthday then, only the season.
 */
export function themeDay({ calendars, birthdays, hemisphere }: ThemeDayInput, civilDate: string, seasonal = true): ThemeDay {
  const holiday = seasonal ? holidayWindow(civilDate, calendars) : null;
  const season = seasonForDate(civilDate, hemisphere);
  const quiet = holiday?.policy.role === 'quiet';
  const birthday = seasonal && !quiet ? birthdayTreatmentForDate(birthdays, civilDate) : null;
  const scene: ThemeSceneId = birthday ? BIRTHDAY_SCENES[birthday] : holiday?.policy.role === 'major' ? holiday.policy.scene : season;
  return { scene, season, holiday, birthday, quiet };
}

/** How far the scene list looks (#697): back far enough to find where today's scene began (no run is longer than a
 * season), ahead about 13 months; runs of one scene less than `mergeGap` days apart are one occurrence (the days
 * between are another scene's holiday). */
export const SCENE_SCHEDULE = { back: 120, ahead: 400, mergeGap: 21 } as const;

/** When a scene is on screen, from `today`:
 * - `current`: it is today's scene, in the occurrence from `start` to `end`;
 * - `next`: its next days, `start` to `end` (today may fall inside a holiday that interrupts the occurrence);
 * - `more`: how many other occurrences start within a year of this one's start;
 * - `weather`: a weather scene, which follows the weather, not the date;
 * - `never`: not in the window: `calendars` (a holiday outranked or not selected), `birthday` (no birthday has this
 *   treatment), `window` (anything else). */
export type SceneWhen =
  | { kind: 'current' | 'next'; start: string; end: string; more: number }
  | { kind: 'weather' }
  | { kind: 'never'; reason: 'calendars' | 'birthday' | 'window' };

/** Every scene's current or next occurrence under these settings, walking each day the way the display resolves it. */
export function sceneSchedule(input: ThemeDayInput, today: string): Record<ThemeSceneId, SceneWhen> {
  const first = shiftHolidayDate(today, -SCENE_SCHEDULE.back), count = SCENE_SCHEDULE.back + SCENE_SCHEDULE.ahead, now = SCENE_SCHEDULE.back;
  const days: string[] = [], scenes: ThemeSceneId[] = [];
  for (let index = 0, date = first; index < count; index++, date = shiftHolidayDate(date, 1)) { days.push(date); scenes.push(themeDay(input, date).scene); }
  // Runs of consecutive days per scene, then merged across short interruptions; each keeps its parts.
  type Run = { start: number; end: number; parts: [number, number][] };
  const runs = new Map<ThemeSceneId, Run[]>();
  for (let index = 0; index < count; index++) {
    const scene = scenes[index]!; if (index > 0 && scenes[index - 1] === scene) continue;
    let end = index; while (end + 1 < count && scenes[end + 1] === scene) end++;
    const list = runs.get(scene) ?? []; runs.set(scene, list);
    const last = list.at(-1);
    if (last && index - last.end - 1 < SCENE_SCHEDULE.mergeGap) { last.end = end; last.parts.push([index, end]); }
    else list.push({ start: index, end, parts: [[index, end]] });
  }
  const result = {} as Record<ThemeSceneId, SceneWhen>;
  for (const id of THEME_SCENE_IDS) {
    const definition = THEME_SCENES[id];
    if (definition.group === 'Weather') { result[id] = { kind: 'weather' }; continue; }
    const list = runs.get(id) ?? [], shown = list.find(run => run.end >= now);
    if (!shown) {
      const treatment = (Object.keys(BIRTHDAY_SCENES) as BirthdayTreatment[]).find(key => BIRTHDAY_SCENES[key] === id);
      result[id] = { kind: 'never', reason: treatment ? input.birthdays.some(entry => entry.treatment === treatment) ? 'window' : 'birthday' : definition.group === 'Seasons' ? 'window' : 'calendars' };
      continue;
    }
    const anniversary = `${Number(days[shown.start]!.slice(0, 4)) + 1}${days[shown.start]!.slice(4)}`;
    const more = list.filter(run => run.start > shown.end && days[run.start]! < anniversary).length;
    if (shown.start <= now && scenes[now] === id) result[id] = { kind: 'current', start: days[shown.start]!, end: days[shown.end]!, more };
    else {
      const resume = shown.parts.find(([start]) => start > now)![0];
      result[id] = { kind: 'next', start: days[Math.max(shown.start, resume)]!, end: days[shown.end]!, more };
    }
  }
  return result;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function civilFormat(date: string, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let format = formats.get(key);
  if (!format) { format = new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }); formats.set(key, format); }
  return format.format(new Date(`${date}T12:00:00Z`));
}
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
/** What a weather scene waits for. */
export const WEATHER_WHEN: Partial<Record<ThemeSceneId, string>> = { rain: 'when it rains', snow: 'when it snows', storm: 'in a storm', fog: 'in fog', wind: 'when windy' };
export const NEVER_WHEN = { calendars: 'not with your calendars', birthday: 'no birthday set', window: 'not in the next year' } as const;

/**
 * A short phrase for a scene's dates (#697), in the app's civil-date style (`en`, the day at noon UTC):
 * `until Nov 14` (today's scene; `today` when it is today only), `Jan 7`, `Oct 15 – 31`, `Nov 15 – Dec 26`, with
 * `+ 1 more` for another occurrence within the year and a year only for a start more than a year away.
 */
export function sceneWhenLabel(id: ThemeSceneId, when: SceneWhen, today: string): string {
  if (when.kind === 'weather') return WEATHER_WHEN[id] ?? 'with the weather';
  if (when.kind === 'never') return NEVER_WHEN[when.reason];
  const more = when.more ? ` + ${when.more} more` : '';
  if (when.kind === 'current') return `${when.start === when.end ? 'today' : `until ${civilFormat(when.end, { month: 'short', day: 'numeric' })}`}${more}`;
  const year = daysBetween(today, when.start) > 365 ? { year: 'numeric' as const } : {};
  const start = civilFormat(when.start, { month: 'short', day: 'numeric', ...year });
  if (when.start === when.end) return `${start}${more}`;
  const sameMonth = when.start.slice(0, 7) === when.end.slice(0, 7) && !('year' in year);
  return `${start} – ${civilFormat(when.end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric', ...year })}${more}`;
}
