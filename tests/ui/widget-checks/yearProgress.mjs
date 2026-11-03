import assert from 'node:assert/strict';
import { prepareCollection } from '../lib/collection-fixture.mjs';
export const id = 'yearProgress';
export const selectors = ['.collection-label', '.collection-value', '.collection-title', '.collection-footer', '.collection-hour-value'];
export function prepare(state, options) { prepareCollection(state, options); }
export async function family({ widget }) {
  assert.equal(await widget.locator('.collection-face').count(), 1, 'yearProgress owns its face');
  assert.ok((await widget.innerText()).trim().length > 0, 'yearProgress has real content or an honest empty state');
  assert.equal(await widget.locator('button, input, a, select').count(), 0, 'yearProgress stays passive');
}
