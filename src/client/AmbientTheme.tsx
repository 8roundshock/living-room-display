import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { THEME_ACTIVE_MS, THEME_SCENES } from '../shared/theme-registry';
import { placeThemeMark, themeCadence, type ThemeRect, type ThemeScene } from './ambient-theme';
import './ambient-theme.css';

type Exclusions = () => readonly ThemeRect[];
interface ThemeProps { scene: ThemeScene | null; animated: boolean; still?: boolean; exclusions: Exclusions; layoutKey: string }

/** Static editor art is explicit; disabled/reduced display motion never mounts a sequence. */
export const AmbientTheme = memo(function AmbientTheme({ scene, animated, still = false, exclusions, layoutKey }: ThemeProps) {
  return scene && (animated || still) ? <ThemeSequence key={`${scene.motif}:${still}:${layoutKey}`} scene={scene} still={still} exclusions={exclusions} /> : null;
});

/** Finite transform/opacity animations. Placement reads only at slot renewal or resize. */
function ThemeSequence({ scene, still, exclusions }: { scene: ThemeScene; still: boolean; exclusions: Exclusions }) {
  const [tick, setTick] = useState(0);
  const [seed] = useState(() => still ? 579 : Math.floor(Date.now() / 1000));
  const root = useRef<HTMLDivElement>(null);
  const measuredSize = useRef('');
  const [marks, setMarks] = useState<{ generation: number; index: number; left: number; top: number; size: number; box: ThemeRect }[]>([]);
  const definition = THEME_SCENES[scene.motif], { slots, interval } = themeCadence(scene.motif);
  useEffect(() => {
    if (still) return;
    const timer = window.setInterval(() => setTick(value => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [interval, still]);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const nextSize = `${width}:${height}`, resize = measuredSize.current !== nextSize;
      measuredSize.current = nextSize;
      const occupied = [...exclusions()];
      setMarks(previous => {
        const next = resize || still ? [] : previous.filter(mark => tick - mark.generation < slots);
        occupied.push(...next.map(mark => mark.box));
        const count = still ? 3 : 1;
        for (let index = 0; index < count; index++) {
          const generation = still ? index : tick;
          if (next.some(mark => mark.generation === generation)) continue;
          const artIndex = generation % definition.art.length;
          const size = Math.min(width, height) * definition.size / 100 * (artIndex === 0 ? 1 : .58);
          const point = placeThemeMark(generation, seed + generation, width, height, size, occupied);
          if (point) { next.push({ generation, index: artIndex, ...point }); occupied.push(point.box); }
        }
        return [...next];
      });
    };
    // Widget fit/layout effects have committed before this frame; no continuous frame loop.
    const frame = requestAnimationFrame(place);
    const resize = new ResizeObserver(place); resize.observe(element);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [tick, still, definition, exclusions, seed, slots]);
  return <div ref={root} className="ambient-theme" aria-hidden="true" data-theme-motif={scene.motif} data-theme-source={scene.source} data-theme-quiet={scene.quiet || undefined}
    data-theme-still={still || undefined} data-theme-tick={tick} data-theme-interval={interval} data-theme-motion={definition.motion}
    style={{ '--theme-tint': scene.tint, '--theme-companion': scene.companion, '--theme-duration': `${THEME_ACTIVE_MS}ms` } as CSSProperties}>
    {marks.map(mark => {
      const art = definition.art[mark.index]!;
      return <svg key={mark.generation} data-theme-generation={mark.generation} data-theme-anchor={mark.index === 0 || undefined} className="theme-mark" viewBox="0 0 100 100"
        style={{ left: mark.left, top: mark.top, width: mark.size, height: mark.size, '--theme-turn': `${mark.generation % 2 ? 5 : -5}deg` } as CSSProperties}>
        <path d={art.primary} />{art.secondary && <path className="theme-companion" d={art.secondary} />}
      </svg>;
    })}
  </div>;
}
