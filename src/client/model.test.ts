import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import {
  applyBuiltinPreset,
  getVisual,
  reminderPresentation,
  weatherAttributionWidget,
} from './model.ts';
import { precipitationOutlook, rainOutlook, upcomingRain } from './weather-outlook.ts';
import { pendingReminders } from '../shared/reminders.ts';

test('weather attribution follows the first enabled weather module and can all be removed', () => {
  const settings = defaultSettings(); assert.equal(weatherAttributionWidget(settings), 'forecast');
  settings.widgets.forecast = false; assert.equal(weatherAttributionWidget(settings), 'weather');
  // Rain is retired into Weather (#74): even an injected enabled Rain never carries the credit.
  settings.widgets.weather = false; settings.widgets.rain = true; assert.equal(weatherAttributionWidget(settings), null);
  settings.widgets.rain = false; assert.equal(weatherAttributionWidget(settings), null);
});
import {
  ageLabel,
  forecastDay,
  forecastPeriod,
  localInputDate,
  nextComposition,
  precipitation,
  temperature,
  weatherTime,
} from './format.ts';

test('provider values keep their supplied units and missing temperatures stay missing', () => {
  assert.equal(temperature(68), '68°');
  assert.equal(temperature(null), '—');
  assert.equal(precipitation(0.12, 'in'), '0.12 in');
  assert.equal(precipitation(0.4, 'mm'), '0.4 mm');
});

test('weather time uses forecast timezone across a daylight-saving transition', () => {
  assert.equal(
    weatherTime('2026-11-01T05:30:00Z', 'America/Toronto', '24h'),
    '01:30',
  );
  assert.equal(
    weatherTime('2026-11-01T06:30:00Z', 'America/Toronto', '24h'),
    '01:30',
  );
});

test('forecast day labels use the actual city calendar date even in a stale list', () => {
  const now = Date.parse('2026-10-18T13:00:00Z');
  assert.equal(forecastDay('2026-10-17', 'America/Toronto', now), 'Sat');
  assert.equal(forecastDay('2026-10-18', 'America/Toronto', now), 'Today');
  assert.equal(forecastDay('2026-10-19', 'America/Toronto', now), 'Tomorrow');
  assert.equal(forecastDay('2026-10-19', 'America/Toronto', now, true), 'Mon', 'compact labels name tomorrow by its weekday (#256)');
  assert.equal(forecastDay('2026-10-20', 'America/Toronto', now, true), 'Tue');
  assert.equal(forecastDay('2026-10-20', 'America/Toronto', now), 'Tue');
});

test('forecast Today and Tomorrow change at city midnight independently of the browser timezone', () => {
  const now = Date.parse('2026-10-18T23:30:00Z');
  assert.equal(forecastDay('2026-10-18', 'America/Toronto', now), 'Today');
  assert.equal(forecastDay('2026-10-18', 'Asia/Tokyo', now), 'Sun');
  assert.equal(forecastDay('2026-10-19', 'Asia/Tokyo', now), 'Today');
  assert.equal(forecastDay('2026-10-20', 'Asia/Tokyo', now), 'Tomorrow');
  assert.equal(
    forecastDay(
      '2026-10-18',
      'America/Toronto',
      Date.parse('2026-10-18T03:59:59Z'),
    ),
    'Tomorrow',
  );
  assert.equal(
    forecastDay(
      '2026-10-18',
      'America/Toronto',
      Date.parse('2026-10-18T04:00:00Z'),
    ),
    'Today',
  );
});

test('forecast relative calendar dates survive DST and amount periods identify overnight coverage', () => {
  const now = Date.parse('2026-11-01T04:30:00Z');
  assert.equal(forecastDay('2026-11-02', 'America/Toronto', now), 'Tomorrow');
  assert.equal(
    forecastDay(
      '2026-11-02',
      'America/Toronto',
      Date.parse('2026-11-02T04:30:00Z'),
    ),
    'Tomorrow',
  );
  assert.equal(
    forecastDay(
      '2026-11-02',
      'America/Toronto',
      Date.parse('2026-11-02T05:00:00Z'),
    ),
    'Today',
  );
  assert.equal(
    forecastPeriod(
      '2026-10-19T03:00:00Z',
      '2026-10-19T05:00:00Z',
      'America/Toronto',
      '24h',
      Date.parse('2026-10-18T13:00:00Z'),
    ),
    '23:00–Tomorrow 01:00',
  );
});

