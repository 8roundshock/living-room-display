/** Original contour artwork and product policy. Calendar facts live in holidays.ts.
 * Read docs/ambient-themes.md before changing eligibility, cultural art or motion. */
export interface ThemeArt { primary: string; secondary?: string }
export interface ThemeDefinition {
  label: string;
  group: 'Seasons' | 'Celebrations' | 'Weather';
  palette: readonly [string, string];
  art: readonly ThemeArt[];
  /** Short-side percentage of the principal mark; companion marks are smaller. */
  size: number;
  motion: 'float' | 'rain' | 'wind';
  slots: number;
  interval: number;
}
const leaf: ThemeArt = { primary: 'M20 82C8 54 29 18 81 13C85 54 62 88 20 82Z M20 82L72 23', secondary: 'M33 67L29 44 M49 51L70 48 M57 42L55 27' };
const branch: ThemeArt = { primary: 'M14 88Q47 58 77 13 M36 64Q17 56 16 39Q36 39 42 55 M53 43Q70 49 85 35Q68 28 58 35', secondary: 'M66 28Q53 18 58 8Q72 13 71 20' };
const pine: ThemeArt = { primary: 'M15 84Q42 55 82 18 M30 68L18 42 M30 68L53 68 M42 54L31 28 M42 54L67 55 M57 39L49 17 M57 39L80 40 M70 27L66 10', secondary: 'M25 73L17 60 M36 61L25 46 M49 47L42 32 M62 34L57 22' };
const ornament: ThemeArt = { primary: 'M48 7V28 M42 29H54V36H42Z M64 42A23 23 0 1 1 32 42', secondary: 'M31 57Q48 69 65 57 M40 78Q49 81 57 77' };
const grain: ThemeArt = { primary: 'M38 91Q46 53 58 14 M49 52Q23 50 29 33Q45 34 49 52 M53 38Q72 36 74 20Q57 19 53 38 M44 69Q18 66 24 50Q39 52 44 69 M48 57Q71 59 77 42Q58 37 48 57', secondary: 'M57 25Q44 15 54 4Q65 11 57 25' };
const moon: ThemeArt = { primary: 'M73 17A39 39 0 0 1 84 72 M74 84A39 39 0 0 1 19 75 M12 62A39 39 0 0 1 20 25 M30 15A39 39 0 0 1 59 10', secondary: 'M66 24A30 30 0 0 1 78 45 M23 61A30 30 0 0 0 39 77' };
const egg: ThemeArt = { primary: 'M50 10C31 10 18 46 18 65C18 97 82 97 82 65C82 46 69 10 50 10Z', secondary: 'M22 54Q50 68 78 54 M22 72Q50 58 78 72' };
const petal: ThemeArt = { primary: 'M19 71Q14 31 50 13Q86 31 81 71Q50 93 19 71Z M50 13Q31 47 50 83Q69 47 50 13', secondary: 'M19 71Q50 61 81 71' };
const kite: ThemeArt = { primary: 'M22 11L79 19L70 76L13 68Z M53 32A12 12 0 1 1 39 52A12 12 0 1 1 53 32 M13 68Q35 82 22 92Q16 96 30 98', secondary: 'M22 11L38 32 M79 19L59 34 M70 76L56 55 M13 68L35 52' };
const lotus: ThemeArt = { primary: 'M50 83Q18 66 14 39Q40 38 50 69 M50 83Q82 66 86 39Q60 38 50 69 M50 76Q25 50 50 13Q75 50 50 76 M50 83V96', secondary: 'M24 46Q22 28 31 20Q46 33 45 48 M76 46Q78 28 69 20Q54 33 55 48 M42 88H58' };
const star: ThemeArt = { primary: 'M50 8L57 37L86 29L65 50L86 71L57 63L50 92L43 63L14 71L35 50L14 29L43 37Z', secondary: 'M50 27V73 M27 50H73' };
const ring: ThemeArt = { primary: 'M74 20A38 38 0 1 1 20 74 M18 29A38 38 0 0 1 44 12', secondary: 'M62 29A25 25 0 1 1 29 62' };
const seed: ThemeArt = { primary: 'M23 80Q50 56 71 20 M47 55Q22 53 22 30Q45 31 47 55 M60 38Q82 44 89 23Q69 15 60 38', secondary: 'M35 68Q23 63 14 69 M73 19L84 9' };
const scene = (label: string, palette: readonly [string, string], art: readonly ThemeArt[], group: ThemeDefinition['group'] = 'Celebrations', size = 14): ThemeDefinition =>
  ({ label, group, palette, art, size, motion: 'float', slots: 4, interval: 4000 });
