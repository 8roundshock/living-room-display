import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, composeWidgetGrid, firstPlacement, fitGridDensity, fitWidgetFamily, gridProblem, placeWidget, reflowWidget, repackGrid, switchGridDensity, widgetContentLimits, widgetSizes } from '../shared/widgets.ts';
import { mergeSettings, settingsSchema } from './validation.ts';

test('all optional widgets and their family metadata have a valid independent default', () => {
  const settings = defaultSettings();
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null);
  assert.equal(settings.appearance.clockStyle, 'outline');
  assert.equal(settings.widgets.rain, false, 'Rain is part of Weather (#74)'); assert.equal(settings.widgets.photo, false);
  for (const id of WIDGET_IDS) assert.ok(widgetSizes(id).includes(WIDGET_CATALOG[id].defaultSize));
  assert.deepEqual(widgetContentLimits('small'), { forecastDays: 3 });
  assert.deepEqual(widgetContentLimits('large'), { forecastDays: 7 });
  const empty = mergeSettings(settings, { widgets: Object.fromEntries(WIDGET_IDS.map(id => [id, false])) });
  assert.equal(Object.values(empty.widgets).some(Boolean), false, 'even time and current weather are optional');
});

test('invalid drops, overlaps, unsupported sizes and bounds cannot mutate saved settings or presets', () => {
  const settings = defaultSettings(); const original = structuredClone(settings.widgetGrid);
  assert.equal(placeWidget(settings.widgetGrid, 'clock', { column: 8, row: 0, size: 'large' }, settings.widgets), null);
  assert.equal(placeWidget(settings.widgetGrid, 'clock', { column: -1, row: 0, size: 'small' }, settings.widgets), null);
  assert.throws(() => mergeSettings(settings, { widgetGrid: { placements: { preview: { column: 8, row: 0 } } } }), /overlaps/);
  assert.throws(() => mergeSettings(settings, { widgetGrid: { placements: { forecast: { column: 10 } } } }), /outside/);
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = settings;
  const visual = { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid: { ...widgetGrid, placements: { ...widgetGrid.placements, preview: { column: 8, row: 0, size: 'medium' } } }, preview };
  assert.throws(() => settingsSchema.parse({ ...settings, savedPresets: [{ id: 'bad', name: 'Bad board', visual }] }), /overlaps/);
  assert.deepEqual(settings.widgetGrid, original);
});

test('per-widget supported families are authoritative for validation and placement', () => {
  const settings = defaultSettings();
  const sizes = WIDGET_CATALOG.weather.sizes;
  // A future renderer may deliberately omit a family; generic helpers must honor that contract.
  WIDGET_CATALOG.weather.sizes = { small: sizes.small, medium: sizes.medium } as typeof sizes;
  try {
    assert.deepEqual(widgetSizes('weather'), ['small', 'medium']);
    assert.equal(firstPlacement(settings.widgetGrid, 'weather', 'large', settings.widgets), null);
    assert.equal(placeWidget(settings.widgetGrid, 'weather', { column: 0, row: 0, size: 'large' }, {}), null);
    assert.throws(() => mergeSettings(settings, { widgetGrid: { placements: { weather: { size: 'large' } } } }), /does not support/);
  } finally { WIDGET_CATALOG.weather.sizes = sizes; }
});

test('density changes preserve families and every enabled module or reject without truncation', () => {
  const settings = defaultSettings();
  const fine = repackGrid(settings.widgetGrid, 'fine', settings.widgets); assert.ok(fine);
  assert.equal(gridProblem(fine, settings.widgets), null);
  for (const id of WIDGET_IDS) assert.equal(fine.placements[id].size, settings.widgetGrid.placements[id].size);
  assert.equal(repackGrid(settings.widgetGrid, 'spacious', settings.widgets), null, '76 occupied cells cannot fit into 48 while preserving all families');
  const allSmall = structuredClone(settings.widgetGrid);
  for (const id of WIDGET_IDS) allSmall.placements[id].size = 'small';
  const compact = repackGrid(allSmall, 'spacious', settings.widgets); assert.ok(compact);
  assert.equal(gridProblem(compact, settings.widgets), null);
});

