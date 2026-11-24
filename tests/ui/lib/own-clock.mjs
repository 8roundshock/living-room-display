import assert from 'node:assert/strict';
import { mockScreenWakeLock, mockWindowsStatus } from './windows-fixture.mjs';

/**
 * A display page with a paused clock of its own, for a widget check's sweep in the widgets suite (#741).
 *
 * The suite's main page clock is shared by every check and moves only when a check runs it. The harness puts it
 * back to its start before each sweep, but inside a sweep every case adds to it: an offline case alone needs the
 * 30 s state poll, and one sweep of such cases spent 25 minutes, so its later cases ran on a late clock and their
 * ages had moved. Playwright's clock belongs to a browser context (#431), so a sweep that has to run time takes a
 * context of its own. The main clock never moves for it, and `restart()` puts its own clock back to `now` before
 * a render, so every age in the sweep is exact.
 *
 * The context serves `state` at /api/state, read at each request (a sweep edits the object in place), or a 503
 * while `setOffline(true)`. `run(own, { setOffline, restart })` gets the page; its result is returned, a page
 * error fails the sweep, and the main page is in front again afterwards (Chromium delays frames in a background
 * tab, and the checks that follow wait on real frames).
 */
export async function withOwnClock(page, { viewport, state, now }, run) {
  const context = await page.context().browser().newContext({ viewport, timezoneId: 'America/Toronto', reducedMotion: 'reduce' });
  let offline = false;
  const errors = [];
  try {
    await mockWindowsStatus(context); await mockScreenWakeLock(context);
    await context.route('**/api/state', route => route.fulfill(offline
      ? { status: 503, contentType: 'application/json', body: '{"error":"Synthetic offline"}' }
      : { contentType: 'application/json', body: JSON.stringify(state) }));
    const own = await context.newPage();
    own.on('pageerror', error => errors.push(error.message));
    await own.clock.install({ time: new Date(now) }); await own.clock.pauseAt(new Date(now));
    await own.bringToFront();
    const result = await run(own, { setOffline: value => { offline = Boolean(value); }, restart: () => own.clock.setSystemTime(new Date(now)) });
    assert.deepEqual(errors, [], 'no page error on the sweep\'s own page');
    return result;
  } finally { await context.close(); await page.bringToFront(); }
}