const weather = (label: string, palette: readonly [string, string], art: ThemeArt, size: number, motion: ThemeDefinition['motion'] = 'float'): ThemeDefinition =>
  ({ label, group: 'Weather', palette, art: [art], size, motion, slots: motion === 'wind' ? 5 : 8, interval: motion === 'wind' ? 4000 : 2000 });

/** The renderer and scene picker consume this same registry; no parallel list of art. */
export const THEME_SCENES = {
  spring: scene('Spring', ['#879f8a', '#a294a6'], [branch, petal, seed], 'Seasons'),
  summer: scene('Summer', ['#789c8b', '#b19b6b'], [seed, branch, ring], 'Seasons'),
  autumn: scene('Autumn', ['#b18b68', '#a27363'], [leaf, grain, seed], 'Seasons'),
  winter: scene('Winter', ['#8c9fae', '#82978b'], [pine, { primary: 'M50 10V90 M15 30L85 70 M15 70L85 30', secondary: 'M38 18L50 30L62 18 M38 82L50 70L62 82 M20 46L32 40L31 26 M69 74L68 60L80 54' }, branch], 'Seasons'),
  christmas: scene('Christmas', ['#8ca087', '#b5a077'], [pine, ornament, pine]),
  'new-year': scene('New Year', ['#b4a17c', '#98a9b5'], [ring, { primary: 'M16 80Q18 21 79 18 M28 87Q30 38 87 31', secondary: 'M28 28L20 16 M71 75L80 85' }, star]),
  'new-year-tree': scene('New Year · Russia', ['#8ca08e', '#b7a17a'], [{ primary: 'M50 10L26 35H37L15 61H32L8 86H92L68 61H85L63 35H74Z', secondary: 'M23 68Q50 81 77 68 M36 43Q50 52 64 43 M50 86V96' }, ornament, ring]),
  'orthodox-christmas': scene('Orthodox Christmas', ['#a4a8bb', '#b6a98c'], [star, pine, star]),
  halloween: scene('Halloween', ['#b18b64', '#9c8298'], [{ primary: 'M50 28C18 8 5 42 14 72C22 94 37 87 50 89C63 87 78 94 86 72C95 42 82 8 50 28Z M49 27Q44 13 59 6', secondary: 'M50 28Q29 46 35 82 M50 28Q71 46 65 82 M50 34V82' }, leaf, seed]),
  thanksgiving: scene('Thanksgiving · Canada', ['#b29a68', '#a78469'], [grain, leaf, grain]),
  'canada-day': scene('Canada Day', ['#b6857f', '#a8a89d'], [{ primary: 'M49 88L49 68L23 74L27 60L10 47L25 44L21 29L38 38L41 15L50 25L59 15L62 38L79 29L75 44L90 47L73 60L77 74L51 68', secondary: 'M50 67V38 M49 59L33 49 M51 59L67 49' }, leaf, seed]),
  easter: scene('Easter · Canada', ['#929f87', '#ac98ab'], [egg, branch, petal]),
  seollal: scene('Seollal · Korea', ['#a4acb8', '#b38e79'], [kite, { primary: 'M27 18L39 30H62L73 18 M39 30C14 48 14 81 50 86C86 81 86 48 62 30Z', secondary: 'M38 38H63 M49 31V56 M43 54L49 63L55 54' }, kite]),
  chuseok: scene('Chuseok · Korea', ['#b5ac93', '#96a080'], [moon, grain, { primary: 'M17 67Q50 7 83 67Q50 91 17 67Z', secondary: 'M27 66Q50 49 73 66' }], 'Celebrations', 16),
  'lotus-lanterns': scene('Buddha’s Birthday · Korea', ['#b49a9e', '#b5a479'], [lotus, lotus, petal]),
  maslenitsa: scene('Maslenitsa · Russia', ['#b59a6b', '#8d9eae'], [ring, { primary: 'M13 20Q45 46 83 20L76 75Q43 57 20 81Z', secondary: 'M20 81L17 93 M30 77L29 90 M69 73L68 87 M76 75L77 90' }, ring]),
  pascha: scene('Orthodox Easter', ['#ae8782', '#9ca88e'], [egg, branch, egg]),
  mimosa: scene('Women’s Day · Russia', ['#b6a366', '#8fa18c'], [{ primary: 'M33 90Q46 53 72 13 M44 63Q19 62 14 43Q40 46 44 63 M57 42Q76 53 90 38Q71 32 57 42', secondary: 'M54 24A7 7 0 1 1 40 24A7 7 0 1 1 54 24 M76 22A7 7 0 1 1 62 22A7 7 0 1 1 76 22 M53 44A7 7 0 1 1 39 44A7 7 0 1 1 53 44 M69 8A6 6 0 1 1 57 8A6 6 0 1 1 69 8' }, branch, seed]),
  rain: weather('Rain', ['#8fa5ba', '#8397a7'], { primary: 'M65 8L28 92' }, 4, 'rain'),
  snow: weather('Snow', ['#a6b1be', '#929eae'], { primary: 'M50 12V88 M17 31L83 69 M17 69L83 31', secondary: 'M39 20L50 31L61 20 M39 80L50 69L61 80' }, 3),
  storm: weather('Storms', ['#979eaf', '#8e98aa'], { primary: 'M65 8L28 92 M91 19L56 96' }, 5, 'rain'),
  fog: weather('Fog', ['#8b9ca6', '#7c909a'], { primary: 'M4 40Q35 19 65 40T96 40 M15 68Q47 48 85 64' }, 13, 'wind'),
  wind: weather('Wind', ['#8ca79d', '#a29d86'], { primary: 'M4 64Q32 22 63 39T94 22', secondary: 'M17 85Q50 54 80 65' }, 12, 'wind'),
} satisfies Record<string, ThemeDefinition>;
export type ThemeSceneId = keyof typeof THEME_SCENES;
export const THEME_SCENE_IDS = Object.keys(THEME_SCENES) as ThemeSceneId[];
export const THEME_ACTIVE_MS = 12_000;
export const THEME_RETIRE_MS = 180;
/** Include the smooth retirement and one paint allowance in future reading-space bounds. */
export const THEME_CLEARANCE_SECONDS = (THEME_ACTIVE_MS + THEME_RETIRE_MS + 20) / 1000;
export const THEME_PARTICLES_MAX = 8;
export const QUIET_PALETTE = ['#858f94', '#798788'] as const;

