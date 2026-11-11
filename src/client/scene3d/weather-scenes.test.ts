import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WeatherState } from '../../shared/contracts.ts';
import { defaultSettings } from '../../shared/defaults.ts';
import type { ThemeSceneId } from '../../shared/theme-registry.ts';
import { previewTheme, resolveTheme, type WeatherMotif } from '../ambient-theme.ts';
import { planScene3d } from './resolve.ts';
import { sceneTier } from './tier.ts';

// The weather family in 3D (#617 Rain, #618 Snow, #619 Storms, #620 Fog, #621 Wind): each kind is a
// standalone scene (scenes/<kind>.js) and an overlay over another scene in Combined mode (weather/<kind>.js).
const filesIn = (folder: string) => readdirSync(fileURLToPath(new URL(`./${folder}/`, import.meta.url))).filter(file => file.endsWith('.js') && !file.startsWith('_'));
const SCENES = filesIn('scenes').map(file => file.slice(0, -3)), OVERLAYS = filesIn('weather').map(file => file.slice(0, -3));
const KINDS: readonly WeatherMotif[] = ['rain', 'snow', 'storm', 'fog', 'wind'];

test('Every weather kind has its own 3D scene and its own overlay', () => {
  for (const kind of KINDS) {
    assert.ok(SCENES.includes(kind), `scenes/${kind}.js`); assert.ok(OVERLAYS.includes(kind), `weather/${kind}.js`);
    assert.deepEqual(planScene3d(previewTheme(kind), SCENES, OVERLAYS), { sceneId: kind, module: kind, weather: null }, `${kind} on its own is the scene, never the overlay`);
    assert.equal(sceneTier(previewTheme(kind), 2026), 'everyday', `${kind} is an everyday scene`);
  }
  assert.deepEqual([...OVERLAYS].sort(), [...KINDS].sort(), 'weather/ holds the five kinds and nothing else');
});
test('Combined weather over any 3D scene is drawn in 3D: no pairing waits on a missing overlay', () => {
  for (const habitat of SCENES.filter(id => !(KINDS as readonly string[]).includes(id))) for (const motif of KINDS)
    assert.deepEqual(planScene3d({ motif, habitat: habitat as ThemeSceneId, source: 'weather' }, SCENES, OVERLAYS), { sceneId: habitat, module: habitat, weather: motif }, `${motif} over ${habitat}`);
});
test('From the resolver to the stage: in Combined the scene keeps its own module and the weather is its overlay, also for pairings that used to swap the scene (#655)', () => {
  const now = new Date('2026-12-20T18:30:00Z'), settings = defaultSettings(); settings.appearance.theme = { mode: 'combined', calendars: ['CA', 'KR', 'RU'] };
  const reading = (code: number, wind: number): WeatherState => ({ status: 'fresh', updatedAt: now.toISOString(), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', location: settings.location,
    units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' }, current: { time: now.toISOString(), temperature: 4, feelsLike: 2, weatherCode: code, isDay: true, windSpeed: wind }, daily: [], hourly: [], details: [] });
  // [civil date, scene, weather kind, code]: snow in November, rain in a winter thaw, a storm in December, snow in April,
  // a storm on Canada Day, and snow in winter, which always worked.
  for (const [date, id, kind, code] of [['2026-11-04', 'autumn', 'snow', 73], ['2026-02-01', 'winter', 'rain', 63], ['2026-12-20', 'christmas', 'storm', 95], ['2026-04-25', 'spring', 'snow', 73], ['2026-07-01', 'canada-day', 'storm', 95], ['2026-02-01', 'winter', 'snow', 73]] as const) {
    const scene = resolveTheme(settings, reading(code, 8), now, false, date)!;
    assert.deepEqual(planScene3d(scene, SCENES, OVERLAYS), { sceneId: id, module: id, weather: kind }, `${kind} over ${id}`);
    assert.equal(sceneTier(scene, 2026), sceneTier(previewTheme(id), 2026), `${kind} over ${id} keeps the scene's tier`);
  }
  // Weather mode is the only place a weather scene stands alone.
  settings.appearance.theme.mode = 'weather';
  assert.deepEqual(planScene3d(resolveTheme(settings, reading(73, 8), now, false, '2026-11-04')!, SCENES, OVERLAYS), { sceneId: 'snow', module: 'snow', weather: null });
});
test('Storms have no bolt and no flash: the only light is the slow glow inside the cloud', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const cloud = read('./parts/storm-cloud.js');
  // Coordinator decision on #619. The rise is 1.6 real seconds and the glow is drawn only through the cloud's own
  // density, with "lighter of the two" blending, so overlapping volumes cannot add up beyond the stated peak.
  assert.match(cloud, /since < 1\.6 \?/, 'the glow takes 1.6 seconds to rise');
  assert.match(cloud, /blendEquation: T\.MaxEquation/, 'the glow never adds up where volumes overlap');
  const peak = Number(cloud.match(/peak = (\.\d+)/)?.[1]);
  // The everyday layer is drawn at 0.855 of the saved brightness and widget text at about 0.27 of white beside a
  // saved 36% (docs/ambient-themes.md), so a display value under 0.87 stays under the text.
  assert.ok(peak > 0 && peak < .87, `the glow's peak ${peak} stays below widget text`);
  // The bound is enforced in the part itself, whatever a caller passes: 0.86 on an everyday layer, 0.74 on a special one.
  assert.match(cloud, /Math\.min\(peak, ctx\.tier === 'special' \? \.74 : \.86\)/, 'the peak is clamped inside stormCloud');
  for (const file of ['./scenes/storm.js', './weather/storm.js', './parts/storm-cloud.js']) assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /bolt|lightning|flash/i, `${file} draws no bolt and no flash`);
});
