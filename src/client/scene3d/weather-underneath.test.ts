import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CARRY, DRIFT, FOG_KEEPS, LEAN, SWAY, WET_BACKLIGHT, weatherOver } from './parts/wind-underneath.js';
import { built, census } from '../../../tests/scene3d/census.mjs';

// #646: every season, holiday and birthday scene responds to the weather drawn over it in Combined mode (the weather
// plans' "scene underneath": #621 wind, #617 rain, #619 storm, #620 fog, #618 snow), through parts/wind-underneath.js.
const folder = (name: string) => fileURLToPath(new URL(`./${name}/`, import.meta.url));
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const WEATHER = readdirSync(folder('weather')).filter(file => file.endsWith('.js')).map(file => file.slice(0, -3)).sort();
const SCENES = readdirSync(folder('scenes')).filter(file => file.endsWith('.js')).map(file => file.slice(0, -3)).sort();
/** The scenes a weather overlay can be drawn over: every scene that is not itself a weather (those are Weather mode, ctx.weather is null). */
const UNDER = SCENES.filter(id => !WEATHER.includes(id));
const source = (id: string) => read(`./scenes/${id}.js`);
const DEGREE = Math.PI / 180;

/** A kit with only what the part uses: a deterministic rnd and a tick list run by hand. */
function fakeKit() { const ticks: ((t: number) => void)[] = []; return { kit: { rnd: (i: number, s: number) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }, tick: (fn: (t: number) => void) => ticks.push(fn), fade() {} }, run: (t: number) => ticks.forEach(fn => fn(t)) }; }

test('The rules as numbers: a lean of 2 to 4 degrees, half as much sway again, half the backlight in rain, 60% in fog', () => {
  // The plan's twice the sway (#621) was too much on the display: one and a half (coordinator decision on #646).
  assert.deepEqual(LEAN, { lull: 2, peak: 4 }); assert.equal(SWAY, 1.5); assert.equal(WET_BACKLIGHT, .5); assert.equal(FOG_KEEPS, .6);
  const calm = weatherOver(fakeKit().kit, { weather: null, seed: 1, quiet: false });
  assert.deepEqual([calm.backlight, calm.far, calm.glints, calm.falls, calm.ownSnow, calm.windy, calm.sway(.02, 1), calm.drift(30)], [1, 1, true, true, true, false, .02, 0]);
  for (const kind of ['rain', 'storm']) { const wet = weatherOver(fakeKit().kit, { weather: kind, seed: 1, quiet: false }); assert.deepEqual([wet.backlight, wet.far, wet.falls, wet.ownSnow, wet.glints], [.5, 1, false, false, true], kind); }
  const fog = weatherOver(fakeKit().kit, { weather: 'fog', seed: 1, quiet: false }); assert.deepEqual([fog.backlight, fog.far, fog.glints, fog.falls, fog.ownSnow], [.6, .6, false, true, true]);
  const snow = weatherOver(fakeKit().kit, { weather: 'snow', seed: 1, quiet: false }); assert.deepEqual([snow.ownSnow, snow.falls, snow.backlight], [false, true, 1], 'one snowfall, never two');
});

