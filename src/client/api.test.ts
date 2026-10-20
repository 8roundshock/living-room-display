import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';
import { ApiError, NETWORK_ERROR_MESSAGE, api, apiTagged, isNetworkError, rememberRevision, revisionOf, settingsConflict } from './api.ts';
import { defaultSettings } from '../shared/defaults.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function respond(handler: (init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => handler(init)) as typeof fetch;
}

test('a server error carries its HTTP status and the server message (#142)', async () => {
  respond(() => Response.json({ error: 'Restore this reminder before editing it.' }, { status: 409 }));
  const error = await api('/api/reminders/1', { method: 'PATCH' }).catch((caught: unknown) => caught);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.message, 'Restore this reminder before editing it.');
  assert.equal(error.network, false);
  // Recognised by status even when the wording changes.
  respond(() => Response.json({ error: 'Different wording' }, { status: 409 }));
  const reworded = await api('/api/reminders/1').catch((caught: unknown) => caught);
  assert.ok(reworded instanceof ApiError && reworded.status === 409);
});

test('an error reply without a JSON message names the status', async () => {
  respond(() => new Response('<html>Bad gateway</html>', { status: 502 }));
  const error = await api('/api/state').catch((caught: unknown) => caught);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 502);
  assert.equal(error.message, 'The local server returned 502.');
});

test('a fetch that never reaches the server becomes a clear network error (#232)', async () => {
  respond(() => Promise.reject(new TypeError('Failed to fetch')));
  const error = await api('/api/settings', { method: 'PATCH' }).catch((caught: unknown) => caught);
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 0);
  assert.equal(error.network, true);
  assert.equal(isNetworkError(error), true);
  assert.equal(error.message, NETWORK_ERROR_MESSAGE);
  assert.doesNotMatch(error.message, /Failed to fetch|still|Living Room/i);
  assert.ok(error.cause instanceof TypeError, 'the original failure stays available');
  // An abort the caller did not ask for (the connection was torn down) is the same failure.
  respond(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')));
  const aborted = await api('/api/state').catch((caught: unknown) => caught);
  assert.ok(aborted instanceof ApiError && aborted.network);
  // A connection lost while the body arrives is also a network failure.
  respond(() => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network error')); } }), { status: 200 }));
  const cut = await api('/api/state').catch((caught: unknown) => caught);
  assert.ok(cut instanceof ApiError && cut.network);
});

test("a caller's own cancellation is passed through untouched", async () => {
  const controller = new AbortController();
  respond((init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = api('/api/locations?q=Lo', { signal: controller.signal }).catch((caught: unknown) => caught);
  controller.abort();
  const error = await pending;
  assert.ok(!(error instanceof ApiError));
  assert.equal((error as DOMException).name, 'AbortError');
  assert.equal(isNetworkError(error), false);
});

test('successful replies parse JSON and 204 returns nothing', async () => {
  respond(() => Response.json({ ok: true }));
  assert.deepEqual(await api('/api/health'), { ok: true });
  respond(() => new Response(null, { status: 204 }));
  assert.equal(await api('/api/reminders/1', { method: 'DELETE' }), undefined);
  respond(() => new Response('not json', { status: 200 }));
  const unreadable = await api('/api/state').catch((caught: unknown) => caught);
  assert.ok(unreadable instanceof ApiError && !unreadable.network && unreadable.status === 200);
});

test('a reply carries its entity tag: the settings revision (#287)', async () => {
  respond(() => Response.json({ ok: true }, { headers: { ETag: '"abc-1"' } }));
  assert.deepEqual(await apiTagged('/api/state'), { body: { ok: true }, etag: '"abc-1"' });
  respond(() => Response.json({ ok: true }));
  assert.deepEqual(await apiTagged('/api/state'), { body: { ok: true }, etag: null });
  const settings = defaultSettings(), other = defaultSettings();
  rememberRevision(settings, '"abc-1"'); rememberRevision(other, null);
  assert.equal(revisionOf(settings), '"abc-1"');
  assert.equal(revisionOf(structuredClone(settings)), null, 'a revision belongs to the settings object it arrived with');
  assert.equal(revisionOf(other), null);
});

test('a stale settings Save is recognised by its 409 reply with the current settings (#287)', async () => {
  const current = defaultSettings(); current.units = 'imperial';
  respond(() => Response.json({ error: 'Settings changed in another window. Review and save again.', settings: current, revision: 'abc-2' }, { status: 409, headers: { ETag: '"abc-2"' } }));
  const error = await api('/api/settings', { method: 'PATCH' }).catch((caught: unknown) => caught);
  assert.ok(error instanceof ApiError && error.status === 409);
  assert.equal(error.etag, '"abc-2"');
  const conflict = settingsConflict(error);
  assert.ok(conflict);
  assert.equal(conflict.etag, '"abc-2"'); assert.equal(conflict.settings.units, 'imperial');
  assert.equal(conflict.message, 'Settings changed in another window. Review and save again.');
  // Without the header the body's revision is quoted; other 409s are not settings conflicts.
  assert.equal(settingsConflict(new ApiError(409, 'x', undefined, { body: { settings: current, revision: 'abc-3' } }))?.etag, '"abc-3"');
  assert.equal(settingsConflict(new ApiError(409, 'Reminder limit reached', undefined, { body: { error: 'Reminder limit reached' } })), null);
  assert.equal(settingsConflict(new ApiError(500, 'x', undefined, { body: { settings: current, revision: 'abc-3' } })), null);
  assert.equal(settingsConflict(new Error('x')), null);
});
