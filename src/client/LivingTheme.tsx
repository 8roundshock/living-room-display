import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LivingSceneArt, ScenePath } from '../shared/living-scene-art';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry';
import type { ThemeRect, ThemeScene, WeatherMotif } from './ambient-theme';
import { habitatBox, habitatMotion, fitHabitatGroup, patchPhase, rainField, rainImpacts, snowField, fogContour } from './living-scene';
import './living-scene.css';

interface Props { scene: ThemeScene; art: LivingSceneArt; still: boolean; exclusions: () => readonly ThemeRect[]; inkRevision: number }

function ArtPath({ path, palette, quiet }: { path: ScenePath; palette: readonly string[]; quiet: boolean }) {
  return <path d={path.d} fill={path.fill && !quiet ? palette[path.tone] : 'none'} fillOpacity={path.fill ?? 0}
    stroke={path.stroke === 0 ? 'none' : palette[path.tone]} strokeWidth={path.stroke ?? 1.5}
    opacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />;
}

/** One scene, one observation clock. Only bounded renewal/content/resize events
 * read geometry. Weather and rooted groups share its phrase and palette. */
export const LivingTheme = memo(function LivingTheme({ scene, art, still, exclusions, inkRevision }: Props) {
  const root = useRef<HTMLDivElement>(null), started = useRef(performance.now());
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState({ width: 0, height: 0, elapsed: 0, holes: [] as readonly ThemeRect[] });
  const id = useId().replace(/:/g, ''), maskId = `habitat-clearance-${id}`;
  useEffect(() => {
    if (still) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), LIVING_SCENE_BUDGET.observation);
    return () => window.clearInterval(timer);
  }, [still]);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const observer = new ResizeObserver(() => setRevision(value => value + 1));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const handle = requestAnimationFrame(() => {
      const bounds = root.current?.getBoundingClientRect(); if (!bounds) return;
      setFrame({ width: bounds.width, height: bounds.height, elapsed: still ? 0 : performance.now() - started.current, holes: exclusions() });
    });
    return () => cancelAnimationFrame(handle);
  }, [revision, inkRevision, exclusions, still]);
  const { width, height, elapsed, holes } = frame;
  const palette = [scene.tint, scene.companion, scene.accent];
  const weather = scene.source === 'weather' ? scene.motif as WeatherMotif : undefined;
  const atmosphere = weather ?? (scene.motif === 'winter' ? 'snow' : undefined);
  return <div ref={root} className="ambient-theme living-theme" aria-hidden="true" data-theme-motif={scene.motif}
    data-theme-habitat={scene.habitat ?? scene.motif} data-theme-source={scene.source} data-theme-quiet={scene.quiet || undefined}
    data-theme-still={still || undefined} data-scene-elapsed={elapsed} data-scene-revision={revision}>
    {width > 0 && <svg className="living-canvas" viewBox={`0 0 ${width} ${height}`}>
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: 'luminance' }}>
        <rect width={width} height={height} fill="white" />
        {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={Math.max(0, hole.right - hole.left)} height={Math.max(0, hole.bottom - hole.top)} rx={Math.min(width, height) * .014} fill="black" />)}
      </mask></defs>
      <g mask={`url(#${maskId})`} data-reading-mask>
        {art.patches.map((patch, index) => {
          const phase = patchPhase(elapsed, index), box = habitatBox(patch, width, height, phase.generation);
          return <HabitatPatch key={`${patch.id}:${phase.generation}`} patch={patch} box={box} initialAge={phase.age} palette={palette}
            weather={weather} quiet={scene.quiet} still={still} generation={phase.generation} holes={holes} />;
        })}
        {(weather === 'rain' || weather === 'storm') && <g className="living-weather" data-scene-weather={weather}>
          {[0, 1, 2].map(index => <RainPhrase key={`${index}:${Math.floor(elapsed / LIVING_SCENE_BUDGET.life)}`} index={index}
            elapsed={elapsed % LIVING_SCENE_BUDGET.life} width={width} height={height} palette={palette} still={still} />)}
        </g>}
        {(atmosphere === 'snow' || atmosphere === 'fog') && <g className="living-weather" data-scene-weather={atmosphere}>
          {[0, 1, 2].map(index => <AirPhrase key={`${index}:${Math.floor(elapsed / LIVING_SCENE_BUDGET.life)}`} index={index}
            elapsed={elapsed % LIVING_SCENE_BUDGET.life} width={width} height={height} palette={palette} kind={atmosphere} quiet={scene.quiet} />)}
        </g>}
      </g>
    </svg>}
  </div>;
});

