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
import type { Settings, WidgetId } from '../shared/contracts.ts';

/**
 * The foundation ids every release knows (bedca44's catalog), written out rather than read from
 * PREVIOUS_RELEASE, which moves after each install (#263).
 */
const FOUNDATION_IDS = ['clock', 'weather', 'rain', 'forecast', 'reminders', 'preview', 'photo'] as WidgetId[];
/** The six #78 ids, appended after the foundation ids in this order; each unit activated its own (deleted `status`). */
const NEW_IDS = ['worldClocks', 'calendar', 'countdown', 'note', 'airQuality', 'sunMoon'] as WidgetId[];
/** Ids appended after the #78 ones, each by its own ticket: Dynamic (#437). */
const LATER_IDS = ['dynamic'] as WidgetId[];
/** Ids still reserved; computed so that activating an entry (deleting its status) needs no edit here. */
const PLANNED = WIDGET_IDS.filter(isPlannedWidget);
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
  assert.deepEqual(WIDGET_IDS, [...FOUNDATION_IDS, ...NEW_IDS, ...LATER_IDS]);
  // New ids are appended: the previous installed release's ids (all 13 since 3fee844, #263; 3446400 since #367) stay a prefix.
  assert.deepEqual(WIDGET_IDS.slice(0, PREVIOUS_RELEASE.widgetIds.length), [...PREVIOUS_RELEASE.widgetIds]);
  // Rain is retired into Weather (#74); every other foundation id stays active, and each #78 id is
  // active once its unit deletes `status`.
  assert.deepEqual(ACTIVE_WIDGET_IDS, [...FOUNDATION_IDS.filter(id => id !== 'rain'), ...NEW_IDS.filter(id => !PLANNED.includes(id)), ...LATER_IDS]);
  // Both #78 units (#157 Calendar/Countdown/Note, #171 World clocks/Air quality/Sun & moon) have shipped.
  assert.deepEqual(NEW_IDS.filter(id => !isActiveWidget(id)), [], 'every #78 id is active after both catalog units');
  assert.ok(PLANNED.every(id => NEW_IDS.includes(id)), 'only reserved #78 ids are planned');
  for (const id of NEW_IDS) { assert.equal(definition(id).defaultEnabled, false, `${id} is optional and off by default`); assert.equal(definition(id).legacyPlacement, undefined); }
  for (const id of PLANNED) {
    assert.equal(isPlannedWidget(id), true); assert.equal(isActiveWidget(id), false, `${id}: widgetVisible starts with isActiveWidget`);
  }
  for (const id of ACTIVE_WIDGET_IDS) { assert.equal(isActiveWidget(id), true); assert.equal(isPlannedWidget(id), false); }
});

test('#437 Dynamic is an active, optional Weather & sky widget with standard families and no legacy placement', () => {
  const dynamic = definition('dynamic');
  assert.equal(isActiveWidget('dynamic'), true);
  assert.deepEqual({ name: dynamic.name, description: dynamic.description, icon: dynamic.icon, category: dynamic.category, tone: dynamic.tone, defaultSize: dynamic.defaultSize, defaultEnabled: dynamic.defaultEnabled, defaultPlacement: dynamic.defaultPlacement },
    { name: 'Dynamic', description: 'What matters now, or a calm rotation', icon: 'sparkles', category: 'weather', tone: 'sky', defaultSize: 'medium', defaultEnabled: false, defaultPlacement: { column: 2, row: 4 } });
  assert.deepEqual(widgetSizes('dynamic'), ['small', 'medium', 'large']);
  assert.equal(dynamic.legacyPlacement, undefined, 'no revision-one board ever held Dynamic');
  assert.equal(dynamic.legacyEnabledFrom, undefined);
  assert.equal(defaultWidgetVisibility().dynamic, false, 'off by default');
  for (const revision of [1, 2] as const) assert.equal(gridProblem(defaultWidgetGrid(revision), { dynamic: true }), null, `its default placement is in bounds at revision ${revision}`);
  // The catalog's icons stay distinct: Dynamic takes sparkles, which no other entry uses.
  const icons = ACTIVE_WIDGET_IDS.map(id => definition(id).icon);
  assert.equal(new Set(icons).size, icons.length, `every active widget has its own picker icon: ${icons.join(', ')}`);
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
  // #74 retired Rain into Weather; src/server/weather-merge.test.ts covers its migration.
  assert.equal(rain.status, 'retired'); assert.equal(rain.mergedInto, 'weather');
  try {
    assert.equal(isActiveWidget('rain'), false);
    delete rain.status; assert.equal(isActiveWidget('rain'), true, 'isActiveWidget reads the catalog live');
    rain.status = 'retired'; assert.equal(isActiveWidget('rain'), false);
    assert.deepEqual(retiredProblems(), []);
    const settings = defaultSettings(); settings.widgets.rain = true;
    assert.equal(settingsSchema.parse(settings).widgets.rain, false, 'reading merges an enabled retired id into its target');
    // World clocks is active since #171, so reserve it briefly to keep proving an inactive target is refused.
    const worldClocks = definition('worldClocks'), worldClocksStatus = worldClocks.status;
    try {
      worldClocks.status = 'planned';
      rain.mergedInto = 'worldClocks'; assert.deepEqual(retiredProblems(), ['rain must merge into an active widget']);
    } finally { if (worldClocksStatus === undefined) delete worldClocks.status; else worldClocks.status = worldClocksStatus; }
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
  assert.equal(isActiveWidget('rain'), false);
});

test('settings, saved styles and imports that enable a planned id read it as disabled', () => {
  // As below: reserve one id while every #78 unit has shipped, so the read path stays covered.
  const probe = PLANNED[0] ?? 'sunMoon', probeStatus = definition(probe).status;
  const reserved = PLANNED.length ? PLANNED : [probe];
  definition(probe).status = 'planned';
  try {
    const settings = JSON.parse(JSON.stringify(defaultSettings()));
    for (const id of reserved) settings.widgets[id] = true;
    const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = settings;
    settings.savedPresets = [{ id: 'style', name: 'Style', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }];
    const read = settingsSchema.parse(settings);
    const imported = importSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings, reminders: [] }).settings;
    for (const value of [read.widgets, read.savedPresets[0]!.visual.widgets, imported.widgets]) {
      for (const id of reserved) assert.equal(value[id], false, id);
      for (const id of ACTIVE_WIDGET_IDS.filter(id => !reserved.includes(id))) assert.equal(value[id], settings.widgets[id], id);
    }
  } finally { if (probeStatus === undefined) delete definition(probe).status; else definition(probe).status = probeStatus; }
});

