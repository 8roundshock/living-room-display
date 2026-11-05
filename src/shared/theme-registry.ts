/** Original artwork and product policy. Calendar facts live in holidays.ts.
 * Read docs/ambient-themes.md before changing eligibility, cultural art or motion. */
import type { BirthdayTreatment } from './birthdays.ts';
import { LIVING_SCENE_ART, type LivingSceneArt } from './living-scene-art.ts';
export const LIVING_SCENE_BUDGET = { life: 36_000, stagger: 12_000, observation: 4000, patches: 4, paths: 240, animations: 32 } as const;
export type ThemeTone = 0 | 1 | 2;
export interface ThemeArt { primary: string; secondary?: string; accent?: string; wash?: string; tone?: ThemeTone; secondaryTone?: ThemeTone; motion?: ThemeMotion }
export interface ThemeMotionFrame { x: number; y: number; turn: number }
/** Five CSS waypoints (0/25/50/75/100%). Travel is viewport percent; rotation is
 * about the art centre. The same actual waypoints supply placement bounds. */
const motion = (x: number, y: number, turn: number, points: readonly (readonly [number, number, number])[]): readonly ThemeMotionFrame[] =>
  points.map(([px, py, pt]) => ({ x: x * px, y: y * py, turn: turn * pt }));
const glide = [[0, 0, -.3], [.2, .25, .1], [.5, .5, .4], [.8, .75, .7], [1, 1, 1]] as const;
const rocking = [[0, 0, -.4], [-.5, .25, .6], [.4, .5, -.2], [.9, .75, 1], [.6, 1, .2]] as const;
const tumbling = [[0, 0, -.6], [-.35, .25, .4], [.4, .5, -.3], [.65, .75, .8], [1, 1, 1]] as const;
export const THEME_MOTIONS = {
  sway: motion(.8, 1.2, 9, rocking), flutter: motion(2.2, 3.2, 14, tumbling),
  rise: motion(1.4, -2.8, 7, rocking), drift: motion(1.8, 1.8, 6, glide),
  rain: motion(-1.6, 4.2, 0, glide), snow: motion(2.1, 3.8, 18, tumbling),
  mist: motion(3, .7, 0, glide), wind: motion(3.2, 1.3, 8, glide),
} as const;
export type ThemeMotion = keyof typeof THEME_MOTIONS;
export const THEME_GROUPS = ['Seasons', 'Celebrations', 'Birthdays', 'Weather'] as const;
export interface ThemeDefinition {
  composition?: LivingSceneArt;
  label: string;
  group: typeof THEME_GROUPS[number];
  palette: readonly [string, string, string];
  art: readonly ThemeArt[];
  /** Short-side percentage of a feature form; companions use smaller scales. */
  size: number;
  motion: ThemeMotion;
  slots: number;
  interval: number;
  still: number;
}
const leaf: ThemeArt = { primary: 'M20 82C8 54 29 18 81 13C85 54 62 88 20 82Z M20 82L72 23', secondary: 'M33 67L29 44 M49 51L70 48 M57 42L55 27', accent: 'M8 24Q16 9 25 12Q23 26 8 24 M72 85Q84 72 94 78Q90 91 72 85', wash: 'M22 77Q19 45 70 22Q73 56 22 77Z', motion: 'flutter' };
const branch: ThemeArt = { primary: 'M14 88Q47 58 77 13 M36 64Q17 56 16 39Q36 39 42 55 M53 43Q70 49 85 35Q68 28 58 35', secondary: 'M66 28Q53 18 58 8Q72 13 71 20', accent: 'M22 27a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M69 58a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M43 13a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', wash: 'M16 39Q36 39 42 55Q24 55 16 39Z', motion: 'sway' };
const pine: ThemeArt = { primary: 'M15 84Q42 55 82 18 M30 68L18 42 M30 68L53 68 M42 54L31 28 M42 54L67 55 M57 39L49 17 M57 39L80 40 M70 27L66 10', secondary: 'M25 73L17 60 M36 61L25 46 M49 47L42 32 M62 34L57 22 M42 54L58 62 M57 39L72 46', accent: 'M62 73a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M73 62a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', motion: 'sway' };
const ornament: ThemeArt = { primary: 'M48 7V28 M42 29H54V36H42Z M64 42A23 23 0 1 1 32 42', secondary: 'M27 57Q48 72 69 57 M31 72Q49 81 65 72', accent: 'M42 48L49 42L56 48L49 54Z M78 13V29 M70 21H86', wash: 'M28 59Q48 72 68 59L65 70Q48 80 31 70Z', tone: 1, motion: 'sway' };
const grain: ThemeArt = { primary: 'M38 91Q46 53 58 14 M49 52Q23 50 29 33Q45 34 49 52 M53 38Q72 36 74 20Q57 19 53 38 M44 69Q18 66 24 50Q39 52 44 69 M48 57Q71 59 77 42Q58 37 48 57', secondary: 'M57 25Q44 15 54 4Q65 11 57 25 M64 86Q75 71 85 54 M75 72L89 68', accent: 'M17 16L21 27 M10 23L26 20 M80 9L83 18', wash: 'M49 52Q23 50 29 33Q45 34 49 52Z M48 57Q71 59 77 42Q58 37 48 57Z', tone: 1, motion: 'sway' };
const moon: ThemeArt = { primary: 'M73 17A39 39 0 0 1 84 72 M74 84A39 39 0 0 1 19 75 M12 62A39 39 0 0 1 20 25 M30 15A39 39 0 0 1 59 10', secondary: 'M66 24A30 30 0 0 1 78 45 M23 61A30 30 0 0 0 39 77', accent: 'M31 33Q37 27 43 31 M59 66Q65 61 70 64 M51 18L54 20', motion: 'drift' };
const egg: ThemeArt = { primary: 'M50 10C31 10 18 46 18 65C18 97 82 97 82 65C82 46 69 10 50 10Z', secondary: 'M22 49Q50 62 78 49 M21 72Q50 59 79 72 M29 81Q50 89 71 81', accent: 'M31 36L38 30L45 36L38 42Z M55 36L62 30L69 36L62 42Z M39 66L50 60L61 66L50 72Z', wash: 'M23 50Q50 63 77 50L79 56Q50 69 21 56Z', motion: 'drift' };
const petal: ThemeArt = { primary: 'M50 49C24 16 41 7 50 23C61 3 79 18 54 49C85 25 97 44 77 51C97 62 80 78 54 55C78 87 58 97 50 76C39 96 22 80 46 55C14 79 3 59 24 51C3 41 18 23 46 48Z', secondary: 'M43 51A7 7 0 1 0 57 51A7 7 0 1 0 43 51', accent: 'M15 14Q29 9 29 24Q15 28 15 14 M76 81Q90 74 92 89Q78 94 76 81', wash: 'M50 49C24 16 41 7 50 23C61 3 79 18 54 49Z', tone: 1, motion: 'rise' };
const kite: ThemeArt = { primary: 'M22 11L79 19L70 76L13 68Z M53 32A12 12 0 1 1 39 52A12 12 0 1 1 53 32 M13 68Q35 82 22 92Q16 96 30 98', secondary: 'M22 11L38 32 M79 19L59 34 M70 76L56 55 M13 68L35 52', accent: 'M18 80L12 86L23 87 M28 92L37 89 M28 17L48 25L72 23', wash: 'M24 15L47 29L36 34L20 57Z M73 24L60 36L62 48L69 66Z', motion: 'flutter' };
const lotus: ThemeArt = { primary: 'M50 83Q18 66 14 39Q40 38 50 69 M50 83Q82 66 86 39Q60 38 50 69 M50 76Q25 50 50 13Q75 50 50 76 M50 83V96', secondary: 'M24 46Q22 28 31 20Q46 33 45 48 M76 46Q78 28 69 20Q54 33 55 48', accent: 'M40 87H60 M43 92H57 M9 18L13 12 M86 13L91 20', wash: 'M50 76Q25 50 50 13Q75 50 50 76Z', motion: 'rise' };
const star: ThemeArt = { primary: 'M50 8L57 37L86 29L65 50L86 71L57 63L50 92L43 63L14 71L35 50L14 29L43 37Z', secondary: 'M50 27V73 M27 50H73', accent: 'M13 12L18 18 M82 82L88 89 M86 12L81 18 M12 87L18 81', wash: 'M50 27L57 43L73 50L57 57L50 73L43 57L27 50L43 43Z', motion: 'drift' };
const ring: ThemeArt = { primary: 'M74 20A38 38 0 1 1 20 74 M18 29A38 38 0 0 1 44 12', secondary: 'M62 29A25 25 0 1 1 29 62', accent: 'M75 8L78 18 M87 24L96 22 M10 80L6 89 M25 91L29 97', motion: 'rise' };
const seed: ThemeArt = { primary: 'M23 80Q50 56 71 20 M47 55Q22 53 22 30Q45 31 47 55 M60 38Q82 44 89 23Q69 15 60 38', secondary: 'M35 68Q23 63 14 69 M73 19L84 9', accent: 'M10 18L16 25 M19 13L23 21 M72 77Q85 63 91 74Q86 87 72 77', wash: 'M60 38Q82 44 89 23Q69 15 60 38Z', motion: 'flutter' };
const flake: ThemeArt = { primary: 'M50 10V90 M15 30L85 70 M15 70L85 30', secondary: 'M38 18L50 30L62 18 M38 82L50 70L62 82 M20 46L32 40L31 26 M69 74L68 60L80 54', accent: 'M8 84V96 M2 90H14 M88 4V16 M82 10H94', tone: 2, motion: 'snow' };
const scene = (label: string, palette: ThemeDefinition['palette'], art: readonly ThemeArt[], group: ThemeDefinition['group'] = 'Celebrations', size = 14, motion: ThemeMotion = 'drift'): ThemeDefinition =>
  ({ label, group, palette, art, size, motion, slots: 9, interval: 1600, still: 7 });
