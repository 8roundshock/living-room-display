import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LivingSceneArt, ScenePath } from '../shared/living-scene-art';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry';
import type { ThemeRect, ThemeScene, WeatherMotif } from './ambient-theme';
import { habitatBox, habitatMotion, fitHabitatGroup, fitHabitatPatch, patchExtent, patchPriority, patchPhase, patchQuality, rainField, rainImpacts, snowField, fogContour, driftForm, DRIFT_FORMS, type HabitatBox } from './living-scene';
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
  const atmosphere = weather ?? art.air;
  const patches = scene.quiet ? art.patches.filter(patch => patch.depth === 'habitat').slice(0, 2) : art.patches;
  const weatherGroups = scene.quiet ? [0] : [0, 1, 2];
  // Whole-patch roots are chosen once per local generation (and per still layout),
  // principal drawing first. A root is chosen again only when later reading-space
  // changes cost it most of its silhouette; that patch then fades in at its new root.
  const placed = useRef(new Map<string, { key: string; box: HabitatBox; extent: ThemeRect | null; quality: number; epoch: number }>());
  const phases = patches.map((_, index) => patchPhase(elapsed, index));
  if (width > 0) {
    const live = new Set(patches.map(patch => patch.id));
    for (const id of placed.current.keys()) if (!live.has(id)) placed.current.delete(id);
    const occupied: ThemeRect[] = [];
    for (const index of patchPriority(patches, width, height)) {
      const patch = patches[index]!, far = patch.depth === 'far';
      const key = `${phases[index]!.generation}:${width}:${height}:${weather}:${scene.quiet}:${still ? JSON.stringify(holes) : ''}`;
      let entry = placed.current.get(patch.id);
      const lost = entry?.key === key && patchQuality(patch, entry.box, holes, weather, scene.quiet) < entry.quality * .6;
      if (!entry || entry.key !== key || lost) {
        const box = fitHabitatPatch(patch, width, height, holes, weather, scene.quiet, phases[index]!.generation, far ? [] : occupied);
        entry = { key, box, extent: far ? null : patchExtent(patch, box, holes, weather, scene.quiet), quality: patchQuality(patch, box, holes, weather, scene.quiet), epoch: (entry?.epoch ?? 0) + (lost ? 1 : 0) };
        placed.current.set(patch.id, entry);
      }
      if (entry.extent) occupied.push(entry.extent);
    }
  }
  const drifting = !scene.quiet && (!atmosphere && !weather || weather === 'wind');
  return <div ref={root} className="ambient-theme living-theme" aria-hidden="true" data-theme-motif={scene.motif}
    data-theme-habitat={scene.habitat ?? scene.motif} data-theme-source={scene.source} data-theme-quiet={scene.quiet || undefined}
    data-theme-still={still || undefined} data-scene-elapsed={elapsed} data-scene-revision={revision}>
    {width > 0 && <svg className="living-canvas" viewBox={`0 0 ${width} ${height}`}>
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: 'luminance' }}>
        <rect width={width} height={height} fill="white" />
        {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={Math.max(0, hole.right - hole.left)} height={Math.max(0, hole.bottom - hole.top)} rx={Math.min(width, height) * .014} fill="black" />)}
      </mask></defs>
      <g mask={`url(#${maskId})`} data-reading-mask>
        {patches.map((patch, index) => {
          const phase = phases[index]!, entry = placed.current.get(patch.id)!, authored = habitatBox(patch, width, height, phase.generation);
          return <HabitatPatch key={`${patch.id}:${phase.generation}:${entry.epoch}`} patch={patch} box={entry.box} initialAge={phase.age} palette={palette}
            relocated={Math.abs(entry.box.x - authored.x) > 1 || Math.abs(entry.box.y - authored.y) > 1 || Math.abs(entry.box.width - authored.width) > 1}
            weather={weather} quiet={scene.quiet} generation={phase.generation} holes={holes} />;
        })}
        {drifting && <g className="living-drift-field" data-scene-drift={art.passage.kind}>
          {Array.from({ length: DRIFT_FORMS }, (_, index) => {
            const form = driftForm(index, elapsed, width, height, art.passage.kind, weather === 'wind');
            return (still || form.iteration > 0) && <DriftForm key={`${index}:${form.iteration}`} form={form} art={art.passage} palette={palette} />;
          })}
        </g>}
        {(weather === 'rain' || weather === 'storm') && <g className="living-weather" data-scene-weather={weather}>
          {weatherGroups.map(index => <RainPhrase key={`${index}:${Math.floor(elapsed / LIVING_SCENE_BUDGET.life)}`} index={index}
            elapsed={elapsed % LIVING_SCENE_BUDGET.life} width={width} height={height} palette={palette} still={still} />)}
        </g>}
        {(atmosphere === 'snow' || atmosphere === 'fog') && <g className="living-weather" data-scene-weather={atmosphere}>
          {weatherGroups.map(index => <AirPhrase key={`${index}:${Math.floor(elapsed / LIVING_SCENE_BUDGET.life)}:${width}:${height}`} index={index}
            elapsed={elapsed % LIVING_SCENE_BUDGET.life} width={width} height={height} palette={palette} kind={atmosphere} quiet={scene.quiet} holes={holes} />)}
        </g>}
      </g>
    </svg>}
  </div>;
});

