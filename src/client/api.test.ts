import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';
import { ApiError, NETWORK_ERROR_MESSAGE, api, isNetworkError } from './api.ts';

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
