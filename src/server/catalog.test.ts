import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { PREVIOUS_RELEASE } from './persistence.ts';
import { importSchema, mergeSettings, settingsPatchSchema, settingsSchema } from './validation.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { PALETTE_ROLES } from '../shared/palette.ts';
import {
  ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, WIDGET_IDS, composeWidgetGrid, defaultWidgetGrid, defaultWidgetVisibility,
  fitGridDensity, gridProblem, isActiveWidget, isPlannedWidget, repackGrid, switchGridDensity, widgetSizes, type WidgetDefinition,
} from '../shared/widgets.ts';
import type { WidgetId } from '../shared/contracts.ts';

const PLANNED = ['worldClocks', 'calendar', 'countdown', 'note', 'airQuality', 'sunMoon'];
const definition = (id: WidgetId): WidgetDefinition => WIDGET_CATALOG[id];

test('every catalog entry declares a valid category, tone, status and supported default size', () => {
  for (const id of WIDGET_IDS) {
    const entry = definition(id);
    assert.ok(Object.hasOwn(WIDGET_CATEGORIES, entry.category), `${id} category`);
    assert.ok((PALETTE_ROLES as readonly string[]).includes(entry.tone), `${id} tone`);
    assert.ok(entry.status === undefined || ['active', 'planned', 'retired'].includes(entry.status), `${id} status`);
    assert.ok(widgetSizes(id).includes(entry.defaultSize), `${id} default size`);
    assert.equal(entry.mergedInto === undefined || entry.status === 'retired', true, `${id} mergedInto is for retired entries only`);
  }
  for (const revision of [1, 2] as const) {
    assert.equal(gridProblem(defaultWidgetGrid(revision), {}), null, `every default placement is in bounds at revision ${revision}`);
  }
  assert.equal(gridProblem(defaultWidgetGrid(), defaultWidgetVisibility()), null);
});

test('planned entries reserve the #78 ids after the shipped ones and are never active', () => {
  assert.deepEqual(WIDGET_IDS, [...PREVIOUS_RELEASE.widgetIds, ...PLANNED]);
  assert.deepEqual(ACTIVE_WIDGET_IDS, [...PREVIOUS_RELEASE.widgetIds]);
  for (const id of PLANNED as WidgetId[]) {
    assert.equal(isPlannedWidget(id), true); assert.equal(isActiveWidget(id), false, `${id}: widgetVisible starts with isActiveWidget`);
    assert.equal(definition(id).defaultEnabled, false); assert.equal(definition(id).legacyPlacement, undefined);
  }
  for (const id of ACTIVE_WIDGET_IDS) { assert.equal(isActiveWidget(id), true); assert.equal(isPlannedWidget(id), false); }
});

/** A retired entry must name an active id whose families include every retired family. */
function retiredProblems(): string[] {
  return WIDGET_IDS.filter(id => definition(id).status === 'retired').flatMap(id => {
    const target = definition(id).mergedInto as WidgetId | undefined;
    if (!target || !WIDGET_IDS.includes(target) || !isActiveWidget(target)) return [`${id} must merge into an active widget`];
    return widgetSizes(id).filter(size => !widgetSizes(target).includes(size)).map(size => `${id} ${size} has no ${target} family`);
  });
}

test('retired entries merge into an active id that supports their families', () => {
  assert.deepEqual(retiredProblems(), []);
  const rain = definition('rain'), original = { status: rain.status, mergedInto: rain.mergedInto };
  try {
    rain.status = 'retired'; rain.mergedInto = 'weather';
    assert.equal(isActiveWidget('rain'), false, 'isActiveWidget reads the catalog live');
    assert.deepEqual(retiredProblems(), []);
    const settings = defaultSettings();
    assert.equal(settingsSchema.parse(settings).widgets.rain, true, 'reading leaves retired ids untouched');
    rain.mergedInto = 'worldClocks'; assert.deepEqual(retiredProblems(), ['rain must merge into an active widget']);
    rain.mergedInto = undefined; assert.deepEqual(retiredProblems(), ['rain must merge into an active widget']);
    const clockSizes = definition('clock').sizes;
    try {
      definition('clock').sizes = { small: clockSizes.small };
      rain.mergedInto = 'clock'; assert.deepEqual(retiredProblems(), ['rain medium has no clock family', 'rain large has no clock family']);
    } finally { definition('clock').sizes = clockSizes; }
  } finally {
    if (original.status === undefined) delete rain.status; else rain.status = original.status;
    if (original.mergedInto === undefined) delete rain.mergedInto; else rain.mergedInto = original.mergedInto;
  }
  assert.equal(isActiveWidget('rain'), true);
});

