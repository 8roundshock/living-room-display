import assert from 'node:assert/strict';

export const id = 'reminders';
export const selectors = ['li'];
export function prepare(state, { now }) {
  state.reminders = Array.from({ length: 5 }, (_, i) => ({ id: `fixture-${i}`, text: ['Read a chapter', 'Water the plants', 'Plan the weekend', 'Call a friend', 'A later reminder'][i], completed: false, dueAt: null, createdAt: new Date(now + i).toISOString(), updatedAt: new Date(now).toISOString() }));
}
export async function family({ widget, size }) {
  assert.equal(await widget.locator('li').count(), size === 'small' ? 1 : size === 'medium' ? 2 : 4);
}
