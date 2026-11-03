import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_WIDGET_IDS,
  alertStartLabel,
  compass,
  currentDetail,
  dayProgress,
  distance,
  reminderWeek,
  timeOverlap,
  upcomingDetails,
  unexpiredAlerts,
  yearProgress,
} from './collection.ts';
import {
  ACTIVE_WIDGET_IDS,
  defaultWidgetGrid,
  defaultWidgetVisibility,
  needsAlerts,
  needsForecast,
  WIDGET_CATALOG,
} from '../shared/widgets.ts';
import { defaultSettings } from '../shared/defaults.ts';
import { emptyWeather } from '../server/weather.ts';
import { settingsSchema } from '../server/validation.ts';
import { persistableData } from '../server/persistence.ts';
import {
  assertPreviousReaderAccepts,
  assertPreviousReaderRejects,
} from '../server/compat/previous-reader.ts';

test('exactly fifteen additional optional ids, old/default layouts remain unchanged', () => {
  assert.equal(COLLECTION_WIDGET_IDS.length, 15);
  assert.equal(ACTIVE_WIDGET_IDS.length, 28);
  const settings = defaultSettings();
  for (const id of COLLECTION_WIDGET_IDS) {
    assert.equal(WIDGET_CATALOG[id].defaultEnabled, false);
    assert.equal(settings.widgets[id], false);
  }
  assert.deepEqual(
    Object.keys(settings.widgets).filter((id) => settings.widgets[id as keyof typeof settings.widgets]),
    ['clock', 'weather', 'forecast', 'reminders', 'preview', 'calendar'],
  );
  const persisted = persistableData({ version: 1, settings, reminders: [], photoAsset: null });
  assertPreviousReaderAccepts('data', persisted, 'all fifteen off by default');
  assert.deepEqual(
    settingsSchema.parse(persisted.settings),
    settings,
    'omission restores defaults without changing the existing board',
  );
  for (const id of COLLECTION_WIDGET_IDS) {
    const single = defaultSettings();
    single.widgets = Object.fromEntries(
      Object.keys(single.widgets).map((key) => [key, key === id]),
    ) as typeof single.widgets;
    single.widgetGrid.placements[id] = { column: 0, row: 0, size: WIDGET_CATALOG[id].defaultSize };
    const data = persistableData({ version: 1, settings: single, reminders: [], photoAsset: null });
    assertPreviousReaderRejects('data', data, `${id} enabled is an explicit rollback exception`);
    assert.deepEqual(
      settingsSchema.parse(data.settings),
      single,
      `${id} saves and imports in the current reader`,
    );
  }
  const legacy = defaultSettings();
  legacy.widgets = defaultWidgetVisibility();
  legacy.widgetGrid = defaultWidgetGrid();
  for (const id of COLLECTION_WIDGET_IDS) {
    delete (legacy.widgets as Partial<typeof legacy.widgets>)[id];
    delete (legacy.widgetGrid.placements as Partial<typeof legacy.widgetGrid.placements>)[id];
  }
  const restored = settingsSchema.parse(legacy);
  for (const id of COLLECTION_WIDGET_IDS) assert.equal(restored.widgets[id], false);
});

test('new data sources are gated by their saved optional widgets', () => {
  const settings = defaultSettings();
  for (const id of ACTIVE_WIDGET_IDS) settings.widgets[id] = false;
  assert.equal(needsForecast(settings), false);
  assert.equal(needsAlerts(settings), false);
  settings.widgets.wind = true;
  assert.equal(needsForecast(settings), true);
  settings.widgets.wind = false;
  settings.widgets.weatherAlerts = true;
  assert.equal(needsAlerts(settings), true);
  assert.equal(needsForecast(settings), false);
});

