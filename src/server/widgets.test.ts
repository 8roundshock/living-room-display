import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { WIDGET_CATALOG, WIDGET_IDS, GRID_DENSITIES, composeWidgetGrid, firstPlacement, gridProblem, motionOffset, placeWidget, repackGrid, widgetContentLimits, widgetSizes } from '../shared/widgets.ts';
import { mergeSettings, settingsSchema } from './validation.ts';

test('all optional widgets and their family metadata have a valid independent default', () => {
  const settings = defaultSettings();
  assert.equal(gridProblem(settings.widgetGrid, settings.widgets), null);
  assert.equal(settings.appearance.clockStyle, 'outline');
  assert.equal(settings.widgets.rain, true); assert.equal(settings.widgets.photo, false);
  for (const id of WIDGET_IDS) assert.ok(widgetSizes(id).includes(WIDGET_CATALOG[id].defaultSize));
  assert.deepEqual(widgetContentLimits('small'), { forecastDays: 3, reminders: 1 });
  assert.deepEqual(widgetContentLimits('large'), { forecastDays: 7, reminders: 4 });
  const empty = mergeSettings(settings, { widgets: Object.fromEntries(WIDGET_IDS.map(id => [id, false])) });
  assert.equal(Object.values(empty.widgets).some(Boolean), false, 'even time and current weather are optional');
});

test('invalid drops, overlaps, unsupported sizes and bounds cannot mutate saved settings or presets', () => {
  const settings = defaultSettings(); const original = structuredClone(settings.widgetGrid);
  assert.equal(placeWidget(settings.widgetGrid, 'clock', { column: 8, row: 0, size: 'large' }, settings.widgets), null);
  assert.equal(placeWidget(settings.widgetGrid, 'clock', { column: -1, row: 0, size: 'small' }, settings.widgets), null);
  assert.throws(() => mergeSettings(settings, { widgetGrid: { placements: { rain: { column: 8, row: 0 } } } }), /overlaps/);
  assert.throws(() => mergeSettings(settings, { widgetGrid: { placements: { forecast: { column: 10 } } } }), /outside/);
  const { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid, preview } = settings;
  const visual = { appearance, widgets, widgetOverrides, widgetBehavior, widgetGrid: { ...widgetGrid, placements: { ...widgetGrid.placements, rain: { column: 8, row: 0, size: 'medium' } } }, preview };
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
  assert.equal(repackGrid(settings.widgetGrid, 'spacious', settings.widgets), null, '56 occupied cells cannot be squeezed into 48 without an explicit resize');
  const allSmall = structuredClone(settings.widgetGrid);
  for (const id of WIDGET_IDS) allSmall.placements[id].size = 'small';
  const compact = repackGrid(allSmall, 'spacious', settings.widgets); assert.ok(compact);
  assert.equal(gridProblem(compact, settings.widgets), null);
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
    assert.notDeepEqual(motionOffset(1), motionOffset(5), 'additional protected-plane offsets do not repeat on the old four-cycle boundary');
  }
  const grid = defaultSettings().widgetGrid;
  assert.ok(firstPlacement(grid, 'photo', 'small', defaultSettings().widgets));
});
