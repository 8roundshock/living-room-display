import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { defaultSettings } from './defaults.ts';
import { emptySchedule, overlappingRules, ruleMatches, scheduledSettings, selectScheduledPreset, type ScheduleRule } from './schedule.ts';

const rule = (patch: Partial<ScheduleRule> = {}): ScheduleRule => ({ id: 'row', presetId: 'morning', days: [1], start: '08:00', end: '12:00', ...patch });
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, 18 + day, hour, minute); // Sunday 18 October.
const settings = defaultSettings();
const { appearance, widgets, widgetGrid, widgetBehavior, widgetOverrides, preview } = settings;
const presets = ['morning', 'evening'].map(id => ({ id, name: id, visual: { appearance, widgets, widgetGrid, widgetBehavior, widgetOverrides, preview } }));

test('local schedule intervals include their start, exclude their end and use the start weekday overnight', () => {
  assert.equal(ruleMatches(rule(), local(1, 7, 59)), false);
  assert.equal(ruleMatches(rule(), local(1, 8)), true);
  assert.equal(ruleMatches(rule(), local(1, 11, 59)), true);
  assert.equal(ruleMatches(rule(), local(1, 12)), false);
  assert.equal(ruleMatches(rule(), local(2, 8)), false);
  const overnight = rule({ days: [6], start: '22:00', end: '06:00' });
  assert.equal(ruleMatches(overnight, local(6, 22)), true);
  assert.equal(ruleMatches(overnight, local(0, 5, 59)), true);
  assert.equal(ruleMatches(overnight, local(0, 6)), false);
  assert.equal(ruleMatches(overnight, local(6, 5)), false);
  assert.equal(ruleMatches(rule({ start: '08:00', end: '08:00' }), local(2, 7, 59)), true);
  assert.equal(ruleMatches(rule({ start: '08:00', end: '08:00' }), local(2, 8)), false);
});

test('priority, fallback, deleted styles, overrides and wake catchup are deterministic without mutating settings', () => {
  const config = { enabled: true, fallbackPresetId: 'evening', rules: [rule({ presetId: 'deleted' }), rule(), rule({ id: 'later', presetId: 'evening' })] };
  const before = structuredClone(config);
  assert.equal(selectScheduledPreset(config, presets, local(1, 8)).presetId, 'morning');
  assert.deepEqual(selectScheduledPreset(config, presets, local(1, 8)).missingPresetIds, ['deleted']);
  assert.equal(selectScheduledPreset(config, presets, local(1, 12)).source, 'fallback');
  const until = local(1, 9).toISOString();
  assert.equal(selectScheduledPreset(config, presets, local(1, 8), until).source, 'override');
  assert.equal(selectScheduledPreset(config, presets, local(1, 9), until).source, 'rule');
  assert.equal(selectScheduledPreset(config, [], local(1, 8)).source, 'manual');
  assert.equal(selectScheduledPreset(emptySchedule(), presets, local(1, 8)).source, 'manual');
  assert.deepEqual(config, before);
  const visual = { ...presets[0]!.visual, appearance: { ...appearance, brightness: 0.3 } };
  const effective = scheduledSettings(settings, { visual });
  assert.equal(effective.appearance.brightness, 0.3);
  assert.equal(settings.appearance.brightness, 0.55);
  assert.equal(effective.location, settings.location);
  assert.equal(effective.widgetData, settings.widgetData);
});

test('overlap explanations agree with resolver including overnight and week rollover; adjacent ranges are disjoint', () => {
  const overnight = rule({ id: 'overnight', days: [6], start: '22:00', end: '06:00' });
  const sunday = rule({ id: 'sunday', days: [0], start: '05:00', end: '08:00' });
  assert.deepEqual(overlappingRules([overnight, sunday]), [['overnight', 'sunday']]);
  assert.deepEqual(overlappingRules([rule(), rule({ id: 'adjacent', start: '12:00', end: '15:00' })]), []);
  assert.deepEqual(overlappingRules([rule({ start: '00:00', end: '00:00' }), rule({ id: 'any' })]), [['row', 'any']]);
});

test('DST uses desktop civil time: skipped minutes do not run; repeated minutes both match', () => {
  // A separate process keeps timezone testing isolated from every other test and Windows settings.
  const module = new URL('./schedule.ts', import.meta.url).href;
  const code = `import {ruleMatches} from ${JSON.stringify(module)}; const r={id:'x',presetId:'a',days:[0],start:'01:00',end:'02:00'}; console.log(JSON.stringify(['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z','2026-11-01T07:00:00Z'].map(x=>ruleMatches(r,new Date(x))))); const s={...r,start:'02:00',end:'03:00'}; console.log(JSON.stringify(['2026-03-08T06:59:00Z','2026-03-08T07:00:00Z'].map(x=>ruleMatches(s,new Date(x)))));`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.deepEqual(output.trim().split(/\r?\n/).map(line => JSON.parse(line)), [[true, true, false], [false, false]]);
});
