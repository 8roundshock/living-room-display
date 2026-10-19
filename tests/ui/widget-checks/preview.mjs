import assert from 'node:assert/strict';

export const id = 'preview';
export const selectors = ['.preview-caption'];
export function prepare(state, { now }) {
  state.preview = { available: true, capturedAt: new Date(now).toISOString(), width: 320, height: 200 };
}
export async function family({ widget }) {
  assert.equal(await widget.locator('img').evaluate(el => getComputedStyle(el).objectFit), 'contain');
}
