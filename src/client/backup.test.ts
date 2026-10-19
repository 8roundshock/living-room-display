// Restore from backup (#234): the editor's client-side check and summary before POST /api/import.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultSettings } from '../shared/defaults.ts';
import { importSchema } from '../server/validation.ts';
import { persistableSettings } from '../server/persistence.ts';
import { BackupError, backupContents, backupDate, parseBackup } from './backup.ts';

function exported(overrides: Record<string, unknown> = {}) {
  const settings = defaultSettings();
  settings.savedPresets = [{ id: 'style', name: 'Synthetic style', visual: { appearance: settings.appearance, widgets: settings.widgets, widgetOverrides: settings.widgetOverrides, widgetBehavior: settings.widgetBehavior, widgetGrid: settings.widgetGrid, preview: settings.preview } }];
  const at = '2026-10-18T13:00:00.000Z';
  return {
    version: 1,
    // Exports omit additive defaults (#84), exactly as GET /api/export writes them.
    settings: persistableSettings(settings),
    reminders: [
      { id: '00000000-0000-4000-8000-000000000001', text: 'Synthetic one', completed: false, dueAt: null, createdAt: at, updatedAt: at },
      { id: '00000000-0000-4000-8000-000000000002', text: 'Synthetic two', completed: true, dueAt: null, createdAt: at, updatedAt: at },
      { id: '00000000-0000-4000-8000-000000000003', text: 'Synthetic three', completed: false, dueAt: at, createdAt: at, updatedAt: at },
    ],
    exportedAt: at,
    ...overrides,
  };
}

test('a real export passes the client check, the server schema and reads as a summary', () => {
  const file = exported();
  assert.doesNotThrow(() => importSchema.parse(file), 'the fixture is a valid import');
  const backup = parseBackup(JSON.stringify(file));
  assert.equal(backupContents(backup), '3 reminders (1 completed) and 1 saved style');
  assert.equal(backupDate(backup, '12h', 'America/Toronto').replace(/\s/g, ' '), 'Oct 18, 2026, 9:00 AM');
  assert.equal(backupDate(backup, '24h', 'America/Toronto'), 'Oct 18, 2026, 09:00');
  assert.equal(backupContents(parseBackup(JSON.stringify(exported({ reminders: [] })))), 'no reminders and 1 saved style');
  const single = exported({ reminders: [exported().reminders[0]] });
  (single.settings as { savedPresets?: unknown[] }).savedPresets = [];
  assert.equal(backupContents(parseBackup(JSON.stringify(single))), '1 reminder and no saved styles');
});

test('anything that is not an export is refused with a message, before reaching the server', () => {
  const notBackup = "That file isn't a backup. Choose one made with Export saved data.";
  for (const [label, text] of [
    ['not JSON', 'hello'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['a settings file without reminders', JSON.stringify({ version: 1, settings: defaultSettings() })],
    ['a missing date', JSON.stringify(exported({ exportedAt: undefined }))],
    ['an invalid date', JSON.stringify(exported({ exportedAt: 'yesterday' }))],
    ['no version', JSON.stringify(exported({ version: undefined }))],
    ['reminders that are not reminders', JSON.stringify(exported({ reminders: [{ title: 'x' }] }))],
    ['settings without appearance', JSON.stringify(exported({ settings: { location: { name: 'Example' } } }))],
  ] as const) {
    assert.throws(() => parseBackup(text), (error: unknown) => error instanceof BackupError && error.message === notBackup, label);
  }
  assert.throws(() => parseBackup(JSON.stringify(exported({ version: 2 }))), /newer version of the app/, 'a future export says so');
});
