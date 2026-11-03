import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { selectScheduledPreset, type PresetSchedule } from '../shared/schedule.ts';
import { getVisual } from './model.ts';
import { duplicateStyleSuggestion, newStyleDraft, prepareStyleSave, restoredStyleId, sameVisual, undoStyleDeletion } from './style-workflow.ts';

function example() {
  const settings = defaultSettings();
  settings.savedPresets = [{ id: 'arbitrary:imported/id', name: 'Evening', visual: getVisual(settings) }];
  return settings;
}

test('new blank styles start independently while retaining personal content and existing styles', () => {
  const current = example(); current.note = 'Private note'; current.units = 'imperial';
  current.appearance.brightness = 0.8;
  const original = structuredClone(current), next = newStyleDraft(current, 'blank');
  assert.equal(Object.values(next.widgets).some(Boolean), false);
  assert.equal(next.preview.enabled, false);
  assert.equal(next.note, 'Private note'); assert.equal(next.units, 'imperial');
  assert.deepEqual(next.savedPresets, current.savedPresets);
  assert.deepEqual(current, original);
  assert.notEqual(next.appearance.brightness, current.appearance.brightness);
});

test('starter styles use a fresh board and never opt a disabled screenshot back in', () => {
  const current = example(); current.widgets.clock = false;
  current.preview.enabled = false; current.widgets.preview = false;
  for (const start of ['room', 'phone', 'night'] as const) {
    const next = newStyleDraft(current, start);
    assert.equal(next.appearance.preset, start);
    assert.equal(next.widgets.clock, true); assert.equal(next.widgets.calendar, true);
    assert.equal(next.widgets.preview, false); assert.equal(next.preview.enabled, false);
    assert.deepEqual(next.savedPresets, current.savedPresets);
  }
});
test('duplicate suggestions distinguish repeated copies, trim to the name limit and ignore case', () => {
  const base = example();
  base.savedPresets.push({ ...base.savedPresets[0]!, id: 'copy', name: ' evening COPY ' });
  assert.equal(duplicateStyleSuggestion(base.savedPresets, 'Evening'), 'Evening copy 2');
  assert.equal(duplicateStyleSuggestion([], 'x'.repeat(60)).length, 60);
});
test('deletion Undo restores the latest record in order without replacing newer draft edits', () => {
  const base = example(), draft = structuredClone(base); draft.savedPresets = []; draft.appearance.brightness = 0.2;
  base.savedPresets[0]!.name = 'New remote name';
  const restored = undoStyleDeletion(base, draft, base.savedPresets[0]!.id, 0);
  assert.equal(restored.appearance.brightness, 0.2);
  assert.equal(restored.savedPresets[0]!.name, 'New remote name');
  assert.deepEqual(draft.savedPresets, []);
  base.savedPresets = [];
  assert.throws(() => undoStyleDeletion(base, draft, 'arbitrary:imported/id', 0), /deleted elsewhere/);
});
test('deletion and Undo preserve schedule references and restore their existing target', () => {
  const base = example(), draft = structuredClone(base), id = base.savedPresets[0]!.id;
  const config: PresetSchedule = { enabled: true, fallbackPresetId: id, rules: [{ id: 'rule', presetId: id, days: [2], start: '00:00', end: '23:59' }] };
  const before = structuredClone(config); draft.savedPresets = [];
  assert.deepEqual(selectScheduledPreset(config, draft.savedPresets, new Date('2026-11-03T12:00:00')).missingPresetIds, [id]);
  const restored = undoStyleDeletion(base, draft, id, 0);
  assert.equal(selectScheduledPreset(config, restored.savedPresets, new Date('2026-11-03T12:00:00')).presetId, id);
  assert.deepEqual(config, before);
});
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