const weather = (label: string, palette: ThemeDefinition['palette'], art: readonly ThemeArt[], size: number, motion: ThemeMotion): ThemeDefinition =>
  ({ label, group: 'Weather', palette, art, size, motion, slots: motion === 'mist' ? 8 : 12, interval: motion === 'mist' ? 2000 : 1200, still: motion === 'mist' ? 6 : 9 });

const birthdayCake: ThemeArt = {
  primary: 'M17 47Q50 37 83 47V81Q50 93 17 81Z M17 48Q20 65 30 57Q40 69 50 58Q60 69 70 57Q80 64 83 48 M10 85Q50 99 90 85',
  secondary: 'M46 42V27H54V42 M50 22C40 17 50 7 50 7C50 7 60 17 50 22Z',
  accent: 'M24 73Q50 82 76 73', wash: 'M21 65Q50 75 79 65V78Q50 87 21 78Z', motion: 'sway',
};
const birthdayBalloons: ThemeArt = {
  primary: 'M16 29C16 2 52 2 52 29C52 52 34 58 34 58C34 58 16 52 16 29Z M32 59L36 59L34 64Z M34 64Q18 78 37 96',
  secondary: 'M55 41C55 20 84 20 84 41C84 59 70 64 70 64C70 64 55 59 55 41Z M70 65Q88 81 62 94',
  accent: 'M24 22Q25 14 32 13 M61 38Q62 31 68 30 M7 70L13 74 M88 9L91 16',
  wash: 'M20 29C20 10 37 6 43 13Q27 15 27 34Q28 44 35 51C27 48 20 40 20 29Z', tone: 1, motion: 'rise',
};
const birthdayGift: ThemeArt = {
  primary: 'M16 43H84V84H16Z M12 33H88V44H12Z',
  secondary: 'M45 33V84 M55 33V84 M50 32C13 34 22 6 39 16Z M50 32C87 34 78 6 61 16Z',
  accent: 'M8 13L12 20 M83 8L79 17 M4 91L12 94 M88 59L97 64',
  wash: 'M20 48H40V80H20Z', tone: 2, motion: 'flutter',
};
const russianCake: ThemeArt = { ...birthdayCake, accent: 'M23 72L30 65L37 72L30 79Z M43 75L50 68L57 75L50 82Z M63 72L70 65L77 72L70 79Z' };
const koreanCake: ThemeArt = { ...birthdayCake, accent: 'M21 69Q50 78 79 69 M37 66V83 M60 73V83 M60 73L77 79', wash: 'M22 67Q29 70 36 71V81L22 78Z M61 74L77 71V78Z' };

