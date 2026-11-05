import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import type { WeatherState } from '../shared/contracts.ts';
import { THEME_SCENES, LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';
import { habitatBox, habitatMotion, fitHabitatGroup, patchPhase, rainField, rainImpacts } from './living-scene.ts';
import { resolveTheme } from './ambient-theme.ts';

test('Summer keeps authored non-square ratios at editor, HD and 4K sizes', () => {
  const art = THEME_SCENES.summer.composition!;
  for (const [width, height] of [[320, 180], [1920, 1080], [3840, 2160]]) for (const patch of art.patches) {
    const box = habitatBox(patch, width!, height!);
    assert.ok(Math.abs(box.width / box.height - patch.viewBox[0] / patch.viewBox[1]) < .0001);
    assert.ok(box.height <= height! * .18);
    assert.ok(box.y + box.height > height! && box.y < height!, 'offscreen roots avoid a fixed lit baseline');
  }
});
test('Local retreats remain staggered over several cycles without whole-scene blanking', () => {
  for (let elapsed = 0; elapsed <= LIVING_SCENE_BUDGET.life * 5; elapsed += 250) {
    const phases = THEME_SCENES.summer.composition!.patches.map((_, index) => patchPhase(elapsed, index));
    assert.ok(phases.every(value => value.age >= 0 && value.age < LIVING_SCENE_BUDGET.life));
    assert.ok(phases.some(value => value.age >= .08 * LIVING_SCENE_BUDGET.life && value.age <= .78 * LIVING_SCENE_BUDGET.life));
  }
});
test('Shallow reading clearance selects complete compact growth and impossible clearance omits the group', () => {
  const patch = THEME_SCENES.summer.composition!.patches[1]!, group = patch.groups[0]!;
  const box = habitatBox(patch, 1920, 1080);
  const clear = fitHabitatGroup(group, patch, box, [], undefined, false);
  assert.equal(clear.compact, false); assert.equal(clear.yScale, 1);
  const shallow = fitHabitatGroup(group, patch, box, [{ left: 0, top: 850, right: 640, bottom: 1014 }], undefined, false);
  assert.equal(shallow.compact, true); assert.equal(shallow.visible, true);
  assert.ok(shallow.yScale >= .65 && shallow.yScale <= 1);
  assert.equal(shallow.paths, group.compact!.paths, 'whole authored low forms replace tall geometry');
  const blocked = fitHabitatGroup(group, patch, box, [{ left: 0, top: 0, right: 1920, bottom: 1080 }], undefined, false);
  assert.equal(blocked.visible, false, 'the reading mask is not a way to pass off chopped stems as a fit');
  assert.equal(rainImpacts(1920, 1080, 0).match(/M/g)?.length, 6);
});
test('Wind strength changes related attached groups while quiet motion is smaller', () => {
  const group = THEME_SCENES.summer.composition!.patches[1]!.groups[0]!;
  assert.notDeepEqual(habitatMotion(group, 'rain', false), habitatMotion(group, undefined, false));
  assert.notDeepEqual(habitatMotion(group, undefined, true), habitatMotion(group, undefined, false));
  assert.equal(habitatMotion(group, 'rain', false)[0], habitatMotion(group, 'rain', false)[4]);
  assert.equal(rainField(1920, 1080, 0).match(/M/g)?.length, 11);
  assert.notEqual(rainField(1920, 1080, 0), rainField(1920, 1080, 1));
});
test('Combined rain adapts Summer; Weather stays neutral and stale data drops the adaptation', () => {
  const settings = defaultSettings(), now = new Date('2026-07-10T18:30:00Z');
  settings.appearance.theme = { mode: 'combined', calendars: [] };
  const weather: WeatherState = { status: 'fresh', updatedAt: now.toISOString(), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', location: settings.location,
    units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' }, current: { time: now.toISOString(), temperature: 20, feelsLike: 20, weatherCode: 63, isDay: true, windSpeed: 8 }, daily: [], hourly: [], details: [] };
  assert.equal(resolveTheme(settings, weather, now)?.habitat, 'summer');
  settings.appearance.theme.mode = 'weather'; assert.equal(resolveTheme(settings, weather, now)?.habitat, undefined);
  settings.appearance.theme.mode = 'combined'; weather.status = 'stale';
  assert.equal(resolveTheme(settings, weather, now)?.motif, 'summer');
  assert.equal(resolveTheme(settings, weather, now)?.habitat, undefined);
});
