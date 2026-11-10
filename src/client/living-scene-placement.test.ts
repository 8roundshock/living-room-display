import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVING_SCENE_ART } from '../shared/living-scene-art.ts';
import { THEME_SCENE_IDS } from '../shared/theme-registry.ts';
import type { ThemeRect } from './ambient-theme.ts';
import { PRINCIPAL_FORMS as PRINCIPAL } from './living-scene-principals.ts';
import { driftForm, DRIFT_FORMS, fitHabitatGroup, fitHabitatPatch, fogContour, habitatBox, patchExtent, patchQuality, placeScenePatches } from './living-scene.ts';

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

test('an open board keeps every authored root exactly', () => {
  for (const id of THEME_SCENE_IDS) {
    const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, [], undefined, false);
    art.patches.forEach((patch, index) => assert.deepEqual(boxes[index], habitatBox(patch, W, H), `${id}/${patch.id}`));
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
      assert.ok(box.width <= authored.width + .001 && box.width >= authored.width * .62 - .001, `${id}/${patch.id}: bounded size`);
      const onFrame = box.x <= 1 || box.y <= 1 || box.x + box.width >= W - 1 || box.y + box.height >= H - 1;
      assert.ok(onFrame, `${id}/${patch.id}: a relocated patch still enters from the frame`);
      if (box.mirror) assert.ok(patch.edge.startsWith('top'), `${id}/${patch.id}: only a top drawing is reflected to a side`);
      if (patch.edge.startsWith('bottom')) assert.ok(Math.abs(box.y + box.height * .97 - H) < .01, `${id}/${patch.id}: stays rooted on the bottom edge`);
    });
  }
});

test('placed habitat drawings are not stacked into the same gap', () => {
  for (const holes of [DEFAULT_BOARD, DENSE_BOARD]) for (const id of ['christmas', 'lotus-lanterns', 'canada-day', 'halloween']) {
    const art = LIVING_SCENE_ART[id]!, boxes = placeScenePatches(art.patches, W, H, holes, undefined, false);
    const extents = art.patches.map((patch, index) => patch.depth === 'far' ? null : patchExtent(patch, boxes[index]!, holes, undefined, false));
    for (let a = 0; a < extents.length; a++) for (let b = a + 1; b < extents.length; b++)
      if (extents[a] && extents[b]) assert.ok(!intersects(extents[a]!, extents[b]!), `${id}: ${art.patches[a]!.id} overlaps ${art.patches[b]!.id}`);
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

test('detached drift forms are few, finite, inside the frame and replaced only at their own boundary', () => {
  for (const kind of ['seed', 'petal', 'leaf', 'flake', 'ribbon'] as const) for (const gust of [false, true]) for (let index = 0; index < DRIFT_FORMS; index++) {
    let previous = driftForm(index, 0, W, H, kind, gust);
    assert.equal(previous.iteration, 0, 'no form is visible before its first whole iteration starts');
    for (let elapsed = 4000; elapsed <= 240_000; elapsed += 4000) {
      const form = driftForm(index, elapsed, W, H, kind, gust);
      assert.ok(form.iteration - previous.iteration <= 1);
      assert.ok(form.duration >= 11_000 && form.duration <= 24_000 && (form.duration + 300) % 4000 === 0);
      assert.ok(form.x >= 0 && form.x + form.end[0] >= 0 && form.x + Math.max(0, form.end[0]) <= W * 1.15 && form.y >= 0 && form.y + form.end[1] <= H);
      assert.ok(form.size <= Math.min(W, H) * .07);
      previous = form;
    }
    assert.ok(previous.iteration >= 9, 'forms keep renewing');
  }
});

test('fog ribbons take open space or are omitted, never sheared by reading space', () => {
  assert.ok(fogContour(W, H, 0).startsWith('M'));
  assert.equal(fogContour(W, H, 0, [{ left: 0, top: 0, right: W, bottom: H }]), '');
  for (const holes of [DEFAULT_BOARD, DENSE_BOARD]) for (let group = 0; group < 3; group++) {
    const d = fogContour(W, H, group, holes); if (!d) continue;
    const [x, y] = d.slice(1).split(/[ c]/).map(Number) as [number, number];
    assert.ok(!holes.some(hole => x >= hole.left && x <= hole.right && y >= hole.top && y <= hole.bottom));
  }
});