test('Wind: the lean follows the shared gust between 2 and 4 degrees toward the left, the sway grows by half; a quiet date takes none', () => {
  const { kit, run } = fakeKit(), wind = weatherOver(kit, { weather: 'wind', seed: 7, quiet: false });
  let least = Infinity, most = -Infinity;
  for (let t = 12; t < 400; t += .37) { run(t); least = Math.min(least, wind.wind.lean); most = Math.max(most, wind.wind.lean); assert.equal(wind.sway(0, 1), wind.wind.lean); assert.equal(wind.sway(0, -1), -wind.wind.lean); assert.ok(wind.drift(1e6) < 0 && wind.drift(1e6) >= -DRIFT); }
  assert.ok(least >= 2 * DEGREE - 1e-9 && most <= 4 * DEGREE + 1e-9 && most - least > 1.5 * DEGREE, `${least / DEGREE} to ${most / DEGREE} degrees`);
  assert.ok(Math.abs(wind.sway(.01, 0) - .015) < 1e-12, 'a whole bough only sways, half as far again');
  assert.ok(wind.carry(100) < 0 && Math.abs(wind.carry(100)) < CARRY * 200, 'an endless fall is carried left');
  const quiet = fakeKit(), still = weatherOver(quiet.kit, { weather: 'wind', seed: 7, quiet: true }); quiet.run(20);
  assert.deepEqual([still.windy, still.wind.lean, still.wind.sway, still.drift(30), still.carry(30)], [false, 0, 1, 0, 0], 'a quiet date is frozen');
  const held = fakeKit(), peak = weatherOver(held.kit, { weather: 'wind', seed: 7, quiet: false, gust: 1 }); held.run(20);
  assert.ok(Math.abs(peak.wind.lean - 4 * DEGREE) < 1e-12, 'tools hold the gust at its peak');
  // The overlay's seeds ride on windGust(kit, { salt: ctx.seed + 31 }): the same salt, so the same gust.
  assert.match(read('./weather/wind.js'), /salt = ctx\.seed \+ 31/); assert.match(read('./parts/wind-underneath.js'), /windGust\(kit, \{ salt: ctx\.seed \+ 31 \}\)/);
});

