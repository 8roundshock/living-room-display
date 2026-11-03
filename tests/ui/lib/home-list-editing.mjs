import assert from 'node:assert/strict';

const ONE = '11111111-1111-4111-8111-111111111111';
const TWO = '22222222-2222-4222-8222-222222222222';
const THREE = '33333333-3333-4333-8333-333333333333';

/** Uses only the parent suite's ephemeral app and synthetic records. Images remain in RAM. */
export async function checkHomeListEditing({ page, app, reset, home, action, sheet, state, capture = false }) {
  const images = [], checks = [];
  const button = name => sheet(page).getByRole('button', { name, exact: true });
  const close = async () => { await page.keyboard.press('Escape'); await sheet(page).waitFor({ state: 'detached' }); };
  const list = () => app.store.snapshot().settings.widgetData.countdowns;
  await reset(settings => {
    settings.widgetData.countdowns = [
      { id: ONE, title: 'Synthetic picnic', date: '2027-05-10', repeatsYearly: false },
      { id: TWO, title: 'Synthetic visit', date: '2027-06-12', repeatsYearly: false },
    ];
    settings.widgetData.worldClocks = [
      { id: ONE, label: 'London', timezone: 'Europe/London', latitude: 51.5, longitude: -0.1 },
      { id: TWO, label: 'Tokyo', timezone: 'Asia/Tokyo', latitude: 35.7, longitude: 139.7 },
    ];
  });
  await home(page);
  await page.getByRole('button', { name: 'Manage London clock', exact: true }).click();
  await button('Edit London').click();
  await page.waitForFunction(() => document.activeElement?.closest('label')?.textContent === 'Clock label');
  await sheet(page).getByLabel('Clock label', { exact: true }).fill('Friends in London');
  await button('Move later').click();
  assert.deepEqual((await state()).settings.widgetData.worldClocks.map(item => item.label), ['London', 'Tokyo']);
  await button('Cancel edits').click();
  assert.equal(await button('Save edits').count(), 0);
  await button('Edit London').click();
  await sheet(page).getByLabel('Clock label', { exact: true }).fill('Friends in London');
  await button('Move later').click();
  await button('Save edits').click(); await sheet(page).locator('.home-list-edit-actions').waitFor({ state: 'detached' });
  assert.deepEqual((await state()).settings.widgetData.worldClocks.map(item => [item.id, item.label]), [[TWO, 'Tokyo'], [ONE, 'Friends in London']]);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit Friends in London');
  await close();
  checks.push('World-clock chips open management; rename/reorder Save preserves IDs, Cancel writes nothing, and focus returns to the saved row');

  await action(page, 'countdown').click(); await button('Edit Synthetic picnic').click();
  await sheet(page).getByLabel('Countdown title', { exact: true }).fill('Picnic together');
  await sheet(page).getByLabel('Countdown date', { exact: true }).fill('2027-05-15');
  await sheet(page).getByRole('switch', { name: 'Repeat every year', exact: true }).check();
  await button('Move later').click();
  await close();
  await action(page, 'countdown').click();
  await button('Edit Picnic together').click();
  assert.equal(await sheet(page).getByLabel('Countdown date', { exact: true }).inputValue(), '2027-05-15');
  assert.equal(await button('Add countdown').isEnabled(), false);
  // Another page edits a different field and adds an item while this list has a retained draft.
  await app.store.update(data => {
    data.settings.units = 'imperial';
    data.settings.widgetData.countdowns[1].date = '2027-06-20';
    data.settings.widgetData.countdowns.push({ id: THREE, title: 'Added elsewhere', date: '2027-07-01', repeatsYearly: false });
  });
  await button('Save edits').click();
  await sheet(page).getByText('Updated in another window. Review your edits, then save again.', { exact: true }).waitFor();
  assert.equal(list()[0].title, 'Synthetic picnic', 'first save requests review without overwriting');
  await button('Save edits').click(); await sheet(page).locator('.home-list-edit-actions').waitFor({ state: 'detached' });
  assert.deepEqual(list().map(item => item.id), [TWO, ONE, THREE]);
  assert.equal(list()[0].date, '2027-06-20');
  assert.deepEqual(list()[1], { id: ONE, title: 'Picnic together', date: '2027-05-15', repeatsYearly: true });
  assert.equal((await state()).settings.units, 'imperial');
  checks.push('Countdown title/date/yearly/reorder drafts survive sheet close; concurrent additions, other fields and unrelated settings survive the review-and-save flow');

  await button('Edit Picnic together').click();
  await sheet(page).getByLabel('Countdown title', { exact: true }).fill('Retry picnic');
  await page.route('**/api/settings', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Synthetic save unavailable' } }) : route.continue());
  await button('Save edits').click(); await sheet(page).getByText('Synthetic save unavailable', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Save edits');
  assert.equal(await sheet(page).getByLabel('Countdown title', { exact: true }).inputValue(), 'Retry picnic');
  await page.unroute('**/api/settings');
  let raced = false;
  await page.route('**/api/settings', async route => {
    if (!raced && route.request().method() === 'PATCH') {
      raced = true;
      await app.store.update(data => { data.settings.widgetData.countdowns[0].title = 'Visit changed elsewhere'; });
    }
    await route.continue();
  });
  await button('Save edits').click();
  await sheet(page).getByText('Updated in another window. Review your edits, then save again.', { exact: true }).waitFor();
  assert.equal(list()[1].title, 'Picnic together', 'a race after the revision read is refused');
  await button('Save edits').click(); await sheet(page).locator('.home-list-edit-actions').waitFor({ state: 'detached' });
  await page.unroute('**/api/settings');
  assert.equal(list()[0].title, 'Visit changed elsewhere'); assert.equal(list()[1].title, 'Retry picnic');
  await button('Remove Retry picnic').click(); await button('Undo').click(); await button('Edit Retry picnic').waitFor();
  assert.equal(list()[1].id, ONE); assert.equal(list()[1].title, 'Retry picnic');
  checks.push('A failed list save keeps edits; an intervening write is refused by ETag, explicit retry keeps both edits, and Remove/Undo restores the edited item and order');

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 640 }, { width: 320, height: 480 }, { width: 640, height: 300 }]) {
    await page.setViewportSize(viewport);
    await button('Edit Retry picnic').click();
    await sheet(page).getByLabel('Countdown title', { exact: true }).fill('Visible draft');
    for (const control of await sheet(page).locator('.home-item-fields input, .home-item-fields button:not(:disabled)').all()) {
      await control.focus();
      await page.waitForFunction(element => {
        const rect = element.getBoundingClientRect(), body = element.closest('.home-sheet-body').getBoundingClientRect();
        const footer = document.querySelector('.home-sheet-footer').getBoundingClientRect();
        return rect.top >= body.top && rect.bottom <= Math.min(body.bottom, footer.top)
          && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }, await control.elementHandle(), { timeout: 3000 });
    }
    await button('Save edits').scrollIntoViewIfNeeded();
    assert.equal(await button('Save edits').isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const box = await button('Save edits').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `Save fits ${JSON.stringify(viewport)}`);
    if (capture) images.push({ name: `home-list-edit-${viewport.width}x${viewport.height}`, bytes: await page.screenshot() });
    await button('Cancel edits').click();
  }
  await close(); await page.setViewportSize({ width: 1280, height: 720 });
  checks.push('Inline editing and its Save/Cancel controls reflow at desktop, 390px, 320px and short landscape viewports');

  await action(page, 'worldClock').click(); await button('Edit Friends in London').click();
  await sheet(page).getByLabel('Clock label', { exact: true }).fill('First submitted');
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  await page.route('**/api/settings', async route => { entered(); await held; await route.continue(); });
  await button('Save edits').click(); await started;
  await close(); await action(page, 'worldClock').click(); await button('Edit First submitted').click();
  await sheet(page).getByLabel('Clock label', { exact: true }).fill('Newer draft');
  release();
  await page.waitForFunction(() => document.querySelector('.home-clock-link[aria-label="Manage First submitted clock"]'));
  assert.equal(await sheet(page).getByLabel('Clock label', { exact: true }).inputValue(), 'Newer draft');
  await close(); await action(page, 'worldClock').click(); await button('Edit Newer draft').click();
  assert.equal(await sheet(page).getByLabel('Clock label', { exact: true }).inputValue(), 'Newer draft');
  await button('Cancel edits').click(); await button('Edit First submitted').waitFor();
  await page.unroute('**/api/settings'); await close();
  checks.push('A delayed save finishing after sheet close cannot erase a newer draft made after reopening');
  return { checks, images };
}
