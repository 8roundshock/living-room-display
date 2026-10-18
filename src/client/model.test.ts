import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import {
  applyBuiltinPreset,
  getVisual,
  precipitationOutlook,
  reminderPresentation,
  sortReminders,
  upcomingRain,
  weatherAttributionWidget,
} from './model.ts';

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
  assert.equal(forecastDay('2026-10-19', 'America/Toronto', now, true), 'Tom.');
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
  assert.equal(ageLabel('2026-10-17T10:00:00Z', now), 'Updated 1 days ago');
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
  const outlook = precipitationOutlook(unknown, 'mm', forecastNow);
  assert.equal(outlook.chance, null);
  assert.equal(outlook.expected, null);
  assert.equal(outlook.rainExpected, null);
  assert.equal(outlook.rainIncomplete, true);
  assert.equal(outlook.incomplete, true);
  assert.deepEqual(outlook.wet, []);
  assert.equal(
    precipitationOutlook(
      [
        {
          ...unknown[0],
          precipitationProbability: 75,
          precipitationAmount: 0.5,
        },
      ],
      'mm',
      forecastNow,
    ).expected,
    0.5,
  );
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
  const outlook = precipitationOutlook(snowy, 'mm', forecastNow);
  assert.equal(outlook.chance, 90);
  assert.equal(outlook.rainExpected, 0);
  assert.equal(outlook.rainy.length, 0);
  assert.equal(outlook.wet.length, 1);
});

test('two known dry hours are a partial forecast with their actual amount period', () => {
  const outlook = precipitationOutlook(hourly(0, 2), 'mm', forecastNow);
  assert.equal(outlook.coverageComplete, false);
  assert.equal(outlook.incomplete, true);
  assert.equal(outlook.rainIncomplete, true);
  assert.equal(outlook.rainDataIncomplete, false);
  assert.equal(outlook.hasGaps, false);
  assert.equal(outlook.rainExpected, 0);
  assert.equal(
    forecastPeriod(
      outlook.coverageStart!,
      outlook.coverageEnd!,
      'America/Toronto',
      '24h',
      forecastNow,
    ),
    '09:00–11:00',
  );
});

test('gapped hourly data stays partial even when both ends of the horizon exist', () => {
  const source = hourly(0, 12, 0.5).filter((_, index) => index !== 4);
  const outlook = precipitationOutlook(source.reverse(), 'mm', forecastNow);
  assert.equal(outlook.hasGaps, true);
  assert.equal(outlook.coverageComplete, false);
  assert.equal(outlook.incomplete, true);
  assert.equal(outlook.rainExpected, 5.5);
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
  const outlook = precipitationOutlook(source, 'mm', forecastNow);
  assert.deepEqual(outlook.intervals, []);
  assert.equal(outlook.rainExpected, null);
  assert.equal(outlook.chance, null);
  assert.equal(outlook.coverageStart, null);
  assert.equal(outlook.coverageEnd, null);
  assert.equal(outlook.coverageComplete, false);
});

test('complete upcoming coverage includes both intersecting hour buckets and totals only those shown', () => {
  const outlook = precipitationOutlook(
    hourly(0, 24, 0.5),
    'mm',
    forecastNow + 30 * 60_000,
  );
  assert.equal(outlook.coverageComplete, true);
  assert.equal(outlook.incomplete, false);
  assert.equal(outlook.hasGaps, false);
  assert.equal(outlook.intervals.length, 13);
  assert.equal(outlook.rainExpected, 6.5);
  assert.equal(
    forecastPeriod(
      outlook.coverageStart!,
      outlook.coverageEnd!,
      'America/Toronto',
      '24h',
      forecastNow,
    ),
    '09:00–22:00',
  );
});

test('dated pending reminders lead undated/completed entries without mutating input', () => {
  const values = [
    { name: 'undated', completed: false, dueAt: null, createdAt: '2026-10-01' },
    {
      name: 'done',
      completed: true,
      dueAt: '2026-10-01T12:00:00Z',
      createdAt: '2026-10-01',
    },
    {
      name: 'upcoming',
      completed: false,
      dueAt: '2026-10-20T12:00:00Z',
      createdAt: '2026-10-01',
    },
    {
      name: 'overdue',
      completed: false,
      dueAt: '2026-10-17T12:00:00Z',
      createdAt: '2026-10-01',
    },
  ];
  assert.deepEqual(
    sortReminders(values).map((value) => value.name),
    ['overdue', 'upcoming', 'undated', 'done'],
  );
  assert.equal(values[0].name, 'undated');
});

test('appearance presets reset visuals while preserving personal data and named presets', () => {
  const source = defaultSettings();
  source.location.name = 'Example city';
  source.units = 'imperial';
  source.savedPresets = [
    { id: 'example', name: 'Example', visual: getVisual(source) },
  ];
  source.widgetOverrides.clock.offsetX = 25;
  source.widgetBehavior.reminders.hideWhenEmpty = false;
  const night = applyBuiltinPreset(source, 'night');
  assert.equal(night.location.name, 'Example city');
  assert.equal(night.units, 'imperial');
  assert.equal(night.savedPresets.length, 1);
  assert.equal(night.widgetOverrides.clock.offsetX, 0);
  assert.equal(night.appearance.brightness, 0.28);
  assert.equal(night.widgetBehavior.reminders.hideWhenEmpty, true);
  assert.equal(source.savedPresets[0].visual.widgetBehavior.reminders.hideWhenEmpty, true);
  const visual = getVisual(source);
  assert.equal(visual.widgetBehavior.reminders.hideWhenEmpty, false);
  visual.widgetBehavior.reminders.hideWhenEmpty = true;
  assert.equal(source.widgetBehavior.reminders.hideWhenEmpty, false, 'visual snapshot is independent');
  night.widgets.clock = false;
  assert.equal(source.widgets.clock, true);
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
