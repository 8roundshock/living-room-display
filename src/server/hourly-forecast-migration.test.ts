// Hourly forecast (#714): the large family changed from 4 × 4 to 8 × 2, like Forecast's. A large placement
// saved before that, which the new span puts outside the grid or over a shown widget, becomes medium at
// the same origin, in current settings, saved styles and imports. Synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Settings, WidgetGrid, WidgetId, WidgetPlacement } from '../shared/contracts.ts';
import {
  GRID_DENSITIES, WIDGET_CATALOG, WIDGET_IDS, fitGridDensity, fitReshapedFamilies, gridProblem, intersects, placementSpan, widgetSizes, widgetSpan,
  type GridDensity, type WidgetDefinition,
} from '../shared/widgets.ts';
import { createApplication } from './app.ts';
import { colorAccentDefaults, forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { persistableData } from './persistence.ts';
import { importSchema, settingsSchema } from './validation.ts';
import { getVisual } from '../client/model.ts';

const ID = 'hourlyTemperature' satisfies WidgetId;
/** The span every large placement was saved with before #714. */
const OLD_LARGE = { columns: 4, rows: 4 };
type Shown = Partial<Record<WidgetId, WidgetPlacement>>;

/** Settings showing exactly `shown` on a density; every hidden widget waits at a valid placement of that grid. */
function board(shown: Shown, density: GridDensity = 'balanced', hidden: Shown = {}): Settings {
  const settings = colorAccentDefaults();
  settings.widgets = Object.fromEntries(WIDGET_IDS.map(id => [id, false])) as Settings['widgets'];
  if (density !== 'balanced') { const fit = fitGridDensity(settings.widgetGrid, density, settings.widgets); assert.ok(fit); settings.widgetGrid = fit.grid; }
  for (const [id, placement] of Object.entries({ ...hidden, ...shown }) as [WidgetId, WidgetPlacement][]) settings.widgetGrid.placements[id] = { ...placement };
  for (const id of Object.keys(shown) as WidgetId[]) settings.widgets[id] = true;
  return settings;
}
/** Whether the board was valid when large meant 4 × 4: every other rule as today, the hourly cells as they were. */
function validBefore(settings: Pick<Settings, 'widgets' | 'widgetGrid'>): boolean {
  const grid = settings.widgetGrid, placement = grid.placements[ID], limits = GRID_DENSITIES[grid.density];
  if (placement.size !== 'large') return gridProblem(grid, settings.widgets) === null;
  const rest: WidgetGrid = { ...grid, placements: { ...grid.placements, [ID]: { column: 0, row: 0, size: 'medium' } } };
  if (gridProblem(rest, { ...settings.widgets, [ID]: false })) return false;
  if (placement.column + OLD_LARGE.columns > limits.columns || placement.row + OLD_LARGE.rows > limits.rows) return false;
  return !settings.widgets[ID] || WIDGET_IDS.every(other => other === ID || !settings.widgets[other] || !intersects(placement, OLD_LARGE, grid.placements[other], placementSpan(other, grid.placements[other])));
}
const hourly = (settings: Pick<Settings, 'widgetGrid'>) => settings.widgetGrid.placements[ID];

// Old boards, each valid with a 4 × 4 Hourly temperature.
const outside = () => board({ clock: { column: 0, row: 0, size: 'large' }, [ID]: { column: 8, row: 4, size: 'large' } });
const overlapping = () => board({ [ID]: { column: 0, row: 4, size: 'large' }, calendar: { column: 4, row: 4, size: 'medium' }, weather: { column: 8, row: 0, size: 'large' } });
const fitting = () => board({ clock: { column: 0, row: 0, size: 'large' }, [ID]: { column: 0, row: 4, size: 'large' }, note: { column: 8, row: 6, size: 'small' } });

test('the catalog: Hourly forecast keeps its stored id and takes Forecast’s medium and large spans', () => {
  const entry: WidgetDefinition = WIDGET_CATALOG[ID];
  assert.equal(entry.name, 'Hourly forecast'); assert.equal(entry.description, 'The hours ahead');
  assert.ok(WIDGET_IDS.includes(ID), 'the stored id is unchanged');
  assert.deepEqual(widgetSizes(ID), ['medium', 'large'], 'no small family, and the 4 × 4 family is gone');
  assert.deepEqual(widgetSpan(ID, 'medium'), { columns: 4, rows: 2 }); assert.deepEqual(widgetSpan(ID, 'large'), { columns: 8, rows: 2 });
  assert.deepEqual(widgetSpan(ID, 'medium'), widgetSpan('forecast', 'medium')); assert.deepEqual(widgetSpan(ID, 'large'), widgetSpan('forecast', 'large'));
  assert.deepEqual(entry.reshaped, { large: 'medium' });
  assert.equal(entry.defaultEnabled, false); assert.equal(entry.defaultSize, 'medium');
  // Only this widget declares a reshaped family, and each fallback is a family the widget still has.
  for (const id of WIDGET_IDS) {
    const reshaped = (WIDGET_CATALOG[id] as WidgetDefinition).reshaped;
    assert.equal(reshaped !== undefined, id === ID, id);
    for (const [from, to] of Object.entries(reshaped ?? {})) { assert.ok(widgetSizes(id).includes(from as never)); assert.ok(widgetSizes(id).includes(to)); }
  }
});

test('a shown large placement that is now outside the grid or over a shown widget becomes medium at the same origin', () => {
  for (const [label, old] of [['outside the grid', outside()], ['over a shown widget', overlapping()]] as const) {
    assert.ok(validBefore(old), `${label}: the board was valid with a 4 × 4 widget`);
    assert.ok(gridProblem(old.widgetGrid, old.widgets), `${label}: read as 8 × 2 it is invalid`);
    const origin = hourly(old), fitted = fitReshapedFamilies(old);
    assert.deepEqual(hourly(fitted), { column: origin.column, row: origin.row, size: 'medium' }, label);
    assert.equal(gridProblem(fitted.widgetGrid, fitted.widgets), null, `${label}: valid again`);
    assert.equal(fitted.widgets[ID], true, 'still shown');
    for (const id of WIDGET_IDS) if (id !== ID) assert.deepEqual(fitted.widgetGrid.placements[id], old.widgetGrid.placements[id], `${id} is untouched`);
    assert.deepEqual(old.widgetGrid.placements[ID].size, 'large', 'the input is not mutated');
    assert.deepEqual(fitReshapedFamilies(fitted), fitted, 'idempotent');
  }
  assert.match(gridProblem(outside().widgetGrid, outside().widgets)!, /Hourly forecast is outside the grid/);
  assert.match(gridProblem(overlapping().widgetGrid, overlapping().widgets)!, /overlaps another widget/);
});

test('a large placement that fits as 8 × 2 stays large, and nothing else is changed', () => {
  const old = fitting();
  assert.ok(validBefore(old)); assert.equal(gridProblem(old.widgetGrid, old.widgets), null, 'the cells to its right are free, so it reads as 8 × 2');
  assert.equal(fitReshapedFamilies(old), old, 'returned as it is');
  // Medium placements and other widgets' large families are never touched.
  const medium = board({ [ID]: { column: 8, row: 6, size: 'medium' }, forecast: { column: 0, row: 6, size: 'large' }, weather: { column: 8, row: 0, size: 'large' } });
  assert.equal(fitReshapedFamilies(medium), medium);
  // Revision-one grids predate the widget and keep their own migration.
  const legacy = outside(); legacy.widgetGrid.revision = 1;
  assert.equal(fitReshapedFamilies(legacy), legacy);
});

test('a hidden large placement only has to stay inside the grid', () => {
  const beyond = board({ clock: { column: 0, row: 0, size: 'large' } }, 'balanced', { [ID]: { column: 8, row: 4, size: 'large' } });
  assert.ok(validBefore(beyond)); assert.match(gridProblem(beyond.widgetGrid, beyond.widgets)!, /outside the grid/, 'validation checks a hidden widget’s bounds too');
  const fitted = fitReshapedFamilies(beyond);
  assert.deepEqual(hourly(fitted), { column: 8, row: 4, size: 'medium' }); assert.equal(fitted.widgets[ID], false);
  assert.equal(gridProblem(fitted.widgetGrid, fitted.widgets), null);
  // Hidden under a shown widget is no collision, so an in-bounds hidden large stays large.
  const under = board({ clock: { column: 0, row: 0, size: 'large' } }, 'balanced', { [ID]: { column: 0, row: 2, size: 'large' } });
  assert.equal(gridProblem(under.widgetGrid, under.widgets), null); assert.equal(fitReshapedFamilies(under), under);
});

test('every board that was valid with a 4 × 4 widget is valid after the refit, on every grid', () => {
  let boards = 0, shrunk = 0, kept = 0;
  for (const density of Object.keys(GRID_DENSITIES) as GridDensity[]) {
    const limits = GRID_DENSITIES[density], base = board({}, density);
    for (let row = 0; row + OLD_LARGE.rows <= limits.rows; row++) for (let column = 0; column + OLD_LARGE.columns <= limits.columns; column++) {
      // One small neighbour at every cell outside the old 4 × 4 cells, and the widget alone.
      const neighbours: (WidgetPlacement | null)[] = [null];
      for (let y = 0; y + 2 <= limits.rows; y++) for (let x = 0; x + 2 <= limits.columns; x++) {
        const note: WidgetPlacement = { column: x, row: y, size: 'small' };
        if (!intersects({ column, row, size: 'large' }, OLD_LARGE, note, { columns: 2, rows: 2 })) neighbours.push(note);
      }
      for (const note of neighbours) for (const shown of [true, false]) {
        const placement: WidgetPlacement = { column, row, size: 'large' };
        const old = { widgets: { ...base.widgets, note: note !== null, [ID]: shown }, widgetGrid: { ...base.widgetGrid, placements: { ...base.widgetGrid.placements, ...(note ? { note } : {}), [ID]: placement } } };
        assert.ok(validBefore(old), `${density} ${column},${row}: a valid old board`);
        const fitted = fitReshapedFamilies(old);
        assert.equal(gridProblem(fitted.widgetGrid, fitted.widgets), null, `${density} ${column},${row} ${shown ? 'shown' : 'hidden'} beside ${JSON.stringify(note)}`);
        const result = hourly(fitted);
        assert.deepEqual([result.column, result.row], [column, row], 'the origin never moves');
        if (result.size === 'medium') shrunk++; else kept++;
        boards++;
      }
    }
  }
  assert.ok(boards > 5000 && shrunk > 0 && kept > 0, `${boards} boards: ${shrunk} became medium, ${kept} stayed large`);
});

test('settings and saved styles read an old placement instead of rejecting it; a truly invalid board still fails', () => {
  for (const old of [outside(), overlapping()]) {
    const origin = hourly(old);
    old.savedPresets = [{ id: 'old-style', name: 'Old style', visual: getVisual(old) }];
    const parsed = settingsSchema.parse(JSON.parse(JSON.stringify(old)));
    assert.deepEqual(hourly(parsed), { column: origin.column, row: origin.row, size: 'medium' }, 'current settings');
    assert.deepEqual(hourly(parsed.savedPresets[0]!.visual), { column: origin.column, row: origin.row, size: 'medium' }, 'a saved style');
    assert.equal(parsed.widgets[ID], true); assert.equal(parsed.savedPresets[0]!.visual.widgets[ID], true);
    assert.deepEqual(settingsSchema.parse(JSON.parse(JSON.stringify(parsed))), parsed, 'reading it again changes nothing');
  }
  // A style alone may carry the old placement while the current settings are fine.
  const current = fitting(); current.savedPresets = [{ id: 'old-style', name: 'Old style', visual: getVisual(outside()) }];
  assert.deepEqual(hourly(settingsSchema.parse(current).savedPresets[0]!.visual), { column: 8, row: 4, size: 'medium' });
  assert.deepEqual(hourly(settingsSchema.parse(current)), { column: 0, row: 4, size: 'large' });
  // Not a loophole: a board that was never valid stays rejected, with the widget named.
  const broken = outside(); broken.widgets.note = true; broken.widgetGrid.placements.note = { column: 10, row: 4, size: 'small' };
  assert.equal(validBefore(broken), false);
  assert.throws(() => settingsSchema.parse(broken), /overlaps another widget/);
  const beyond = outside(); beyond.widgetGrid.placements[ID] = { column: 10, row: 4, size: 'large' };
  assert.throws(() => settingsSchema.parse(beyond), /Hourly forecast is outside the grid/, 'medium at that origin is outside too');
  const wrongFamily = board({ [ID]: { column: 0, row: 4, size: 'small' } });
  assert.throws(() => settingsSchema.parse(wrongFamily), /Hourly forecast does not support this size/, 'a family the widget never had is not refitted');
});

test('an import with an old placement in the settings and in a saved style is accepted', () => {
  const old = outside(); old.savedPresets = [{ id: 'old-style', name: 'Old style', visual: getVisual(overlapping()) }];
  const exported = { version: 1 as const, exportedAt: new Date(0).toISOString(), settings: persistableData({ settings: old }).settings, reminders: [] };
  assert.equal((exported.settings as { widgetGrid: WidgetGrid }).widgetGrid.placements[ID].size, 'large', 'the file holds the old family');
  const imported = importSchema.parse(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(hourly(imported.settings), { column: 8, row: 4, size: 'medium' });
  assert.deepEqual(hourly(imported.settings.savedPresets[0]!.visual), { column: 0, row: 4, size: 'medium' });
});

test('the store opens files saved with the old family, and the API accepts an old import and an old style', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-hourly-714-'));
  try {
    // state.json and its backup as the previous build wrote them: the widget on and large at 8,4.
    const old = outside(); old.savedPresets = [{ id: 'old-style', name: 'Old style', visual: getVisual(overlapping()) }];
    const file = JSON.stringify(persistableData({ version: 1 as const, settings: old, reminders: [], photoAsset: null }), null, 2);
    assert.match(file, /"hourlyTemperature": \{\s+"column": 8,\s+"row": 4,\s+"size": "large"/);
    await writeFile(join(directory, 'state.json'), file); await writeFile(join(directory, 'state.backup.json'), file);
    const store = await DataStore.open(directory);
    assert.equal(store.warning, null, 'state.json is read; nothing is recovered from the backup');
    await assert.rejects(access(join(directory, 'state.corrupt.json')), 'no file is set aside as unreadable');
    const settings = store.snapshot().settings;
    assert.deepEqual(hourly(settings), { column: 8, row: 4, size: 'medium' }); assert.equal(settings.widgets[ID], true);
    assert.deepEqual(hourly(settings.savedPresets[0]!.visual), { column: 0, row: 4, size: 'medium' });
    // Reading refits in memory only: both files keep their bytes, so a rollback straight after an update needs no step.
    const untouched = async (label: string) => { for (const name of ['state.json', 'state.backup.json']) assert.equal(await readFile(join(directory, name), 'utf8'), file, `${name} is byte-identical ${label}`); };
    await untouched('after the store opens');

    const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    const send = (method: string, path: string, value?: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    try {
      // Starting the application and reading through the API write nothing either.
      const state = await (await send('GET', '/api/state')).json() as { settings: Settings };
      assert.deepEqual(hourly(state.settings), { column: 8, row: 4, size: 'medium' }, 'the API serves the fitted family');
      assert.equal((await send('GET', '/api/export')).status, 200);
      await untouched('after the application starts and is read');
      // The next save writes the fitted family.
      assert.equal((await send('PATCH', '/api/settings', { units: 'imperial' })).status, 200);
      assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).settings.widgetGrid.placements[ID].size, 'medium');
      // An export made by the previous build, with the old family in the settings and in a style.
      const exported = { version: 1, exportedAt: new Date(0).toISOString(), settings: persistableData({ settings: (() => { const value = overlapping(); value.savedPresets = [{ id: 'old-export-style', name: 'Old export style', visual: getVisual(outside()) }]; return value; })() }).settings, reminders: [] };
      const response = await send('POST', '/api/import', exported);
      assert.equal(response.status, 200, await response.clone().text());
      const imported = app.store.snapshot().settings;
      assert.deepEqual(hourly(imported), { column: 0, row: 4, size: 'medium' });
      assert.deepEqual(hourly(imported.savedPresets[0]!.visual), { column: 8, row: 4, size: 'medium' });
      // A style saved by an editor tab that predates the change.
      const styled = await send('PATCH', '/api/settings', { savedPresets: [{ id: 'stale-tab-style', name: 'Stale tab style', visual: getVisual(outside()) }] });
      assert.equal(styled.status, 200, await styled.clone().text());
      assert.deepEqual(hourly(app.store.snapshot().settings.savedPresets[0]!.visual), { column: 8, row: 4, size: 'medium' });
      // A large placement that fits is saved as large, and an impossible board is still a 400.
      const large = await send('PATCH', '/api/settings', { widgets: Object.fromEntries(WIDGET_IDS.map(id => [id, id === ID])), widgetGrid: { placements: { [ID]: { column: 4, row: 6, size: 'large' } } } });
      assert.equal(large.status, 200, await large.clone().text());
      assert.deepEqual(hourly(app.store.snapshot().settings), { column: 4, row: 6, size: 'large' });
      assert.equal((await send('PATCH', '/api/settings', { widgetGrid: { placements: { [ID]: { column: 10, row: 6, size: 'large' } } } })).status, 400);
      assert.deepEqual(hourly(app.store.snapshot().settings), { column: 4, row: 6, size: 'large' }, 'a rejected placement changes nothing');
    } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
