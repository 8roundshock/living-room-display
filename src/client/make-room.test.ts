// Room guidance (#183, #238): explanations and fixes come from the shared collision helpers, are
// pure, and only ever produce boards that validation accepts.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Settings, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, fitWidgetFamily, gridProblem, placementSpan } from '../shared/widgets.ts';
import {
  addToGrid,
  applyRoomFix,
  columnOutlook,
  describeRoomProblem,
  diagnoseRoom,
  listNames,
  roomFixLabel,
  roomFixResult,
  roomProblem,
  type RoomRequest,
} from './make-room.ts';

const column: RoomRequest = { kind: 'span', id: 'reminders', span: { columns: 2, rows: 8 } };

/** The 2026-10-19 QA board: the default board plus Calendar, World clocks, Sun & moon and Air quality. */
function qaBoard(): Settings {
  const settings = defaultSettings();
  for (const id of ['calendar', 'worldClocks', 'sunMoon', 'airQuality'] as WidgetId[]) {
    const grid = addToGrid(settings.widgetGrid, id, WIDGET_CATALOG[id].defaultSize, settings.widgets);
    assert.ok(grid, `${id} fits the default board`);
    settings.widgetGrid = grid; settings.widgets[id] = true;
  }
  return settings;
}

test('a full-height column on the default board names Clock, Weather and Forecast and offers the smallest reduction', () => {
  const settings = defaultSettings(), before = structuredClone(settings.widgetGrid);
  const diagnosis = diagnoseRoom(settings.widgetGrid, column, settings.widgets);
  assert.ok(diagnosis);
  assert.deepEqual(diagnosis.blockers, ['clock', 'weather', 'forecast']);
  // Weather and Forecast both lose 8 cells (Clock loses 24); catalog order breaks the tie.
  assert.deepEqual(diagnosis.fixes, [{ kind: 'shrink', widget: 'weather', size: 'medium' }]);
  assert.equal(describeRoomProblem(column, diagnosis, 'balanced'), 'No room for a full-height Reminders column beside Clock, Weather and Forecast.');
  assert.equal(roomFixLabel(diagnosis.fixes[0]!), 'Make room: Weather medium');
  const fixed = applyRoomFix(settings.widgetGrid, column, diagnosis.fixes[0]!, settings.widgets);
  assert.ok(fixed);
  assert.equal(gridProblem(fixed, settings.widgets), null, 'the fixed board is valid');
  assert.deepEqual(placementSpan('reminders', fixed.placements.reminders), { columns: 2, rows: 8 });
  assert.equal(fixed.placements.weather.size, 'medium');
  for (const id of ['clock', 'forecast', 'preview'] as WidgetId[]) assert.equal(fixed.placements[id].size, settings.widgetGrid.placements[id].size, `${id} keeps its family`);
  assert.equal(roomFixResult(column, diagnosis.fixes[0]!, fixed), 'Weather is now medium. Reminders is now a full-height column.');
  assert.deepEqual(settings.widgetGrid, before, 'diagnosis and fixes never change the input board');
});

test('every single reduction the explanation names actually fits the column', () => {
  const settings = defaultSettings();
  for (const id of ['clock', 'weather', 'forecast'] as WidgetId[]) {
    const reduced = fitWidgetFamily(settings.widgetGrid, id, 'medium', settings.widgets);
    assert.ok(reduced);
    assert.equal(diagnoseRoom(reduced, column, settings.widgets), null, `${id} medium leaves room for the column`);
  }
  const off = { ...settings.widgets, preview: false };
  const diagnosis = diagnoseRoom(settings.widgetGrid, column, off);
  assert.ok(diagnosis, 'Last screen alone does not free the room (#183 comment)');
  assert.equal(diagnosis.blockers.includes('preview'), false, 'a hidden widget is never named');
});

test('requests that already fit need no guidance', () => {
  const settings = defaultSettings();
  assert.equal(diagnoseRoom(settings.widgetGrid, { kind: 'family', id: 'reminders', size: 'large' }, settings.widgets), null);
  assert.equal(roomProblem(settings.widgetGrid, { kind: 'family', id: 'reminders', size: 'medium' }, settings.widgets), null);
  const medium = structuredClone(settings);
  medium.widgetGrid.placements.weather = { ...medium.widgetGrid.placements.weather, size: 'medium' };
  assert.equal(diagnoseRoom(medium.widgetGrid, column, medium.widgets), null);
});

