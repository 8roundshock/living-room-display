import assert from 'node:assert/strict';

/** #512: a saved update refreshes a clean open Note, without replacing genuine typing. */
export async function checkHomeNoteSync({ page, base, advance }) {
  const action = page.locator('.home-action[data-action="note"]');
  const sheet = page.locator('.home-sheet-note');
  const note = sheet.getByRole('textbox', { name: 'Note' });
  const save = sheet.getByRole('button', { name: 'Save note' });
  const prompted = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  async function external(text) {
    const response = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgetData: { note: { text } } }) });
    assert.equal(response.status, 200);
    const refreshed = page.waitForResponse(response => response.url() === `${base}/api/state`);
    await advance(6_000);
    assert.equal((await (await refreshed).json()).settings.widgetData.note.text, text);
    // Let the state response and its React effects commit before reading the field or unload guard.
    await page.clock.runFor(100);
  }

  await action.click(); await note.waitFor();
  await external('Synthetic clean external note');
  assert.equal(await note.inputValue(), 'Synthetic clean external note', 'an untouched open Note follows the latest saved text');
  assert.equal(await save.count(), 0, 'an external update creates no false draft');
  assert.equal(await prompted(), false, 'an untouched Note does not block leaving');

  await note.fill('Synthetic local typing');
  await external('Synthetic newer saved note');
  assert.equal(await note.inputValue(), 'Synthetic local typing', 'an external update preserves genuine typing');
  assert.equal(await save.count(), 1);
  assert.equal(await prompted(), true, 'the real draft still guards leaving');
  await sheet.getByRole('button', { name: 'Discard' }).click();
  assert.equal(await note.inputValue(), 'Synthetic newer saved note', 'Discard takes the newest saved note');

  // Typing back to the saved value (including ineffective trailing space) also resolves the draft.
  await note.fill('Synthetic transient edit');
  await note.fill('Synthetic newer saved note   ');
  assert.equal(await save.count(), 0);
  assert.equal(await prompted(), false);
  await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
  await external('Synthetic saved while closed');
  await action.click(); await note.waitFor();
  assert.equal(await note.inputValue(), 'Synthetic saved while closed', 'an effectively clean field does not retain an obsolete cached draft');
  assert.equal(await save.count(), 0);
  await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
}
