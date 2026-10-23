import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActiveScheme, parsePowerSetting, parseWindowsStatus, powerStatus, windowsStatus } from './windows.ts';

test('Windows status reports actual registry flags without changing lock behavior', () => {
  const status = parseWindowsStatus('    SCRNSAVE.EXE    REG_SZ    C:\\Users\\Example\\AppData\\Local\\LivingRoomDisplay\\app\\windows\\LivingRoomDisplay.scr\r\n    ScreenSaveActive    REG_SZ    1\r\n    ScreenSaveTimeOut    REG_SZ    600\r\n    ScreenSaverIsSecure    REG_SZ    1\r\n');
  assert.equal(status.isLivingRoomDisplay, true); assert.equal(status.active, true);
  assert.equal(status.secure, true); assert.equal(status.timeoutSeconds, 600);
  assert.equal(parseWindowsStatus('').active, null);
  assert.equal(parseWindowsStatus('SCRNSAVEXEXE REG_SZ C:\\LivingRoomDisplay.scr').isLivingRoomDisplay, false);
});

// Synthetic `powercfg` output in the shape Windows 10 prints it (English and German labels).
const ENGLISH_VIDEO = `Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)
  GUID Alias: SCHEME_MIN
  Subgroup GUID: 7516b95f-f776-4464-8c53-06167f40cc99  (Display)
    GUID Alias: SUB_VIDEO
    Power Setting GUID: 3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e  (Turn off display after)
      GUID Alias: VIDEOIDLE
      Minimum Possible Setting: 0x00000000
      Maximum Possible Setting: 0xffffffff
      Possible Settings increment: 0x00000001
      Possible Settings units: Seconds
    Current AC Power Setting Index: 0x00000000
    Current DC Power Setting Index: 0x00000258
`;
const GERMAN_SLEEP = `GUID des Energieschemas: 381b4222-f694-41f0-9685-ff5bb260df2e  (Ausbalanciert)
  GUID-Alias: SCHEME_BALANCED
  GUID der Untergruppe: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Energie sparen)
    GUID-Alias: SUB_SLEEP
    GUID der Energieeinstellung: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Standbymodus nach)
      GUID-Alias: STANDBYIDLE
      Minimaler möglicher Wert: 0x00000000
      Maximaler möglicher Wert: 0xffffffff
      Mögliche Schritte für Einstellungen: 0x00000001
      Mögliche Einheiten für Einstellungen: Sekunden
    Aktueller Wechselstrom-Einstellungsindex: 0x00000708
    Aktueller Gleichstrom-Einstellungsindex: 0x00000384
`;

test('#436 powercfg settings parse the same in English and German: the last two values are AC then DC, 0 is Never', () => {
  assert.deepEqual(parsePowerSetting(ENGLISH_VIDEO), { ac: 0, dc: 600 });
  assert.deepEqual(parsePowerSetting(GERMAN_SLEEP), { ac: 1800, dc: 900 });
  assert.equal(parseActiveScheme('Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\r\n'), 'High performance');
  assert.equal(parseActiveScheme('GUID des Energieschemas: 381b4222-f694-41f0-9685-ff5bb260df2e  (Ausbalanciert)'), 'Ausbalanciert');
  // Garbage reads as unknown, never as Never.
  for (const garbage of ['', 'Invalid Parameters -- try "/?" for help', 'Current AC Power Setting Index: 0x0000', '\u0000\u0001']) assert.equal(parsePowerSetting(garbage), null, JSON.stringify(garbage));
  assert.equal(parseActiveScheme('no scheme here'), null);
});

