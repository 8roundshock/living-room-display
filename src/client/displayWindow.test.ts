import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { leaveDisplay, liveOpener, RETIRE_CARD_DELAY_MS } from './displayWindow.ts';

function windowFixture() {
  const navigations: string[] = [], timers: { callback: () => void; delay: number }[] = [];
  let closes = 0, focuses = 0;
  const opener = { closed: false, location: { origin: 'http://127.0.0.1:12345' }, focus() { focuses++; } };
  const page = {
    opener: opener as typeof opener | null,
    closed: false,
    location: { origin: opener.location.origin, assign(path: string) { navigations.push(path); } },
    close() { closes++; page.closed = true; },
    setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); return timers.length; },
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: page, configurable: true });
  return {
    page, opener, navigations, timers,
    get closes() { return closes; }, get focuses() { return focuses; },
    restore() { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); },
  };
}

test('#480 an editor-opened display still closes after its opener has closed or disappeared', () => {
  for (const missing of [false, true]) {
    const fixture = windowFixture();
    try {
      fixture.opener.closed = true;
      if (missing) fixture.page.opener = null;
      assert.equal(liveOpener(), null);
      leaveDisplay('/editor', true);
      assert.equal(fixture.closes, 1);
      assert.equal(fixture.focuses, 0, 'do not focus the closed editor');
      fixture.timers.forEach(timer => timer.callback());
      assert.deepEqual(fixture.navigations, [], 'closing must not create a replacement editor');
    } finally { fixture.restore(); }
  }
});

test('#480 a live editor is focused before closing its display', () => {
  const fixture = windowFixture();
  try {
    fixture.page.close = () => { assert.equal(fixture.focuses, 1); fixture.page.closed = true; };
    leaveDisplay();
    assert.equal(fixture.page.closed, true);
    fixture.timers.forEach(timer => timer.callback());
    assert.deepEqual(fixture.navigations, []);
  } finally { fixture.restore(); }
});

test('#480 a directly opened display follows its destination without trying to close', () => {
  const fixture = windowFixture();
  try {
    fixture.page.opener = null;
    leaveDisplay('/');
    assert.equal(fixture.closes, 0);
    assert.deepEqual(fixture.navigations, ['/']);
    assert.equal(fixture.timers.length, 0);
  } finally { fixture.restore(); }
});

test('#480 a refused close falls back to the requested destination after the close grace period', () => {
  for (const throws of [false, true]) {
    const fixture = windowFixture();
    try {
      fixture.page.opener = null;
      fixture.page.close = () => { if (throws) throw new Error('Synthetic close refusal'); };
      leaveDisplay('/', true);
      assert.deepEqual(fixture.navigations, []);
      assert.equal(fixture.timers[0]?.delay, RETIRE_CARD_DELAY_MS);
      fixture.timers.forEach(timer => timer.callback());
      assert.deepEqual(fixture.navigations, ['/']);
    } finally { fixture.restore(); }
  }
});