test('adding a large photo searches nearby origins when its old origin blocks the wide forecast', () => {
  const settings = defaultSettings(), original = structuredClone(settings.widgetGrid);
  const preferred = { ...original.placements.photo, size: 'large' as const };
  assert.equal(firstPlacement(original, 'photo', 'large', settings.widgets), null);
  assert.equal(reflowWidget(original, 'photo', preferred, settings.widgets), null, 'the old hidden origin partitions the free space');
  const next = fitWidgetFamily(original, 'photo', 'large', settings.widgets); assert.ok(next);
  assert.equal(gridProblem(next, { ...settings.widgets, photo: true }), null);
  assert.equal(next.placements.photo.size, 'large');
  for (const id of WIDGET_IDS.filter(id => id !== 'photo')) assert.equal(next.placements[id].size, original.placements[id].size, 'adding preserves every existing family');
  assert.deepEqual(fitWidgetFamily(original, 'photo', 'large', settings.widgets), next, 'nearest-origin search is deterministic');
  assert.deepEqual(settings.widgetGrid, original, 'the saved baseline is untouched');
  assert.doesNotThrow(() => mergeSettings(settings, { widgets: { photo: true }, widgetGrid: next }));
});

test('density fitting keeps every widget and exactly restores an explored authored layout and families', () => {
  const settings = defaultSettings(); settings.widgets.photo = true;
  const original = structuredClone(settings.widgetGrid);
  const compact = switchGridDensity(original, 'spacious', settings.widgets); assert.ok(compact);
  assert.equal(gridProblem(compact.grid, settings.widgets), null);
  assert.ok(compact.resized.length > 0);
  assert.equal(compact.grid.placements.clock.size, 'medium');
  const fine = switchGridDensity(compact.grid, 'fine', settings.widgets, compact.history); assert.ok(fine);
  const restored = switchGridDensity(fine.grid, 'balanced', settings.widgets, fine.history); assert.ok(restored);
  assert.deepEqual(restored.grid, original, 'returning restores positions and larger families, including hidden/default geometry');
  assert.deepEqual(settings.widgetGrid, original, 'all exploration is a pure draft');
  for (const density of Object.keys(GRID_DENSITIES) as (keyof typeof GRID_DENSITIES)[]) {
    const fit = fitGridDensity(original, density, settings.widgets); assert.ok(fit);
    assert.equal(gridProblem(fit.grid, settings.widgets), null);
    assert.deepEqual(Object.keys(fit.grid.placements), WIDGET_IDS);
  }
});

test('density history cannot overwrite a meaningful widget edit with a stale snapshot', () => {
  const settings = defaultSettings(); for (const id of WIDGET_IDS) settings.widgets[id] = id === 'clock';
  settings.widgetGrid.placements.clock = { column: 6, row: 6, size: 'small' };
  const original = structuredClone(settings.widgetGrid);
  const compact = switchGridDensity(original, 'spacious', settings.widgets); assert.ok(compact);
  const back = switchGridDensity(compact.grid, 'balanced', settings.widgets, compact.history); assert.ok(back);
  assert.deepEqual(back.grid, original, 'the original bottom-right placement survives coarse rounding');
  const edited = structuredClone(compact.grid); edited.placements.clock = { column: 0, row: 0, size: 'medium' };
  const afterEdit = switchGridDensity(edited, 'balanced', settings.widgets, compact.history); assert.ok(afterEdit);
  assert.deepEqual(afterEdit.grid.placements.clock, { column: 0, row: 0, size: 'medium' });
});

test('direct manipulation pins the requested widget, displaces neighbors, and leaves unrelated cells intact', () => {
  const settings = defaultSettings();
  const original = structuredClone(settings.widgetGrid);
  const next = reflowWidget(original, 'weather', { column: 6, row: 0, size: 'medium' }, settings.widgets); assert.ok(next);
  assert.deepEqual(next.placements.weather, { column: 6, row: 0, size: 'medium' });
  assert.equal(gridProblem(next, settings.widgets), null);
  assert.notDeepEqual(next.placements.clock, original.placements.clock, 'the large neighbor makes room');
  assert.deepEqual(next.placements.forecast, original.placements.forecast, 'unrelated neighbors stay put when possible');
  assert.equal(reflowWidget(original, 'clock', { column: -1, row: 0, size: 'large' }, settings.widgets), null);
  assert.deepEqual(original, settings.widgetGrid, 'a valid preview or rejected request never mutates its source');
});

