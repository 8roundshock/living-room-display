// Room guidance (#183, #238, #346) and layout descriptions (#340, #341): explanations and fixes come
// from the shared collision helpers, are pure, and only ever produce boards that validation accepts.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Settings, WidgetId } from '../shared/contracts.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, WIDGET_IDS, fitGridDensity, fitWidgetFamily, gridProblem, placementSpan, reflowWidget, resizeWidgetSpan } from '../shared/widgets.ts';
import {
  addToGrid,
  applyRoomFix,
  cellPosition,
  columnOutlook,
  densityFixLabel,
  densityFixResult,
  densityRefusal,
  describeRoomProblem,
  diagnoseRoom,
  displacedNeighbours,
  listNames,
  movedMessage,
  placementDescription,
  refusedMove,
  resizedMessage,
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

  // A board where only the small family fits offers "Try small" first.
  const partial = qaBoard();
  partial.widgetGrid = fitWidgetFamily(partial.widgetGrid, 'preview', 'small', partial.widgets)!;
  const tryMedium = roomProblem(partial.widgetGrid, { kind: 'add', id: 'note', size: 'medium' }, partial.widgets);
  assert.ok(tryMedium);
  assert.deepEqual(tryMedium.fixes[0], { kind: 'size', size: 'small' });
  assert.equal(roomFixLabel(tryMedium.fixes[0]!), 'Try small');
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
  assert.equal(describeRoomProblem({ kind: 'span', id: 'reminders', span: { columns: 8, rows: 4 } }, { blockers: ['clock'], fixes: [] }, 'balanced'), 'No room for an 8 × 4 Reminders beside Clock. Make Clock smaller or remove a widget.');
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

/** Every active widget on one Balanced 12 × 8 board, every cell used (as in the palette and motion suites). */
function fullBoard(): Settings {
  const placements: Partial<Settings['widgetGrid']['placements']> = {
    clock: { column: 0, row: 0, size: 'medium' }, worldClocks: { column: 4, row: 0, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' },
    sunMoon: { column: 0, row: 2, size: 'large' }, calendar: { column: 4, row: 2, size: 'medium' }, airQuality: { column: 4, row: 4, size: 'medium' },
    reminders: { column: 8, row: 4, size: 'medium' }, forecast: { column: 0, row: 6, size: 'medium' }, countdown: { column: 4, row: 6, size: 'small' },
    note: { column: 6, row: 6, size: 'small' }, preview: { column: 8, row: 6, size: 'small' }, photo: { column: 10, row: 6, size: 'small' },
  };
  const settings = defaultSettings();
  settings.widgets = Object.fromEntries(WIDGET_IDS.map((id) => [id, id in placements])) as Settings['widgets'];
  Object.assign(settings.widgetGrid.placements, structuredClone(placements));
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null);
  return settings;
}

test('fix labels share one capitalisation style (#310)', () => {
  assert.equal(roomFixLabel({ kind: 'size', size: 'small' }), 'Try small');
  assert.equal(roomFixLabel({ kind: 'density', density: 'fine' }), 'Switch the grid to Fine');
  assert.equal(roomFixLabel({ kind: 'shrink', widget: 'weather', size: 'medium' }), 'Make room: Weather medium');
  assert.equal(densityFixLabel({ density: 'spacious', count: 11, remove: 'photo', message: '' }), 'Make room: remove Photo');
});

test('a refused density names itself and the widget count, with a removal fix only when one fits (#346)', () => {
  const settings = fullBoard(), before = structuredClone(settings.widgetGrid);
  assert.equal(fitGridDensity(settings.widgetGrid, 'spacious', settings.widgets), null, 'Spacious cannot hold the full board');
  const refusal = densityRefusal(settings.widgetGrid, 'spacious', settings.widgets);
  assert.deepEqual(refusal, { density: 'spacious', count: 12, remove: null, message: "Spacious (8 × 6) can't fit these 12 widgets. Make some smaller or remove one, then try again." });
  assert.deepEqual(settings.widgetGrid, before, 'diagnosis never changes the board');

  // Without Photo, hiding the smallest widget that frees enough room is offered, and the fix fits.
  const enabled = { ...settings.widgets, photo: false };
  assert.equal(fitGridDensity(settings.widgetGrid, 'spacious', enabled), null);
  const fixable = densityRefusal(settings.widgetGrid, 'spacious', enabled);
  assert.equal(fixable.message, "Spacious (8 × 6) can't fit these 11 widgets.");
  assert.equal(fixable.remove, 'preview');
  assert.equal(densityFixLabel(fixable), 'Make room: remove Last screen');
  const without = { ...enabled, preview: false };
  const fit = fitGridDensity(settings.widgetGrid, 'spacious', without);
  assert.ok(fit, 'the offered removal makes the density fit');
  assert.equal(fit.grid.density, 'spacious');
  assert.equal(gridProblem(fit.grid, without), null, 'the fixed board is valid');
  assert.match(densityFixResult('preview', 'spacious', fit.resized), /^Last screen removed and the grid switched to Spacious\. .+ to fit\.$/);
  assert.equal(densityFixResult('photo', 'fine', []), 'Photo removed and the grid switched to Fine.');
});

test('layout results name the new place or size and the neighbours they moved (#340, #341)', () => {
  const settings = defaultSettings(), base = settings.widgetGrid, enabled = settings.widgets;
  assert.equal(cellPosition({ column: 6, row: 4 }), 'column 7, row 5');
  assert.equal(placementDescription('preview', base.placements.preview), 'Column 9, row 5 · Medium');
  assert.equal(placementDescription('reminders', base.placements.reminders), 'Column 1, row 5 · 2 × 2');
  const moved = reflowWidget(base, 'preview', { ...base.placements.preview, column: 7 }, enabled);
  assert.ok(moved);
  assert.equal(movedMessage(base, moved, 'preview', enabled), 'Last screen moved to column 8, row 5');
  const pushed = reflowWidget(base, 'clock', { ...base.placements.clock, column: 1 }, enabled);
  assert.ok(pushed);
  assert.match(movedMessage(base, pushed, 'clock', enabled), /^Clock moved to column 2, row 1 · .+ to make room$/);
  const small = fitWidgetFamily(base, 'preview', 'small', enabled);
  assert.ok(small);
  assert.equal(resizedMessage(base, small, 'preview', enabled), 'Last screen resized to Small', 'a family is named as its size button reads');
  // A taller Reminders pushes Forecast aside; computed from the same base, the shorter step puts it back.
  const taller = resizeWidgetSpan(base, 'reminders', { columns: 2, rows: 3 }, enabled);
  assert.ok(taller);
  assert.equal(resizedMessage(base, taller, 'reminders', enabled, base), 'Reminders resized to 2 × 3 · Forecast moved right to make room');
  const shorter = resizeWidgetSpan(base, 'reminders', { columns: 2, rows: 2 }, enabled);
  assert.ok(shorter);
  assert.deepEqual(shorter, base, 'the shorter step from the base is the base board');
  assert.equal(displacedNeighbours(taller, shorter, 'reminders', enabled, base), 'Forecast moved back');
  assert.equal(displacedNeighbours(base, small, 'preview', enabled), '', 'nothing else moved');
  assert.deepEqual((['left', 'right', 'up', 'down'] as const).map(refusedMove), ['No room to the left', 'No room to the right', 'No room above', 'No room below']);
});
