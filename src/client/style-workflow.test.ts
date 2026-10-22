import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { getVisual } from './model.ts';
import { prepareStyleSave, restoredStyleId, sameVisual } from './style-workflow.ts';

function example() {
  const settings = defaultSettings();
  settings.savedPresets = [{ id: 'arbitrary:imported/id', name: 'Evening', visual: getVisual(settings) }];
  return settings;
}
test('update retains the explicit ID, unrelated settings and other records without mutating inputs', () => {
  const base = example(), draft = structuredClone(base), original = structuredClone(base);
  draft.appearance.brightness = 0.3; draft.units = 'imperial';
  const result = prepareStyleSave(base, draft, { kind: 'update', id: base.savedPresets[0]!.id, original: base.savedPresets[0]! });
  assert.equal(result.savedPresets[0]!.id, 'arbitrary:imported/id');
  assert.equal(result.savedPresets[0]!.visual.appearance.brightness, 0.3);
  assert.equal(result.units, 'imperial'); assert.deepEqual(base, original);
  assert.equal(draft.savedPresets[0]!.visual.appearance.brightness, original.appearance.brightness);
});
test('save as new preserves the original and reuses one ID across retries', () => {
  const base = example(), draft = structuredClone(base); draft.appearance.brightness = 0.3;
  const intent = { kind: 'new' as const, id: 'new-id', name: '  Reading  ' };
  const first = prepareStyleSave(base, draft, intent), retry = prepareStyleSave(base, first, intent);
  assert.deepEqual(first, retry); assert.equal(first.savedPresets.length, 2);
  assert.deepEqual(first.savedPresets[0], base.savedPresets[0]); assert.equal(first.savedPresets[1]!.name, 'Reading');
  assert.deepEqual(prepareStyleSave(first, first, intent), first, 'acknowledgement lost after a successful save is idempotent');
});
test('changed and deleted selected records cannot be overwritten or resurrected', () => {
  const original = example(), draft = structuredClone(original);
  const intent = { kind: 'update' as const, id: original.savedPresets[0]!.id, original: original.savedPresets[0]! };
  const deleted = structuredClone(original); deleted.savedPresets = [];
  assert.throws(() => prepareStyleSave(deleted, draft, intent), /deleted elsewhere/);
  const changed = structuredClone(original); changed.savedPresets[0]!.visual.appearance.brightness = 0.8;
  assert.throws(() => prepareStyleSave(changed, draft, intent), /changed elsewhere/);
});
test('new/renamed names and limit are validated against a rebased list, preserving imported duplicates', () => {
  const base = example(), intent = { kind: 'new' as const, id: 'new', name: ' evening ' };
  assert.throws(() => prepareStyleSave(base, base, intent), /already exists/);
  const duplicates = example(); duplicates.savedPresets.push({ ...structuredClone(duplicates.savedPresets[0]!), id: 'other' });
  const update = { kind: 'update' as const, id: duplicates.savedPresets[0]!.id, original: duplicates.savedPresets[0]! };
  assert.equal(prepareStyleSave(duplicates, duplicates, update).savedPresets.length, 2);
  assert.throws(() => prepareStyleSave(duplicates, duplicates, { ...update, name: ' evening ' }), /already exists/);
  const full = example(); full.savedPresets = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Style ${index}`, visual: getVisual(full) }));
  assert.throws(() => prepareStyleSave(full, full, { ...intent, name: 'Another' }), /Up to 12/);
});
test('reload restores an explicit matching ID, never the first visually identical style', () => {
  const settings = example(); settings.savedPresets.push({ ...structuredClone(settings.savedPresets[0]!), id: 'second' });
  assert.equal(restoredStyleId(settings, null), ''); assert.equal(restoredStyleId(settings, 'missing'), '');
  assert.equal(restoredStyleId(settings, 'second'), 'second');
  settings.appearance.brightness = 0.3; assert.equal(restoredStyleId(settings, 'second'), '');
  const label = getVisual(settings); label.appearance.preset = 'custom';
  assert.equal(sameVisual(getVisual(settings), label), true);
});
