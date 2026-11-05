import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { THEME_ACTIVE_MS, THEME_RETIRE_MS, THEME_SCENES, THEME_MOTIONS, QUIET_THEME, type ThemeMotionFrame } from '../shared/theme-registry';
import { placeThemeMark, themeCadence, type ThemeRect, type ThemeScene } from './ambient-theme';
import './ambient-theme.css';
import { LivingTheme } from './LivingTheme';

type Exclusions = () => readonly ThemeRect[];
interface ThemeProps { scene: ThemeScene | null; animated: boolean; still?: boolean; exclusions: Exclusions; layoutKey: string; inkRevision: number }

/** Static editor art is explicit; disabled/reduced display motion never mounts a sequence. */
export const AmbientTheme = memo(function AmbientTheme({ scene, animated, still = false, exclusions, layoutKey, inkRevision }: ThemeProps) {
  const composition = scene && THEME_SCENES[scene.habitat ?? scene.motif].composition;
  if (scene && composition && (animated || still)) return <LivingTheme key={`${scene.motif}:${scene.habitat}:${scene.quiet}:${still}:${layoutKey}`} scene={scene} art={composition} still={still} exclusions={exclusions} inkRevision={inkRevision} />;
  return scene && (animated || still) ? <ThemeSequence key={`${scene.motif}:${scene.quiet}:${still}:${layoutKey}`} scene={scene} still={still} exclusions={exclusions} inkRevision={inkRevision} /> : null;
});

/** Finite transform/opacity animations. Placement reads only at slot renewal or resize. */
function ThemeSequence({ scene, still, exclusions, inkRevision }: { scene: ThemeScene; still: boolean; exclusions: Exclusions; inkRevision: number }) {
  const [tick, setTick] = useState(0);
  const [seed] = useState(() => still ? 579 : Math.floor(Date.now() / 1000));
  const root = useRef<HTMLDivElement>(null);
  const measuredSize = useRef('');
  const [resizeRevision, setResizeRevision] = useState(0);
  const [marks, setMarks] = useState<{ generation: number; born: number; index: number; feature: boolean; frames: readonly ThemeMotionFrame[]; left: number; top: number; size: number; box: ThemeRect; obscured: boolean }[]>([]);
  const definition = THEME_SCENES[scene.motif], { slots, interval } = themeCadence(scene.motif, scene.quiet);
  useEffect(() => {
    if (still) return;
    const timer = window.setInterval(() => setTick(value => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [interval, still]);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    // Keep one observer per mounted scene. Re-observing every slot renewal delivers
    // another initial callback and duplicates placement/style work despite no resize.
    const observer = new ResizeObserver(() => setResizeRevision(value => value + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const nextSize = `${width}:${height}`, resize = measuredSize.current !== nextSize;
      measuredSize.current = nextSize;
      const occupied = [...exclusions()];
      setMarks(previous => {
        const next = resize || still ? [] : previous.filter(mark => tick - mark.generation < slots).map(mark => ({ ...mark,
          // A growing reading area fades only intersecting marks; their ages never restart.
          obscured: mark.obscured || occupied.some(rect => mark.box.left < rect.right && mark.box.right > rect.left && mark.box.top < rect.bottom && mark.box.bottom > rect.top) }));
        occupied.push(...next.filter(mark => !mark.obscured).map(mark => mark.box));
        const count = still ? (scene.quiet ? QUIET_THEME.still : definition.still) : 1;
        for (let index = 0; index < count; index++) {
          const generation = still ? index : tick;
          if (next.some(mark => mark.generation === generation)) continue;
          // A feature returns every third birth. The intervening companions cycle
          // through distinct forms/colours rather than all becoming tiny veins.
          const feature = generation % 3 === 0;
          const artIndex = feature || definition.art.length === 1 ? 0 : 1 + (Math.floor(generation / 3) * 2 + generation % 3 - 1) % (definition.art.length - 1);
          const art = definition.art[artIndex]!;
          const size = Math.min(width, height) * definition.size / 100 * (feature ? 1 : (definition.group === 'Weather' ? [.75, .7, .85] : [.44, .55, .65])[generation % 3]!);
          const scale = (scene.quiet ? QUIET_THEME.motionScale : 1) * (.8 + generation % 3 * .1);
          const motion = art.motion ?? definition.motion;
          const mirror = ['sway', 'flutter', 'rise', 'snow'].includes(motion) && generation % 2 ? -1 : 1;
          const frames = THEME_MOTIONS[motion].map(frame => still ? { x: 0, y: 0, turn: 0 } : { x: frame.x * scale * mirror, y: frame.y * scale, turn: frame.turn * scale * mirror });
          const point = placeThemeMark(generation, seed + generation, width, height, size, occupied, frames);
          if (point) { next.push({ generation, born: performance.now(), index: artIndex, feature, frames, ...point, obscured: false }); occupied.push(point.box); }
        }
        return [...next];
      });
    };
    // Widget fit/layout effects have committed before this frame; no continuous frame loop.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [tick, still, definition, exclusions, seed, slots, scene.quiet, inkRevision, resizeRevision]);
  return <div ref={root} className="ambient-theme" aria-hidden="true" data-theme-motif={scene.motif} data-theme-source={scene.source} data-theme-quiet={scene.quiet || undefined}
    data-theme-still={still || undefined} data-theme-tick={tick} data-theme-interval={interval} data-theme-motion={definition.motion}
    style={{ '--theme-duration': `${THEME_ACTIVE_MS}ms`, '--theme-retire-duration': `${THEME_RETIRE_MS}ms` } as CSSProperties}>
    {marks.map(mark => {
      const art = definition.art[mark.index]!;
      const palette = [scene.tint, scene.companion, scene.accent], tone = art.tone ?? (mark.feature ? 0 : mark.index % 3);
      const steps = Object.fromEntries(mark.frames.map((frame, index) => [`--theme-step-${index}`, `translate3d(${frame.x}cqw,${frame.y}cqh,0) rotate(${frame.turn}deg)`]));
      return <div key={mark.generation} className="theme-placement" data-theme-obscured={mark.obscured || undefined}
        style={{ left: mark.left, top: mark.top, width: mark.size, height: mark.size, '--theme-tint': palette[tone], '--theme-companion': palette[art.secondaryTone ?? (tone + 1) % 3], '--theme-accent': palette[(tone + 2) % 3], ...steps } as CSSProperties}>
        <svg data-theme-generation={mark.generation} data-theme-born={mark.born} data-theme-anchor={mark.feature || undefined} data-theme-motion={art.motion ?? definition.motion} className="theme-mark" viewBox="0 0 100 100">
        {art.wash && <path className="theme-wash" d={art.wash} />}
        <path d={art.primary} />{art.secondary && <path className="theme-companion" d={art.secondary} />}{art.accent && <path className="theme-accent" d={art.accent} />}
      </svg></div>;
    })}
  </div>;
}