test('Every scene a weather can be drawn over reads it through the part, first; the weather scenes themselves never get one', () => {
  for (const id of UNDER) {
    const text = source(id), call = text.indexOf('weatherOver(kit, ctx)'), firstTick = text.search(/\btick\(/);
    assert.match(text, /import \{ weatherOver \} from '\.\.\/parts\/wind-underneath\.js';/, `${id} imports the weather part`);
    assert.ok(call > 0 && (firstTick < 0 || call < firstTick), `${id} calls weatherOver before its first tick, so the wind is read once a frame before it is used`);
    assert.doesNotMatch(text, /ctx\.weather/, `${id} reads the weather only through the part`);
  }
  for (const id of WEATHER) assert.doesNotMatch(source(id), /weatherOver|ctx\.weather/, `${id} is the weather itself (Weather mode)`);
});

test('Each rule is applied where the scene has the thing it applies to', () => {
  const uses = (pattern: RegExp) => UNDER.filter(id => pattern.test(source(id)));
  // Rain and a storm: no falling petals, leaves, blossom or embers of the scene's own; half the backlight.
  assert.deepEqual(uses(/weather\.falls/), ['autumn', 'canada-day', 'chuseok', 'mimosa', 'new-year', 'spring']);
  assert.deepEqual(uses(/weather\.backlight/), ['autumn', 'canada-day', 'christmas', 'chuseok', 'easter', 'halloween', 'maslenitsa', 'new-year-tree', 'seollal', 'spring', 'summer', 'thanksgiving', 'winter']);
  assert.match(source('summer'), /visible = !weather\.wet/, 'Summer puts its fireflies out in rain and storms');
  // Snow: one snowfall, never two; and none of the scene's own with the rain. Every kit.snow is hidden by the rule and carried by the wind.
  for (const id of UNDER) for (const [line] of source(id).matchAll(/^.*kit\.snow\(.*$/gm)) assert.match(line, /drift: weather\.carry\b.*visible = weather\.ownSnow/, `${id}: ${line.trim()}`);
  assert.deepEqual(uses(/kit\.snow\(/), ['christmas', 'orthodox-christmas']);
  // Fog: glints hidden where the scene draws them itself; the kit stops every twinkle; far things dimmed.
  assert.deepEqual(uses(/weather\.glints/), ['orthodox-christmas', 'winter']);
  assert.match(read('./parts/halloween-cobweb.js'), /glint\.visible = !weather \|\| weather\.glints/);
  assert.match(read('./kit/core.js'), /if \(ctx\.weather === 'fog'\) twinkle = 0;/);
  assert.deepEqual(uses(/weather\.far(ther)?\b/), ['new-year', 'orthodox-christmas', 'seollal', 'summer']);
  // Wind: sway through weather.sway (or a part given the weather), falling things drift.
  assert.deepEqual(UNDER.filter(id => !/weather\.sway\(|, weather[ }]|weather \}\)/.test(source(id))), [], 'every scene leans, sways or blows something (Maslenitsa only its steam)');
  assert.deepEqual(uses(/weather\.drift\(/), ['autumn', 'birthday-korean', 'canada-day', 'chuseok', 'mimosa', 'new-year', 'spring']);
});

test('No weather removes anything: the same objects are built, only shown or hidden', async () => {
  const hidden: Record<string, string[]> = {};
  for (const id of UNDER) {
    const calm = await census(id);
    for (const kind of WEATHER) {
      const under = await census(id, { weather: kind });
      assert.deepEqual([under.objects, under.triangles], [calm.objects, calm.triangles], `${id} under ${kind} builds what it builds in calm`);
      if (under.drawn < calm.objects) (hidden[kind] ??= []).push(id);
    }
  }
  assert.deepEqual(hidden, {
    rain: ['autumn', 'canada-day', 'christmas', 'chuseok', 'mimosa', 'new-year', 'orthodox-christmas', 'spring', 'summer'],
    storm: ['autumn', 'canada-day', 'christmas', 'chuseok', 'mimosa', 'new-year', 'orthodox-christmas', 'spring', 'summer'],
    snow: ['christmas', 'orthodox-christmas'],
    fog: ['halloween', 'orthodox-christmas', 'winter'],
  });
});

test('In the wind every scene moves something to the left, and nothing leans more than 4 degrees on average', async () => {
  // The turn about the screen's axis that takes a piece from where it is in calm to where it is in the wind (the twist of the difference).
  const turn = (calm: THREE.Object3D, windy: THREE.Object3D) => { calm.getWorldQuaternion(q); windy.getWorldQuaternion(r); r.multiply(q.invert()); const d = 2 * Math.atan2(r.z, r.w); return Math.atan2(Math.sin(d), Math.cos(d)); };
  /** Where a piece's middle is on the screen's x axis: the middle of its geometry, or its origin. */
  const middle = (object: any, at: THREE.Vector3) => { const geometry = object.geometry; if (geometry?.attributes?.position) { if (!geometry.boundingSphere) geometry.computeBoundingSphere(); return at.copy(geometry.boundingSphere.center).applyMatrix4(object.matrixWorld).x; } return object.getWorldPosition(at).x; };
  const q = new THREE.Quaternion(), r = new THREE.Quaternion(), v = new THREE.Vector3(), p = new THREE.Vector3(), TIMES = Array.from({ length: 48 }, (_, i) => 12 + i * 2.13);
  for (const id of UNDER) {
    const calm = await built(id), wind = await built(id, { weather: 'wind', gust: 1 });
    const pieces = (made: any) => { const list: THREE.Object3D[] = []; made.kit.stage.traverse((object: THREE.Object3D) => { if ((object as any).isMesh || (object as any).isLine || (object as any).isPoints || (object as any).isSprite) list.push(object); }); return list; };
    const a = pieces(calm), b = pieces(wind); assert.equal(a.length, b.length, id);
    const lean = new Array(a.length).fill(0), shift = new Array(a.length).fill(0);
    for (const t of TIMES) {
      calm.animate(t); wind.animate(t); calm.kit.stage.updateMatrixWorld(true); wind.kit.stage.updateMatrixWorld(true);
      a.forEach((object, i) => { lean[i] += turn(object, b[i]!) / TIMES.length; shift[i] += (middle(b[i]!, p) - middle(object, v)) / TIMES.length; });
    }
    calm.dispose(); wind.dispose();
    const most = Math.max(...lean.map(Math.abs)) / DEGREE, left = Math.min(...shift);
    assert.ok(most <= LEAN.peak + 1, `${id}: a piece leans ${most.toFixed(2)} degrees on average at the gust's peak`);
    assert.ok(left < -.01 || lean.some(value => value / DEGREE > 1.5), `${id}: something moves left in the wind (least shift ${left.toFixed(3)}, most lean ${most.toFixed(2)} degrees)`);
  }
});

test('In the wind no attached piece turns more than 7 degrees from its calm pose at any instant, at the gust’s lull or peak', async () => {
  // The lean (at most 4 degrees) and half as much sway again (#646): a piece turns from where it would be in calm by its lean
  // plus half its own calm swing. Falling and drifting pieces are free and not counted.
  const q = new THREE.Quaternion(), r = new THREE.Quaternion(), p = new THREE.Vector3(), TIMES = Array.from({ length: 160 }, (_, i) => 12 + i * .731), worst: Record<string, number> = {};
  for (const id of UNDER) for (const gust of [0, 1]) {
    const calm = await built(id), wind = await built(id, { weather: 'wind', gust });
    const pieces = (made: any) => { const list: any[] = []; made.kit.stage.traverse((object: any) => { if (object.isMesh || object.isLine || object.isPoints || object.isSprite) list.push(object); }); return list; };
    const a = pieces(calm), b = pieces(wind), most = a.map(() => 0), low = a.map(() => Infinity), high = a.map(() => -Infinity);
    for (const t of TIMES) {
      calm.animate(t); wind.animate(t); calm.kit.stage.updateMatrixWorld(true); wind.kit.stage.updateMatrixWorld(true);
      a.forEach((object, i) => {
        object.getWorldPosition(p); low[i] = Math.min(low[i], p.x + p.y); high[i] = Math.max(high[i], p.x + p.y);
        object.getWorldQuaternion(q); b[i].getWorldQuaternion(r); r.multiply(q.invert()); most[i] = Math.max(most[i], 2 * Math.acos(Math.min(1, Math.abs(r.w))) / DEGREE);
      });
    }
    calm.dispose(); wind.dispose();
    const attached = most.filter((_, i) => high[i] - low[i] < 1 && a[i].visible !== false);
    worst[id] = Math.max(worst[id] ?? 0, ...attached);
  }
  for (const [id, degrees] of Object.entries(worst)) assert.ok(degrees <= 7, `${id}: a piece turns ${degrees.toFixed(2)} degrees from its calm pose`);
  assert.ok(Object.values(worst).filter(degrees => degrees > 3).length >= 15, `the wind is seen: ${JSON.stringify(worst)}`);
});

test('A scene’s own snow wraps round only where it is out of sight, also when the wind carries it', async () => {
  // Christmas's kit.snow spans depths -9 to 2: a far flake sees a wider and taller view than a near one (#646 review).
  for (const weather of [null, 'wind']) {
    const made: any = await built('christmas', { weather, gust: weather ? 1 : null }), view = made.kit.view;
    const flakes: any[] = []; made.kit.stage.traverse((object: any) => { if (object.isPoints && object.geometry.attributes.position.count > 10) flakes.push(object); });
    assert.equal(flakes.length, 1, 'the scene’s own snow');
    const position = flakes[0].geometry.attributes.position, n = position.count, last = new Float32Array(n * 3);
    let wraps = 0;
    for (let k = 0; k <= 4400; k++) {
      made.animate(12 + k * .1);
      for (let i = 0; i < n; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (k) {
          const jumpX = Math.abs(x - last[i * 3]!) > view.halfWAt(z), jumpY = Math.abs(y - last[i * 3 + 1]!) > view.halfHAt(z);
          if (jumpX) { wraps++; assert.ok(Math.abs(x) >= view.halfWAt(z) && Math.abs(last[i * 3]!) >= view.halfWAt(z), `flake ${i} at depth ${z.toFixed(2)} wraps across x from ${last[i * 3]!.toFixed(2)} to ${x.toFixed(2)}, inside the view (half-width ${view.halfWAt(z).toFixed(2)})`); }
          if (jumpY) { wraps++; assert.ok(Math.abs(y) >= view.halfHAt(z) && Math.abs(last[i * 3 + 1]!) >= view.halfHAt(z), `flake ${i} at depth ${z.toFixed(2)} wraps across y from ${last[i * 3 + 1]!.toFixed(2)} to ${y.toFixed(2)}, inside the view (half-height ${view.halfHAt(z).toFixed(2)})`); }
        }
        last[i * 3] = x; last[i * 3 + 1] = y; last[i * 3 + 2] = z;
      }
    }
    made.dispose();
    assert.ok(wraps > n, `${weather ?? 'calm'}: the flakes wrapped ${wraps} times in the sampled hour`);
  }
});
