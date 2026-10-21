// #435: new installs and Reset layout start on the owner's Calendar, Clock, Weather and Forecast board,
// while older saved data keeps backfilling from the unchanged catalog. Synthetic data in temporary folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from './store.ts';
import { persistableSettings } from './persistence.ts';
import { dataSchema, settingsSchema } from './validation.ts';
import { PREVIOUS_READER } from './compat/previous-reader.ts';
import { WIDGET_CATALOG as PREVIOUS_CATALOG } from './compat/d66832b/shared/widgets.ts';
import { defaultSettings as previousDefaults } from './compat/d66832b/shared/defaults.ts';
import { catalogBoardDefaults } from './fixtures.ts';
import { defaultSettings } from '../shared/defaults.ts';
import {
  ACTIVE_WIDGET_IDS, DEFAULT_BOARD, GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, defaultBoardGrid, defaultBoardVisibility, defaultWidgetGrid,
  defaultWidgetVisibility, gridProblem, placementSpan, switchGridDensity, type WidgetDefinition,
} from '../shared/widgets.ts';
import type { WidgetId } from '../shared/contracts.ts';

type Loose = Record<string, any>;
const parse = (value: unknown) => settingsSchema.parse(structuredClone(value));
/** The owner's board from the #435 ticket, written out: column, row, family and the cells it takes. */
const OWNER_BOARD: [WidgetId, number, number, 'medium' | 'large', number, number][] = [
  ['calendar', 0, 0, 'large', 4, 4],
  ['clock', 4, 0, 'large', 8, 4],
  ['weather', 0, 4, 'large', 4, 4],
  ['forecast', 4, 4, 'large', 8, 2],
  ['preview', 4, 6, 'medium', 4, 2],
  ['reminders', 8, 6, 'medium', 4, 2],
];

test('the default board is the owner\'s Balanced 12 × 8 board, fills the grid and shows nothing else', () => {
  const settings = defaultSettings(), grid = settings.widgetGrid;
  assert.equal(grid.revision, 2); assert.equal(grid.density, 'balanced');
  for (const [id, column, row, size, columns, rows] of OWNER_BOARD) {
    assert.equal(settings.widgets[id], true, `${id} is shown`);
    assert.deepEqual(grid.placements[id], { column, row, size }, `${id} placement`);
    assert.deepEqual(placementSpan(id, grid.placements[id]), { columns, rows }, `${id} takes ${columns} × ${rows}`);
  }
  const shown = WIDGET_IDS.filter(id => settings.widgets[id]);
  assert.deepEqual(shown.sort(), OWNER_BOARD.map(([id]) => id).sort(), 'every other widget is off');
  const { columns, rows } = GRID_DENSITIES.balanced;
  assert.equal(shown.reduce((sum, id) => { const span = placementSpan(id, grid.placements[id]); return sum + span.columns * span.rows; }, 0), columns * rows, 'every cell is used');
  assert.equal(gridProblem(grid, settings.widgets), null);
  assert.equal(settings.preview.enabled, true, 'Last screen is on');
  // Hidden widgets wait at their catalog placement; the retired Rain sits inside Weather (#74).
  for (const id of WIDGET_IDS.filter(id => !settings.widgets[id] && id !== 'rain')) assert.deepEqual(grid.placements[id], defaultWidgetGrid().placements[id], `${id} hidden at its catalog placement`);
  assert.deepEqual(grid.placements.rain, { column: 0, row: 6, size: 'medium' });
  assert.deepEqual(settings.widgetGrid, defaultBoardGrid()); assert.deepEqual(settings.widgets, defaultBoardVisibility());
  assert.deepEqual(Object.keys(DEFAULT_BOARD.placements).sort(), shown.sort());
  assert.deepEqual(parse(settings), settings, 'the default board reads back unchanged');
});

test('style defaults are unchanged by the default board (#435 scope)', () => {
  const { appearance, preview, widgetBehavior } = defaultSettings();
  assert.deepEqual(appearance, {
    preset: 'room', accentColor: '#8aa8c2', textColor: '#b8c1ca', brightness: 0.55, fontScale: 1, fontFamily: 'sans', layout: 'balanced',
    motionEnabled: true, motionIntervalSeconds: 180, fadeSeconds: 2, clockStyle: 'outline', accentMode: 'native', animation: 'subtle', daylightBrightness: null,
  });
  assert.deepEqual(preview, { enabled: true, opacity: 0.24, widthPercent: 20 });
  assert.deepEqual(widgetBehavior, { reminders: { hideWhenEmpty: true } });
});

