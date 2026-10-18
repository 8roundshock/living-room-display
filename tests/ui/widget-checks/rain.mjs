import assert from 'node:assert/strict';

export const id = 'rain';
export const selectors = ['.rain-bars', '.rain-confidence', '.rain-amount'];
export async function family({ widget, size }) {
  assert.match(await widget.innerText(), /mm rain/); if (size === 'large') assert.ok((await widget.locator('.rain-bars').boundingBox()).height >= (await widget.boundingBox()).height * 0.1, 'Rain chart retains real height');
}
