import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import { gridProblem, switchGridDensity } from '../shared/widgets.ts';
import {
  rebaseDraft,
  rebaseSettings,
  same,
  sameEffectiveSettings,
  settingsChanges,
} from './draft.ts';

test('draft rebase refreshes untouched nested fields and retains local edits', () => {
  const base = defaultSettings(),
    draft = structuredClone(base),
    incoming = structuredClone(base);
  draft.appearance.brightness = 0.3;
  incoming.appearance.fontScale = 1.2;
  incoming.location.name = 'A city saved elsewhere';
  const next = rebaseDraft(base, draft, incoming);
  assert.equal(next.appearance.brightness, 0.3);
  assert.equal(next.appearance.fontScale, 1.2);
  assert.equal(next.location.name, 'A city saved elsewhere');
  assert.deepEqual(settingsChanges(incoming, next), {
    appearance: { brightness: 0.3 },
  });
});

test('save acknowledgement preserves only edits made after submission', () => {
  const submitted = defaultSettings(),
    later = structuredClone(submitted),
    saved = structuredClone(submitted);
  submitted.appearance.brightness = 0.3;
  later.appearance.brightness = 0.3;
  saved.appearance.brightness = 0.3;
  later.appearance.fontScale = 1.3;
  saved.location.name = 'Concurrent manual city';
  const next = rebaseDraft(submitted, later, saved);
  assert.equal(next.location.name, 'Concurrent manual city');
  assert.deepEqual(settingsChanges(saved, next), {
    appearance: { fontScale: 1.3 },
  });
});

test('location edits submit one atomic selection while untouched location is omitted', () => {
  const base = defaultSettings(),
    draft = structuredClone(base);
  draft.locationSource = 'device';
  draft.location = {
    name: 'Device area',
    latitude: 12.3,
    longitude: 45.7,
    timezone: 'auto',
  };
  assert.deepEqual(settingsChanges(base, draft, true), {
    location: draft.location,
    locationSource: 'device',
    automaticLocation: true,
  });
  assert.deepEqual(settingsChanges(base, structuredClone(base)), {});
  draft.locationSource = base.locationSource;
  draft.location = structuredClone(base.location);
  draft.units = 'imperial';
  assert.deepEqual(settingsChanges(base, draft), { units: 'imperial' });
});

test('a pending city remains an atomic selection when another editor saves a location', () => {
  const base = defaultSettings(),
    draft = structuredClone(base),
    incoming = structuredClone(base);
  draft.location = {
    name: 'Pending city',
    latitude: 20,
    longitude: 30,
    timezone: 'Asia/Tokyo',
  };
  draft.locationSource = 'manual';
  incoming.location = {
    name: 'Other city',
    latitude: 40,
    longitude: 50,
    timezone: 'Europe/London',
  };
  incoming.locationSource = 'manual';
  incoming.appearance.fontScale = 1.2;
  const next = rebaseSettings(base, draft, incoming);
  assert.deepEqual(next.location, draft.location);
  assert.equal(next.appearance.fontScale, 1.2);
});

test('a density draft remains a valid atomic layout through a concurrent placement and visibility poll', () => {
  const base = defaultSettings(), draft = structuredClone(base), incoming = structuredClone(base);
  const compact = switchGridDensity(base.widgetGrid, 'spacious', base.widgets); assert.ok(compact);
  draft.widgetGrid = compact.grid;
  incoming.widgetGrid.placements.weather.row = 6;
  incoming.widgets.clock = false;
  incoming.appearance.brightness = 0.3;
  incoming.location.name = 'Concurrent city';
  incoming.preview.opacity = 0.15;
  assert.equal(gridProblem(incoming.widgetGrid, incoming.widgets), null, 'the incoming saved board is valid in its own density');
  const next = rebaseSettings(base, draft, incoming);
  assert.deepEqual(next.widgetGrid, draft.widgetGrid);
  assert.deepEqual(next.widgets, draft.widgets);
  assert.equal(gridProblem(next.widgetGrid, next.widgets), null);
  assert.equal(next.appearance.brightness, 0.3);
  assert.equal(next.location.name, 'Concurrent city');
  assert.equal(next.preview.opacity, 0.15, 'independent opacity refreshes normally');
  const back = switchGridDensity(next.widgetGrid, 'balanced', next.widgets, compact.history); assert.ok(back);
  assert.deepEqual(back.grid, base.widgetGrid, 'polling does not corrupt density round-trip history');
  assert.deepEqual(rebaseSettings(base, structuredClone(base), incoming), incoming, 'an untouched layout refreshes as a whole');
});

