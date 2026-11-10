import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVING_SCENE_ART } from '../shared/living-scene-art.ts';
import { THEME_SCENE_IDS } from '../shared/theme-registry.ts';
import type { ThemeRect } from './ambient-theme.ts';
import { PRINCIPAL_FORMS as PRINCIPAL } from './living-scene-principals.ts';
import { fitHabitatGroup, fitHabitatPatch, habitatBox, patchExtent, patchQuality, placeScenePatches, PATCH_ROOT_FACTORS } from './living-scene.ts';
import { edgeProfile, fogBands, groundBand, litColumns, particleLayers, sceneAnimationCount, topBand, PARTICLE_LAYERS, PENDANT_MAX } from './living-dressing.ts';
import { SCENE_DRESSING } from '../shared/living-scene-dressing.ts';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';

const W = 1920, H = 1080;
/** Reading holes as measured by the renderer (ink plus clearance, no movement) for the
 * default layout and a dense thirteen-widget board at 1920x1080 with synthetic data. */
const DEFAULT_BOARD: ThemeRect[] = [{ left: 936, top: 42, right: 1572, bottom: 503 }, { left: 76, top: 555, right: 666, bottom: 1017 }, { left: 665, top: 596, right: 1844, bottom: 730 }, { left: 856, top: 835, right: 1063, bottom: 990 }, { left: 76, top: 73, right: 666, bottom: 506 }];
const DENSE_BOARD: ThemeRect[] = [{ left: 76, top: 66, right: 480, bottom: 267 }, { left: 1253, top: 58, right: 1844, bottom: 520 }, { left: 76, top: 845, right: 666, bottom: 979 }, { left: 1302, top: 836, right: 1501, bottom: 989 }, { left: 665, top: 306, right: 1255, bottom: 524 }, { left: 665, top: 591, right: 970, bottom: 736 }, { left: 76, top: 328, right: 666, bottom: 502 }, { left: 76, top: 567, right: 574, bottom: 759 }];
const intersects = (a: ThemeRect, b: ThemeRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function fittedGroups(id: string, holes: readonly ThemeRect[]) {
  const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, holes, undefined, false);
  return art.patches.flatMap((patch, index) => patch.groups.map(group => ({ patch, group, box: boxes[index]!, fitted: fitHabitatGroup(group, patch, boxes[index]!, holes, undefined, false) })));
}

test('the principal table names real groups in every registered scene', () => {
  assert.deepEqual(Object.keys(PRINCIPAL).sort(), [...THEME_SCENE_IDS].sort());
  for (const [id, names] of Object.entries(PRINCIPAL)) {
    const groups = LIVING_SCENE_ART[id]!.patches.flatMap(patch => patch.groups.map(group => group.id));
    for (const name of names) assert.ok(groups.includes(name), `${id}: ${name}`);
  }
});

test('an open board keeps every principal patch at its authored root with every group whole', () => {
  for (const id of THEME_SCENE_IDS) {
    const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, [], undefined, false);
    const principal = art.patches.findIndex(patch => patch.groups.some(group => PRINCIPAL[id]!.includes(group.id)));
    assert.deepEqual(boxes[principal], habitatBox(art.patches[principal]!, W, H), `${id}/${art.patches[principal]!.id}`);
    for (const entry of fittedGroups(id, [])) assert.ok(entry.fitted.visible && !entry.fitted.compact && entry.fitted.yScale === 1, `${id}: ${entry.group.id}`);
  }
});

for (const [label, holes] of [['default', DEFAULT_BOARD], ['dense', DENSE_BOARD]] as const) {
  test(`every scene keeps its named principal silhouette on the ${label} board without entering reading space`, () => {
    for (const id of THEME_SCENE_IDS) {
      const groups = fittedGroups(id, holes);
      for (const name of PRINCIPAL[id]!) {
        const entry = groups.find(item => item.group.id === name)!;
        assert.ok(entry.fitted.visible, `${id}: ${name} is omitted on the ${label} board`);
        assert.ok(entry.fitted.yScale >= .65, `${id}: ${name} keeps at least 65% of its size`);
        if (label === 'default' && entry.group.motion !== 'grass') assert.equal(entry.fitted.compact, false, `${id}: ${name} keeps its complete (not compact) drawing on the default board`);
      }
      // Reading protection is unchanged: a full-size visible group's complete motion sweep clears every hole.
      for (const entry of groups) if (entry.fitted.visible && entry.fitted.yScale === 1)
        assert.ok(!holes.some(hole => intersects(entry.fitted.swept, hole)), `${id}: ${entry.group.id} sweeps reading space`);
    }
  });
}

