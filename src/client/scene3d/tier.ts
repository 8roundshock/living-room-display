/** Intensity tier of a scene, derived from the app's own scene data: the registry group and the
 * holiday policy's eligibility window. No second list of scenes lives here. */
import { observancesForYear, shiftHolidayDate } from '../../shared/holidays.ts';
import { holidayScenePolicy, THEME_SCENES, type ThemeSceneId } from '../../shared/theme-registry.ts';
import type { SceneTier } from './settings.ts';

/** A celebration that can be on screen for at most this many consecutive days is a special
 * occasion; a longer window spans more than one week and is treated as everyday scenery. */
export const SPECIAL_MAX_WINDOW_DAYS = 7;
const DAY = 86_400_000;
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** Longest run of consecutive days on which the holiday policy can show this scene in `year`,
 * across all calendars (lead days, the holiday's own span and adjoining observances of the same
 * scene, such as Christmas and Boxing Day). Zero when no observance uses the scene. */
export function sceneWindowDays(sceneId: string, year: number): number {
  const spans = observancesForYear(year).flatMap(observance => {
    const policy = holidayScenePolicy(observance.id);
    if (policy.role !== 'major' || policy.scene !== sceneId) return [];
    const approach = shiftHolidayDate(observance.date, -policy.leadDays);
    const start = approach < observance.startDate ? approach : observance.startDate;
    const end = policy.endOffset === undefined ? observance.endDate : shiftHolidayDate(observance.date, policy.endOffset);
    return [[noon(start), noon(end)] as [number, number]];
  }).sort((a, b) => a[0] - b[0]);
  let longest = 0, current: [number, number] | null = null;
  for (const span of spans) {
    if (current && span[0] <= current[1] + DAY) current[1] = Math.max(current[1], span[1]);
    else current = [span[0], span[1]];
    longest = Math.max(longest, Math.round((current[1] - current[0]) / DAY) + 1);
  }
  return longest;
}

/** `special` for birthdays and celebrations whose window is a week or less; `everyday` for
 * seasons, weather and holidays that stay for more than a week. Weather over a scene (Combined)
 * keeps that scene's tier. */
export function sceneTier(scene: { motif: ThemeSceneId; habitat?: ThemeSceneId }, year: number): SceneTier {
  const base = scene.habitat ?? scene.motif, group = THEME_SCENES[base]?.group;
  if (group === 'Birthdays') return 'special';
  if (group !== 'Celebrations') return 'everyday';
  const days = sceneWindowDays(base, year);
  return days > 0 && days <= SPECIAL_MAX_WINDOW_DAYS ? 'special' : 'everyday';
}
