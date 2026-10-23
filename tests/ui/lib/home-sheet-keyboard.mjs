import assert from 'node:assert/strict';

/** A Home modal keeps both directions of ordinary Tab navigation inside its current controls. */
export async function checkHomeSheetKeyboard(page) {
  for (const key of ['Tab', 'Shift+Tab']) for (let step = 0; step < 30; step++) {
    await page.keyboard.press(key);
    const focus = await page.evaluate(() => ({
      inside: !!document.activeElement?.closest('dialog.home-sheet[open]'),
      tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 40),
      pageFocused: document.hasFocus(), modal: !!document.querySelector('dialog.home-sheet:modal'),
    }));
    assert.equal(focus.inside, true, `${key} ${step + 1}: focus stays in the sheet ${JSON.stringify(focus)}`);
  }
}
