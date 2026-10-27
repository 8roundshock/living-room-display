import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayPresence, DISPLAY_PRESENCE_MS } from './display-presence.ts';

test('a lost display heartbeat fails closed without resuming or clearing another view', () => {
  let now = 100; const presence = new DisplayPresence(() => now);
  const first = presence.start()!, second = presence.start()!;
  const revision = presence.revision;
  now += DISPLAY_PRESENCE_MS;
  assert.deepEqual(presence.status(), { paused: true, needsResume: true });
  assert.equal(presence.heartbeat(first), false);
  assert.equal(presence.revision, revision, 'expiry cannot resume capture');
  assert.equal(presence.release(first), true); assert.equal(presence.paused, true);
  assert.equal(presence.release(second), true); assert.equal(presence.paused, false);
  assert.notEqual(presence.revision, revision, 'uploads spanning a display are fenced');
});
test('only a valid live heartbeat extends presence; entries are bounded and explicit recovery clears them', () => {
  let now = 0; const presence = new DisplayPresence(() => now);
  const id = presence.start()!; now += 5_000;
  assert.equal(presence.heartbeat(id), true);
  assert.equal(presence.heartbeat('other'), false);
  for (let i = 0; i < 7; i++) assert.ok(presence.start());
  assert.equal(presence.start(), null);
  presence.resume(); assert.equal(presence.paused, false);
});