test('relocation moves one complete patch: ratio, edge contact and group relationships are preserved', () => {
  for (const id of THEME_SCENE_IDS) {
    const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, DEFAULT_BOARD, undefined, false);
    art.patches.forEach((patch, index) => {
      const box = boxes[index]!, authored = habitatBox(patch, W, H);
      assert.ok(Math.abs(box.width / box.height - patch.viewBox[0] / patch.viewBox[1]) < .0001, `${id}/${patch.id}: authored ratio`);
      assert.ok(box.width <= authored.width + .001 && box.width >= authored.width * PATCH_ROOT_FACTORS.at(-1)! - .001, `${id}/${patch.id}: bounded size`);
      // Bottom drawings stand slightly above the frame inside the ground band's front layer.
      const onFrame = box.x <= 1 || box.y <= 1 || box.x + box.width >= W - 1 || box.y + box.height >= H * .97;
      assert.ok(onFrame, `${id}/${patch.id}: a relocated patch still enters from the frame`);
      if (box.mirror) assert.ok(patch.edge.startsWith('top'), `${id}/${patch.id}: only a top drawing is reflected to a side`);
      if (patch.edge.startsWith('bottom') && !box.mirror) assert.ok(Math.abs(box.y + box.height * .97 + H * .026 - H) < .01, `${id}/${patch.id}: stays rooted on the bottom edge`);
    });
  }
});

test('placed habitat drawings are not stacked into the same gap', () => {
  for (const holes of [DEFAULT_BOARD, DENSE_BOARD]) for (const id of ['christmas', 'lotus-lanterns', 'canada-day', 'halloween']) {
    const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, holes, undefined, false);
    const extents = art.patches.map((patch, index) => patch.depth === 'far' ? null : patchExtent(patch, boxes[index]!, holes, undefined, false));
    for (let a = 0; a < extents.length; a++) for (let b = a + 1; b < extents.length; b++)
      if (extents[a] && extents[b]) {
        const [p, q] = [extents[a]!, extents[b]!], shared = Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)) * Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
        assert.ok(shared <= .35 * Math.min((p.right - p.left) * (p.bottom - p.top), (q.right - q.left) * (q.bottom - q.top)), `${id}: ${art.patches[a]!.id} is stacked on ${art.patches[b]!.id}`);
      }
  }
});

test('reading space is never traded for a silhouette: a fully occupied edge omits the patch', () => {
  const full = [{ left: 0, top: 0, right: W, bottom: H }];
  for (const id of THEME_SCENE_IDS) for (const entry of fittedGroups(id, full)) assert.equal(entry.fitted.visible, false, `${id}: ${entry.group.id}`);
  const patch = LIVING_SCENE_ART.christmas!.patches.find(item => item.groups.some(group => group.id === 'christmas-linked-bough'))!;
  const authored = habitatBox(patch, W, H);
  assert.ok(patchQuality(patch, authored, DEFAULT_BOARD, undefined, false) < .5, 'the authored root loses the bough on the default board');
  const moved = fitHabitatPatch(patch, W, H, DEFAULT_BOARD, undefined, false);
  assert.ok(patchQuality(patch, moved, DEFAULT_BOARD, undefined, false) > .9, 'a whole-patch root keeps it');
  assert.notDeepEqual(moved, authored);
});

test('a reflected patch sweeps the mirror image of its authored extent', () => {
  const patch = LIVING_SCENE_ART.christmas!.patches.find(item => item.edge === 'top-left')!, group = patch.groups[0]!;
  const box = { x: 500, y: 100, width: 600, height: 600 * patch.viewBox[1] / patch.viewBox[0] };
  const plain = fitHabitatGroup(group, patch, box, [], undefined, false).swept, mirrored = fitHabitatGroup(group, patch, { ...box, mirror: true }, [], undefined, false).swept;
  assert.ok(Math.abs(mirrored.left - (box.x + box.width - (plain.right - box.x))) < .001);
  assert.ok(Math.abs(mirrored.right - (box.x + box.width - (plain.left - box.x))) < .001);
  assert.equal(mirrored.top, plain.top); assert.equal(mirrored.bottom, plain.bottom);
});