test('legacy family geometry is validated before migration while current invalid layouts remain errors', () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings())); delete legacy.widgetGrid.revision;
  // Revision-one positions of the foundation (pre-#78) ids, written out rather than read from PREVIOUS_RELEASE (#263).
  const positions = { clock: [0, 0], weather: [8, 0], rain: [0, 3], forecast: [2, 6], reminders: [5, 3], preview: [8, 3], photo: [4, 3] };
  for (const [id, [column, row]] of Object.entries(positions)) legacy.widgetGrid.placements[id] = { ...legacy.widgetGrid.placements[id], column, row };
  // Legacy boards predate #74: a medium Weather and an enabled Rain, which Weather now absorbs.
  legacy.widgetGrid.placements.weather.size = 'medium'; legacy.widgets.rain = true;
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = legacy;
  legacy.savedPresets = [{ id: 'legacy', name: 'Legacy layout', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }];
  const migrated = settingsSchema.parse(legacy);
  assert.equal(migrated.widgetGrid.revision, 2);
  assert.equal(gridProblem(migrated.widgetGrid, migrated.widgets), null);
  assert.deepEqual(migrated.widgets, { ...legacy.widgets, rain: false });
  assert.equal(migrated.savedPresets[0]!.visual.widgetGrid.revision, 2);
  assert.equal(gridProblem(migrated.savedPresets[0]!.visual.widgetGrid, migrated.widgets), null);
  const malformed = structuredClone(legacy); malformed.widgetGrid.placements.rain.row = 0;
  assert.throws(() => settingsSchema.parse(malformed), /overlaps/, 'migration does not repair previously invalid input');
  assert.throws(() => settingsSchema.parse({ ...legacy, widgetGrid: { ...legacy.widgetGrid, revision: 2 } }), /overlaps/, 'current geometry invalidity stays strict');
  assert.equal(legacy.widgetGrid.revision, undefined, 'reading a legacy input does not modify its original data');
  const dense = structuredClone(legacy); dense.savedPresets = []; dense.widgets.photo = true; dense.widgetGrid.density = 'spacious';
  dense.widgetGrid.placements = {
    clock: { column: 0, row: 0, size: 'large' }, weather: { column: 6, row: 0, size: 'small' },
    rain: { column: 0, row: 2, size: 'medium' }, preview: { column: 4, row: 2, size: 'medium' },
    forecast: { column: 0, row: 4, size: 'medium' }, reminders: { column: 4, row: 4, size: 'small' }, photo: { column: 6, row: 4, size: 'small' },
  };
  const migratedDense = settingsSchema.parse(dense);
  assert.equal(gridProblem(migratedDense.widgetGrid, migratedDense.widgets), null);
  assert.deepEqual(migratedDense.widgets, { ...dense.widgets, rain: false }, 'a full legacy board never loses a widget to the larger clock; Weather absorbs Rain');
  assert.equal(migratedDense.widgetGrid.placements.clock.size, 'medium');
});

test('additive legacy migration preserves visibility, cities, presets and obsolete transforms', () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings()));
  delete legacy.widgetGrid; delete legacy.appearance.clockStyle; delete legacy.widgets.rain; delete legacy.widgets.photo;
  delete legacy.widgetOverrides.rain; delete legacy.widgetOverrides.photo; legacy.widgets.weather = false; legacy.widgetOverrides.clock.offsetX = 12;
  const visual = { appearance: legacy.appearance, widgets: legacy.widgets, widgetOverrides: legacy.widgetOverrides, widgetBehavior: legacy.widgetBehavior, preview: legacy.preview };
  legacy.savedPresets = [{ id: 'old', name: 'Old preset', visual }];
  const saved = settingsSchema.parse(legacy);
  assert.equal(saved.widgets.weather, false); assert.equal(saved.widgets.rain, false, 'legacy weather toggle also controlled rain');
  assert.equal(saved.widgets.photo, false); assert.equal(saved.widgetOverrides.clock.offsetX, 12);
  assert.equal(saved.savedPresets[0]!.visual.widgetGrid.density, 'balanced');
  assert.equal(saved.savedPresets[0]!.visual.appearance.clockStyle, 'outline');
  // With Weather on, the legacy toggle also enabled Rain: Weather absorbs it in the default space (#74).
  const withWeather = settingsSchema.parse({ ...legacy, widgets: { ...legacy.widgets, weather: true } });
  assert.equal(withWeather.widgets.weather, true); assert.equal(withWeather.widgets.rain, false, 'Weather absorbs the legacy Rain');
  assert.deepEqual(withWeather.widgetGrid.placements.weather, { column: 8, row: 0, size: 'large' });
});