export type HolidayScenePolicy = { role: 'card' } | { role: 'quiet' } | {
  role: 'major'; scene: ThemeSceneId; priority: number; leadDays: number;
  /** Relative to the central day; omitted means the factual ordinary holiday end. */
  endOffset?: number;
};
const card = { role: 'card' } as const, quiet = { role: 'quiet' } as const;
const major = (scene: ThemeSceneId, priority: number, leadDays = 0, endOffset?: number): HolidayScenePolicy =>
  ({ role: 'major', scene, priority, leadDays, ...(endOffset === undefined ? {} : { endOffset }) });
/** Explicit presentation tiers; cultural importance is not inferred from the tier.
 * Sources/review dates and the distinction between date facts and design choices:
 * docs/holiday-calendar.md. New/unlisted observances deliberately remain card-only. */
export const HOLIDAY_SCENE_POLICY: Readonly<Record<string, HolidayScenePolicy>> = {
  'ca:new-year': major('new-year', 80, 5), 'ca:valentines': card, 'ca:flag-day': card,
  'ca:good-friday': quiet, 'ca:easter': major('easter', 75, 7), 'ca:easter-monday': major('easter', 75),
  'ca:victoria': card, 'ca:indigenous': card, 'ca:canada-day': major('canada-day', 65, 2),
  'ca:labour': card, 'ca:reconciliation': quiet, 'ca:thanksgiving': major('thanksgiving', 70, 7),
  'ca:halloween': major('halloween', 80, 16), 'ca:remembrance': quiet,
  'ca:christmas': major('christmas', 90, 40), 'ca:boxing-day': major('christmas', 90),
  'kr:new-year': major('new-year', 80, 5), 'kr:independence-movement': card, 'kr:labour': card,
  'kr:children': card, 'kr:memorial': quiet, 'kr:constitution': card, 'kr:liberation': card,
  'kr:foundation': card, 'kr:hangeul': card, 'kr:christmas': major('christmas', 90, 40),
  'kr:seollal': major('seollal', 90, 7), 'kr:daeboreum': card,
  'kr:buddha': major('lotus-lanterns', 65, 3), 'kr:dano': card, 'kr:chilseok': card,
  'kr:chuseok': major('chuseok', 85, 7),
  // A selected Russian calendar supplies the shared New Year tree; still only one scene.
  'ru:new-year': major('new-year-tree', 81, 5), 'ru:christmas': major('orthodox-christmas', 95, 6),
  'ru:old-new-year': card, 'ru:easter': major('pascha', 75, 7), 'ru:maslenitsa': major('maslenitsa', 70),
  'ru:defender': card, 'ru:women': major('mimosa', 65, 2), 'ru:spring-labour': card,
  'ru:victory': quiet, 'ru:russia': card, 'ru:unity': card,
};
export const holidayScenePolicy = (id: string): HolidayScenePolicy => HOLIDAY_SCENE_POLICY[id] ?? card;