test('civil progress and reminder buckets respect short and long local days', () => {
  const before = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    assert.equal(dayProgress(new Date('2026-03-08T12:00:00-04:00')).length, 23 * 3600_000);
    assert.equal(dayProgress(new Date('2026-11-01T12:00:00-05:00')).length, 25 * 3600_000);
    const year = yearProgress(new Date('2028-12-31T12:00:00-05:00'));
    assert.equal(year.total, 366);
    assert.equal(year.day, 366);
    assert.equal(year.remaining, 0);
    const now = new Date('2026-03-07T20:00:00-05:00');
    const item = {
      id: 'synthetic',
      text: 'Example',
      dueAt: '2026-03-09T00:15:00-04:00',
      completed: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const week = reminderWeek([item], now);
    assert.equal(week[2]!.items.length, 1);
    assert.deepEqual(
      week.map((day) => day.key),
      ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'],
    );
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('time overlap uses real instants across DST and quarter-hour zones; weekends remain unavailable', () => {
  const london = [{ label: 'London', timezone: 'Europe/London' }];
  const before = timeOverlap(london, Date.parse('2026-03-06T12:00:00Z'), 'America/Toronto');
  assert.equal(before.start, Date.parse('2026-03-06T14:00:00Z'));
  assert.equal(before.end, Date.parse('2026-03-06T17:00:00Z'));
  const after = timeOverlap(london, Date.parse('2026-03-09T12:00:00Z'), 'America/Toronto');
  assert.equal(after.start, Date.parse('2026-03-09T13:00:00Z'));
  assert.equal(
    timeOverlap(london, Date.parse('2026-10-30T12:00:00Z'), 'America/Toronto').start,
    Date.parse('2026-10-30T13:00:00Z'),
  );
  assert.equal(
    timeOverlap(london, Date.parse('2026-11-02T12:00:00Z'), 'America/Toronto').start,
    Date.parse('2026-11-02T14:00:00Z'),
  );
  const kathmandu = timeOverlap(
    [{ label: 'Kathmandu', timezone: 'Asia/Kathmandu' }],
    Date.parse('2026-03-09T00:00:00Z'),
    'UTC',
  );
  assert.equal(kathmandu.end, Date.parse('2026-03-09T11:15:00Z'));
  const weekend = timeOverlap(london, Date.parse('2026-03-07T01:00:00Z'), 'America/Toronto');
  assert.equal(weekend.start, null);
});

test('detail readers never use future instants as current or expired instants as upcoming; units stay explicit', () => {
  const weather = emptyWeather(defaultSettings()),
    now = Date.parse('2026-11-03T12:30:00Z');
  const reading = {
    temperature: null,
    humidity: null,
    dewPoint: null,
    pressure: null,
    visibility: null,
    cloudCover: null,
    windSpeed: null,
    windDirection: null,
    windGust: null,
  };
  weather.details = [
    { ...reading, time: '2026-11-03T12:00:00Z' },
    { ...reading, time: '2026-11-03T13:00:00Z' },
  ];
  assert.equal(currentDetail(weather, now)?.time, weather.details[0]!.time);
  assert.equal(upcomingDetails(weather, now)[0]?.time, weather.details[1]!.time);
  assert.equal(compass(359), 'N');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(null), '—');
  assert.equal(distance(1609.344, true), '1.0 mi');
  assert.equal(distance(1000, false), '1.0 km');
  assert.equal(distance(null, false), '—');
});
test('future alert starts use the saved weather zone and selected 12/24-hour format', () => {
  const at = '2026-11-03T21:30:00Z';
  assert.match(alertStartLabel(at, 'America/Toronto', '12h'), /4:30.*PM/);
  assert.match(alertStartLabel(at, 'America/Toronto', '24h'), /16:30/);
  assert.match(alertStartLabel(at, 'Europe/London', '24h'), /21:30/);
  assert.match(alertStartLabel('2026-11-04T05:00:00Z', 'America/Toronto', '24h'), /00:00/);
});

test('official notices disappear at either end or expiry, while future notices remain explicitly dated', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const notice = {
    id: 'future',
    level: 'warning' as const,
    name: 'Synthetic notice',
    area: null,
    issuedAt: new Date(now).toISOString(),
    startsAt: new Date(now + 3600_000).toISOString(),
    endsAt: null,
    expiresAt: null,
  };
  const result = unexpiredAlerts(
    [
      {
        ...notice,
        id: 'ended',
        endsAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 3600_000).toISOString(),
      },
      { ...notice, id: 'expired', expiresAt: new Date(now).toISOString() },
      notice,
    ],
    now,
  );
  assert.deepEqual(
    result.map((alert) => alert.id),
    ['future'],
  );
});
