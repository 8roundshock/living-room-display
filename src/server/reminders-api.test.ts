// Reminder check-off and local history (#73). Synthetic reminders in temporary folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app.ts';
import { forecastFixture } from './fixtures.ts';
import { assertPreviousReaderAccepts } from './compat/previous-reader.ts';
import { REMINDER_HISTORY_LIMIT, REMINDER_LIMIT } from '../shared/reminders.ts';
import type { Reminder } from '../shared/contracts.ts';

async function fixture(now?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'lrd-reminders-'));
  const app = await createApplication({ dataDirectory: directory, fetcher: async () => Response.json(forecastFixture()), now });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  return { ...app, directory, url: `http://127.0.0.1:${address.port}`, async close() { app.server.closeAllConnections(); app.server.close(); await once(app.server, 'close'); await rm(directory, { recursive: true, force: true }); } };
}
function body(value: unknown) { return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }; }
function clock(start = Date.parse('2026-10-18T13:00:00Z')) {
  let current = start;
  return { now: () => current, advance(ms: number) { current += ms; }, iso(offset = 0) { return new Date(current + offset).toISOString(); } };
}
function reminder(index: number, completed: boolean, base: number): Reminder {
  const created = new Date(base + index * 1000).toISOString();
  return { id: randomUUID(), text: `Synthetic ${completed ? 'done' : 'open'} ${index}`, completed, dueAt: null, createdAt: created, updatedAt: completed ? new Date(base + 1e6 + index * 1000).toISOString() : created };
}
type App = Awaited<ReturnType<typeof fixture>>;
const patch = (app: App, id: string, value: unknown) => fetch(`${app.url}/api/reminders/${id}`, { method: 'PATCH', ...body(value) });
const create = async (app: App, value: unknown) => { const response = await fetch(`${app.url}/api/reminders`, { method: 'POST', ...body(value) }); assert.equal(response.status, 201); return await response.json() as Reminder; };
async function files(app: App) {
  return { state: await readFile(join(app.directory, 'state.json'), 'utf8'), backup: await readFile(join(app.directory, 'state.backup.json'), 'utf8') };
}
async function assertPreviousReads(app: App, label: string) {
  const { state, backup } = await files(app);
  assertPreviousReaderAccepts('data', JSON.parse(state), `${label} state.json`);
  assertPreviousReaderAccepts('data', JSON.parse(backup), `${label} state.backup.json`);
  assertPreviousReaderAccepts('import', await (await fetch(`${app.url}/api/export`)).json(), `${label} export`);
}

test('completing records the completion time once; repeats and no-op patches write nothing', async () => {
  const time = clock(); const app = await fixture(time.now);
  try {
    const created = await create(app, { text: 'Water the plants', dueAt: '2026-10-19T15:00:00.000Z' });
    time.advance(60_000);
    const completed = await patch(app, created.id, { completed: true });
    assert.equal(completed.status, 200);
    const done = await completed.json() as Reminder;
    assert.equal(done.completed, true); assert.equal(done.updatedAt, time.iso(), 'completion time is updatedAt');
    const before = await files(app);
    time.advance(60_000);
    const repeated = await patch(app, created.id, { completed: true });
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), done, 'a retry or double tap keeps the original completion time');
    assert.deepEqual(await patch(app, created.id, { completed: true, text: 'Water the plants', dueAt: '2026-10-19T15:00:00.000Z' }).then(response => response.json()), done, 'equal fields are not edits');
    assert.deepEqual(await files(app), before, 'no write, no backup rotation');
    const open = await create(app, { text: 'Read a chapter' });
    time.advance(60_000);
    const same = await patch(app, open.id, { text: 'Read a chapter', dueAt: null });
    assert.equal(same.status, 200); assert.deepEqual(await same.json(), open, 'an unchanged pending patch keeps updatedAt');
    await assertPreviousReads(app, 'after completion');
  } finally { await app.close(); }
});

