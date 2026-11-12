import { useEffect, useState, type KeyboardEvent } from 'react';
import { MOVEMENT_PREVIEW_SECONDS, previewTimeLabel } from '../shared/movementTimeline.ts';
import './motion-preview.css';

/** Keyboard steps on the hour slider (#686): the arrows move a few seconds, Page Up and Page Down a minute. */
const KEY_SECONDS: Readonly<Record<string, number>> = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 60, PageDown: -60 };
const clampPreview = (value: number) => Math.max(0, Math.min(MOVEMENT_PREVIEW_SECONDS, Number.isFinite(value) ? value : 0));

/** This clock belongs only to the mounted editor. It never changes Date, polling or saved settings. It covers one hour
 * (#686) and starts at 0:00 whenever the preview opens. A change of settings keeps the position, so the same moment is
 * shown with the new settings. */
export function useMotionPreview(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { setSeconds(0); }, [active]);
  return { seconds, duration: MOVEMENT_PREVIEW_SECONDS, seek: (value: number) => setSeconds(clampPreview(value)) };
}

/** One slider over an hour of the display's movement with the draft settings (#686): the board, each widget's content
 * and the 3D scene (#678) are drawn where they would be at that moment. */
export function MotionPreviewControls({ clock, swaps }: { clock: ReturnType<typeof useMotionPreview>; swaps: boolean }) {
  const { seconds, duration, seek } = clock;
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = KEY_SECONDS[event.key], target = event.key === 'Home' ? 0 : event.key === 'End' ? duration : step === undefined ? null : seconds + step;
    if (target === null) return;
    event.preventDefault(); seek(target);
  };
  return <section className="motion-preview-controls" aria-label="Movement preview" data-swaps={swaps}>
    <div className="motion-preview-row">
      <input type="range" min="0" max={duration} step="1" value={seconds} aria-label="Movement preview time" aria-valuetext={`${previewTimeLabel(seconds)} of ${previewTimeLabel(duration)}`}
        aria-describedby="motion-preview-note" onKeyDown={keys} onChange={event => seek(Number(event.target.value))} />
      <output className="motion-preview-time" aria-label="Preview elapsed time">{previewTimeLabel(seconds)} <span>/ {previewTimeLabel(duration)}</span></output>
    </div>
    <p className="motion-preview-note" id="motion-preview-note">Where the board, widgets and scene would be at each moment of an hour with these settings. Nothing changes on the display or in saved settings.</p>
  </section>;
}