test('effective equality ignores object order, preset labels and disabled widget positions', () => {
  assert.equal(
    same({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }),
    true,
  );
  assert.equal(same([1, 2], [2, 1]), false);
  const base = defaultSettings(),
    draft = structuredClone(base);
  draft.appearance.preset = 'custom';
  draft.appearance.layout = 'minimal';
  draft.preview.widthPercent = 35;
  draft.widgetGrid.placements.photo = { column: 9, row: 4, size: 'small' };
  assert.equal(sameEffectiveSettings(base, draft), true);
  assert.deepEqual(settingsChanges(base, draft), {});
  draft.widgets.photo = true;
  assert.equal(sameEffectiveSettings(base, draft), false);
});

test('restoring a value removes dirty state despite a custom preset descriptor', () => {
  const base = defaultSettings(),
    draft = structuredClone(base);
  draft.appearance.preset = 'custom';
  draft.appearance.brightness = 0.3;
  assert.equal(sameEffectiveSettings(base, draft), false);
  draft.appearance.brightness = base.appearance.brightness;
  assert.equal(sameEffectiveSettings(base, draft), true);
  draft.units = 'imperial';
  assert.deepEqual(settingsChanges(base, draft), { units: 'imperial' });
});

test('widgetData edits submit a minimal patch with exact dirty detection and rebase', () => {
  const base = defaultSettings();
  const event = { id: '11111111-1111-4111-8111-111111111111', title: 'Synthetic', date: '2026-12-25', repeatsYearly: true };
  const listed = structuredClone(base);
  listed.widgetData.countdowns = [event];
  assert.equal(sameEffectiveSettings(base, listed), false);
  assert.deepEqual(settingsChanges(base, listed), { widgetData: { countdowns: [event] } }, 'lists are sent whole');
  const noted = structuredClone(base);
  noted.widgetData.note.text = 'Synthetic note';
  assert.deepEqual(settingsChanges(base, noted), { widgetData: { note: { text: 'Synthetic note' } } });
  const reverted = structuredClone(noted);
  reverted.widgetData.note.text = '';
  assert.equal(sameEffectiveSettings(base, reverted), true, 'reverting the edit is clean');
  assert.deepEqual(settingsChanges(base, reverted), {});
  const grown = structuredClone(listed);
  grown.widgetData.countdowns = [event, { ...event, id: '22222222-2222-4222-8222-222222222222' }];
  assert.deepEqual(settingsChanges(listed, grown), { widgetData: { countdowns: grown.widgetData.countdowns } });
  const incoming = structuredClone(base);
  incoming.widgetData.note.text = 'Saved elsewhere';
  incoming.widgetData.calendar.weekStart = 'monday';
  incoming.widgetData.countdowns = [{ ...event, title: 'Saved elsewhere' }];
  const next = rebaseSettings(base, listed, incoming);
  assert.deepEqual(next.widgetData.countdowns, [event], 'a local list edit survives');
  assert.equal(next.widgetData.note.text, 'Saved elsewhere');
  assert.equal(next.widgetData.calendar.weekStart, 'monday');
  assert.deepEqual(settingsChanges(incoming, next), { widgetData: { countdowns: [event] } });
});
