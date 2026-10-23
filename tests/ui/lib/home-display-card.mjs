import assert from 'node:assert/strict';

/** #513: Home's card and header operate the same display without reloading it. */
export async function checkHomeDisplayCard(page) {
  const card = page.locator('.home-open-display');
  const header = page.locator('.studio-header .open-display');
  const close = page.locator('.studio-header .close-display');
  const popup = page.waitForEvent('popup');
  await card.click();
  const display = await popup;
  await display.locator('.display-page').waitFor();
  assert.equal(await header.getAttribute('aria-label'), 'Show display', 'opening from the card registers the display with the header');
  await close.waitFor();
  assert.equal((await card.innerText()).trim(), 'Show display');

  // A reload loses this marker and focus counter. Both links must call the live window's focus.
  const marker = await display.evaluate(() => {
    const marker = window.__lrdHomeCard = { id: crypto.randomUUID(), focuses: 0 };
    const focus = window.focus;
    window.focus = function (...args) { marker.focuses++; return focus.apply(this, args); };
    return marker.id;
  });
  let navigations = 0;
  display.on('framenavigated', frame => { if (frame === display.mainFrame()) navigations++; });
  await card.click();
  await header.click();
  await display.waitForFunction(() => window.__lrdHomeCard?.focuses === 2, undefined, { timeout: 3000 });
  assert.equal(await display.evaluate(() => window.__lrdHomeCard?.id), marker, 'both links reuse the existing document');
  assert.equal(navigations, 0, 'showing from either link causes no navigation');
  assert.equal(await display.evaluate(() => document.hasFocus()), true, 'showing focuses the display');
  assert.equal(page.context().pages().filter(candidate => new URL(candidate.url()).pathname === '/display').length, 1);

  const closed = display.waitForEvent('close');
  await close.click(); await closed;
  assert.equal(await header.getAttribute('aria-label'), 'Open display');
  assert.equal((await card.innerText()).trim(), 'Open display');
  assert.equal(await close.count(), 0, 'closing resets both controls');
}
