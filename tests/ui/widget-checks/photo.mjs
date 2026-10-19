import assert from 'node:assert/strict';

export const id = 'photo';
export function prepare(state, { now }) {
  state.photo = { available: true, id: 'synthetic', width: 320, height: 200, updatedAt: new Date(now).toISOString() };
}
export async function family({ widget, size }) {
  assert.equal(await widget.locator('img').evaluate(el => getComputedStyle(el).objectFit), size === 'large' ? 'contain' : 'cover');
}