test('missing additive modules use accepted revision-one origins before settings and preset migration', () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings()));
  legacy.locationSource = 'manual'; legacy.location.name = 'Preserved legacy city'; legacy.units = 'imperial';
  legacy.widgetGrid = { density: 'balanced', placements: {
    clock: { column: 0, row: 0, size: 'large' }, weather: { column: 8, row: 0, size: 'medium' },
    forecast: { column: 2, row: 6, size: 'large' }, reminders: { column: 5, row: 3, size: 'small' },
    preview: { column: 8, row: 3, size: 'medium' }, photo: { column: 4, row: 3, size: 'small' },
  } };
  delete legacy.widgets.rain; delete legacy.widgetOverrides.rain;
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = legacy;
  legacy.savedPresets = [{ id: 'old-default', name: 'Existing style', visual: { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } }];
  const untouched = structuredClone(legacy), migrated = settingsSchema.parse(legacy);
  // The legacy toggle enabled Rain; Weather absorbs it (#74).
  assert.equal(migrated.widgets.rain, false); assert.equal(migrated.widgets.weather, true);
  assert.equal(migrated.location.name, 'Preserved legacy city'); assert.equal(migrated.units, 'imperial');
  assert.equal(migrated.widgetGrid.revision, 2); assert.equal(gridProblem(migrated.widgetGrid, migrated.widgets), null);
  const preset = migrated.savedPresets[0]!.visual;
  assert.equal(preset.widgets.rain, false); assert.equal(preset.widgets.weather, true); assert.equal(preset.widgetGrid.revision, 2); assert.equal(gridProblem(preset.widgetGrid, preset.widgets), null);
  assert.deepEqual(legacy, untouched, 'parsing/import migration does not rewrite the original bytes/object');
  const malformed = structuredClone(legacy); malformed.widgetGrid.placements.rain = { column: 8, row: 3, size: 'medium' };
  assert.throws(() => settingsSchema.parse(malformed), /overlaps/, 'an explicitly invalid legacy placement is not silently repaired');
});

test('catalog defaults generically backfill an absent module throughout saved visuals', () => {
  const legacy = JSON.parse(JSON.stringify(defaultSettings()));
  for (const field of ['widgets', 'widgetOverrides']) delete legacy[field].photo;
  delete legacy.widgetGrid.placements.photo;
  const saved = settingsSchema.parse(legacy);
  assert.equal(saved.widgets.photo, WIDGET_CATALOG.photo.defaultEnabled);
  assert.equal(saved.widgetGrid.placements.photo.size, WIDGET_CATALOG.photo.defaultSize);
  assert.deepEqual(saved.widgetGrid.placements.photo, { ...WIDGET_CATALOG.photo.defaultPlacement, size: WIDGET_CATALOG.photo.defaultSize });
  assert.deepEqual(saved.widgetOverrides.photo, { offsetX: 0, offsetY: 0, scale: 1 });
});

test('a centered single widget visits distant regions rather than remaining locked by reflections', () => {
  const settings = defaultSettings(); const enabled = Object.fromEntries(WIDGET_IDS.map(id => [id, id === 'clock']));
  settings.widgetGrid.placements.clock = { column: 3, row: 3, size: 'large' };
  let previous = settings.widgetGrid; const origins = new Set<string>();
  for (let cycle = 1; cycle <= 40; cycle++) {
    const next = composeWidgetGrid(settings.widgetGrid, enabled, cycle, previous); const point = next.placements.clock;
    assert.equal(gridProblem(next, enabled), null);
    assert.notDeepEqual(point, previous.placements.clock);
    const distance = Math.hypot((point.column - previous.placements.clock.column) / 12, (point.row - previous.placements.clock.row) / 8);
    assert.ok(distance >= 0.28, 'where distant origins are available, use them');
    origins.add(`${point.column},${point.row}`); previous = next;
  }
  assert.ok(origins.size >= 10);
});

test('long-running full and dense boards remain collision-free and move modules across varied origins', () => {
  for (const density of Object.keys(GRID_DENSITIES) as (keyof typeof GRID_DENSITIES)[]) {
    const settings = defaultSettings(); settings.widgets.photo = true;
    if (density === 'spacious') for (const id of WIDGET_IDS) settings.widgetGrid.placements[id].size = 'small';
    let grid = repackGrid(settings.widgetGrid, density, settings.widgets); assert.ok(grid);
    const original = structuredClone(grid); const origins = Object.fromEntries(WIDGET_IDS.map(id => [id, new Set<string>()]));
    for (let cycle = 1; cycle <= 32; cycle++) {
      const next = composeWidgetGrid(original, settings.widgets, cycle, grid);
      assert.equal(gridProblem(next, settings.widgets), null);
      for (const id of WIDGET_IDS) origins[id]!.add(`${next.placements[id].column},${next.placements[id].row}`);
      grid = next;
    }
    for (const id of WIDGET_IDS.filter(id => settings.widgets[id])) assert.ok(origins[id]!.size >= 5, `${density}/${id} needs more than four fixed origins`);
  }
  const grid = defaultSettings().widgetGrid;
  assert.ok(firstPlacement(grid, 'photo', 'small', defaultSettings().widgets));
});
