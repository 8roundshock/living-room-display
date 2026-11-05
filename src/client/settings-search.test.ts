import test from 'node:test';
import assert from 'node:assert/strict';
import { findSettings } from './settings-search.ts';

test('settings search accepts everyday names and keeps multiple-word queries specific', () => {
  assert.deepEqual(findSettings('temperature').map(item => item.id), ['units']);
  assert.deepEqual(findSettings('  CLOCK  ').map(item => item.id), ['time']);
  assert.deepEqual(findSettings('weather city').map(item => item.id), ['city']);
  assert.deepEqual(findSettings('backup').map(item => item.id), ['export', 'restore']);
  assert.deepEqual(findSettings('backup restore').map(item => item.id), ['restore']);
  assert.deepEqual(findSettings('birthday').map(item => item.id), ['birthdays']);
  assert.deepEqual(findSettings(''), []);
  assert.deepEqual(findSettings('unknown setting'), []);
});
