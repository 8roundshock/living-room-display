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
  // Dynamic (#437) carries it only while Forecast and Weather are both off.
  settings.widgets.dynamic = true; assert.equal(weatherAttributionWidget(settings), 'dynamic');
  settings.widgets.weather = true; assert.equal(weatherAttributionWidget(settings), 'weather');
  settings.widgets.weather = false; settings.widgets.forecast = true; assert.equal(weatherAttributionWidget(settings), 'forecast');
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

import {
  BUILTIN_PRESETS,
  MAX_SAVED_STYLES,
  builtinLook,
  duplicateStyleName,
  labelLook,
  matchingBuiltinPreset,
  resetAppearance,
  spokenInterval,
  spokenSeconds,
  withAppearance,
} from './model.ts';
import { sameEffectiveSettings, settingsChanges } from './draft.ts';

/** Someone's own board and preferences: an added Note, Last screen removed, motion and clock choices, Text size. */
function personalised() {
  const source = defaultSettings();
  source.location.name = 'Example city';
  source.units = 'imperial';
  source.widgets.note = true;
  source.widgets.preview = false;
  source.preview.enabled = false;
  source.preview.opacity = 0.4;
  source.widgetGrid.placements.note = { column: 10, row: 6, size: 'small' };
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

test('the stored style label follows the look on every appearance edit and never makes a draft dirty by itself (#277)', () => {
  const room = defaultSettings();
  assert.equal(room.appearance.preset, 'room');
  // A change outside the look (Text size, motion, Animation, the Clock widget's style) keeps the
  // matching built-in label.
  for (const update of [{ fontScale: 1.25 }, { motionEnabled: false }, { motionIntervalSeconds: 600 }, { fadeSeconds: 5 }, { animation: 'lively' as const }, { clockStyle: 'digital' as const }]) {
    assert.equal(withAppearance(room, update).appearance.preset, 'room', JSON.stringify(update));
  }
  // A change to the look is Custom; reverting it is the built-in style again.
  const brighter = withAppearance(room, { brightness: 0.6 });
  assert.equal(brighter.appearance.preset, 'custom');
  assert.equal(withAppearance(brighter, { brightness: 0.55 }).appearance.preset, 'room');
  assert.equal(withAppearance(room, { accentMode: 'color' }).appearance.preset, 'custom', 'a single accent is no built-in look');
  assert.equal(withAppearance(room, { fontFamily: 'serif' }).appearance.preset, 'custom');
  assert.equal(withAppearance(room, { textColor: '#ffffff' }).appearance.preset, 'custom');
  // Reaching another built-in look by hand stores that style's label.
  const night = builtinLook('night');
  assert.equal(withAppearance(room, { brightness: night.brightness, accentColor: night.accentColor, textColor: night.textColor }).appearance.preset, 'night');
  // An older label that disagrees with the look is corrected by the next edit.
  const stale = defaultSettings(); stale.appearance.preset = 'custom';
  assert.equal(labelLook(stale.appearance).preset, 'room');
  const unchanged = defaultSettings().appearance;
  assert.equal(labelLook(unchanged), unchanged, 'an already correct label returns the same object');
  // Every value stays one the previous release accepts.
  for (const settings of [room, brighter, applyBuiltinPreset(room, 'phone'), resetAppearance(brighter)])
    assert.ok(['phone', 'room', 'night', 'custom'].includes(settings.appearance.preset));
  assert.equal(resetAppearance(brighter).appearance.preset, 'room', 'Reset appearance labels the Room look');
  // The label alone is not an effective change: no Save bar and nothing to send.
  const relabelled = structuredClone(stale); relabelled.appearance = labelLook(relabelled.appearance);
  assert.equal(sameEffectiveSettings(stale, relabelled), true);
  assert.deepEqual(settingsChanges(stale, relabelled), {});
  // With a real change the corrected label travels with it.
  assert.deepEqual(settingsChanges(stale, withAppearance(stale, { fontScale: 1.1 })).appearance, { fontScale: 1.1, preset: 'room' });
  assert.equal(room.appearance.fontScale, 1, 'withAppearance does not mutate its input');
});

test('saved style names are unique without case and surrounding spaces (#344)', () => {
  const styles = [{ id: 'a', name: 'Evening' }, { id: 'b', name: ' Morning light ' }];
  assert.equal(duplicateStyleName(styles, 'Evening'), 'Evening');
  assert.equal(duplicateStyleName(styles, '  evening  '), 'Evening', 'case and spaces do not make a new name');
  assert.equal(duplicateStyleName(styles, 'MORNING LIGHT'), ' Morning light ');
  assert.equal(duplicateStyleName(styles, 'Evenings'), null);
  assert.equal(duplicateStyleName(styles, '   '), null, 'an empty name is not a duplicate');
  assert.equal(duplicateStyleName(styles, 'evening', 'a'), null, 'renaming a style to its own name is allowed');
  assert.equal(duplicateStyleName(styles, 'evening', 'b'), 'Evening', 'renaming onto another style is refused');
  assert.equal(MAX_SAVED_STYLES, 12);
});

test('slider values are read aloud with their unit (#342)', () => {
  assert.equal(spokenInterval(30), '30 seconds');
  assert.equal(spokenInterval(60), '1 minute');
  assert.equal(spokenInterval(90), '1 minute 30 seconds');
  assert.equal(spokenInterval(180), '3 minutes');
  assert.equal(spokenInterval(1800), '30 minutes');
  assert.equal(spokenSeconds(0), '0 seconds');
  assert.equal(spokenSeconds(1), '1 second');
  assert.equal(spokenSeconds(2), '2 seconds');
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