test('completed reminders are immutable until restored; restore can edit in the same patch', async () => {
  const time = clock(); const app = await fixture(time.now);
  try {
    const created = await create(app, { text: 'Call a friend', dueAt: '2026-10-19T15:00:00.000Z' });
    time.advance(1000);
    const done = await (await patch(app, created.id, { completed: true })).json() as Reminder;
    for (const edit of [{ text: 'Changed' }, { dueAt: null }, { dueAt: '2026-10-20T15:00:00.000Z' }, { completed: true, text: 'Changed' }]) {
      const response = await patch(app, created.id, edit);
      assert.equal(response.status, 409, JSON.stringify(edit));
      assert.deepEqual(await response.json(), { error: 'Restore this reminder before editing it.' });
    }
    assert.deepEqual(app.store.snapshot().reminders.find(item => item.id === created.id), done, 'the rejected edits change nothing');
    time.advance(1000);
    const restored = await (await patch(app, created.id, { completed: false })).json() as Reminder;
    assert.equal(restored.completed, false); assert.equal(restored.updatedAt, time.iso());
    time.advance(1000);
    const edited = await patch(app, created.id, { text: 'Call a friend tonight' });
    assert.equal(edited.status, 200); assert.equal((await edited.json() as Reminder).text, 'Call a friend tonight');
    await patch(app, created.id, { completed: true });
    const combined = await patch(app, created.id, { completed: false, text: 'Restored and renamed', dueAt: null });
    assert.equal(combined.status, 200);
    assert.deepEqual({ ...(await combined.json() as Reminder), id: '', createdAt: '', updatedAt: '' }, { id: '', text: 'Restored and renamed', completed: false, dueAt: null, createdAt: '', updatedAt: '' });
    assert.equal((await patch(app, randomUUID(), { completed: true })).status, 404);
  } finally { await app.close(); }
});

test('DELETE /api/reminders/completed clears history only, atomically, behind the normal origin checks', async () => {
  const time = clock(); const app = await fixture(time.now);
  try {
    const kept = await create(app, { text: 'Keep me' });
    for (const text of ['Done one', 'Done two', 'Done three']) { const item = await create(app, { text }); await patch(app, item.id, { completed: true }); }
    const foreign = await fetch(`${app.url}/api/reminders/completed`, { method: 'DELETE', headers: { Origin: 'http://example.test' } });
    assert.equal(foreign.status, 403);
    assert.equal(app.store.snapshot().reminders.length, 4);
    const cleared = await fetch(`${app.url}/api/reminders/completed`, { method: 'DELETE' });
    assert.equal(cleared.status, 200); assert.deepEqual(await cleared.json(), { deleted: 3 });
    assert.deepEqual(app.store.snapshot().reminders, [kept]);
    assert.deepEqual(await (await fetch(`${app.url}/api/reminders/completed`, { method: 'DELETE' })).json(), { deleted: 0 });
    assert.equal((await fetch(`${app.url}/api/reminders/completed`, { method: 'PATCH', ...body({ completed: true }) })).status, 404, 'cannot collide with the id route');
    await assertPreviousReads(app, 'after clear');
  } finally { await app.close(); }
});

test('history keeps the newest 500 completed; the 501st completion prunes the oldest', async () => {
  const time = clock(); const app = await fixture(time.now);
  try {
    const base = Date.parse('2026-01-01T00:00:00Z');
    const completed = Array.from({ length: REMINDER_HISTORY_LIMIT }, (_, index) => reminder(index, true, base));
    const pending = Array.from({ length: 3 }, (_, index) => reminder(index, false, base));
    await app.store.update(data => { data.reminders = [...completed, ...pending]; });
    const response = await patch(app, pending[0]!.id, { completed: true });
    assert.equal(response.status, 200);
    const stored = app.store.snapshot().reminders;
    assert.equal(stored.filter(item => item.completed).length, REMINDER_HISTORY_LIMIT);
    assert.equal(stored.some(item => item.id === completed[0]!.id), false, 'the oldest completion is pruned');
    assert.equal(stored.some(item => item.id === completed[1]!.id), true);
    assert.equal(stored.find(item => item.id === pending[0]!.id)?.completed, true);
    assert.deepEqual(stored.filter(item => !item.completed).map(item => item.id), pending.slice(1).map(item => item.id), 'pending reminders are never pruned');
    await assertPreviousReads(app, 'after pruning');
  } finally { await app.close(); }
});

