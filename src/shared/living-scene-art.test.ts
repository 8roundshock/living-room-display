import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVING_SCENE_ART, type ScenePath } from './living-scene-art.ts';
import { LIVING_SCENE_BUDGET, THEME_SCENE_IDS } from './theme-registry.ts';

/** Independent control-hull check. Absolute curve controls conservatively bound
 * the complete curve; horizontal/vertical segments use the preceding endpoint. */
function controlHull(path: ScenePath): readonly (readonly [number, number])[] {
  assert.match(path.d, /^[MLCQHVZ\d\s.,+-]+$/, 'extend the bounds verifier before adding another SVG command');
  const result: [number, number][] = [];
  let x = 0, y = 0, origin: [number, number] = [0, 0];
  for (const [, command, source] of path.d.matchAll(/([MLCQHVZ])([^MLCQHVZ]*)/g)) {
    const values = source!.match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
    assert.ok(values.every(Number.isFinite));
    if (command === 'Z') { [x, y] = origin; continue; }
    if (command === 'H' || command === 'V') {
      for (const value of values) {
        if (command === 'H') x = value; else y = value;
        result.push([x, y]);
      }
      continue;
    }
    const arity = command === 'C' ? 6 : command === 'Q' ? 4 : 2;
    assert.equal(values.length % arity, 0, `complete ${command} coordinates`);
    for (let index = 0; index < values.length; index += 2) {
      x = values[index]!; y = values[index + 1]!;
      result.push([x, y]);
      if (command === 'M' && index === 0) origin = [x, y];
    }
  }
  assert.ok(result.length > 0);
  return result;
}

test('all registered scenes have one connected authored composition', () => {
  assert.deepEqual(Object.keys(LIVING_SCENE_ART).sort(), [...THEME_SCENE_IDS].sort());
  const shapes = new Set<string>();
  for (const id of THEME_SCENE_IDS) {
    const art = LIVING_SCENE_ART[id];
    assert.ok(art, id);
    assert.ok(art.patches.length > 0, id);
    const shape = art.patches.flatMap(patch => patch.groups.flatMap(group => group.paths.map(path => path.d)));
    assert.ok(shape.length > 0, id);
    shapes.add(JSON.stringify(shape));
  }
  // Palettes alone cannot turn an existing topology into a completed new scene.
  assert.equal(shapes.size, THEME_SCENE_IDS.length);
});

test('authored compositions remain within patch, group and active-path budgets', () => {
  for (const [id, art] of Object.entries(LIVING_SCENE_ART)) {
    assert.ok(art, id);
    assert.ok(art.patches.length <= LIVING_SCENE_BUDGET.patches, id);
    assert.ok(art.patches.reduce((count, patch) => count + patch.groups.length, 0) <= 6, id);
    const activePaths = art.patches.reduce((count, patch) => count + patch.groups.reduce((subtotal, group) =>
      subtotal + Math.max(group.paths.length, group.compact?.paths.length ?? 0), 0), art.passage.paths.length);
    // Both lifecycle generations and three weather field paths can coexist.
    assert.ok(activePaths * 2 + 3 <= LIVING_SCENE_BUDGET.paths, `${id}: transition path budget`);
    assert.equal(new Set(art.patches.map(patch => patch.id)).size, art.patches.length, id);
    for (const patch of art.patches) {
      assert.ok(patch.width > 0 && patch.width <= 1 && patch.height > 0 && patch.height <= 1, `${id}/${patch.id}`);
      assert.ok(patch.viewBox.every(size => Number.isFinite(size) && size > 0));
      assert.equal(new Set(patch.groups.map(group => group.id)).size, patch.groups.length);
    }
  }
});

test('complete and compact geometry, controls, strokes and roots fit their declared bounds', () => {
  for (const [id, art] of Object.entries(LIVING_SCENE_ART)) {
    assert.ok(art, id);
    for (const patch of art.patches) for (const group of patch.groups) {
      assert.ok(group.pivot.every(Number.isFinite));
      for (const [variant, shape] of [['complete', group], ...(group.compact ? [['compact', group.compact] as const] : [])] as const) {
        const context = `${id}/${patch.id}/${group.id}/${variant}`;
        const [left, top, width, height] = shape.bounds;
        assert.ok(shape.bounds.every(Number.isFinite) && width > 0 && height > 0, context);
        for (const path of shape.paths) {
          assert.ok([0, 1, 2].includes(path.tone), context);
          for (const opacity of [path.fill, path.opacity]) assert.ok(opacity === undefined || Number.isFinite(opacity) && opacity >= 0 && opacity <= 1, context);
          assert.ok(path.stroke === undefined || Number.isFinite(path.stroke) && path.stroke >= 0, context);
          const radius = (path.stroke ?? 1.5) / 2;
          for (const [x, y] of controlHull(path)) {
            assert.ok(x - radius >= left - .001 && x + radius <= left + width + .001 && y - radius >= top - .001 && y + radius <= top + height + .001,
              `${context}: (${x},${y}) plus stroke${radius} exceeds ${shape.bounds}`);
          }
        }
      }
    }
  }
});

test('foreground drawings remain unfilled and fit their own complete viewBox', () => {
  for (const [id, art] of Object.entries(LIVING_SCENE_ART)) {
    assert.ok(art, id);
    const [width, height] = art.passage.viewBox;
    assert.ok(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0, id);
    for (const path of art.passage.paths) {
      assert.ok(path.fill === undefined || path.fill === 0, `${id}: foreground fill`);
      const radius = (path.stroke ?? 1.5) / 2;
      for (const [x, y] of controlHull(path)) {
        assert.ok(x - radius >= 0 && x + radius <= width && y - radius >= 0 && y + radius <= height,
          `${id}: passage control/stroke outside viewBox`);
      }
    }
  }
});
