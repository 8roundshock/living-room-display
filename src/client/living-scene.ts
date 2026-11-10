import type { ScenePatch, SceneArtGroup } from '../shared/living-scene-art.ts';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';
import type { WeatherMotif, ThemeRect } from './ambient-theme.ts';

/** Local patches retire independently. Their cycles never blank the information plane. */
export function patchPhase(elapsed: number, index: number) {
  const shifted = elapsed + index * LIVING_SCENE_BUDGET.stagger;
  const generation = Math.floor(shifted / LIVING_SCENE_BUDGET.life);
  return { generation, age: shifted % LIVING_SCENE_BUDGET.life };
}

/** Keep the authored natural aspect ratio. Dense layouts cut reading space out of
 * the shared scene, rather than converting the habitat into square icon slots. */
export function habitatBox(patch: ScenePatch, width: number, height: number, generation = 0) {
  const short = Math.min(width, height), ratio = patch.viewBox[0] / patch.viewBox[1];
  const w = Math.min(width * patch.width, short * patch.height * ratio), h = w / ratio;
  const drift = short * .012 * (generation % 3 - 1);
  const right = patch.edge.includes('right'), top = patch.edge.includes('top');
  return { x: right ? width - w + drift : drift, y: top ? -h * .035 : patch.edge === 'left' || patch.edge === 'right' ? height * .52 - h / 2 : height - h * .97,
    width: w, height: h };
}

export type HabitatBox = ReturnType<typeof habitatBox> & { /** The whole drawing is reflected left-to-right (a top drawing moved to the far side). */ mirror?: boolean };
const intersects = (a: ThemeRect, b: ThemeRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** How much of a patch's authored silhouette survives in a box, from 0 to 1.
 * Groups weigh by their drawn area, so the principal connected form dominates
 * and a retained ribbon cannot stand in for a lost cake, bough or kite. A whole
 * form counts fully, an authored compact form less, an omitted form nothing. */
export function patchQuality(patch: ScenePatch, box: HabitatBox, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean) {
  let total = 0, kept = 0;
  for (const group of patch.groups) {
    const weight = group.bounds[2] * group.bounds[3], fitted = fitHabitatGroup(group, patch, box, holes, weather, quiet);
    total += weight;
    if (fitted.visible) kept += weight * (fitted.compact ? .7 : 1) * (.55 + .45 * fitted.yScale);
  }
  return total ? kept / total : 0;
}

/** Screen bounds swept by the groups that stay visible; null when none do. */
export function patchExtent(patch: ScenePatch, box: HabitatBox, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean): ThemeRect | null {
  const rects = patch.groups.map(group => fitHabitatGroup(group, patch, box, holes, weather, quiet)).filter(fitted => fitted.visible).map(fitted => fitted.swept);
  return rects.length ? { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)), right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) } : null;
}

export const PATCH_ROOT_FACTORS = [1, .86, .74, .62] as const;
export const PATCH_ROOT_POSITIONS = 25;
export const PATCH_SIDE_POSITIONS = 13;
/** Relocate one COMPLETE authored patch along its own edge before any group is
 * shortened or omitted. A bounded set of roots (four sizes, 25 positions) is
 * scored by retained silhouette against the same reading holes the renderer
 * masks with, plus the extents of patches already placed. Group relationships
 * inside the patch never change: it is one drawing moved as a whole, not a
 * scatter of independently placed symbols. The authored root wins when intact. */
