import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES } from '../shared/widgets.ts';
import { filteredPickerGroups, filteredPickerSelection, firstPickerSelection, pickerGroups } from './picker-catalog.ts';

const ids = (groups: ReturnType<typeof pickerGroups>) => groups.flatMap(group => group.ids);

test('picker catalog keeps category order and every active widget exactly once', () => {
  const groups = pickerGroups(), order = ids(groups);
  assert.deepEqual(groups.map(group => group.category), Object.keys(WIDGET_CATEGORIES));
  assert.deepEqual([...order].sort(), [...ACTIVE_WIDGET_IDS].sort());
  assert.equal(new Set(order).size, order.length);
  assert.equal(order.includes('rain'), false, 'retired widgets stay hidden');
  const widgets = defaultSettings().widgets;
  assert.equal(firstPickerSelection(widgets), order.find(id => !widgets[id]));
});

test('picker searches names, descriptions and categories, using every trimmed word', () => {
  const widgets = defaultSettings().widgets;
  assert.deepEqual(ids(filteredPickerGroups(widgets, '  WORLD   cities ', 'all')), ['worldClocks']);
  assert.deepEqual(ids(filteredPickerGroups(widgets, 'Pictures', 'all')), ['preview', 'photo']);
  assert.deepEqual(ids(filteredPickerGroups(widgets, 'moon sky', 'all')), ['sunMoon']);
  assert.deepEqual(ids(filteredPickerGroups(widgets, 'no such widget', 'all')), []);
  assert.deepEqual(ids(filteredPickerGroups(widgets, ' \t ', 'all')), ids(pickerGroups()));
});

test('picker filters the current draft without changing it and combines query with availability', () => {
  const widgets = defaultSettings().widgets, before = structuredClone(widgets);
  for (const filter of ['not-added', 'on-display'] as const) {
    const result = ids(filteredPickerGroups(widgets, '', filter));
    assert.deepEqual(result, ids(pickerGroups()).filter(id => widgets[id] === (filter === 'on-display')));
  }
  assert.deepEqual(ids(filteredPickerGroups(widgets, 'Pictures', 'not-added')), ['photo']);
  assert.deepEqual(ids(filteredPickerGroups(widgets, 'Pictures', 'on-display')), ['preview']);
  assert.deepEqual(widgets, before);
  const changed = { ...widgets, photo: true };
  assert.deepEqual(ids(filteredPickerGroups(changed, 'Pictures', 'not-added')), []);
  assert.deepEqual(ids(filteredPickerGroups(changed, 'Pictures', 'on-display')), ['preview', 'photo']);
});

test('filtered selection stays visible, falls back in catalog order, and clears for no results', () => {
  const widgets = defaultSettings().widgets;
  const pictures = filteredPickerGroups(widgets, 'Pictures', 'all');
  assert.equal(filteredPickerSelection(pictures, 'photo'), 'photo');
  assert.equal(filteredPickerSelection(pictures, 'clock'), 'preview');
  assert.equal(filteredPickerSelection([], 'clock'), null);
  const all = Object.fromEntries(Object.keys(WIDGET_CATALOG).map(id => [id, true])) as typeof widgets;
  assert.deepEqual(filteredPickerGroups(all, '', 'not-added'), []);
  assert.equal(firstPickerSelection(all), ids(pickerGroups())[0]);
});
