import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PowerStatus, PowerTimeouts, WindowsStatus } from '../shared/contracts.ts';

export type { PowerStatus, PowerTimeouts, WindowsStatus };
const execute = promisify(execFile);
type ScreensaverStatus = Omit<WindowsStatus, 'power'>;
export function parseWindowsStatus(output: string): ScreensaverStatus {
  function value(name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\s*${escaped}\\s+REG_\\w+\\s+(.*?)\\s*$`, 'mi').exec(output)?.[1] ?? null;
  }
  const selected = value('SCRNSAVE.EXE'); const timeout = value('ScreenSaveTimeOut');
  const active = value('ScreenSaveActive'); const secure = value('ScreenSaverIsSecure');
  return { available: true, selectedScreenSaver: selected, active: active == null ? null : active === '1',
    timeoutSeconds: timeout && /^\d+$/.test(timeout) ? Number(timeout) : null, secure: secure == null ? null : secure === '1',
    isLivingRoomDisplay: !!selected && /(?:^|[\\/])LivingRoomDisplay\.scr"?$/i.test(selected),
  };
}

/**
 * One setting from `powercfg /query <scheme> <subgroup> <setting>`. Locale-independent: the labels are
 * translated, but the output always ends with the current AC index, then the current DC index, as 0x…
 * values (the minimum, maximum and increment come before them). Null for anything else.
 */
export function parsePowerSetting(output: string): PowerTimeouts | null {
  const values = output.match(/0x[0-9a-f]+/gi);
  if (!values || values.length < 2) return null;
  const [ac, dc] = values.slice(-2).map(value => Number.parseInt(value, 16));
  return Number.isSafeInteger(ac) && Number.isSafeInteger(dc) ? { ac: ac!, dc: dc! } : null;
}
/** The active plan's name from `powercfg /getactivescheme`: the last parenthesised text (translated by Windows). */
export function parseActiveScheme(output: string): string | null {
  const names = [...output.matchAll(/\(([^()\r\n]+)\)/g)];
  return names.at(-1)?.[1]?.trim() || null;
}

const QUERY = { windowsHide: true, timeout: 2000, maxBuffer: 1024 * 1024 } as const;
async function run(file: string, args: string[]): Promise<string | null> {
  try { return (await execute(file, args, QUERY)).stdout; } catch { return null; }
}
const OFF_WINDOWS: PowerStatus = { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null };

/** Read-only: never changes a power setting. `runner` is replaceable for tests. */
export async function powerStatus(runner: (file: string, args: string[]) => Promise<string | null> = run, platform = process.platform): Promise<PowerStatus> {
  if (platform !== 'win32') return OFF_WINDOWS;
  const [video, sleep, scheme] = await Promise.all([
    runner('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_VIDEO', 'VIDEOIDLE']),
    runner('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']),
    runner('powercfg.exe', ['/getactivescheme']),
  ]);
  const displayOffSeconds = video === null ? null : parsePowerSetting(video);
  const sleepSeconds = sleep === null ? null : parsePowerSetting(sleep);
  const result: PowerStatus = { available: true, scheme: scheme === null ? null : parseActiveScheme(scheme), displayOffSeconds, sleepSeconds };
  if (!displayOffSeconds || !sleepSeconds) result.error = 'Windows power settings could not be read.';
  return result;
}

/** Defaults read the current device; source tests supply their own runner and platform. */
export async function windowsStatus(runner: (file: string, args: string[]) => Promise<string | null> = run, platform = process.platform): Promise<WindowsStatus> {
  if (platform !== 'win32') return { available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, power: OFF_WINDOWS };
  const [screensaver, power] = await Promise.all([runner('reg.exe', ['query', 'HKCU\\Control Panel\\Desktop']), powerStatus(runner, platform)]);
  if (screensaver === null) return { available: true, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, error: 'Windows screensaver settings could not be read.', power };
  return { ...parseWindowsStatus(screensaver), power };
}