export function fitHabitatPatch(patch: ScenePatch, width: number, height: number, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean, generation = 0, occupied: readonly ThemeRect[] = []) {
  const original = habitatBox(patch, width, height, generation);
  const quality = (box: HabitatBox) => {
    const own = patchExtent(patch, box, holes, weather, quiet);
    // Another placed drawing is not reading ink: it never shortens a group, but
    // two scene groups must not be stacked into the same gap.
    return patchQuality(patch, box, holes, weather, quiet) * (own && occupied.some(rect => intersects(own, rect)) ? .45 : 1);
  };
  let best = original, score = quality(original);
  if (score >= .999) return best;
  const horizontal = patch.edge.startsWith('bottom') || patch.edge.startsWith('top');
  const authored = horizontal ? original.x : original.y, travel = horizontal ? width : height;
  for (const factor of PATCH_ROOT_FACTORS) {
    const w = original.width * factor, h = original.height * factor;
    const span = Math.max(0, horizontal ? width - w : height - h);
    for (let index = 0; index < PATCH_ROOT_POSITIONS; index++) {
      const position = span * index / (PATCH_ROOT_POSITIONS - 1);
      const candidate = horizontal ? { x: position, y: patch.edge.startsWith('bottom') ? height - h * .97 : -h * .035, width: w, height: h }
        : { x: patch.edge === 'right' ? width - w * .97 : -w * .035, y: position, width: w, height: h };
      // Prefer whole forms, then the larger size, then the root nearest the authored one.
      const candidateScore = quality(candidate) - (1 - factor) * .32 - Math.abs(position - authored) / travel * .05;
      if (candidateScore > score + .0005) { best = candidate; score = candidateScore; }
    }
  }
  // Last resort for a hanging/top drawing whose whole top edge is reading space:
  // the same complete drawing enters lower from its own side, or reflected from
  // the opposite side. Still one authored patch on the frame, never a free float.
  if (patch.edge.startsWith('top') && score < .5) for (const side of ['own', 'opposite'] as const) for (const factor of PATCH_ROOT_FACTORS.slice(0, 3)) {
    const w = original.width * factor, h = original.height * factor;
    const right = patch.edge.endsWith('right') !== (side === 'opposite');
    for (let index = 0; index < PATCH_SIDE_POSITIONS; index++) {
      const y = Math.max(0, height - h) * index / (PATCH_SIDE_POSITIONS - 1);
      const candidate = { x: right ? width - w : 0, y, width: w, height: h, mirror: side === 'opposite' };
      const candidateScore = quality(candidate) - .1 - (1 - factor) * .32 - y / height * .05;
      if (candidateScore > score + .0005) { best = candidate; score = candidateScore; }
    }
  }
  return best;
}

/** Largest habitat first: a counterweight yields to the principal drawing. */
export function patchPriority(patches: readonly ScenePatch[], width: number, height: number) {
  return patches.map((patch, index) => ({ index, far: patch.depth === 'far', area: habitatBox(patch, width, height).width * habitatBox(patch, width, height).height }))
    .sort((a, b) => Number(a.far) - Number(b.far) || b.area - a.area || a.index - b.index).map(entry => entry.index);
}

/** One pass for a complete scene. Far silhouettes sit behind and reserve nothing. */
export function placeScenePatches(patches: readonly ScenePatch[], width: number, height: number, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean, generations: readonly number[] = []) {
  const boxes: HabitatBox[] = [], occupied: ThemeRect[] = [];
  for (const index of patchPriority(patches, width, height)) {
    const patch = patches[index]!, far = patch.depth === 'far';
    const box = fitHabitatPatch(patch, width, height, holes, weather, quiet, generations[index] ?? 0, far ? [] : occupied);
    const extent = far ? null : patchExtent(patch, box, holes, weather, quiet);
    if (extent) occupied.push(extent);
    boxes[index] = box;
  }
  return boxes;
}

/** Authored wind, not a compass claim. Attached groups share one twelve-second
 * phrase; their small phase differences describe a gust passing through roots. */
export function habitatMotion(group: SceneArtGroup, weather: WeatherMotif | undefined, quiet: boolean) {
  const strength = quiet ? .35 : weather === 'storm' ? 1.65 : weather === 'wind' || weather === 'rain' ? 1.3 : 1;
  const amplitude = ({ still: .25, grass: 4, branch: 1.5, hanging: 5, drift: .8 } as const)[group.motion] * strength;
  return [0, -.55, 1, .28, 0].map(turn => `rotate(${(turn * amplitude).toFixed(3)}deg)`);
}

/** Fit complete rooted groups before the reading mask. A compact authored form
 * keeps broad leaves and complete seedheads where a tall clump cannot fit. */
