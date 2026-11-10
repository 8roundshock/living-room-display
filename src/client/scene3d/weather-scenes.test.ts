import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ThemeSceneId } from '../../shared/theme-registry.ts';
import { previewTheme, type WeatherMotif } from '../ambient-theme.ts';
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
  for (const file of ['./scenes/storm.js', './weather/storm.js', './parts/storm-cloud.js']) assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /bolt|lightning|flash/i, `${file} draws no bolt and no flash`);
});
