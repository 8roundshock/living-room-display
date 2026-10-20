// Silent timers (#438) in the timers.json sidecar: synthetic data in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { DataStore } from './store.ts';
import { TIMERS_CORRUPT_FILE, TIMERS_FILE, TimerError, TimerStore } from './timers.ts';
import { KEEP_DONE_MS, TIMER_MESSAGES } from '../shared/timers.ts';
import type { Timer } from '../shared/contracts.ts';

const START = Date.parse('2026-10-20T22:00:00.000Z');

async function folder() { return mkdtemp(join(tmpdir(), 'lrd-timers-')); }
async function hash(directory: string, name: string): Promise<string | null> {
  try { return createHash('sha256').update(await readFile(join(directory, name))).digest('hex'); } catch { return null; }
}
async function application(directory: string, clock: { now: number }) {
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()), now: () => clock.now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const send = async (method: string, path: string, value?: unknown) => {
    const response = await fetch(`${url}${path}`, value === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { ...app, url, send, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); } };
}

test('#438 timers start, pause, resume, add time, restart and delete through the API, in timers.json only', async () => {
  const directory = await folder(), clock = { now: START };
  const app = await application(directory, clock);
  try {
    // A settings write first, so both state files exist; timer actions must never touch them.
    assert.equal((await app.send('PATCH', '/api/settings', { clockFormat: '24h' })).status, 200);
    const state = await hash(directory, 'state.json'), backup = await hash(directory, 'state.backup.json');
    const created = await app.send('POST', '/api/timers', { label: '  Pasta  ', durationMs: 600_000 });
    assert.equal(created.status, 201);
    const pasta: Timer = created.body;
    assert.equal(pasta.label, 'Pasta');
    assert.equal(pasta.endsAt, new Date(START + 600_000).toISOString());
    assert.equal(pasta.remainingMs, null);
    const stored = JSON.parse(await readFile(join(directory, TIMERS_FILE), 'utf8'));
    assert.deepEqual(stored, { version: 1, timers: [pasta] });

    clock.now = START + 120_000;
    const paused = await app.send('PATCH', `/api/timers/${pasta.id}`, { paused: true });
    assert.equal(paused.status, 200);
    assert.deepEqual([paused.body.endsAt, paused.body.remainingMs], [null, 480_000], 'a pause keeps what was left');
    // A repeated pause changes nothing and writes nothing.
    const file = await hash(directory, TIMERS_FILE);
    clock.now = START + 300_000;
    assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, { paused: true })).body.remainingMs, 480_000);
    assert.equal(await hash(directory, TIMERS_FILE), file, 'a no-op leaves the file unchanged');
    const added = await app.send('PATCH', `/api/timers/${pasta.id}`, { addMs: 60_000 });
    assert.equal(added.body.remainingMs, 540_000, 'adding to a paused timer adds to what is left');
    const resumed = await app.send('PATCH', `/api/timers/${pasta.id}`, { paused: false });
    assert.deepEqual([resumed.body.endsAt, resumed.body.remainingMs], [new Date(START + 300_000 + 540_000).toISOString(), null]);
    const resumedFile = await hash(directory, TIMERS_FILE);
    assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, { paused: false })).status, 200);
    assert.equal(await hash(directory, TIMERS_FILE), resumedFile, 'resuming a running timer writes nothing');
    assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, { addMs: 60_000 })).body.endsAt, new Date(START + 900_000).toISOString());

    // Done: pause and resume are refused, add time runs it again, restart starts its length over.
    clock.now = START + 900_000;
    for (const paused of [true, false]) {
      const refused = await app.send('PATCH', `/api/timers/${pasta.id}`, { paused });
      assert.deepEqual([refused.status, refused.body.error], [409, TIMER_MESSAGES.finished]);
    }
    clock.now = START + 1_000_000;
    assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, { addMs: 60_000 })).body.endsAt, new Date(START + 1_060_000).toISOString());
    clock.now = START + 2_000_000;
    const restarted = await app.send('PATCH', `/api/timers/${pasta.id}`, { restart: true });
    assert.equal(restarted.body.endsAt, new Date(START + 2_600_000).toISOString(), 'restart runs the length it was started with');
    assert.equal(restarted.body.durationMs, 600_000);

    // Over 24 hours in total is refused; an unknown id is 404; a request needs exactly one action.
    assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, { addMs: 3_600_000 })).status, 200, 'an hour more stays under 24 hours');
    const long = await app.send('POST', '/api/timers', { durationMs: 86_400_000 - 1000 });
    const over = await app.send('PATCH', `/api/timers/${long.body.id}`, { addMs: 60_000 });
    assert.deepEqual([over.status, over.body.error], [400, TIMER_MESSAGES.total]);
    const missing = await app.send('PATCH', `/api/timers/${randomUUID()}`, { paused: true });
    assert.deepEqual([missing.status, missing.body.error], [404, TIMER_MESSAGES.notFound]);
    for (const patch of [{}, { paused: true, addMs: 1000 }, { restart: false }, { addMs: 500 }, { addMs: 3_600_001 }, { paused: 'yes' }])
      assert.equal((await app.send('PATCH', `/api/timers/${pasta.id}`, patch)).status, 400, JSON.stringify(patch));

    assert.equal((await app.send('DELETE', `/api/timers/${pasta.id}`)).status, 204);
    assert.equal((await app.send('DELETE', `/api/timers/${pasta.id}`)).status, 404);
    assert.deepEqual((await app.send('GET', '/api/timers')).body, { timers: [JSON.parse(await readFile(join(directory, TIMERS_FILE), 'utf8')).timers[0]], warning: null });
    assert.equal(await hash(directory, 'state.json'), state, 'timer actions never write state.json');
    assert.equal(await hash(directory, 'state.backup.json'), backup, 'timer actions never rotate state.backup.json');
    const exported = await (await fetch(`${app.url}/api/export`)).text();
    assert.equal(exported.includes('timers'), false, 'exports carry no timers');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 timer creation validates its length, label, limit and the Undo fields', async () => {
  const directory = await folder(), clock = { now: START };
  const app = await application(directory, clock);
  try {
    for (const durationMs of [0, 999, 86_400_001, 1500.5, '600000', null]) {
      const refused = await app.send('POST', '/api/timers', { durationMs });
      assert.deepEqual([refused.status, refused.body.error], [400, TIMER_MESSAGES.range], String(durationMs));
    }
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, label: 'x'.repeat(41) })).status, 400);
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, sound: true })).status, 400, 'unknown fields are rejected');
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, endsAt: new Date(START + 1000).toISOString(), remainingMs: 1000 })).status, 400);
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, endsAt: new Date(START - KEEP_DONE_MS - 1).toISOString() })).status, 400);
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, endsAt: new Date(START + 86_400_001).toISOString() })).status, 400);
    assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000, remainingMs: 60_001 })).status, 400);
    const response = await fetch(`${app.url}/api/timers`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"durationMs":60000}' });
    assert.equal(response.status, 415);

    // Undo re-creates a cancelled timer as it was: running with its end, or paused with its remainder.
    const running = await app.send('POST', '/api/timers', { durationMs: 300_000, endsAt: new Date(START + 42_000).toISOString() });
    assert.deepEqual([running.status, running.body.endsAt, running.body.remainingMs], [201, new Date(START + 42_000).toISOString(), null]);
    const paused = await app.send('POST', '/api/timers', { durationMs: 300_000, label: 'Tea', remainingMs: 12_000 });
    assert.deepEqual([paused.body.endsAt, paused.body.remainingMs], [null, 12_000]);
    for (let index = 0; index < 4; index++) assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000 })).status, 201);
    const full = await app.send('POST', '/api/timers', { durationMs: 60_000 });
    assert.deepEqual([full.status, full.body.error], [409, TIMER_MESSAGES.limit]);

    // Dismissing every finished timer at once.
    clock.now = START + 61_000;
    assert.deepEqual((await app.send('DELETE', '/api/timers/finished')).body, { deleted: 5 }, 'four one-minute timers and the Undo one finished');
    const unchanged = await hash(directory, TIMERS_FILE);
    assert.deepEqual((await app.send('DELETE', '/api/timers/finished')).body, { deleted: 0 });
    assert.equal(await hash(directory, TIMERS_FILE), unchanged, 'nothing to dismiss writes nothing');
    assert.deepEqual((await app.send('GET', '/api/timers')).body.timers.map((item: Timer) => item.label), ['Tea']);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 timers survive a restart; finished ones older than an hour are pruned once, then reads never write', async () => {
  const directory = await folder(), clock = { now: START };
  let app = await application(directory, clock);
  try {
    const kept = (await app.send('POST', '/api/timers', { durationMs: 600_000, label: 'Laundry' })).body as Timer;
    const old = (await app.send('POST', '/api/timers', { durationMs: 60_000 })).body as Timer;
    clock.now = START + 120_000;
    await app.send('PATCH', `/api/timers/${kept.id}`, { paused: true });
    await app.close();
    // Restarted 2 hours later: the paused one keeps what was left; the finished one is pruned on load.
    clock.now = START + 2 * 3_600_000;
    app = await application(directory, clock);
    const after = (await app.send('GET', '/api/state')).body;
    assert.deepEqual(after.timers.map((item: Timer) => [item.id, item.remainingMs]), [[kept.id, 480_000]]);
    assert.equal(after.timersWarning, null);
    const file = JSON.parse(await readFile(join(directory, TIMERS_FILE), 'utf8'));
    assert.deepEqual(file.timers.map((item: Timer) => item.id), [kept.id], 'the prune was written once');
    assert.equal(file.timers.some((item: Timer) => item.id === old.id), false);
    const pruned = await hash(directory, TIMERS_FILE);
    await app.send('GET', '/api/timers'); await app.send('GET', '/api/state');
    assert.equal(await hash(directory, TIMERS_FILE), pruned, 'reads never write');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('#438 an unreadable timers.json moves aside with a warning and never touches state.json', async () => {
  for (const content of ['{not json', JSON.stringify({ version: 1, timers: [{ id: 'not-a-uuid' }] }), JSON.stringify({ version: 2, timers: [] })]) {
    const directory = await folder(), clock = { now: START };
    try {
      await (await DataStore.open(directory)).patchSettings({ units: 'imperial' });
      const state = await hash(directory, 'state.json');
      await writeFile(join(directory, TIMERS_FILE), content);
      const app = await application(directory, clock);
      try {
        const result = (await app.send('GET', '/api/timers')).body;
        assert.deepEqual(result, { timers: [], warning: TIMER_MESSAGES.cleared });
        assert.equal((await app.send('GET', '/api/state')).body.timersWarning, TIMER_MESSAGES.cleared);
        assert.equal(await readFile(join(directory, TIMERS_CORRUPT_FILE), 'utf8'), content, 'the unreadable file is kept aside');
        assert.equal(await hash(directory, TIMERS_FILE), null);
        assert.equal(await hash(directory, 'state.json'), state);
        // The next timer write replaces it and clears the warning.
        assert.equal((await app.send('POST', '/api/timers', { durationMs: 60_000 })).status, 201);
        assert.equal((await app.send('GET', '/api/timers')).body.warning, null);
      } finally { await app.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('#438 startup removes stale timers.json temporary files', async () => {
  const directory = await folder();
  try {
    const stale = `${TIMERS_FILE}.${randomUUID()}.tmp`, unrelated = 'timers.json.keep.tmp';
    await writeFile(join(directory, stale), 'partial');
    await writeFile(join(directory, unrelated), 'not ours');
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(join(directory, stale), old, old);
    await DataStore.open(directory);
    const names = await readdir(directory);
    assert.equal(names.includes(stale), false, 'an interrupted timers write is removed');
    assert.equal(names.includes(unrelated), true, 'only atomicWrite names match');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('#438 the timer store serializes writes, counts them and refuses an unknown id with 404', async () => {
  const directory = await folder();
  try {
    const store = await TimerStore.open(directory, START);
    assert.equal(store.changes, 0);
    const created = await Promise.all(Array.from({ length: 6 }, (_, index) => store.create({ durationMs: 60_000 * (index + 1) }, START)));
    assert.equal(new Set(created.map(item => item.id)).size, 6);
    assert.equal(store.changes, 6);
    await assert.rejects(store.create({ durationMs: 60_000 }, START), (error: unknown) => error instanceof TimerError && error.status === 409);
    await assert.rejects(store.remove(randomUUID(), START), (error: unknown) => error instanceof TimerError && error.status === 404);
    assert.equal(store.changes, 6, 'refusals write nothing');
    const reopened = await TimerStore.open(directory, START);
    assert.equal(reopened.list(START).length, 6);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
