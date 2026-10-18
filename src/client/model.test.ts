import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import {
  applyBuiltinPreset,
  getVisual,
  precipitationOutlook,
  sortReminders,
  upcomingRain,
} from './model.ts';
import {
  ageLabel,
  forecastDay,
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
  assert.equal(forecastDay('2026-10-19', 1), 'Mon');
  assert.equal(forecastDay('2026-10-18', 0), 'Today');
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

test('unknown precipitation never becomes a dry or zero-amount forecast', () => {
  const unknown = [
    {
      intervalStart: '',
      intervalEnd: '',
      precipitationProbability: null,
      precipitationAmount: null,
      rainAmount: null,
    },
  ];
  assert.deepEqual(precipitationOutlook(unknown, 'mm'), {
    chance: null,
    expected: null,
    rainExpected: null,
    rainIncomplete: true,
    rainy: [],
    incomplete: true,
    wet: [],
  });
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
    ).expected,
    0.5,
  );
});

test('snow probability does not invent a rain timing window or rain amount', () => {
  const snowy = [
    {
      intervalStart: '',
      intervalEnd: '',
      precipitationProbability: 90,
      precipitationAmount: 3,
      rainAmount: 0,
    },
  ];
  const outlook = precipitationOutlook(snowy, 'mm');
  assert.equal(outlook.chance, 90);
  assert.equal(outlook.rainExpected, 0);
  assert.equal(outlook.rainy.length, 0);
  assert.equal(outlook.wet.length, 1);
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
  const night = applyBuiltinPreset(source, 'night');
  assert.equal(night.location.name, 'Example city');
  assert.equal(night.units, 'imperial');
  assert.equal(night.savedPresets.length, 1);
  assert.equal(night.widgetOverrides.clock.offsetX, 0);
  assert.equal(night.appearance.brightness, 0.28);
  night.widgets.clock = false;
  assert.equal(source.widgets.clock, true);
});