test('the ground band lights the whole bottom edge and stays below every reading area', () => {
  assert.deepEqual(Object.keys(SCENE_DRESSING).sort(), [...THEME_SCENE_IDS].sort(), 'every scene declares its edge dressing');
  for (const holes of [[], DEFAULT_BOARD, DENSE_BOARD]) {
    const profile = edgeProfile(W, H, holes, 'bottom', H * .05, H * .19, 1);
    assert.ok(litColumns(profile) >= .85, `bottom-edge columns lit: ${litColumns(profile)}`);
    profile.forEach((depth, index) => {
      const x = index * 6;
      for (const hole of holes) if (hole.left < x && hole.right > x) assert.ok(H - depth >= hole.bottom, `column ${x} rises into reading space`);
      if (index) assert.ok(Math.abs(depth - profile[index - 1]!) <= 9.01, 'scenery ramps instead of ending in a wall');
    });
  }
  const top = edgeProfile(W, H, DEFAULT_BOARD, 'top', H * .022, H * .12, 6);
  top.forEach((depth, index) => { for (const hole of DEFAULT_BOARD) if (hole.left < index * 6 && hole.right > index * 6) assert.ok(depth <= hole.top); });
  for (const id of THEME_SCENE_IDS) {
    const dressing = SCENE_DRESSING[id]!, ground = groundBand(dressing.ground === 'mist' ? 'water' : dressing.ground, W, H, DEFAULT_BOARD);
    assert.ok(ground.lit >= .85 && ground.segments.every(segment => segment.paths.length > 0), id);
    if (dressing.top) {
      const band = topBand(dressing.top, W, H, DEFAULT_BOARD);
      assert.ok(band.segments[0]!.paths.length + band.front[0]!.paths.length > 0, `${id}: second edge`);
      for (const pendant of band.pendants) for (const hole of DEFAULT_BOARD)
        assert.ok(!(hole.left < pendant.x && hole.right > pendant.x && hole.top < pendant.length + 4), `${id}: a hanging form reaches reading space`);
    }
  }
});

test('particles stay in flight as four seamless depth layers', () => {
  for (const kind of ['flake', 'petal', 'leaf', 'firefly', 'confetti', 'sparkle'] as const) for (const gust of [false, true]) {
    const layers = particleLayers(kind, 40, W, H, gust);
    assert.equal(layers.length, PARTICLE_LAYERS);
    assert.ok(layers.reduce((sum, layer) => sum + layer.count, 0) >= 36, 'the requested number of particles is drawn');
    for (const layer of layers) {
      assert.equal(LIVING_SCENE_BUDGET.life % layer.duration, 0, 'each period divides the scene life, so renewal rejoins its phase');
      assert.ok(layer.paths.length >= 1 && layer.paths.length <= 3);
      // A falling layer travels exactly one tile and is drawn twice a tile apart.
      if (!layer.wander) assert.ok(Math.abs(layer.travel[0]) + Math.abs(layer.travel[1]) >= H * .2);
    }
  }
});

test('every scene and Combined weather pairing stays inside the animation budget on empty 1080p, 4K and ultrawide boards', () => {
  const standalone: Record<string, 'rain' | 'storm' | 'fog' | 'wind' | 'snow'> = { rain: 'rain', storm: 'storm', fog: 'fog', wind: 'wind', snow: 'snow' };
  let highest = 0;
  for (const [width, height] of [[1920, 1080], [3840, 2160], [3440, 1440]] as const) for (const id of THEME_SCENE_IDS) {
    const art = LIVING_SCENE_ART[id]!, dressing = SCENE_DRESSING[id]!;
    // The scene on its own (a weather scene with its own weather), then every Combined adaptation it declares.
    for (const weather of [standalone[id], ...(standalone[id] ? [] : art.weather)]) {
      const count = sceneAnimationCount(art, dressing, width, height, [], weather);
      highest = Math.max(highest, count);
      assert.ok(count <= LIVING_SCENE_BUDGET.animations, `${id}${weather ? ` with ${weather}` : ''} at ${width}x${height}: ${count} animations`);
    }
    if (dressing.top) assert.ok(topBand(dressing.top, width / (height / 1080), 1080, []).pendants.length <= PENDANT_MAX, `${id}: pendants are capped`);
  }
  assert.equal(sceneAnimationCount(LIVING_SCENE_ART.summer!, SCENE_DRESSING.summer!, 1920, 1080, [], 'wind'), 41, 'Combined wind on Summer');
  assert.equal(highest, 41, 'no scene or Combined pairing exceeds the busiest known one');
  // The cap is what holds on a wide empty board: uncapped spacing alone would exceed it.
  assert.equal(topBand('foliage', 3440 / (1440 / 1080), 1080, []).pendants.length, PENDANT_MAX);
});

test('fog is five soft blobs: three low, two as a top haze, none a hard-edged band', () => {
  const blobs = fogBands(W, H);
  assert.equal(blobs.length, 5);
  assert.equal(blobs.filter(blob => blob.cy > H * .6).length, 3); assert.equal(blobs.filter(blob => blob.cy < H * .1).length, 2);
  for (const blob of blobs) assert.ok(blob.rx > blob.ry * 4 && blob.rx <= W * .5);
});