test('date input round trips an existing reminder without changing its instant', () => {
  const original = '2026-10-19T18:45:00.000Z';
  assert.equal(new Date(localInputDate(original)).toISOString(), original);
  assert.equal(localInputDate(null), '');
  assert.equal(localInputDate('bad-date'), '');
});

test('weather age communicates missing and older data', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  assert.equal(ageLabel(null, now), 'Not updated yet');
  assert.equal(ageLabel('2026-10-18T11:12:00Z', now), 'Updated 48 min ago');
  assert.equal(ageLabel('2026-10-17T10:00:00Z', now), 'Updated 1 day ago', 'one day is singular (#280)');
});

test('all four compositions are reachable and cycle', () => {
  let current = 0;
  const visited = [current];
  for (let count = 0; count < 4; count++) {
    current = nextComposition(current);
    visited.push(current);
  }
  assert.deepEqual(visited, [0, 1, 2, 3, 0]);
});

test('upcoming hourly intervals include an in-progress interval and exclude past/remote intervals', () => {
  const interval = (start: string, end: string) => ({
    intervalStart: start,
    intervalEnd: end,
    precipitationProbability: 20,
    precipitationAmount: 0.1,
    rainAmount: 0.1,
  });
  const values = [
    interval('2026-10-18T10:00:00Z', '2026-10-18T11:00:00Z'),
    interval('2026-10-18T11:00:00Z', '2026-10-18T12:00:00Z'),
    interval('2026-10-19T00:00:00Z', '2026-10-19T01:00:00Z'),
  ];
  assert.deepEqual(upcomingRain(values, Date.parse('2026-10-18T11:30:00Z')), [
    values[1],
  ]);
});