test('settings, saved styles and imports that enable a planned id read it as disabled', () => {
  const settings = JSON.parse(JSON.stringify(defaultSettings()));
  for (const id of PLANNED) settings.widgets[id] = true;
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = settings;
  settings.savedPresets = [{ id: 'style', name: 'Style', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }];
  const read = settingsSchema.parse(settings);
  const imported = importSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings, reminders: [] }).settings;
  for (const value of [read.widgets, read.savedPresets[0]!.visual.widgets, imported.widgets]) {
    for (const id of PLANNED as WidgetId[]) assert.equal(value[id], false, id);
    for (const id of ACTIVE_WIDGET_IDS) assert.equal(value[id], settings.widgets[id], id);
  }
});

test('a PATCH enabling a planned id is rejected with a clear message', async () => {
  assert.throws(() => settingsPatchSchema.parse({ widgets: { note: true } }), /Note is not available yet/);
  assert.deepEqual(settingsPatchSchema.parse({ widgets: { note: false } }), { widgets: { note: false } });
  assert.throws(() => mergeSettings(defaultSettings(), settingsPatchSchema.parse({ widgets: { sunMoon: true } })), /Sun & moon is not available yet/);
  const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  try {
    for (const id of PLANNED) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: { [id]: true } }) });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, new RegExp(`${definition(id as WidgetId).name} is not available yet`));
    }
    assert.equal(Object.values(app.store.snapshot().settings.widgets).filter(Boolean).length, 6);
  } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
});

// The same computation recorded on main 88e58b0 before the planned entries were appended; only
// previous-release ids are compared, so appending must leave every existing layout identical.
function layoutGoldens(): string {
  const ids = PREVIOUS_RELEASE.widgetIds;
  const pick = (grid: ReturnType<typeof defaultWidgetGrid>) => ({ revision: grid.revision, density: grid.density, placements: Object.fromEntries(ids.map(id => [id, grid.placements[id]])) });
  const legacy = JSON.parse(JSON.stringify(defaultSettings())); delete legacy.widgetGrid.revision;
  const positions: Record<string, [number, number]> = { clock: [0, 0], weather: [8, 0], rain: [0, 3], forecast: [2, 6], reminders: [5, 3], preview: [8, 3], photo: [4, 3] };
  for (const id of ids) { const [column, row] = positions[id]!; legacy.widgetGrid.placements[id] = { ...legacy.widgetGrid.placements[id], column, row }; }
  const withPhoto = defaultSettings(); withPhoto.widgets.photo = true;
  const out: Record<string, unknown> = {};
  for (const [name, settings] of [['default', defaultSettings()], ['legacy', settingsSchema.parse(legacy)], ['photo', withPhoto]] as const) {
    const entry = { grid: pick(settings.widgetGrid), compose: [] as unknown[], fit: {} as Record<string, unknown>, repack: {} as Record<string, unknown> };
    let previous = settings.widgetGrid;
    for (let cycle = 0; cycle < 9; cycle++) { const grid = composeWidgetGrid(settings.widgetGrid, settings.widgets, cycle, previous); entry.compose.push(pick(grid)); previous = grid; }
    for (const density of ['spacious', 'balanced', 'fine'] as const) {
      const fit = fitGridDensity(settings.widgetGrid, density, settings.widgets); entry.fit[density] = fit ? { grid: pick(fit.grid), resized: fit.resized } : null;
      const repacked = repackGrid(settings.widgetGrid, density, settings.widgets); entry.repack[density] = repacked ? pick(repacked) : null;
    }
    out[name] = entry;
  }
  return JSON.stringify(out);
}

test('appending planned entries keeps the default board, packing, density fits and composition identical to main', () => {
  assert.equal(createHash('sha256').update(layoutGoldens()).digest('hex'), '322f86655a6725bcdf839a59aa6df64e38e349c8b14d392998897333ffb03b61');
  const settings = defaultSettings(); settings.widgets.photo = true;
  const original = structuredClone(settings.widgetGrid);
  const compact = switchGridDensity(original, 'spacious', settings.widgets); assert.ok(compact);
  const fine = switchGridDensity(compact.grid, 'fine', settings.widgets, compact.history); assert.ok(fine);
  const restored = switchGridDensity(fine.grid, 'balanced', settings.widgets, fine.history); assert.ok(restored);
  assert.deepEqual(restored.grid, original, 'density round trips restore every placement, planned ones included');
});