function HabitatPatch({ patch, box, initialAge, palette, weather, quiet, still, generation, holes }: {
  patch: LivingSceneArt['patches'][number]; box: ReturnType<typeof habitatBox>; initialAge: number; palette: readonly string[];
  weather: WeatherMotif | undefined; quiet: boolean; still: boolean; generation: number;
  holes: readonly ThemeRect[];
}) {
  // Freeze the delay at this generation's mount. Geometry invalidation never restarts its age.
  const [age] = useState(initialAge);
  const [born] = useState(() => performance.now());
  return <svg data-scene-patch={patch.id} data-scene-depth={patch.depth} data-scene-generation={generation}
    data-scene-born={born}
    x={box.x} y={box.y} width={box.width} height={box.height} viewBox={`0 0 ${patch.viewBox[0]} ${patch.viewBox[1]}`} overflow="hidden"
    opacity={patch.opacity ?? (patch.depth === 'far' ? .48 : 1)}>
    <g className="living-patch-life" style={{ '--patch-life': `${LIVING_SCENE_BUDGET.life}ms`, '--patch-age': `-${age}ms` } as CSSProperties}>
      {patch.groups.map(group => {
        const fitted = fitHabitatGroup(group, patch, box, holes, weather, quiet);
        const moves = habitatMotion(group, weather, quiet);
        const style = { transformOrigin: `${group.pivot[0]}px ${group.pivot[1]}px`, '--group-phase': `${-(age + (group.phase ?? 0) * 1000)}ms`,
          ...Object.fromEntries(moves.map((value, index) => [`--habitat-step-${index}`, value])) } as CSSProperties;
        return <g key={group.id} data-scene-fit={group.id} data-scene-compact={fitted.compact || undefined} data-scene-omitted={!fitted.visible || undefined}
          transform={fitted.transform} opacity={fitted.visible ? 1 : 0}>
          <g className="living-attached" data-scene-group={group.id} data-scene-motion={group.motion} style={style}>
            {fitted.paths.map((path, index) => <ArtPath key={index} path={path} palette={palette} quiet={quiet} />)}
          </g>
        </g>;
      })}
    </g>
  </svg>;
}

function AirPhrase({ index, elapsed, width, height, palette, kind, quiet }: { index: number; elapsed: number; width: number; height: number; palette: readonly string[]; kind: 'snow' | 'fog'; quiet: boolean }) {
  const [age] = useState(elapsed);
  const [born] = useState(() => performance.now());
  return <g data-scene-born={born} className={`living-air living-${kind}`} style={{ '--air-age': `${-(age + index * 4000)}ms`, '--air-mid': `translate(${width * .008}px, ${kind === 'snow' ? height * .06 : height * .003}px)`,
    '--air-end': `translate(${width * (kind === 'snow' ? -.006 : .026)}px, ${kind === 'snow' ? height * .12 : height * .006}px)` } as CSSProperties}>
    <path d={kind === 'snow' ? snowField(width, height, index, quiet) : fogContour(width, height, index)} fill="none" stroke={palette[index]}
      strokeWidth={Math.max(.5, Math.min(width, height) * (kind === 'snow' ? .0012 : .0018))} strokeLinecap="round" opacity={kind === 'snow' ? .85 : .6} />
  </g>;
}

function RainPhrase({ index, elapsed, width, height, palette, still }: { index: number; elapsed: number; width: number; height: number; palette: readonly string[]; still: boolean }) {
  const [age] = useState(elapsed);
  const [born] = useState(() => performance.now());
  return <g data-scene-born={born} style={{ '--rain-age': `${-(age + index * 1200)}ms`, '--rain-travel': `translate(${-height * .035}px, ${height * .105}px)` } as CSSProperties}>
    <g className="living-rain"><path d={rainField(width, height, index)} fill="none" stroke={palette[index % 2]} strokeWidth={Math.max(.6, Math.min(width, height) * .0015)} strokeLinecap="round" opacity={.75} /></g>
    <g className="living-ripple"><path d={rainImpacts(width, height, index)} fill="none" stroke={palette[2]} strokeWidth={Math.max(.5, Math.min(width, height) * .001)} strokeLinecap="round" opacity={.65} /></g>
  </g>;
}
