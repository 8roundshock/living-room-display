import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export interface WindowsStatus {
  available: boolean; selectedScreenSaver: string | null; active: boolean | null;
  timeoutSeconds: number | null; secure: boolean | null; isLivingRoomDisplay: boolean; error?: string;
}
export function parseWindowsStatus(output: string): WindowsStatus {
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
export async function windowsStatus(): Promise<WindowsStatus> {
  if (process.platform !== 'win32') return { available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false };
  try {
    const { stdout } = await execute('reg.exe', ['query', 'HKCU\\Control Panel\\Desktop'], { windowsHide: true, timeout: 2000, maxBuffer: 1024 * 1024 });
    return parseWindowsStatus(stdout);
  } catch { return { available: true, selectedScreenSaver: null, active: null, timeoutSeconds: null, secure: null, isLivingRoomDisplay: false, error: 'Windows screensaver settings could not be read.' }; }
}
