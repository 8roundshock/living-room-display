import { useEffect, useRef, useState } from 'react';
import { dimSeconds, glideSeconds, movementWindow, previewTimeLabel, type MovementTiming } from '../shared/movementTimeline.ts';
import { Icon } from './icons';
import './motion-preview.css';

/** This clock belongs only to the mounted editor. It never changes Date, polling or saved settings. */
export function useMotionPreview(active: boolean, timing: MovementTiming, resetKey: string) {
  const [seconds, setSeconds] = useState(0), [playing, setPlaying] = useState(false), [intervals, setIntervals] = useState(4);
  const duration = movementWindow(intervals, timing), current = useRef(seconds);
  current.current = seconds;
  useEffect(() => { setPlaying(false); setSeconds(0); }, [active, resetKey]);
  useEffect(() => { setPlaying(false); setSeconds(value => Math.min(value, duration)); }, [duration]);
  useEffect(() => {
    if (!active || !playing) return;
    const start = performance.now(), from = current.current;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(duration, from + (now - start) / 1000);
      setSeconds(next);
      if (next >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, playing, duration]);
  return {
    seconds, playing, intervals, duration, setIntervals,
    seek: (value: number) => { setPlaying(false); setSeconds(Math.max(0, Math.min(duration, value))); },
    toggle: () => { if (seconds >= duration) setSeconds(0); setPlaying(value => !value); },
  };
}

export function MotionPreviewControls({ clock, timing, reducedMotion }: { clock: ReturnType<typeof useMotionPreview>; timing: MovementTiming & { floating: boolean }; reducedMotion: boolean }) {
  const { seconds, playing, duration, intervals } = clock;
  return <section className="motion-preview-controls" aria-label="Movement preview" data-swaps={timing.swaps}>
    <div className="motion-preview-actions">
      <button className="button small" onClick={clock.toggle} aria-label={playing ? 'Pause movement preview' : 'Play movement preview'}><Icon name={playing ? 'pause' : 'play'} size={16} />{playing ? 'Pause' : 'Play'}</button>
      <button className="icon-button" aria-label="Back one second" disabled={seconds <= 0} onClick={() => clock.seek(seconds - 1)}><Icon name="chevronLeft" size={17} /></button>
      <button className="icon-button" aria-label="Forward one second" disabled={seconds >= duration} onClick={() => clock.seek(seconds + 1)}><Icon name="chevronRight" size={17} /></button>
      <output className="motion-preview-time" aria-label="Preview elapsed time">{previewTimeLabel(seconds)} <span>/ {previewTimeLabel(duration)}</span></output>
      <label className="motion-preview-window">Window <select className="select-input" aria-label="Movement preview window" value={intervals} onChange={event => clock.setIntervals(Number(event.target.value))}>
        {[4, 12, 24].map(count => <option key={count} value={count}>{count} intervals</option>)}
      </select></label>
    </div>
    <input type="range" min="0" max={duration} step="0.05" value={seconds} aria-label="Movement preview time" aria-valuetext={`${previewTimeLabel(seconds)} of ${previewTimeLabel(duration)}`} aria-describedby="motion-preview-scope" onChange={event => clock.seek(Number(event.target.value))} />
    <div className="motion-preview-boundaries" aria-label="Jump to movement boundary">
      <button onClick={() => clock.seek(0)}>Start</button>
      {Array.from({ length: intervals }, (_, index) => index + 1).map(index => <button key={index} onClick={() => clock.seek(index * timing.interval)} aria-label={`Jump to interval ${index}`}>{index}</button>)}
      <button onClick={() => clock.seek(duration)}>End</button>
    </div>
    <details className="motion-preview-scope" id="motion-preview-scope">
      <summary>{intervals} intervals from this layout · {timing.swaps ? 'content movement and swaps' : 'content movement'} · every {timing.interval} s</summary>
      <p>The board and each widget follow different waypoint tracks. This window shows {intervals} intervals; the paths continue and do not repeat as one short cycle.
        {timing.swaps ? ` Swaps start every ${timing.interval} s; ${timing.glide ? `each glide lasts ${glideSeconds(timing.fade)} s` : `each dim-and-move takes ${2 * dimSeconds(timing.fade)} s`}. The last transition is included.` : ' Swap places is off, so widgets keep their cells.'}
        {reducedMotion ? ' Reduced motion is on: positions step instead of gliding.' : !timing.floating ? ' Float gently is off: positions step at each interval.' : ''}
        {' '}Scrubbing affects only this preview. Live information keeps updating; saved settings and the display stay unchanged. Movement uses this canvas’s scale; distances on the TV will differ.</p>
    </details>
  </section>;
}
