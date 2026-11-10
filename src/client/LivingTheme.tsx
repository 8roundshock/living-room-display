import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LivingSceneArt, ScenePath } from '../shared/living-scene-art';
import { SCENE_DRESSING, type ParticleKind, type TopKind } from '../shared/living-scene-dressing';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry';
import type { ThemeRect, ThemeScene, WeatherMotif } from './ambient-theme';
import { habitatBox, habitatMotion, fitHabitatGroup, fitHabitatPatch, patchExtent, patchPriority, patchPhase, patchQuality, rainField, rainImpacts, type HabitatBox } from './living-scene';
import { fogBands, groundBand, gustStreaks, particleLayers, topBand, type DressPath, type DressSegment, type EdgeBand } from './living-dressing';
import './living-scene.css';

interface Props { scene: ThemeScene; art: LivingSceneArt; still: boolean; exclusions: () => readonly ThemeRect[]; inkRevision: number }
type Placement = { key: string; box: HabitatBox; extent: ThemeRect | null; quality: number; epoch: number; generation: number; previous?: { box: HabitatBox; generation: number; epoch: number } };

/** A rim or highlight is the same hue mixed toward white, so filled forms read
 * as lit shapes rather than flat silhouettes. Saved brightness still scales the layer. */
function lighten(color: string, amount = .5) {
  const value = Number.parseInt(color.slice(1), 16), mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(value >> 16 & 255)},${mix(value >> 8 & 255)},${mix(value & 255)})`;
}

function ArtPath({ path, palette, quiet }: { path: ScenePath; palette: readonly string[]; quiet: boolean }) {
  // Low-light fill curve: thin authored fills (0.13-0.5) otherwise vanish against true black at
  // 26% brightness. Outlines use a lighter rim of the same hue. Nothing raises brightness globally.
  const filled = !!path.fill && !quiet;
  return <path d={path.d} fill={filled ? palette[path.tone] : 'none'} fillOpacity={path.fill ? Math.pow(path.fill, .45) : 0}
    stroke={path.stroke === 0 ? 'none' : filled ? lighten(palette[path.tone]!, .38) : palette[path.tone]} strokeWidth={path.stroke ?? 1.5}
    opacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />;
}
function Dress({ path, colors }: { path: DressPath; colors: readonly string[] }) {
  const color = path.light ? lighten(colors[path.tone]!) : colors[path.tone];
  return <path d={path.d} fill={path.fill ? color : 'none'} fillOpacity={path.fill ?? 0} stroke={path.stroke ? color : 'none'} strokeWidth={path.stroke ?? 0}
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
  const dressing = scene.quiet ? undefined : SCENE_DRESSING[scene.habitat ?? scene.motif];
  // The continuous ground band replaces the dim far bottom silhouettes of the first compositions.
  const patches = scene.quiet ? art.patches.filter(patch => patch.depth === 'habitat').slice(0, 2)
    : art.patches.filter(patch => !(dressing && patch.depth === 'far' && patch.edge.startsWith('bottom')));
  const weatherGroups = scene.quiet ? [0] : [0, 1, 2];
  // Whole-patch roots are chosen once per local generation (and per still layout),
  // principal drawing first. A root is chosen again only when later reading-space
  // changes cost it most of its silhouette (or it had none); that patch fades in at its new root.
  const placed = useRef(new Map<string, Placement>());
  const phases = patches.map((_, index) => patchPhase(elapsed, index));
  if (width > 0) {
    const live = new Set(patches.map(patch => patch.id));
    for (const id of placed.current.keys()) if (!live.has(id)) placed.current.delete(id);
    const occupied: ThemeRect[] = [];
    for (const index of patchPriority(patches, width, height)) {
      const patch = patches[index]!, far = patch.depth === 'far', generation = phases[index]!.generation;
      const key = `${generation}:${width}:${height}:${weather}:${scene.quiet}:${still ? JSON.stringify(holes) : ''}`;
      let entry = placed.current.get(patch.id);
      const current = entry?.key === key ? patchQuality(patch, entry.box, holes, weather, scene.quiet) : 0;
      const lost = entry?.key === key && (current < entry.quality * .6 || entry.quality < .05);
      if (!entry || entry.key !== key || lost) {
        const box = fitHabitatPatch(patch, width, height, holes, weather, scene.quiet, generation, far ? [] : occupied);
        const quality = patchQuality(patch, box, holes, weather, scene.quiet);
        // A patch with nowhere to go keeps looking at each observation without remounting.
        if (!(lost && entry && quality <= current + .05)) {
          const renewed = entry && !lost && entry.generation === generation - 1 && entry.key.split(':').slice(1).join(':') === key.split(':').slice(1).join(':');
          entry = { key, box, extent: far ? null : patchExtent(patch, box, holes, weather, scene.quiet), quality, generation, epoch: (entry?.epoch ?? 0) + (lost ? 1 : 0),
            previous: renewed ? { box: entry!.box, generation: entry!.generation, epoch: entry!.epoch } : undefined };
          placed.current.set(patch.id, entry);
        }
      }
      if (entry!.extent) occupied.push(entry!.extent);
    }
  }
  // Round the reading areas so slow widget float does not redraw the edge bands every observation.
  const holeKey = holes.map(hole => [hole.left, hole.top, hole.right, hole.bottom].map(value => Math.round(value / 8)).join(',')).join(';');
  const bands = useMemo(() => {
    if (!dressing || !width) return null;
    const top: TopKind | undefined = weather === 'storm' || weather === 'rain' ? 'cloud' : weather === 'fog' ? undefined : dressing.top;
    return { ground: groundBand(dressing.ground === 'mist' ? 'water' : dressing.ground, width, height, holes), top: top ? topBand(top, width, height, holes) : null, topKind: top };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- holeKey is the rounded identity of holes
  }, [dressing, weather, width, height, holeKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- holeKey is the rounded identity of holes
  const gusts = useMemo(() => weather === 'wind' && width ? gustStreaks(width, height, holes) : [], [weather, width, height, holeKey]);
  const particleKind: ParticleKind | undefined = !dressing || weather === 'rain' || weather === 'storm' || weather === 'fog' ? undefined : weather === 'snow' ? 'flake' : weather === 'wind' ? dressing.particles ?? 'leaf' : dressing.particles;
  const particleCount = weather === 'snow' ? 64 : dressing?.count ?? 26;
  const cycle = Math.floor(elapsed / LIVING_SCENE_BUDGET.life);
  const groundColors = dressing?.groundColors && !weather ? dressing.groundColors : dressing?.groundColors ?? palette;
  const topColors = bands?.topKind === 'cloud' ? palette : dressing?.topColors ?? palette;
  return <div ref={root} className="ambient-theme living-theme" aria-hidden="true" data-theme-motif={scene.motif}
    data-theme-habitat={scene.habitat ?? scene.motif} data-theme-source={scene.source} data-theme-quiet={scene.quiet || undefined}
    data-theme-still={still || undefined} data-scene-elapsed={elapsed} data-scene-revision={revision}>
    {width > 0 && <svg className="living-canvas" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: 'luminance' }}>
          <rect width={width} height={height} fill="white" />
          {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={Math.max(0, hole.right - hole.left)} height={Math.max(0, hole.bottom - hole.top)} rx={Math.min(width, height) * .014} fill="black" />)}
        </mask>
        {/* Wide soft fog must not outline reading areas as boxes: its own mask grows and blurs the holes. */}
        {weather === 'fog' && <>
          <filter id={`${maskId}-blur`} x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation={Math.min(width, height) * .017} /></filter>
          <mask id={`${maskId}-soft`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height} style={{ maskType: 'luminance' }}>
            <rect width={width} height={height} fill="white" />
            <g filter={`url(#${maskId}-blur)`}>{holes.map((hole, index) => { const grow = Math.min(width, height) * .04;
              return <rect key={index} x={hole.left - grow} y={hole.top - grow} width={Math.max(0, hole.right - hole.left) + grow * 2} height={Math.max(0, hole.bottom - hole.top) + grow * 2} rx={grow} fill="black" />; })}</g>
          </mask>
        </>}
        {weather === 'fog' && palette.map((color, index) => <linearGradient key={index} id={`${maskId}-fog-${index}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0" /><stop offset=".5" stopColor={color} stopOpacity=".8" /><stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>)}
      </defs>
      <g mask={`url(#${maskId})`} data-reading-mask>
        {bands && <EdgeLayer key={`rear:${cycle}`} age={elapsed % LIVING_SCENE_BUDGET.life} ground={bands.ground} top={bands.top} layer="segments" groundColors={groundColors} topColors={topColors} kind={dressing!.ground} topKind={bands.topKind} />}
        {patches.map((patch, index) => {
          const phase = phases[index]!, entry = placed.current.get(patch.id)!, authored = habitatBox(patch, width, height, phase.generation);
          const moved = (box: HabitatBox) => Math.abs(box.x - authored.x) > 1 || Math.abs(box.y - authored.y) > 1 || Math.abs(box.width - authored.width) > 1;
          // Renewal is a cross-fade to the next generation's slightly shifted root, never an empty interval.
          const leaving = !still && entry.previous && phase.age < LIVING_SCENE_BUDGET.crossfade ? entry.previous : null;
          return [
            leaving && <HabitatPatch key={`${patch.id}:${leaving.generation}:${leaving.epoch}`} patch={patch} box={leaving.box} initialAge={0} palette={palette} relocated={moved(leaving.box)}
              weather={weather} quiet={scene.quiet} generation={leaving.generation} holes={holes} leaving />,
            <HabitatPatch key={`${patch.id}:${phase.generation}:${entry.epoch}`} patch={patch} box={entry.box} initialAge={phase.age} palette={palette} relocated={moved(entry.box)}
              weather={weather} quiet={scene.quiet} generation={phase.generation} holes={holes} />,
          ];
        })}
        {bands && <EdgeLayer key={`front:${cycle}`} age={elapsed % LIVING_SCENE_BUDGET.life} ground={bands.ground} top={bands.top} layer="front" groundColors={groundColors} topColors={topColors} kind={dressing!.ground} topKind={bands.topKind} />}
        {particleKind && <ParticleLayer key={`${particleKind}:${cycle}:${width}:${height}`} kind={particleKind} count={particleCount} width={width} height={height} age={elapsed % LIVING_SCENE_BUDGET.life}
          gust={weather === 'wind'} palette={palette} />}
        {(weather === 'rain' || weather === 'storm') && <g className="living-weather" data-scene-weather={weather}>
          {weatherGroups.map(index => <RainPhrase key={`${index}:${cycle}`} index={index} storm={weather === 'storm'}
            elapsed={elapsed % LIVING_SCENE_BUDGET.life} width={width} height={height} palette={palette} />)}
        </g>}
        {weather === 'wind' && !scene.quiet && <g key={`gust:${cycle}:${width}:${holeKey}`} className="living-weather" data-scene-weather="wind">
            {gusts.map((streak, index) => <path key={index} className="living-gust" d={streak.d} fill="none" stroke={lighten(palette[streak.tone]!, .3)} strokeWidth={Math.max(1.5, Math.min(width, height) * .0028)} strokeLinecap="round"
              style={{ '--gust-age': `${-(elapsed % LIVING_SCENE_BUDGET.life + streak.delay * 1000)}ms`, '--gust-travel': `translate(${streak.travel}px, 0px)` } as CSSProperties} />)}
          </g>}
      </g>
      {weather === 'fog' && <g key={`fog:${cycle}:${width}`} className="living-weather" data-scene-weather="fog" data-reading-mask mask={`url(#${maskId}-soft)`}>
          {fogBands(width, height).slice(0, scene.quiet ? 2 : 4).map((band, index) => <rect key={index} className="living-fog-band" x={band.x} y={band.y} width={band.width} height={band.height} rx={band.height / 2}
            fill={`url(#${maskId}-fog-${band.tone})`} style={{ '--fog-age': `${-(elapsed % LIVING_SCENE_BUDGET.life)}ms`, '--fog-travel': `translate(${band.travel}px, 0px)` } as CSSProperties} />)}
        </g>}
    </svg>}
  </div>;
});

function HabitatPatch({ patch, box, relocated, initialAge, palette, weather, quiet, generation, holes, leaving = false }: {
  patch: LivingSceneArt['patches'][number]; box: HabitatBox; relocated: boolean; initialAge: number; palette: readonly string[];
  weather: WeatherMotif | undefined; quiet: boolean; generation: number; leaving?: boolean;
  holes: readonly ThemeRect[];
}) {
  // Freeze the delay at this generation's mount. Geometry invalidation never restarts its age.
  const [age] = useState(initialAge);
  const [born] = useState(() => performance.now());
  return <svg className="living-patch" data-scene-patch={patch.id} data-scene-depth={patch.depth} data-scene-edge={patch.edge} data-scene-generation={generation}
    data-scene-born={born} data-scene-relocated={relocated || undefined} data-scene-leaving={leaving || undefined}
    x={box.x} y={box.y} width={box.width} height={box.height} viewBox={`${patch.origin?.[0] ?? 0} ${patch.origin?.[1] ?? 0} ${patch.viewBox[0]} ${patch.viewBox[1]}`} overflow="hidden"
    opacity={patch.opacity ?? (patch.depth === 'far' ? .6 : 1)}>
    <g className={leaving ? 'living-patch-life living-patch-leaving' : 'living-patch-life'} transform={box.mirror ? `translate(${patch.viewBox[0] + 2 * (patch.origin?.[0] ?? 0)} 0) scale(-1 1)` : undefined} data-scene-mirrored={box.mirror || undefined}
      style={{ '--patch-fade': `${LIVING_SCENE_BUDGET.crossfade}ms`, '--patch-age': `-${age}ms` } as CSSProperties}>
      {patch.groups.map(group => {
        const fitted = fitHabitatGroup(group, patch, box, holes, weather, quiet);
        const moves = habitatMotion(group, weather, quiet);
        const style = { transformOrigin: `${group.pivot[0]}px ${group.pivot[1]}px`, '--group-phase': `${-(age + (group.phase ?? 0) * 1000)}ms`,
          ...Object.fromEntries(moves.map((value, index) => [`--habitat-step-${index}`, value])) } as CSSProperties;
        return <g key={group.id} data-scene-fit={leaving ? undefined : group.id} data-scene-compact={fitted.compact || undefined} data-scene-omitted={!fitted.visible || undefined}
          transform={fitted.transform} opacity={fitted.visible ? 1 : 0}>
          <g className="living-attached" data-scene-group={group.id} data-scene-motion={group.motion} style={style}>
            {fitted.paths.map((path, index) => <ArtPath key={index} path={path} palette={palette} quiet={quiet} />)}
          </g>
        </g>;
      })}
    </g>
  </svg>;
}

/** Ground and top bands. Rear segments sit behind the authored patches and the
 * front ones over their bases. Grass segments share one travelling sway; the
 * whole band also shifts a few pixels over its life so its pixels keep changing. */
function EdgeLayer({ age: initialAge, ground, top, layer, groundColors, topColors, kind, topKind }: {
  age: number; ground: EdgeBand; top: EdgeBand | null; layer: 'segments' | 'front'; groundColors: readonly string[]; topColors: readonly string[]; kind: string; topKind: string | undefined;
}) {
  const [age] = useState(initialAge);
  const segment = (band: EdgeBand, colors: readonly string[]) => (part: DressSegment, index: number) => {
    const sway = layer === 'front' ? 0 : band.sway; // only the tall rear blades sway; the low front fringe stays cheap
    const style = sway ? { transformOrigin: `${part.pivot[0]}px ${part.pivot[1]}px`, '--group-phase': `${-(age + part.phase * 1000)}ms`,
      ...Object.fromEntries([0, -.55, 1, .28, 0].map((turn, step) => [`--habitat-step-${step}`, `skewX(${(-turn * sway).toFixed(2)}deg)`])) } as CSSProperties : undefined;
    return <g key={index} className={sway ? 'living-attached living-blades' : undefined} style={style}>{part.paths.map((path, item) => <Dress key={item} path={path} colors={colors} />)}</g>;
  };
  const shift = { '--band-age': `${-age}ms` } as CSSProperties;
  return <>
    <g className="living-band" data-scene-ground={layer === 'segments' ? kind : undefined} data-ground-lit={layer === 'segments' ? ground.lit.toFixed(3) : undefined} style={shift}>{ground[layer].map(segment(ground, groundColors))}</g>
    {top && <g className="living-band living-band-top" data-scene-top={layer === 'segments' ? topKind : undefined} data-top-lit={layer === 'segments' ? top.lit.toFixed(3) : undefined} style={shift}>
      {top[layer].map(segment(top, topColors))}
      {layer === 'front' && top.pendants.map((pendant, index) => <g key={index} className="living-pendulum" style={{ transformOrigin: `${pendant.x}px ${pendant.y}px`, '--swing': `${pendant.swing}deg`,
        animationDuration: `${pendant.period}s`, animationDelay: `${-(age / 1000 + pendant.phase)}s`, animationIterationCount: LIVING_SCENE_BUDGET.life / 1000 / pendant.period + 1 } as CSSProperties}>
        {pendant.paths.map((path, item) => <Dress key={item} path={path} colors={topColors} />)}
      </g>)}
    </g>}
  </>;
}

/** Depth-scaled particles under the reading mask: four layers, each one finite
 * transform animation whose period divides the scene life. */
function ParticleLayer({ kind, count, width, height, age: initialAge, gust, palette }: { kind: ParticleKind; count: number; width: number; height: number; age: number; gust: boolean; palette: readonly string[] }) {
  const [age] = useState(initialAge);
  const layers = useMemo(() => particleLayers(kind, count, width, height, gust), [kind, count, width, height, gust]);
  return <g className="living-particles" data-scene-particles={kind} data-particle-count={layers.reduce((sum, layer) => sum + layer.count, 0)}>
    {layers.map((layer, index) => <g key={index} className={layer.wander ? 'living-particle-layer living-wander' : 'living-particle-layer'} opacity={layer.opacity}
      style={{ animationDuration: `${layer.duration}ms`, animationDelay: `${-(age + layer.offset)}ms`, animationIterationCount: LIVING_SCENE_BUDGET.life / layer.duration + 1,
        '--p-q1': `translate(${(layer.travel[0] * .25 + layer.sway).toFixed(1)}px, ${(layer.travel[1] * .25).toFixed(1)}px)`, '--p-mid': `translate(${(layer.travel[0] * .5).toFixed(1)}px, ${(layer.travel[1] * .5).toFixed(1)}px)`,
        '--p-q3': `translate(${(layer.travel[0] * .75 - layer.sway).toFixed(1)}px, ${(layer.travel[1] * .75).toFixed(1)}px)`, '--p-end': `translate(${layer.travel[0].toFixed(1)}px, ${layer.travel[1].toFixed(1)}px)`,
        '--p-w1': `translate(${layer.sway.toFixed(1)}px, ${(-layer.sway * .6).toFixed(1)}px)`, '--p-w2': `translate(${(-layer.sway * .5).toFixed(1)}px, ${(-layer.sway).toFixed(1)}px)` } as CSSProperties}>
      {layer.paths.map((path, item) => <Dress key={item} path={path} colors={kind === 'firefly' ? [palette[1]!, palette[1]!, palette[2]!] : palette} />)}
    </g>)}
  </g>;
}

function RainPhrase({ index, elapsed, width, height, palette, storm }: { index: number; elapsed: number; width: number; height: number; palette: readonly string[]; storm: boolean }) {
  const [age] = useState(elapsed);
  const [born] = useState(() => performance.now());
  const short = Math.min(width, height);
  return <g data-scene-born={born} style={{ '--rain-age': `${-(age + index * 1200)}ms`, '--rain-travel': `translate(${-height * (storm ? .066 : .035)}px, ${height * .105}px)` } as CSSProperties}>
    <g className="living-rain"><path d={rainField(width, height, index, 0, storm)} fill="none" stroke={palette[index % 2]} strokeWidth={Math.max(1, short * .0019)} strokeLinecap="round" opacity={.8} /></g>
    <g className="living-rain living-rain-near"><path d={rainField(width, height, index, 1, storm)} fill="none" stroke={lighten(palette[0]!, .45)} strokeWidth={Math.max(1.4, short * .0028)} strokeLinecap="round" opacity={.95} /></g>
    <g className="living-ripple"><path d={rainImpacts(width, height, index)} fill="none" stroke={lighten(palette[2]!, .4)} strokeWidth={Math.max(1.2, short * .002)} strokeLinecap="round" /></g>
  </g>;
}
