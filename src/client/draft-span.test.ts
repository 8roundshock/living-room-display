// Free-size spans (#73) in the settings draft: whole-placement patches, exact dirty detection and
// atomic arrangement during polling.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import { fitWidgetFamily, gridProblem, resizeWidgetSpan } from '../shared/widgets.ts';
import { mergeSettings } from '../server/validation.ts';
import { rebaseSettings, sameEffectiveSettings, settingsChanges } from './draft.ts';

function withColumn() {
  const base = defaultSettings();
  base.widgets.preview = false; base.preview.enabled = false;
  const grid = resizeWidgetSpan(base.widgetGrid, 'reminders', { columns: 2, rows: 8 }, base.widgets);
  assert.ok(grid);
  return { base, grid };
}

test('a span edit sends the complete placement and removal sends span: null', () => {
  const { base, grid } = withColumn();
  const draft = structuredClone(base); draft.widgetGrid = grid;
  const patch = settingsChanges(base, draft);
  assert.deepEqual(patch.widgetGrid?.placements?.reminders, { ...grid.placements.reminders, span: { columns: 2, rows: 8 } });
  for (const [id, placement] of Object.entries(patch.widgetGrid?.placements ?? {})) {
    assert.ok(placement && 'column' in placement && 'row' in placement && 'size' in placement && 'span' in placement, `${id} is sent whole`);
  }
  // The server applies the patch to the saved settings and returns exactly the draft arrangement.
  const saved = mergeSettings(base, patch);
  assert.deepEqual(saved.widgetGrid, draft.widgetGrid);
  assert.equal(sameEffectiveSettings(saved, draft), true);

  // Removing the span through a family change: the per-key difference alone could not express it.
  const family = fitWidgetFamily(saved.widgetGrid, 'reminders', 'small', saved.widgets); assert.ok(family);
  const reverted = structuredClone(saved); reverted.widgetGrid = family;
  const removal = settingsChanges(saved, reverted);
  assert.equal(removal.widgetGrid?.placements?.reminders?.span, null);
  const cleared = mergeSettings(saved, removal);
  assert.equal(Object.hasOwn(cleared.widgetGrid.placements.reminders, 'span'), false);
  assert.equal(sameEffectiveSettings(cleared, reverted), true, 'Save leaves no dirty draft behind');
  assert.deepEqual(settingsChanges(cleared, reverted), {});
});

test('the same origin and family with a removed span is still a change', () => {
  const saved = mergeSettings(defaultSettings(), { widgets: { forecast: false, preview: false } });
  saved.widgetGrid.placements.reminders = { column: 0, row: 4, size: 'small', span: { columns: 2, rows: 3 } };
  assert.equal(gridProblem(saved.widgetGrid, saved.widgets), null);
  const draft = structuredClone(saved); delete draft.widgetGrid.placements.reminders.span;
  assert.equal(sameEffectiveSettings(saved, draft), false, 'a span change is effective');
  assert.deepEqual(settingsChanges(saved, draft).widgetGrid?.placements?.reminders, { column: 0, row: 4, size: 'small', span: null });
});

test('resizing back to the saved family span is clean', () => {
  const base = mergeSettings(defaultSettings(), { widgets: { forecast: false, preview: false } });
  const taller = resizeWidgetSpan(base.widgetGrid, 'reminders', { columns: 2, rows: 4 }, base.widgets); assert.ok(taller);
  const draft = structuredClone(base); draft.widgetGrid = taller;
  assert.equal(sameEffectiveSettings(base, draft), false);
  const back = resizeWidgetSpan(draft.widgetGrid, 'reminders', { columns: 2, rows: 2 }, draft.widgets); assert.ok(back);
  draft.widgetGrid = back;
  assert.equal(Object.hasOwn(back.placements.reminders, 'span'), false, 'the family span carries no span key');
  assert.equal(sameEffectiveSettings(base, draft), true);
  assert.deepEqual(settingsChanges(base, draft), {});
});
test('polling keeps a span arrangement atomic and refreshes untouched fields', () => {
  const { base, grid } = withColumn();
  const draft = structuredClone(base); draft.widgetGrid = grid;
  const incoming = structuredClone(base);
  incoming.appearance.brightness = 0.4;
  incoming.widgetGrid.placements.weather = { ...incoming.widgetGrid.placements.weather };
  const next = rebaseSettings(base, draft, incoming);
  assert.deepEqual(next.widgetGrid, draft.widgetGrid, 'density, families, spans and origins stay one arrangement');
  assert.equal(next.appearance.brightness, 0.4);
  assert.equal(gridProblem(next.widgetGrid, next.widgets), null);
  // A saved span arriving from another editor reaches an untouched draft.
  const elsewhere = structuredClone(base); elsewhere.widgetGrid = grid;
  const untouched = rebaseSettings(base, structuredClone(base), elsewhere);
  assert.deepEqual(untouched.widgetGrid.placements.reminders.span, { columns: 2, rows: 8 });
});