const forecastNow = Date.parse('2026-10-18T13:00:00Z');
const units = { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' } as const;
const rainTotal = (intervals: { rainAmount: number | null }[]) => intervals.reduce((total, hour) => total + (hour.rainAmount ?? 0), 0);
function hourly(startHour: number, count = 1, amount = 0) {
  return Array.from({ length: count }, (_, index) => ({
    intervalStart: new Date(
      forecastNow + (startHour + index) * 3_600_000,
    ).toISOString(),
    intervalEnd: new Date(
      forecastNow + (startHour + index + 1) * 3_600_000,
    ).toISOString(),
    precipitationProbability: 0,
    precipitationAmount: amount,
    rainAmount: amount,
  }));
}

test('unknown precipitation never becomes a dry or zero-amount forecast', () => {
  const unknown = [
    {
      ...hourly(0)[0],
      precipitationProbability: null,
      precipitationAmount: null,
      rainAmount: null,
    },
  ];
  const outlook = precipitationOutlook(unknown, forecastNow);
  assert.equal(outlook.chance, null);
  assert.equal(outlook.rainDataIncomplete, true);
  assert.equal(outlook.incomplete, true);
  const classified = rainOutlook({ hourly: unknown, units }, forecastNow);
  assert.equal(classified.firstSpell, null, 'an unknown amount is no rain spell');
  assert.equal(classified.kind, 'unknown', 'nor a dry forecast');
  assert.equal(classified.unknownReason, 'rain-data');
});

test('snow probability does not invent a rain timing window or rain amount', () => {
  const snowy = [
    {
      ...hourly(0)[0],
      precipitationProbability: 90,
      precipitationAmount: 3,
      rainAmount: 0,
    },
  ];
  const outlook = precipitationOutlook(snowy, forecastNow);
  assert.equal(outlook.chance, 90);
  const classified = rainOutlook({ hourly: snowy, units }, forecastNow);
  assert.equal(classified.firstSpell, null, 'no rain timing window');
  assert.equal(classified.kind, 'possible', 'snow is possible precipitation');
});

test('two known dry hours are a partial forecast with their actual amount period', () => {
  const outlook = precipitationOutlook(hourly(0, 2), forecastNow);
  assert.equal(outlook.coverageComplete, false);
  assert.equal(outlook.incomplete, true);
  assert.equal(outlook.rainDataIncomplete, false);
  assert.equal(outlook.hasGaps, false);
  assert.equal(rainTotal(outlook.intervals), 0);
  assert.equal(
    forecastPeriod(
      outlook.intervals[0]!.intervalStart,
      outlook.intervals.at(-1)!.intervalEnd,
      'America/Toronto',
      '24h',
      forecastNow,
    ),
    '09:00–11:00',
  );
});

test('gapped hourly data stays partial even when both ends of the horizon exist', () => {
  const source = hourly(0, 12, 0.5).filter((_, index) => index !== 4);
  const outlook = precipitationOutlook(source.reverse(), forecastNow);
  assert.equal(outlook.hasGaps, true);
  assert.equal(outlook.coverageComplete, false);
  assert.equal(outlook.incomplete, true);
  assert.equal(rainTotal(outlook.intervals), 5.5);
  assert.equal(
    outlook.intervals[0].intervalStart,
    new Date(forecastNow).toISOString(),
  );
});

test('expired and invalid hourly intervals produce no current amount or coverage claim', () => {
  const source = [
    ...hourly(-3, 3, 2),
    { ...hourly(0)[0], intervalEnd: 'invalid' },
    { ...hourly(0)[0], intervalEnd: new Date(forecastNow).toISOString() },
  ];
  const outlook = precipitationOutlook(source, forecastNow);
  assert.deepEqual(outlook.intervals, []);
  assert.equal(outlook.chance, null);
  assert.equal(outlook.coverageComplete, false);
});

test('complete upcoming coverage includes both intersecting hour buckets and totals only those shown', () => {
  const outlook = precipitationOutlook(
    hourly(0, 24, 0.5),
    forecastNow + 30 * 60_000,
  );
  assert.equal(outlook.coverageComplete, true);
  assert.equal(outlook.incomplete, false);
  assert.equal(outlook.hasGaps, false);
  assert.equal(outlook.intervals.length, 13);
  assert.equal(rainTotal(outlook.intervals), 6.5);
  assert.equal(
    forecastPeriod(
      outlook.intervals[0]!.intervalStart,
      outlook.intervals.at(-1)!.intervalEnd,
      'America/Toronto',
      '24h',
      forecastNow,
    ),
    '09:00–22:00',
  );
});

test('the editor and display share one pending order: soon dated, undated, later dated; completed excluded', () => {
  const now = Date.parse('2026-10-18T13:00:00Z');
  const entry = (name: string, completed: boolean, dueAt: string | null) => ({
    name, completed, dueAt, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  });
  const values = [
    entry('undated', false, null),
    entry('done', true, '2026-10-01T12:00:00Z'),
    entry('next month', false, '2026-11-20T12:00:00Z'),
    entry('upcoming', false, '2026-10-20T12:00:00Z'),
    entry('overdue', false, '2026-10-17T12:00:00Z'),
  ];
  assert.deepEqual(
    pendingReminders(values, now).map((value) => value.name),
    ['overdue', 'upcoming', 'undated', 'next month'],
  );
  assert.equal(values[0].name, 'undated');
  const settings = defaultSettings();
  assert.equal(reminderPresentation(settings, values), 'pending');
  assert.equal(reminderPresentation(settings, values.filter((value) => value.completed)), 'hidden', 'history alone is a confirmed empty list');
  assert.equal(reminderPresentation(settings, values.filter((value) => value.completed), true), 'unavailable');
});

import { BUILTIN_PRESETS, builtinLook, matchingBuiltinPreset, resetAppearance, resetLayout } from './model.ts';
import { catalogBoardDefaults } from '../server/fixtures.ts';
import { gridProblem } from '../shared/widgets.ts';

/** Someone's own board and preferences: an added Note, Last screen removed, motion and clock choices, Text size. */
function personalised() {
  const source = defaultSettings();
  source.location.name = 'Example city';
  source.units = 'imperial';
  source.widgets.note = true;
  source.widgets.preview = false;
  source.preview.enabled = false;
  source.preview.opacity = 0.4;
  // Last screen's cells on the default board (#435), freed by removing it.
  source.widgetGrid.placements.note = { column: 4, row: 6, size: 'small' };
  source.widgetGrid.density = 'balanced';
  source.widgetOverrides.clock.offsetX = 25;
  source.widgetBehavior.reminders.hideWhenEmpty = false;
  Object.assign(source.appearance, { motionEnabled: false, motionIntervalSeconds: 600, fadeSeconds: 5, animation: 'lively', clockStyle: 'analog', fontScale: 1.25 });
  source.widgetData.note.text = 'Synthetic note';
  source.savedPresets = [{ id: 'example', name: 'Example', visual: getVisual(source) }];
  return source;
}

test('built-in styles are looks only: each keeps widgets, layout, widget options, motion, clock style and Text size (#153, #110, #226)', () => {
  for (const preset of BUILTIN_PRESETS) {
    const source = personalised(), before = structuredClone(source);
    const styled = applyBuiltinPreset(source, preset);
    const look = builtinLook(preset);
    // The look: brightness, accent, text colour, typeface and the retained legacy layout.
    for (const key of ['brightness', 'accentMode', 'accentColor', 'textColor', 'fontFamily', 'layout'] as const) assert.equal(styled.appearance[key], look[key], `${preset} sets ${key}`);
    assert.equal(styled.appearance.preset, preset);
    assert.equal(styled.appearance.accentMode, 'native', `${preset} uses native colours`);
    // Everything else stays exactly as it was.
    const { appearance: styledAppearance, ...styledRest } = styled;
    const { appearance: beforeAppearance, ...beforeRest } = before;
    assert.deepEqual(styledRest, beforeRest, `${preset} keeps widgets, widgetGrid, widgetBehavior, preview, widgetOverrides, widgetData, saved styles and location`);
    for (const key of ['motionEnabled', 'motionIntervalSeconds', 'fadeSeconds', 'animation', 'clockStyle', 'fontScale'] as const) assert.equal(styledAppearance[key], beforeAppearance[key], `${preset} keeps ${key}`);
    assert.deepEqual(source, before, `${preset} does not mutate its input`);
    styled.widgets.clock = false;
    assert.equal(source.widgets.clock, true, `${preset} returns an independent copy`);
  }
  // Phone no longer sets its own 2-minute arrangement interval, and nothing lowers Text size.
  assert.equal(applyBuiltinPreset(defaultSettings(), 'phone').appearance.motionIntervalSeconds, 180);
  for (const preset of BUILTIN_PRESETS) assert.equal(applyBuiltinPreset(defaultSettings(), preset).appearance.fontScale, 1, `${preset} keeps 100%`);
  assert.deepEqual(builtinLook('night'), { brightness: 0.28, accentMode: 'native', accentColor: '#9990b7', textColor: '#a7a3bb', fontFamily: 'sans', layout: 'minimal' });
  assert.deepEqual(builtinLook('phone'), { brightness: 0.7, accentMode: 'native', accentColor: '#a89ec8', textColor: '#b8c1ca', fontFamily: 'sans', layout: 'balanced' });
  const { brightness, accentMode, accentColor, textColor, fontFamily, layout } = defaultSettings().appearance;
  assert.deepEqual(builtinLook('room'), { brightness, accentMode, accentColor, textColor, fontFamily, layout }, 'Room is the default look');
});

test('a built-in style card reads as chosen whenever its look is showing, whatever else changed (#153)', () => {
  assert.equal(matchingBuiltinPreset(defaultSettings().appearance), 'room', 'new installs show Room');
  for (const preset of BUILTIN_PRESETS) {
    const styled = applyBuiltinPreset(personalised(), preset);
    assert.equal(matchingBuiltinPreset(styled.appearance), preset);
    // Labelled Custom by an edit that was reverted, it still matches.
    const nudged = { ...styled.appearance, preset: 'custom' as const, brightness: styled.appearance.brightness + 0.01 };
    assert.equal(matchingBuiltinPreset(nudged), null, `${preset}: a different brightness is no built-in look`);
    assert.equal(matchingBuiltinPreset({ ...nudged, brightness: styled.appearance.brightness }), preset, `${preset}: brightness back, card pressed again`);
    assert.equal(matchingBuiltinPreset({ ...styled.appearance, layout: 'weather-first' }), preset, 'the legacy layout is not rendered, so it does not count');
    assert.equal(matchingBuiltinPreset({ ...styled.appearance, textColor: styled.appearance.textColor.toUpperCase() }), preset, 'colour case does not matter');
  }
  const room = applyBuiltinPreset(defaultSettings(), 'room').appearance;
  assert.equal(matchingBuiltinPreset({ ...room, accentMode: 'color' }), null, 'a single colour is not a built-in look');
  assert.equal(matchingBuiltinPreset({ ...room, accentColor: '#123456' }), null, 'a kept custom colour differs from Room, so applying Room is an effective change');
  assert.equal(matchingBuiltinPreset({ ...room, fontFamily: 'serif' }), null);
});

test('Reset appearance returns every Style tab value to its default and keeps the board, clock style and saved styles (#234)', () => {
  const source = personalised();
  source.appearance = { ...source.appearance, ...builtinLook('night'), accentMode: 'color', accentColor: '#123456', fontFamily: 'mono', preset: 'custom' };
  const reset = resetAppearance(source);
  assert.deepEqual(reset.appearance, { ...defaultSettings().appearance, clockStyle: 'analog' });
  const { appearance: _reset, ...rest } = reset;
  const { appearance: _source, ...before } = source;
  assert.deepEqual(rest, before, 'widgets, layout, widget options, location, saved styles and widget content stay');
  assert.equal(matchingBuiltinPreset(reset.appearance), 'room');
  assert.notEqual(reset.widgets, source.widgets, 'an independent copy');
});

test('Reset layout returns the widgets, their places and sizes and the grid to the default board and keeps everything else (#435)', () => {
  const defaults = defaultSettings();
  for (const [label, source] of [['a personalised board', personalised()], ['the catalog board in Fine', (() => {
    const board = catalogBoardDefaults(); board.widgetGrid.density = 'fine'; board.widgets.preview = false; board.preview.enabled = false; return board;
  })()]] as const) {
    assert.equal(gridProblem(source.widgetGrid, source.widgets), null, `${label} is a valid board`);
    const before = structuredClone(source), reset = resetLayout(source);
    assert.deepEqual(reset.widgets, defaults.widgets, `${label}: the default board's widgets are shown, every other one hidden`);
    assert.deepEqual(reset.widgetGrid, defaults.widgetGrid, `${label}: the default board's places, sizes and density`);
    assert.equal(reset.preview.enabled, true, `${label}: Last screen is shown again`);
    assert.equal(reset.preview.opacity, source.preview.opacity, `${label}: its opacity is a widget option and stays`);
    const { widgets: _w, widgetGrid: _g, preview: { enabled: _e, ...previewRest }, ...rest } = reset;
    const { widgets: _bw, widgetGrid: _bg, preview: { enabled: _be, ...beforePreview }, ...beforeRest } = before;
    assert.deepEqual(rest, beforeRest, `${label}: appearance (clock style included), widget options, transforms, widget content, location, units and saved styles stay`);
    assert.deepEqual(previewRest, beforePreview);
    assert.deepEqual(source, before, `${label}: the input is not mutated`);
    reset.widgetGrid.placements.clock.column = 0;
    assert.equal(defaultSettings().widgetGrid.placements.clock.column, 4, 'an independent copy of the defaults');
  }
  assert.deepEqual(resetLayout(defaults), defaults, 'resetting the default board changes nothing');
});

const pendingReminder = { id: 'qa', text: 'Synthetic reminder', completed: false,
  dueAt: null, createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T10:00:00Z' };

test('reminders hide only when confirmed empty or all completed, and active items remain visible', () => {
  const settings = defaultSettings();
  assert.equal(reminderPresentation(settings, []), 'hidden');
  assert.equal(reminderPresentation(settings, [{ ...pendingReminder, completed: true }]), 'hidden');
  assert.equal(reminderPresentation(settings, [pendingReminder]), 'pending');
  assert.equal(reminderPresentation(settings, [{ ...pendingReminder, completed: true }, pendingReminder]), 'pending');
});

test('empty override preserves a message while an explicitly disabled reminder widget stays hidden', () => {
  const settings = defaultSettings();
  settings.widgetBehavior.reminders.hideWhenEmpty = false;
  assert.equal(reminderPresentation(settings, []), 'empty');
  assert.equal(reminderPresentation(settings, [{ ...pendingReminder, completed: true }]), 'empty');
  settings.widgets.reminders = false;
  for (const value of [[], [pendingReminder], null])
    assert.equal(reminderPresentation(settings, value, true), 'hidden');
});

test('unknown and disconnected empty reminders cannot become a confirmed empty widget', () => {
  const settings = defaultSettings();
  for (const hide of [true, false]) {
    settings.widgetBehavior.reminders.hideWhenEmpty = hide;
    assert.equal(reminderPresentation(settings, null), 'unavailable');
    assert.equal(reminderPresentation(settings, undefined), 'unavailable');
    assert.equal(reminderPresentation(settings, [], true), 'unavailable');
    assert.equal(reminderPresentation(settings, [{ ...pendingReminder, completed: true }], true), 'unavailable');
    assert.equal(reminderPresentation(settings, [pendingReminder], true), 'pending', 'cached pending items stay useful while marked offline');
  }
});