export function fitHabitatGroup(group: SceneArtGroup, patch: ScenePatch, box: HabitatBox, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean) {
  const scale = box.width / patch.viewBox[0];
  const turns = habitatMotion(group, weather, quiet).map(value => Number(value.slice(7, -4)) * Math.PI / 180);
  const shape = (bounds: SceneArtGroup['bounds']) => {
    const [x, y, w, h] = bounds, [px, py] = group.pivot;
    const low = Math.min(...turns), high = Math.max(...turns);
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].flatMap(([cx, cy]) => {
      const dx = cx! - px, dy = cy! - py;
      // Include analytic x/y extrema between CSS waypoints, not just endpoints.
      const critical = [Math.atan2(-dy, dx), Math.atan2(dx, dy)].flatMap(angle => [-2, -1, 0, 1, 2].map(n => angle + n * Math.PI));
      return [low, high, ...critical.filter(angle => angle >= low && angle <= high)].map(angle => ({
        x: px + dx * Math.cos(angle) - dy * Math.sin(angle), y: py + dx * Math.sin(angle) + dy * Math.cos(angle),
      }));
    });
    // A reflected drawing sweeps the exact reflection of the same local extent.
    const xs = corners.map(p => box.mirror ? patch.viewBox[0] - p.x : p.x);
    return { left: box.x + Math.min(...xs) * scale, right: box.x + Math.max(...xs) * scale,
      top: box.y + Math.min(...corners.map(p => p.y)) * scale, bottom: box.y + Math.max(...corners.map(p => p.y)) * scale };
  };
  const fit = (bounds: SceneArtGroup['bounds']) => {
    const swept = shape(bounds), rootY = box.y + group.pivot[1] * scale, rootX = box.x + (box.mirror ? patch.viewBox[0] - group.pivot[0] : group.pivot[0]) * scale;
    const overlap = holes.filter(hole => hole.right > swept.left && hole.left < swept.right && hole.bottom > swept.top && hole.top < swept.bottom);
    if (!overlap.length) return 1;
    let available: number, full: number;
    if (patch.edge.startsWith('bottom')) {
      available = rootY - Math.max(...overlap.map(hole => hole.bottom)) - 5; full = rootY - swept.top;
    } else if (patch.edge.startsWith('top')) {
      available = Math.min(...overlap.map(hole => hole.top)) - rootY - 5; full = swept.bottom - rootY;
    } else if (patch.edge === 'left') {
      available = Math.min(...overlap.map(hole => hole.left)) - rootX - 5; full = swept.right - rootX;
    } else {
      available = rootX - Math.max(...overlap.map(hole => hole.right)) - 5; full = rootX - swept.left;
    }
    return Math.max(0, Math.min(1, available / Math.max(1, full)));
  };
  let paths = group.paths, bounds = group.bounds, yScale = fit(bounds), compact = false;
  if (yScale < .78 && group.compact) {
    paths = group.compact.paths; bounds = group.compact.bounds; yScale = fit(bounds); compact = true;
  }
  const horizontal = patch.edge === 'left' || patch.edge === 'right';
  // Botanical grass can shorten around its roots; other authored objects retain
  // their natural ratio (a fitted cake/lantern must not become a flattened symbol).
  const xScale = horizontal || group.motion !== 'grass' ? yScale : 1;
  const actualY = !horizontal || group.motion !== 'grass' ? yScale : 1;
  return { paths, compact, visible: yScale >= .65, yScale: actualY, xScale, swept: shape(bounds),
    transform: `translate(${group.pivot[0]} ${group.pivot[1]}) scale(${xScale} ${actualY}) translate(${-group.pivot[0]} ${-group.pivot[1]})` };
}

/** Three related precipitation groups, not an independently scheduled icon set.
 * Each is a sparse slice of the same directional field; the habitat gets its gust. */
export function rainField(width: number, height: number, group: number) {
  return Array.from({ length: 11 }, (_, index) => {
    const x = index >= 8 ? rainLanding(width, group, index - 8) + height * .035 : width * (.04 + ((index * .173 + group * .11) % .94));
    const y = index >= 8 ? height * .88 : height * (.04 + ((index * .231 + group * .15) % .8));
    const length = Math.min(width, height) * (.012 + index % 3 * .006);
    return `M${x.toFixed(2)} ${y.toFixed(2)}l${(-length * .33).toFixed(2)} ${length.toFixed(2)}`;
  }).join(' ');
}