test('a full store drops its oldest completed reminder for a new one, and refuses when all are pending', async () => {
  const time = clock(); const app = await fixture(time.now);
  try {
    const base = Date.parse('2026-01-01T00:00:00Z');
    const history = Array.from({ length: 10 }, (_, index) => reminder(index, true, base));
    const open = Array.from({ length: REMINDER_LIMIT - 10 }, (_, index) => reminder(index, false, base));
    await app.store.update(data => { data.reminders = [...open.slice(0, 400), ...history, ...open.slice(400)]; });
    const created = await create(app, { text: 'One more' });
    const stored = app.store.snapshot().reminders;
    assert.equal(stored.length, REMINDER_LIMIT);
    assert.equal(stored.some(item => item.id === history[0]!.id), false, 'the oldest completed made way');
    assert.equal(stored.at(-1)?.id, created.id);
    assert.equal(stored.filter(item => !item.completed).length, REMINDER_LIMIT - 9);
    await assertPreviousReads(app, 'full store');
    await app.store.update(data => { data.reminders = Array.from({ length: REMINDER_LIMIT }, (_, index) => reminder(index, false, base)); });
    const refused = await fetch(`${app.url}/api/reminders`, { method: 'POST', ...body({ text: 'No room' }) });
    assert.equal(refused.status, 409); assert.deepEqual(await refused.json(), { error: 'Reminder limit reached' });
    assert.equal(app.store.snapshot().reminders.length, REMINDER_LIMIT);
  } finally { await app.close(); }
});

test('history travels through export/import unchanged; oversize imported history prunes at the next completion', async () => {
  const time = clock(); const source = await fixture(time.now); const target = await fixture(time.now);
  try {
    const kept = await create(source, { text: 'Pending item', dueAt: '2026-10-20T12:00:00.000Z' });
    const finished = await create(source, { text: 'Finished item' });
    time.advance(5000);
    await patch(source, finished.id, { completed: true });
    const exported = await (await fetch(`${source.url}/api/export`)).json() as { reminders: Reminder[] };
    assertPreviousReaderAccepts('import', exported, 'history export');
    assert.equal((await fetch(`${target.url}/api/import`, { method: 'POST', ...body(exported) })).status, 200);
    assert.deepEqual(target.store.snapshot().reminders, source.store.snapshot().reminders, 'completion times survive the round trip');
    assert.equal(target.store.snapshot().reminders.find(item => item.id === kept.id)?.completed, false);
    await assertPreviousReads(target, 'after import');

    const base = Date.parse('2026-01-01T00:00:00Z');
    const oversized = { ...exported, reminders: [...Array.from({ length: REMINDER_HISTORY_LIMIT + 20 }, (_, index) => reminder(index, true, base)), reminder(0, false, base)] };
    assert.equal((await fetch(`${target.url}/api/import`, { method: 'POST', ...body(oversized) })).status, 200);
    assert.equal(target.store.snapshot().reminders.length, REMINDER_HISTORY_LIMIT + 21, 'imports are accepted as is');
    await patch(target, oversized.reminders.at(-1)!.id, { completed: true });
    assert.equal(target.store.snapshot().reminders.filter(item => item.completed).length, REMINDER_HISTORY_LIMIT);
    await assertPreviousReads(target, 'after oversize import and prune');
  } finally { await source.close(); await target.close(); }
});
