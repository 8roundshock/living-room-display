import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS } from '../../../src/shared/widgets.ts';

// The longest note the server accepts: four lines, 200 characters, with an unbroken long word.
export const FULL_NOTE = [
  'Dinner at seven with the neighbours; bring the blue salad bowl.',
  'Call about Saturday’s hike before noon.',
  'Supercalifragilisticexpialidociously',
  'Recycling goes out on Tuesday morning, and the compost bin.',
].join('\n');
/** A short multi-line note: four one-word lines (#194). */
export const SHORT_NOTE = ['Milk', 'Eggs', 'Bread', 'Tea'].join('\n');
export const id = 'note';
export const selectors = ['.note-text'];
export function prepare(state) { state.settings.widgetData.note = { text: FULL_NOTE }; }

async function reopen(page) {
  await page.reload();
  await page.locator('.display-page').waitFor();
  await page.clock.runFor(100);
}

/** The note's box against the widget's: completeness, the share of the height it fills, scale and size. */
function noteFacts(widget) {
  return widget.evaluate(element => {
    const outer = element.getBoundingClientRect(), text = element.querySelector('.note-text'), rect = text.getBoundingClientRect();
    const style = getComputedStyle(text);
    return {
      inside: rect.top >= outer.top - 1 && rect.bottom <= outer.bottom + 1 && rect.left >= outer.left - 1 && rect.right <= outer.right + 1,
      fill: rect.height / outer.height,
      scale: new DOMMatrix(getComputedStyle(element.querySelector('.widget-content')).transform).a,
      size: parseFloat(style.fontSize),
      floor: parseFloat(getComputedStyle(element).getPropertyValue('--min-text')),
      lines: (() => { const range = document.createRange(); range.selectNodeContents(text); return new Set([...range.getClientRects()].map(line => Math.round(line.top))).size; })(),
    };
  });
}

/** #194: a short multi-line note fills at least 60% of a medium or large widget at Text 100%, unclipped and unzoomed. */
function assertShort(facts, size, label) {
  assert.ok(facts.inside, `${label}: the short note is not clipped ${JSON.stringify(facts)}`);
  assert.equal(facts.scale, 1, `${label}: no zoom-out`);
  assert.ok(facts.lines >= 4, `${label}: the four lines are kept`);
  if (size !== 'small') assert.ok(facts.fill >= 0.6, `${label}: fills ${Math.round(facts.fill * 100)}% of the widget height (at least 60%)`);
}

export async function family({ page, widget, size, density, viewport, state }) {
  assert.equal(FULL_NOTE.length, 200); assert.equal(FULL_NOTE.split('\n').length, 4);
  const note = widget.locator('.note-text');
  assert.equal(await note.evaluate(el => el.textContent), FULL_NOTE, `${size} shows only the note text`);
  assert.equal(await note.evaluate(el => getComputedStyle(el).whiteSpace), 'pre-line', 'line breaks are kept');
  assert.equal(await widget.locator('.ambient-label').count(), 0, 'no label');
  const full = await noteFacts(widget);
  assert.ok(full.lines >= 4, `${size} keeps at least the four authored lines: ${full.lines}`);
  assert.ok(full.inside, `${size} full note fits without clipping: ${JSON.stringify(full)}`);
  // The text floor holds; only the shared fit may zoom out a note that cannot fit at the floor.
  assert.ok(full.size >= full.floor - 0.01, `${size}/${density} the full note keeps the text floor: ${JSON.stringify(full)}`);
  if (full.scale < 1) assert.ok(Math.abs(full.size - full.floor) < 0.05, `${size}/${density} zooms out only at the floor: ${JSON.stringify(full)}`);
  const text = state.settings.widgetData.note.text;
  state.settings.widgetData.note = { text: SHORT_NOTE };
  try {
    await reopen(page);
    const short = await noteFacts(widget);
    assertShort(short, size, `${size}/${density}/${viewport.width}p short note`);
    assert.ok(short.size > full.size, `${size}/${density}: the short note is set larger than the full one`);
  } finally {
    state.settings.widgetData.note = { text };
    await reopen(page);
  }
}

/** The same at the owner's 1280×720 CSS viewport: every family and density, both notes. */
export async function sweep({ page, viewport, state, base }) {
  if (viewport.width !== 1920) return null;
  const widget = page.locator('[data-widget-id="note"]');
  await page.setViewportSize({ width: 1280, height: 720 });
  try {
    for (const density of Object.keys(GRID_DENSITIES)) for (const size of ['small', 'medium', 'large']) for (const [name, text] of [['short', SHORT_NOTE], ['full', FULL_NOTE]]) {
      state.settings.appearance.motionEnabled = false; state.settings.appearance.fontScale = 1; state.settings.widgetGrid.density = density;
      state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'note']));
      state.settings.widgetGrid.placements.note = { column: 0, row: 0, size };
      state.settings.widgetData.note = { text };
      await page.goto(`${base}/display`); await page.locator('.display-page').waitFor(); await page.clock.runFor(100);
      const facts = await noteFacts(widget), label = `${size}/${density}/1280p ${name} note`;
      if (name === 'short') assertShort(facts, size, label);
      else assert.ok(facts.inside && facts.size >= facts.floor - 0.01, `${label}: fits at or above the floor ${JSON.stringify(facts)}`);
    }
  } finally {
    await page.setViewportSize(viewport);
  }
  return 'Note size is measured from the box: a short four-line note fills at least 60% of medium and large at Text 100% without zooming, and the 200-character note fits every family and density at 720p/1080p/4K at or above the text floor';
}