/** Central registry for original art, demonstrations and bounded scene behavior. */
const SCENE_DEFINITIONS = {
  birthday: scene('Birthday · Classic', ['#df9da8', '#8ac4df', '#e2c679'], [birthdayCake, birthdayBalloons, birthdayGift], 'Birthdays', 15),
  'birthday-russian': scene('Birthday · Russian accents', ['#df91a3', '#dfc176', '#90bfcb'], [russianCake, birthdayBalloons, { ...birthdayGift, accent: 'M20 63L28 55L36 63L28 71Z M62 63L70 55L78 63L70 71Z M20 77H39 M61 77H80' }], 'Birthdays', 15),
  'birthday-korean': scene('Birthday · Korean accents', ['#86cbb6', '#df9aab', '#e2c17c'], [koreanCake, birthdayBalloons, { ...birthdayGift, secondary: 'M50 33C13 34 22 6 39 16Z M50 33C87 34 78 6 61 16Z M40 44V84 M40 61H84 M64 61V84', accent: 'M16 70H40 M64 61L84 44', wash: 'M18 46H38V68H18Z M42 63H62V82H42Z' }], 'Birthdays', 15),
  spring: scene('Spring', ['#79c99b', '#db91b5', '#dec386'], [branch, petal, seed], 'Seasons'),
  summer: { ...scene('Summer', ['#63c1af', '#e1bd62', '#dc9476'], [{ ...petal, tone: 1 }, { ...seed, tone: 0 }, { ...ring, tone: 2 }], 'Seasons'), composition: LIVING_SCENE_ART.summer },
  autumn: scene('Autumn', ['#dc995b', '#bf6f86', '#dbbf70'], [leaf, grain, { ...seed, tone: 2 }], 'Seasons'),
  winter: scene('Winter', ['#83bcd9', '#99c9b7', '#b8a3d8'], [{ ...flake, tone: 0 }, { ...pine, tone: 1 }, branch], 'Seasons'),
  christmas: scene('Christmas', ['#74c398', '#d57d8a', '#e1c077'], [pine, ornament, { ...star, tone: 2 }]),
  'new-year': scene('New Year', ['#e2c778', '#85bde0', '#cd94c8'], [ring, { primary: 'M16 80Q18 21 79 18 M28 87Q30 38 87 31', secondary: 'M28 28L20 16 M71 75L80 85', accent: 'M12 48L5 53 M63 7L69 16 M80 52L91 57 M46 89L49 97', tone: 1, motion: 'rise' }, { ...star, tone: 2 }]),
  'new-year-tree': scene('New Year · Russia', ['#75c7a3', '#dfbc6a', '#c38bce'], [{ primary: 'M50 10L26 35H37L15 61H32L8 86H92L68 61H85L63 35H74Z', secondary: 'M23 68Q50 81 77 68 M36 43Q50 52 64 43 M50 86V96', accent: 'M42 57a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M60 77a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M48 14L50 5L52 14', wash: 'M21 72Q50 84 79 72L88 83H12Z', motion: 'sway' }, ornament, { ...flake, tone: 2 }]),
  'orthodox-christmas': scene('Orthodox Christmas', ['#a9b9e3', '#e1c688', '#83baa9'], [star, { ...pine, tone: 2 }, { ...ornament, tone: 1 }]),
  halloween: scene('Halloween', ['#e3a05c', '#b68ac7', '#93b486'], [{ primary: 'M50 28C18 8 5 42 14 72C22 94 37 87 50 89C63 87 78 94 86 72C95 42 82 8 50 28Z M49 27Q44 13 59 6', secondary: 'M50 28Q29 46 35 82 M50 28Q71 46 65 82 M50 34V82', accent: 'M58 18Q71 3 77 16Q78 27 67 29', wash: 'M50 34Q29 46 35 82Q45 87 50 85Z', motion: 'sway' }, { ...leaf, tone: 1 }, { ...seed, tone: 2 }]),
  thanksgiving: scene('Thanksgiving · Canada', ['#d1b46b', '#cd8564', '#92b595'], [{ ...grain, tone: 0 }, { ...leaf, tone: 1 }, { ...seed, tone: 2 }]),
  'canada-day': scene('Canada Day', ['#df7f87', '#d3c5ab', '#a4bfd4'], [{ primary: 'M49 88L49 68L23 74L27 60L10 47L25 44L21 29L38 38L41 15L50 25L59 15L62 38L79 29L75 44L90 47L73 60L77 74L51 68', secondary: 'M50 67V38 M49 59L33 49 M51 59L67 49', accent: 'M9 14L15 21 M83 85L90 91', wash: 'M49 65L30 69L33 57L19 48L38 51L49 34Z', motion: 'flutter' }, { ...leaf, tone: 1 }, { ...ring, tone: 2 }]),
  easter: scene('Easter · Canada', ['#a6c595', '#cc99ce', '#e0bf81'], [egg, branch, petal]),
  seollal: scene('Seollal · Korea', ['#89b9dc', '#d78e9b', '#ddc27c'], [kite, { primary: 'M27 18L39 30H62L73 18 M39 30C14 48 14 81 50 86C86 81 86 48 62 30Z', secondary: 'M38 38H63 M49 31V56 M43 54L49 63L55 54', accent: 'M30 63Q50 76 70 63 M42 71L50 76L58 71', wash: 'M39 39Q24 59 31 73Q49 84 68 73L62 65Q45 71 39 39Z', tone: 1, motion: 'sway' }, { ...kite, tone: 2 }]),
  chuseok: scene('Chuseok · Korea', ['#e1c786', '#9fbe8b', '#c69fca'], [moon, grain, { primary: 'M17 67Q50 7 83 67Q50 91 17 67Z', secondary: 'M27 66Q50 49 73 66', accent: 'M15 27Q24 16 32 25 M71 88L80 84', wash: 'M22 67Q50 29 78 67Q50 85 22 67Z', tone: 2 }], 'Celebrations', 16),
  'lotus-lanterns': scene('Buddha’s Birthday · Korea', ['#d992b8', '#e1bc76', '#8fbcb3'], [lotus, { ...lotus, tone: 1 }, { ...petal, tone: 2 }]),
  maslenitsa: scene('Maslenitsa · Russia', ['#dfb664', '#88b9cf', '#d28f82'], [{ primary: 'M12 39C12 13 88 13 88 39C88 64 12 64 12 39Z M12 51C12 76 88 76 88 51 M12 65C12 88 88 88 88 65', secondary: 'M22 35Q50 20 78 35 M22 42Q49 56 78 42', accent: 'M45 33L56 30L62 38L50 42Z M7 8L12 17 M88 9L84 17', wash: 'M45 33L56 30L62 38L50 42Z', motion: 'drift' }, { primary: 'M13 20Q45 46 83 20L76 75Q43 57 20 81Z', secondary: 'M20 81L17 93 M30 77L29 90 M69 73L68 87 M76 75L77 90', accent: 'M24 34L30 45L39 39L47 49L57 41L65 45L74 33', wash: 'M20 28Q45 46 77 28L76 40Q48 57 22 42Z', tone: 1, motion: 'flutter' }, { ...ring, tone: 2 }]),
  pascha: scene('Orthodox Easter', ['#d87f88', '#9bc29e', '#dec181'], [{ ...egg, secondary: 'M23 50L36 38L50 51L64 38L77 50 M20 69L35 56L50 70L65 56L80 69', accent: 'M34 79L50 72L66 79 M45 25L50 18L55 25L50 32Z', secondaryTone: 2 }, branch, { ...egg, tone: 2 }]),
  mimosa: scene('Women’s Day · Russia', ['#95be94', '#e2c360', '#c69cc5'], [{ primary: 'M54 24A7 7 0 1 1 40 24A7 7 0 1 1 54 24 M76 22A7 7 0 1 1 62 22A7 7 0 1 1 76 22 M53 44A7 7 0 1 1 39 44A7 7 0 1 1 53 44 M69 8A6 6 0 1 1 57 8A6 6 0 1 1 69 8', secondary: 'M33 90Q46 53 72 13 M44 63Q19 62 14 43Q40 46 44 63 M57 42Q76 53 90 38Q71 32 57 42', accent: 'M14 80Q23 71 28 83 M78 66Q87 56 94 66', wash: 'M54 24A7 7 0 1 1 40 24A7 7 0 1 1 54 24 M53 44A7 7 0 1 1 39 44A7 7 0 1 1 53 44', tone: 1, secondaryTone: 0, motion: 'sway' }, branch, { ...seed, tone: 1 }]),
  rain: weather('Rain', ['#70bce5', '#b39fdf', '#6bc9b7'], [{ primary: 'M53 8C45 25 36 34 36 45C36 65 70 65 70 45C70 34 61 25 53 8Z M19 24L3 62 M87 51L72 90', secondary: 'M44 44Q42 52 51 54 M58 76L48 96', accent: 'M30 77Q49 86 67 77 M28 88Q49 97 70 88' }, { primary: 'M57 10L23 91 M87 7L64 58', secondary: 'M22 25L5 70 M76 75L65 98', accent: 'M45 76L36 96', tone: 1 }], 8, 'rain'),
  snow: weather('Snow', ['#9dcfea', '#c5a4e0', '#8bd2bc'], [flake, { primary: 'M50 16V83 M21 33L79 67 M21 67L79 33', secondary: 'M39 25L50 36L61 25 M39 75L50 64L61 75', accent: 'M11 10V20 M6 15H16 M85 80V94 M78 87H92', tone: 1 }], 7, 'snow'),
  storm: weather('Storms', ['#91a4e1', '#72c5d0', '#c494d2'], [{ primary: 'M18 47C2 45 4 25 20 25C24 5 49 4 59 21C79 10 96 29 86 45Q73 51 18 47Z', secondary: 'M27 60L12 95 M53 58L37 96 M79 58L66 88', accent: 'M8 64L2 78 M88 70L80 91 M30 34Q42 24 55 32' }, { primary: 'M65 8L28 92 M91 19L56 96 M30 7L3 67', secondary: 'M78 11L63 45 M45 57L29 94', accent: 'M6 22Q30 12 44 19', tone: 1 }], 9, 'rain'),
  fog: weather('Fog', ['#93c1d5', '#c1afd9', '#a0c9b8'], [{ primary: 'M4 27Q35 6 65 27T96 27', secondary: 'M9 53Q47 30 91 49', accent: 'M15 78Q49 57 89 73' }, { primary: 'M4 44Q37 63 66 44T96 44', secondary: 'M13 20Q46 36 79 21', accent: 'M24 75Q56 89 88 71', tone: 1 }], 16, 'mist'),
  wind: weather('Wind', ['#82d0b0', '#d8bd79', '#8bbce0'], [{ primary: 'M4 64Q32 22 63 39T94 22', secondary: 'M17 85Q50 54 80 65', accent: 'M8 27Q17 12 29 16Q28 33 8 27', wash: 'M8 27Q17 12 29 16Q28 33 8 27Z' }, { ...seed, tone: 1, motion: 'wind' }], 12, 'wind'),
} satisfies Record<string, ThemeDefinition>;
export const THEME_SCENES = Object.fromEntries(Object.entries(SCENE_DEFINITIONS).map(([id, definition]) =>
  [id, { ...definition, composition: LIVING_SCENE_ART[id] }])) as { [Id in keyof typeof SCENE_DEFINITIONS]: ThemeDefinition };
export type ThemeSceneId = keyof typeof THEME_SCENES;
export const BIRTHDAY_SCENES = { classic: 'birthday', russian: 'birthday-russian', korean: 'birthday-korean' } as const satisfies Record<BirthdayTreatment, ThemeSceneId>;
export const THEME_SCENE_IDS = Object.keys(THEME_SCENES) as ThemeSceneId[];
export const THEME_ACTIVE_MS = 12_000;
export const THEME_RETIRE_MS = 180;
/** Include the smooth retirement and one paint allowance in future reading-space bounds. */
export const THEME_CLEARANCE_SECONDS = (THEME_ACTIVE_MS + THEME_RETIRE_MS + 20) / 1000;
export const THEME_PARTICLES_MAX = 12;
export const QUIET_PALETTE = ['#858f94', '#798788', '#858a90'] as const;
export const QUIET_THEME = { slots: 4, interval: 4000, still: 3, motionScale: .45 } as const;

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