function HabitatPatch({ patch, box, relocated, initialAge, palette, weather, quiet, generation, holes }: {
  patch: LivingSceneArt['patches'][number]; box: HabitatBox; relocated: boolean; initialAge: number; palette: readonly string[];
  weather: WeatherMotif | undefined; quiet: boolean; generation: number;
  holes: readonly ThemeRect[];
}) {
  // Freeze the delay at this generation's mount. Geometry invalidation never restarts its age.
  const [age] = useState(initialAge);
  const [born] = useState(() => performance.now());
  return <svg className="living-patch" data-scene-patch={patch.id} data-scene-depth={patch.depth} data-scene-edge={patch.edge} data-scene-generation={generation}
    data-scene-born={born} data-scene-relocated={relocated || undefined}
    x={box.x} y={box.y} width={box.width} height={box.height} viewBox={`0 0 ${patch.viewBox[0]} ${patch.viewBox[1]}`} overflow="hidden"
    opacity={patch.opacity ?? (patch.depth === 'far' ? .48 : 1)}>
    <g className="living-patch-life" transform={box.mirror ? `translate(${patch.viewBox[0]} 0) scale(-1 1)` : undefined} data-scene-mirrored={box.mirror || undefined} style={{ '--patch-life': `${LIVING_SCENE_BUDGET.life}ms`, '--patch-age': `-${age}ms` } as CSSProperties}>
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

/** One detached form released by the habitat: a single finite drift, replaced at
 * its own boundary while invisible. It stays under the reading mask. */
function DriftForm({ form, art, palette }: { form: ReturnType<typeof driftForm>; art: LivingSceneArt['passage']; palette: readonly string[] }) {
  const [born] = useState(() => performance.now());
  const height = form.size * art.viewBox[1] / art.viewBox[0];
  return <g className="living-drift" data-scene-born={born} style={{ '--drift-duration': `${form.duration}ms`, '--drift-from': `rotate(${form.turn[0]}deg)`,
    '--drift-mid': `translate(${form.mid[0]}px, ${form.mid[1]}px) rotate(${form.turn[1]}deg)`, '--drift-end': `translate(${form.end[0]}px, ${form.end[1]}px) rotate(${form.turn[2]}deg)` } as CSSProperties}>
    <svg x={form.x - form.size / 2} y={form.y - height / 2} width={form.size} height={height} viewBox={`0 0 ${art.viewBox[0]} ${art.viewBox[1]}`} overflow="visible">
      {art.paths.map((path, index) => <path key={index} d={path.d} fill={palette[(path.tone + form.tone) % 3]} fillOpacity={.2} stroke={palette[(path.tone + form.tone) % 3]}
        strokeWidth={(path.stroke ?? 1.5) * 1.5} opacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  </g>;
}

function AirPhrase({ index, elapsed, width, height, palette, kind, quiet, holes }: { index: number; elapsed: number; width: number; height: number; palette: readonly string[]; kind: 'snow' | 'fog'; quiet: boolean; holes: readonly ThemeRect[] }) {
  const [age] = useState(elapsed);
  // A ribbon keeps the open place it was given for this phrase; later reading-space growth only masks it.
  const [contour] = useState(() => kind === 'fog' ? fogContour(width, height, index, holes) : '');
  const [born] = useState(() => performance.now());
  return <g data-scene-born={born} className={`living-air living-${kind}`} style={{ '--air-age': `${-(age + index * 4000)}ms`, '--air-mid': `translate(${width * .008}px, ${kind === 'snow' ? height * .06 : height * .003}px)`,
    '--air-end': `translate(${width * (kind === 'snow' ? -.006 : .026)}px, ${kind === 'snow' ? height * .12 : height * .006}px)` } as CSSProperties}>
    <path d={kind === 'snow' ? snowField(width, height, index, quiet) : contour} fill="none" stroke={palette[index]}
      strokeWidth={Math.max(.5, Math.min(width, height) * (kind === 'snow' ? .0016 : .0026))} strokeLinecap="round" opacity={kind === 'snow' ? .9 : .72} />
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