test('#436 power status is read-only, additive, and honest when powercfg fails or times out', async () => {
  const calls: string[][] = [];
  const answers: Record<string, string | null> = { VIDEOIDLE: ENGLISH_VIDEO, STANDBYIDLE: GERMAN_SLEEP, '/getactivescheme': 'Power Scheme GUID: 1  (Balanced)' };
  const runner = async (file: string, args: string[]) => { calls.push([file, ...args]); return answers[args.at(-1)!] ?? null; };
  assert.deepEqual(await powerStatus(runner, 'win32'), { available: true, scheme: 'Balanced', displayOffSeconds: { ac: 0, dc: 600 }, sleepSeconds: { ac: 1800, dc: 900 } });
  // Only queries: no /change, /setacvalueindex or other writing verb.
  for (const call of calls) {
    assert.equal(call[0], 'powercfg.exe');
    assert.ok(['/query', '/getactivescheme'].includes(call[1]!), JSON.stringify(call));
  }
  // A timed-out or failed query (execFile rejects; the runner answers null) is unknown, with an error.
  const timedOut = await powerStatus(async (_file, args) => args.includes('VIDEOIDLE') ? null : answers[args.at(-1)!] ?? null, 'win32');
  assert.deepEqual(timedOut, { available: true, scheme: 'Balanced', displayOffSeconds: null, sleepSeconds: { ac: 1800, dc: 900 }, error: 'Windows power settings could not be read.' });
  const garbage = await powerStatus(async () => 'garbage', 'win32');
  assert.equal(garbage.displayOffSeconds, null); assert.equal(garbage.sleepSeconds, null); assert.equal(garbage.scheme, null); assert.ok(garbage.error);
  // Off Windows nothing runs.
  let ran = false;
  assert.deepEqual(await powerStatus(async () => { ran = true; return null; }, 'linux'), { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null });
  assert.equal(ran, false);
});

test('#436 the real timeout path: a powercfg that never answers within 2 s reads as unknown', async () => {
  // The default runner wraps execFile with a 2 s timeout and turns any rejection into null; simulate the rejection.
  const slow = (_file: string, _args: string[]) => new Promise<string | null>(resolve => setTimeout(() => resolve(null), 20));
  const status = await powerStatus(slow, 'win32');
  assert.equal(status.available, true);
  assert.equal(status.displayOffSeconds, null);
  assert.ok(status.error);
});

test('#436 the status shape is additive: every earlier key stays and power is new', async () => {
  const calls: [string, string[]][] = [];
  const status = await windowsStatus(async (file, args) => {
    calls.push([file, args]);
    if (file === 'reg.exe') return 'ScreenSaveActive REG_SZ 1\r\nScreenSaveTimeOut REG_SZ 600\r\n';
    return args.includes('VIDEOIDLE') ? ENGLISH_VIDEO : args.includes('STANDBYIDLE') ? GERMAN_SLEEP : '(Synthetic plan)';
  }, 'win32');
  for (const key of ['available', 'selectedScreenSaver', 'active', 'timeoutSeconds', 'secure', 'isLivingRoomDisplay']) assert.ok(key in status, key);
  assert.deepEqual(Object.keys(status.power).filter(key => key !== 'error').sort(), ['available', 'displayOffSeconds', 'scheme', 'sleepSeconds']);
  assert.equal(status.power.available, true);
  assert.equal(status.active, true); assert.equal(status.timeoutSeconds, 600);
  assert.deepEqual(calls, [
    ['reg.exe', ['query', 'HKCU\\Control Panel\\Desktop']],
    ['powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_VIDEO', 'VIDEOIDLE']],
    ['powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']],
    ['powercfg.exe', ['/getactivescheme']],
  ]);
});

test('Windows status off Windows never invokes a runner; failed synthetic registry reads stay unknown', async () => {
  let calls = 0;
  const unavailable = await windowsStatus(async () => { calls++; return null; }, 'linux');
  assert.equal(calls, 0); assert.equal(unavailable.available, false); assert.equal(unavailable.power.available, false);
  const failed = await windowsStatus(async () => null, 'win32');
  assert.equal(failed.available, true); assert.equal(failed.active, null); assert.equal(failed.timeoutSeconds, null);
  assert.match(failed.error!, /could not be read/); assert.match(failed.power.error!, /could not be read/);
});
