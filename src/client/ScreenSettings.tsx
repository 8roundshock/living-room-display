import { useEffect, useState } from 'react';
import type { AppearanceSettings, WindowsStatus } from '../shared/contracts';
import { InfoTip } from './InfoTip';
import { api } from './api';

/** "30 s", "3 min", "1 min 30 s" for the movement interval. */
export function intervalLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
/** A Windows power timeout as Settings shows it: "Never", "10 min", "1 hour". */
export function powerLabel(seconds: number): string {
  if (seconds <= 0) return 'Never';
  if (seconds < 60) return `${seconds} s`;
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} min`;
}

/** The live sentence under Move every (#436): what the display will do with these choices. */
export function motionSentence(appearance: Pick<AppearanceSettings, 'motionEnabled' | 'motionIntervalSeconds' | 'rearrange'>): string {
  const every = intervalLabel(appearance.motionIntervalSeconds);
  if (appearance.rearrange)
    return appearance.motionEnabled
      ? `Floats and swaps places every ${every}.`
      : `Swaps places every ${every}, without animation.`;
  return appearance.motionEnabled
    ? `Floats within your layout, reaching a new spot every ${every}.`
    : `Shifts within your layout every ${every}, without animation.`;
}

export function MotionSentence({ appearance }: { appearance: AppearanceSettings }) {
  return <p className="hint motion-sentence" aria-live="polite">{motionSentence(appearance)}</p>;
}

/**
 * The warning when Windows would turn the screen off or sleep before this app's screensaver starts
 * (#436): plugged-in (AC) values, the ones a TV PC uses. Null when there is nothing to warn about.
 */
export function powerWarning(status: WindowsStatus | null): string | null {
  if (!status?.available || !status.isLivingRoomDisplay || !status.timeoutSeconds || !status.power.available) return null;
  const saver = status.timeoutSeconds;
  const early = (value: number | undefined) => value !== undefined && value > 0 && value <= saver;
  const displayOff = status.power.displayOffSeconds?.ac, sleep = status.power.sleepSeconds?.ac;
  const offFirst = early(displayOff) && (!early(sleep) || displayOff! <= sleep!);
  if (!offFirst && !early(sleep)) return null;
  const what = offFirst ? `Windows turns the screen off after ${powerLabel(displayOff!)}` : `Windows sleeps after ${powerLabel(sleep!)}`;
  return `${what}, before your screensaver starts at ${powerLabel(saver)}, so the display won't appear. Change it in Settings › System › Power & sleep, or choose a shorter wait.`;
}

/** The read-only power line, for example "Windows turns the screen off after Never · Sleeps after Never". */
export function powerLine(status: WindowsStatus | null): string | null {
  const power = status?.power;
  if (!power?.available) return null;
  if (!power.displayOffSeconds || !power.sleepSeconds) return power.error ?? 'Windows power settings could not be read.';
  return `Windows turns the screen off after ${powerLabel(power.displayOffSeconds.ac)} · Sleeps after ${powerLabel(power.sleepSeconds.ac)}`;
}

/**
 * Style › Motion › Screen (#436): Keep the screen on, with this PC's Windows power facts read once,
 * the first time the Motion section opens (`active`). It never changes Windows. It lives inside
 * Motion so the Style tab still fits a 1280 × 720 editor without scrolling.
 */
export function ScreenSettings({ keepAwake, onKeepAwake, active }: { keepAwake: boolean; onKeepAwake: (value: boolean) => void; active: boolean }) {
  const [status, setStatus] = useState<WindowsStatus | null>(null);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!active || requested) return;
    setRequested(true);
    api<WindowsStatus>('/api/windows/status').then(setStatus, () => undefined);
  }, [active, requested]);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const line = powerLine(status), warning = powerWarning(status);
  return (
    <div className="screen-settings" role="group" aria-labelledby="screen-settings-label">
      <div className="field-label-with-help"><span className="field-label" id="screen-settings-label">Screen</span><InfoTip label="About keeping the screen on">Keeps the screen awake in full screen or screensaver mode. Windows power settings apply otherwise.</InfoTip></div>
        <label className="toggle-row">
          <span>Keep the screen on</span>
          <input className="toggle" type="checkbox" checked={keepAwake} onChange={(event) => onKeepAwake(event.target.checked)} />
        </label>
        {!supported && (
          <p className="hint keep-awake-unsupported">
            This browser can't keep the screen on. The screensaver display uses Microsoft Edge, which can.
          </p>
        )}
        {line && <p className="hint power-status" role="status">{line}</p>}
        {warning && <p className="power-warning" role="alert">{warning}</p>}
    </div>
  );
}