test('a PATCH enabling a planned id is rejected with a clear message', async () => {
  // Generic over whichever ids are still planned; temporarily reserve one if every unit has shipped
  // (true since #157 and #171 both merged), so the schema, merge and HTTP paths stay covered.
  const probe = PLANNED[0] ?? 'sunMoon', probeStatus = definition(probe).status;
  const reserved = PLANNED.length ? PLANNED : [probe];
  definition(probe).status = 'planned';
  try {
    assert.throws(() => settingsPatchSchema.parse({ widgets: { [probe]: true } }), new RegExp(`${definition(probe).name} is not available yet`));
    assert.deepEqual(settingsPatchSchema.parse({ widgets: { [probe]: false } }), { widgets: { [probe]: false } });
    assert.throws(() => mergeSettings(defaultSettings(), settingsPatchSchema.parse({ widgets: { [probe]: true } })), new RegExp(`${definition(probe).name} is not available yet`));
    const directory = await mkdtemp(join(tmpdir(), 'lrd-catalog-'));
    const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()) });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    try {
      for (const id of reserved) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: { [id]: true } }) });
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, new RegExp(`${definition(id).name} is not available yet`));
      }
      assert.equal(Object.values(app.store.snapshot().settings.widgets).filter(Boolean).length, 5, 'the five default widgets (Rain is part of Weather since #74)');
    } finally { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); }
  } finally { if (probeStatus === undefined) delete definition(probe).status; else definition(probe).status = probeStatus; }
});

// The same computation recorded on main 88e58b0 before the planned entries were appended; only
// the foundation ids are compared, so appending must leave every existing layout identical.
// #74 deliberately changed the default board (large Weather, Rain merged): the pre-#74 board still
// hashes to 322f8665…, and the value below is recorded after that change.
function layoutGoldens(boardDefaults: () => Settings = defaultSettings): string {
  const ids = FOUNDATION_IDS;
  const pick = (grid: ReturnType<typeof defaultWidgetGrid>) => ({ revision: grid.revision, density: grid.density, placements: Object.fromEntries(ids.map(id => [id, grid.placements[id]])) });
  const legacy = JSON.parse(JSON.stringify(defaultSettings())); delete legacy.widgetGrid.revision;
  const positions: Record<string, [number, number]> = { clock: [0, 0], weather: [8, 0], rain: [0, 3], forecast: [2, 6], reminders: [5, 3], preview: [8, 3], photo: [4, 3] };
  for (const id of ids) { const [column, row] = positions[id]!; legacy.widgetGrid.placements[id] = { ...legacy.widgetGrid.placements[id], column, row }; }
  // Legacy boards predate #74: a medium Weather and an enabled Rain.
  legacy.widgetGrid.placements.weather.size = 'medium'; legacy.widgets.rain = true;
  const withPhoto = boardDefaults(); withPhoto.widgets.photo = true;
  const out: Record<string, unknown> = {};
  for (const [name, settings] of [['default', boardDefaults()], ['legacy', settingsSchema.parse(legacy)], ['photo', withPhoto]] as const) {
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
  assert.equal(createHash('sha256').update(layoutGoldens()).digest('hex'), '315a32e7f731fc510d092d63f544fab42c3694bf791237519296f00a780afdcb');
  // With the pre-#74 catalog and board, the shared layout helpers still produce the foundation golden.
  const rain = definition('rain'), weather = definition('weather'), saved = { status: rain.status, mergedInto: rain.mergedInto, enabled: rain.defaultEnabled, size: weather.defaultSize };
  try {
    delete rain.status; delete rain.mergedInto; rain.defaultEnabled = true; weather.defaultSize = 'medium';
    const preMerge = () => { const board = defaultSettings(); board.widgetGrid.placements.weather.size = 'medium'; board.widgets.rain = true; return board; };
    assert.equal(createHash('sha256').update(layoutGoldens(preMerge)).digest('hex'), '322f86655a6725bcdf839a59aa6df64e38e349c8b14d392998897333ffb03b61', 'the shared layout helpers are unchanged for the pre-#74 board');
  } finally { Object.assign(rain, { status: saved.status, mergedInto: saved.mergedInto, defaultEnabled: saved.enabled }); weather.defaultSize = saved.size; }
  const settings = defaultSettings(); settings.widgets.photo = true;
  const original = structuredClone(settings.widgetGrid);
  const compact = switchGridDensity(original, 'spacious', settings.widgets); assert.ok(compact);
  const fine = switchGridDensity(compact.grid, 'fine', settings.widgets, compact.history); assert.ok(fine);
  const restored = switchGridDensity(fine.grid, 'balanced', settings.widgets, fine.history); assert.ok(restored);
  assert.deepEqual(restored.grid, original, 'density round trips restore every placement, planned ones included');
});