test('older data still backfills from the catalog, which is the installed d66832b catalog unchanged (#497)', () => {
  // The catalog fields that backfill older data are byte-for-byte what the installed release has.
  for (const id of PREVIOUS_READER.widgetIds) {
    const current: WidgetDefinition = WIDGET_CATALOG[id], previous: WidgetDefinition = PREVIOUS_CATALOG[id];
    for (const key of ['defaultEnabled', 'defaultPlacement', 'defaultSize', 'legacyPlacement', 'legacyEnabledFrom'] as const) assert.deepEqual(current[key], previous[key], `${id} ${key}`);
  }
  assert.equal(WIDGET_CATALOG.calendar.defaultEnabled, false, 'a file without a Calendar key reads Calendar as off');
  // A settings object without a grid (pre-grid data) receives the catalog grid, not the default board.
  const pregrid = JSON.parse(JSON.stringify(catalogBoardDefaults())); delete pregrid.widgetGrid;
  const read = parse(pregrid);
  assert.deepEqual(read.widgetGrid, defaultWidgetGrid());
  // Missing widget ids read as their catalog default, and missing placements take catalog origins.
  const sparse = JSON.parse(JSON.stringify(catalogBoardDefaults()));
  for (const id of ['calendar', 'worldClocks', 'note'] as const) { delete sparse.widgets[id]; delete sparse.widgetGrid.placements[id]; delete sparse.widgetOverrides[id]; }
  const backfilled = parse(sparse);
  for (const id of ['calendar', 'worldClocks', 'note'] as const) {
    assert.equal(backfilled.widgets[id], false, `${id} backfills as off`);
    assert.deepEqual(backfilled.widgetGrid.placements[id], defaultWidgetGrid().placements[id], `${id} backfills at its catalog placement`);
  }
  assert.deepEqual(backfilled.widgets, defaultWidgetVisibility());
  // The previous release's own defaults read exactly as they did: the catalog board, Calendar off.
  const previous = parse(previousDefaults());
  assert.equal(previous.widgets.calendar, false);
  assert.deepEqual(previous.widgetGrid, defaultWidgetGrid());
});

test('a fresh data folder writes the default board, and the d66832b reader (#497) reads that board unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-default-board-'));
  try {
    const store = await DataStore.open(directory);
    assert.deepEqual(store.snapshot().settings, defaultSettings());
    const file = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as Loose;
    const written = persistableSettings(defaultSettings()) as Loose;
    assert.deepEqual(file.settings.widgets, written.widgets, 'known visibilities are written; off Dynamic is omitted');
    assert.deepEqual(file.settings.widgetGrid, written.widgetGrid, 'known placements are written; hidden Dynamic is omitted');
    const previous = PREVIOUS_READER.dataSchema.parse(file) as Loose;
    assert.deepEqual(previous.settings.widgets, written.widgets, 'the previous release shows the same widgets');
    assert.deepEqual(previous.settings.widgetGrid, written.widgetGrid, 'in the same places and sizes');
    assert.deepEqual(dataSchema.parse(file).settings, defaultSettings(), 'this release reads its own file back');
    // A previous-release copy of the file (after a rollback) reopens in this release unchanged.
    await writeFile(join(directory, 'state.json'), JSON.stringify(previous));
    assert.deepEqual((await DataStore.open(directory)).snapshot().settings.widgetGrid, defaultSettings().widgetGrid);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('density changes on the default board fit every widget and a round trip restores it exactly', () => {
  const settings = defaultSettings(), original = structuredClone(settings.widgetGrid);
  const fine = switchGridDensity(original, 'fine', settings.widgets); assert.ok(fine);
  assert.deepEqual(fine.resized, [], 'Fine keeps every family');
  assert.equal(gridProblem(fine.grid, settings.widgets), null);
  const spacious = switchGridDensity(fine.grid, 'spacious', settings.widgets, fine.history); assert.ok(spacious);
  assert.equal(gridProblem(spacious.grid, settings.widgets), null);
  for (const id of ACTIVE_WIDGET_IDS.filter(id => settings.widgets[id])) assert.ok(spacious.grid.placements[id], `${id} stays on Spacious`);
  const back = switchGridDensity(spacious.grid, 'balanced', settings.widgets, spacious.history); assert.ok(back);
  assert.deepEqual(back.grid, original, 'Balanced again restores the default board');
});
