import assert from 'node:assert/strict';

// The longest note the server accepts: four lines, 200 characters, with an unbroken long word.
export const FULL_NOTE = [
  'Dinner at seven with the neighbours; bring the blue salad bowl.',
  'Call about Saturday’s hike before noon.',
  'Supercalifragilisticexpialidociously',
  'Recycling goes out on Tuesday morning, and the compost bin.',
].join('\n');
export const id = 'note';
export const selectors = ['.note-text'];
export function prepare(state) { state.settings.widgetData.note = { text: FULL_NOTE }; }

export async function family({ widget, size }) {
  assert.equal(FULL_NOTE.length, 200); assert.equal(FULL_NOTE.split('\n').length, 4);
  const note = widget.locator('.note-text');
  assert.equal(await note.evaluate(el => el.textContent), FULL_NOTE, `${size} shows only the note text`);
  assert.equal(await note.evaluate(el => getComputedStyle(el).whiteSpace), 'pre-line', 'line breaks are kept');
  assert.equal(await widget.locator('.ambient-label').count(), 0, 'no label');
  const lines = await note.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; });
  assert.ok(lines >= 4, `${size} keeps at least the four authored lines: ${lines}`);
  const fit = await widget.evaluate(el => {
    const outer = el.getBoundingClientRect(), text = el.querySelector('.note-text').getBoundingClientRect();
    return { inside: text.top >= outer.top - 1 && text.bottom <= outer.bottom + 1 && text.left >= outer.left - 1 && text.right <= outer.right + 1, scale: new DOMMatrix(getComputedStyle(el.querySelector('.widget-content')).transform).a };
  });
  assert.ok(fit.inside, `${size} full note fits without clipping: ${JSON.stringify(fit)}`);
}