test('adding to a full board offers a smaller family, a finer grid or a reduction, each as one valid draft', () => {
  const settings = qaBoard(), before = structuredClone(settings.widgetGrid);
  const medium: RoomRequest = { kind: 'add', id: 'countdown', size: 'medium' };
  const problem = roomProblem(settings.widgetGrid, medium, settings.widgets);
  assert.ok(problem);
  assert.equal(problem.message, 'No room for Countdown at medium size.');
  assert.deepEqual(problem.fixes.map(roomFixLabel), ['Switch the grid to Fine', 'Make room: Weather medium']);
  for (const fix of problem.fixes) {
    const grid = applyRoomFix(settings.widgetGrid, medium, fix, settings.widgets);
    assert.ok(grid, roomFixLabel(fix));
    const enabled = { ...settings.widgets, countdown: true };
    assert.equal(gridProblem(grid, enabled), null, `${roomFixLabel(fix)} leaves a valid board`);
    assert.equal(grid.placements.countdown.size, 'medium');
    if (fix.kind === 'density') {
      assert.equal(grid.density, 'fine');
      for (const id of Object.keys(settings.widgets) as WidgetId[]) if (settings.widgets[id]) assert.equal(grid.placements[id].size, before.placements[id].size, `the finer grid keeps ${id}'s family`);
    }
  }
  assert.equal(roomFixResult(medium, problem.fixes[0]!, applyRoomFix(settings.widgetGrid, medium, problem.fixes[0]!, settings.widgets)!), 'Grid switched to Fine. Countdown added.');
  assert.deepEqual(settings.widgetGrid, before);

  // A board where only the small family fits offers "Try Small" first.
  const partial = qaBoard();
  partial.widgetGrid = fitWidgetFamily(partial.widgetGrid, 'preview', 'small', partial.widgets)!;
  const tryMedium = roomProblem(partial.widgetGrid, { kind: 'add', id: 'note', size: 'medium' }, partial.widgets);
  assert.ok(tryMedium);
  assert.deepEqual(tryMedium.fixes[0], { kind: 'size', size: 'small' });
  assert.equal(roomFixLabel(tryMedium.fixes[0]!), 'Try Small');
  const added = applyRoomFix(partial.widgetGrid, tryMedium.request, tryMedium.fixes[0]!, partial.widgets);
  assert.ok(added);
  assert.equal(added.placements.note.size, 'small');
  assert.equal(roomFixResult(tryMedium.request, tryMedium.fixes[0]!, added), 'Note added at small size.');
});

test('with no fix the explanation says what to do instead', () => {
  const diagnosis = { blockers: ['clock', 'forecast'] as WidgetId[], fixes: [] };
  assert.equal(describeRoomProblem(column, diagnosis, 'balanced'), 'No room for a full-height Reminders column beside Clock and Forecast. Make one of them smaller or remove a widget.');
  assert.equal(describeRoomProblem({ kind: 'span', id: 'reminders', span: { columns: 3, rows: 6 } }, { blockers: ['clock'], fixes: [] }, 'balanced'), 'No room for a 3 × 6 Reminders beside Clock. Make Clock smaller or remove a widget.');
  assert.equal(describeRoomProblem({ kind: 'add', id: 'note', size: 'small' }, { blockers: [], fixes: [] }, 'fine'), 'No room for Note at small size. Remove a widget or make one smaller first.');
  assert.equal(listNames(['clock', 'weather', 'forecast'], 'or'), 'Clock, Weather or Forecast');
});

test('a fix is recomputed against the current board and refuses stale or self-targeted edits', () => {
  const settings = defaultSettings();
  assert.equal(applyRoomFix(settings.widgetGrid, column, { kind: 'shrink', widget: 'reminders', size: 'small' }, settings.widgets), null, 'never shrinks the widget being resized');
  assert.equal(applyRoomFix(settings.widgetGrid, column, { kind: 'shrink', widget: 'photo', size: 'small' }, settings.widgets), null, 'never touches a hidden widget');
  assert.equal(applyRoomFix(settings.widgetGrid, column, { kind: 'density', density: 'fine' }, settings.widgets), null, 'span requests take no density fix');
});

test('the column outlook qualifies the picker caption', () => {
  const settings = defaultSettings();
  assert.deepEqual(columnOutlook(settings.widgetGrid, 'reminders', settings.widgets), { fits: false, blockers: ['clock', 'weather', 'forecast'] });
  const hidden = { ...settings.widgets, reminders: false };
  assert.deepEqual(columnOutlook(settings.widgetGrid, 'reminders', hidden, 'small'), { fits: false, blockers: ['clock', 'weather', 'forecast'] }, 'measured after adding');
  const medium = structuredClone(settings);
  medium.widgetGrid.placements.weather = { ...medium.widgetGrid.placements.weather, size: 'medium' };
  assert.deepEqual(columnOutlook(medium.widgetGrid, 'reminders', medium.widgets), { fits: true, blockers: [] });
  assert.equal(columnOutlook(settings.widgetGrid, 'clock', settings.widgets), null, 'fixed-family widgets have no outlook');
});