function rainLanding(width: number, group: number, index: number) {
  return width * (.12 + ((index * .31 + group * .09) % .78));
}
export function rainImpacts(width: number, height: number, group: number) {
  const radius = Math.min(width, height) * .014;
  return [0, 1, 2].map(index => {
    const x = rainLanding(width, group, index), y = height * .985;
    return `M${x - radius} ${y}q${radius} ${radius * .3} ${radius * 2} 0 M${x - radius * .65} ${y - radius * .3}q${radius * .65} ${-radius * .18} ${radius * 1.3} 0`;
  }).join(' ');
}

export const DRIFT_FORMS = 5;
/** A detached seed, petal, leaf, flake or ribbon curl. Durations and offsets are
 * whole observation intervals, so each form is replaced at its own boundary
 * (never mid-flight) and takes a new deterministic path every iteration. */
export function driftForm(index: number, elapsed: number, width: number, height: number, kind: 'seed' | 'petal' | 'leaf' | 'flake' | 'ribbon', gust = false) {
  const observation = LIVING_SCENE_BUDGET.observation, short = Math.min(width, height);
  const duration = observation * (gust ? [3, 4, 3, 5, 4] : [5, 4, 6, 4, 5])[index % 5]!, offset = observation * (gust ? [2, 1, 1, 3, 2] : [4, 2, 3, 1, 2])[index % 5]!;
  const iteration = Math.floor((elapsed + offset) / duration);
  const seed = (index * 131 + iteration * 197) % 1009, unit = (salt: number) => (seed * salt % 1009) / 1009;
  const fall = kind === 'flake' || kind === 'ribbon', side = unit(89) < .5 ? -1 : 1;
  const dx = fall ? side * width * (.015 + unit(53) * .03) : width * (gust ? .2 + unit(53) * .12 : .09 + unit(53) * .08);
  const dy = height * (fall ? .13 + unit(31) * .07 : .05 + unit(31) * .08);
  const spin = (kind === 'seed' ? 35 : kind === 'flake' ? 70 : 150) * side;
  return { iteration, duration: duration - 300, size: short * (kind === 'ribbon' ? .05 : .04) * (.8 + unit(17) * .55), tone: seed % 3,
    x: width * (.05 + unit(73) * (fall ? .9 : .78)), y: height * (.06 + unit(137) * .66),
    mid: [dx * .42, dy * .6 - short * .018] as const, end: [dx, dy] as const, turn: [-spin * .2, spin * .45, spin] as const };
}

export function snowField(width: number, height: number, group: number, quiet = false) {
  return Array.from({ length: quiet ? 3 : 7 }, (_, index) => {
    const x = width * (.05 + ((index * .193 + group * .137) % .90));
    const y = height * (.03 + ((index * .271 + group * .173) % .82));
    const r = Math.min(width, height) * (.004 + index % 3 * .003);
    return `M${x} ${y - r}v${r * 2} M${x - r * .86} ${y - r * .5}l${r * 1.72} ${r} M${x - r * .86} ${y + r * .5}l${r * 1.72} ${-r}`;
  }).join(' ');
}

/** A separated fog ribbon in open space. Long contours are never sheared by a
 * reading mask: a bounded set of positions is tried and a ribbon with no clear
 * place (including its drift) is omitted for that phrase. */
export function fogContour(width: number, height: number, group: number, holes: readonly ThemeRect[] = []) {
  const h = height * .025;
  for (let attempt = 0; attempt < 10; attempt++) {
    // Shorter ribbons are tried only after the full one found no open place.
    const w = width * (attempt < 4 ? .42 : attempt < 7 ? .3 : .22);
    const x = width * (.03 + (group * .17 + attempt * .23) % .52), y = height * (.86 - (group * .11 + attempt * .19) % .78);
    const swept = { left: x - 4, right: x + w + width * .03, top: y - h * 2.2, bottom: y + h * 1.4 + height * .008 };
    if (holes.some(hole => hole.left < swept.right && hole.right > swept.left && hole.top < swept.bottom && hole.bottom > swept.top)) continue;
    return `M${x} ${y}c${w * .3} ${-h * 2} ${w * .62} ${h} ${w} 0 M${x + w * .09} ${y + h * .8}q${w * .4} ${-h} ${w * .78} ${h * .15}`;
  }
  return '';
}
