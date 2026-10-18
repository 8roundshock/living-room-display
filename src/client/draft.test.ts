import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import { rebaseDraft, rebaseSettings, settingsChanges } from './draft.ts';

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
