import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../shared/defaults.ts';
import { emptySchedule, MANUAL_OVERRIDE_MS } from '../shared/schedule.ts';
import { ScheduleStore, scheduleConfigSchema } from './schedule.ts';

const config = { enabled: true, fallbackPresetId: 'legacy-style', rules: [{ id: '00000000-0000-4000-8000-000000000001', presetId: 'legacy-style', days: [1], start: '22:00', end: '06:00' }] };
const settings = defaultSettings();

test('schedule reads, missing sidecar and automatic boundary catchup write no files; explicit saves persist independently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-schedule-'));
  try {
    const store = await ScheduleStore.open(directory);
    assert.deepEqual(store.snapshot(settings, 0).config, emptySchedule());
    assert.deepEqual(await readdir(directory), []);
    await store.configure(config, [store.revision]);
    const saved = await readFile(join(directory, 'schedule.json'), 'utf8');
    const revision = store.revision;
    const restarted = await ScheduleStore.open(directory);
    assert.deepEqual(restarted.snapshot(settings, Date.now()).config, config);
    store.snapshot(settings, 0); store.snapshot(settings, Date.now());
    assert.equal(store.revision, revision);
    assert.equal(await readFile(join(directory, 'schedule.json'), 'utf8'), saved);
    await assert.rejects(store.configure(emptySchedule(), ['stale']), { status: 409 });
    assert.equal(await readFile(join(directory, 'schedule.json'), 'utf8'), saved);
    await store.override(true, 1000, [revision]);
    const override = await ScheduleStore.open(directory);
    assert.equal(override.snapshot(settings, 1001).selection.source, 'override');
    assert.equal(override.snapshot(settings, 1000 + MANUAL_OVERRIDE_MS).overrideUntil, null);
    await override.restore(config, [override.revision]);
    assert.equal(override.snapshot(settings, 1001).overrideUntil, null, 'schedule restore never revives a temporary override');
    await override.configure(emptySchedule(), null);
    await assert.rejects(override.override(true, 1000, null), { status: 409 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid schedules remain untouched until deliberate replacement; failed writes preserve saved configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-schedule-'));
  try {
    await writeFile(join(directory, 'schedule.json'), 'unreadable synthetic schedule');
    const store = await ScheduleStore.open(directory);
    assert.ok(store.warning);
    assert.equal(await readFile(join(directory, 'schedule.json'), 'utf8'), 'unreadable synthetic schedule');
    await store.configure(config, null);
    const corrupt = (await readdir(directory)).find(name => name.startsWith('schedule.corrupt-'))!;
    assert.equal(await readFile(join(directory, corrupt), 'utf8'), 'unreadable synthetic schedule');
    const saved = await readFile(join(directory, 'schedule.json'), 'utf8');
    const failing = await ScheduleStore.open(directory, { rename: async (from, to) => { if (to.endsWith('schedule.json')) throw new Error('synthetic disk failure'); await rename(from, to); } });
    await assert.rejects(failing.configure(emptySchedule(), null), /synthetic disk failure/);
    assert.deepEqual(failing.snapshot(settings, 0).config, config);
    assert.equal(await readFile(join(directory, 'schedule.json'), 'utf8'), saved);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('schedule validation permits legacy style IDs but rejects invalid clocks, empty weekdays, duplicate IDs and unknown fields', () => {
  assert.equal(scheduleConfigSchema.safeParse(config).success, true);
  for (const row of [{ ...config.rules[0], start: '24:00' }, { ...config.rules[0], days: [] }, { ...config.rules[0], days: [1, 1] }, { ...config.rules[0], days: [7] }]) assert.equal(scheduleConfigSchema.safeParse({ ...config, rules: [row] }).success, false);
  assert.equal(scheduleConfigSchema.safeParse({ ...config, rules: [config.rules[0], config.rules[0]] }).success, false);
  assert.equal(scheduleConfigSchema.safeParse({ ...config, visual: settings }).success, false);
});
