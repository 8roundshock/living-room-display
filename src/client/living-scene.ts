import type { ScenePatch, SceneArtGroup } from '../shared/living-scene-art.ts';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';
import type { WeatherMotif, ThemeRect } from './ambient-theme.ts';

/** Local patches retire independently. Their cycles never blank the information plane. */
export function patchPhase(elapsed: number, index: number) {
  const shifted = elapsed + index * LIVING_SCENE_BUDGET.stagger;
  const generation = Math.floor(shifted / LIVING_SCENE_BUDGET.life);
  return { generation, age: shifted % LIVING_SCENE_BUDGET.life };
}

export const SCENE_SCALE = 1.45;
export const FLOAT_BOB = 11;
export const BOTTOM_LIFT = .026;
/** Keep the authored natural aspect ratio. Dense layouts cut reading space out of
 * the shared scene, rather than converting the habitat into square icon slots. */
export function habitatBox(patch: ScenePatch, width: number, height: number, generation = 0) {
  const short = Math.min(width, height), ratio = patch.viewBox[0] / patch.viewBox[1];
  // Habitat drawings are authored at the plan's first, smaller sizes; SCENE_SCALE brings hero forms to
  // 200-320px at 1080p (owner direction, 2026-11-09). The fitter still shrinks a patch that has no room.
  const scale = patch.depth === 'far' ? 1.15 : SCENE_SCALE;
  const w = Math.min(width * Math.min(.94, patch.width * scale), short * Math.min(.6, patch.height * scale) * ratio), h = w / ratio;
  const drift = short * .02 * (generation % 3 - 1);
  const right = patch.edge.includes('right'), top = patch.edge.includes('top');
  // Bottom drawings stand a little above the frame; the ground band's front layer covers their bases.
  return { x: right ? width - w + drift : drift, y: top ? -h * .035 : patch.edge === 'left' || patch.edge === 'right' ? height * .52 - h / 2 : height - h * .97 - short * BOTTOM_LIFT,
    width: w, height: h };
}

export type HabitatBox = ReturnType<typeof habitatBox> & { /** The whole drawing is reflected left-to-right (a top drawing moved to the far side). */ mirror?: boolean };

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

export const PATCH_ROOT_FACTORS = [1, .86, .74, .62, .52, .44] as const;
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
    // Another placed drawing is not reading ink: it never shortens a group. A bough may brush a
    // snowbank, but two drawings must not be stacked into the same gap, so the cost grows with
    // the share of this patch that another one already covers.
    const area = own ? Math.max(1, (own.right - own.left) * (own.bottom - own.top)) : 1;
    const covered = own ? Math.max(0, ...occupied.map(rect => Math.max(0, Math.min(own.right, rect.right) - Math.max(own.left, rect.left)) * Math.max(0, Math.min(own.bottom, rect.bottom) - Math.max(own.top, rect.top)) / area)) : 0;
    return patchQuality(patch, box, holes, weather, quiet) * (1 - .8 * Math.min(1, covered * 1.6));
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
      const candidate = horizontal ? { x: position, y: patch.edge.startsWith('bottom') ? height - h * .97 - Math.min(width, height) * BOTTOM_LIFT : -h * .035, width: w, height: h }
        : { x: patch.edge === 'right' ? width - w * .97 : -w * .035, y: position, width: w, height: h };
      // Prefer whole forms, then the larger size, then the root nearest the authored one.
      const candidateScore = quality(candidate) - (1 - factor) * .32 - Math.abs(position - authored) / travel * .05;
      if (candidateScore > score + .0005) { best = candidate; score = candidateScore; }
    }
  }
  // Last resort for a hanging/top drawing whose whole top edge is reading space:
  // the same complete drawing enters lower from its own side, or reflected from
  // the opposite side. Still one authored patch on the frame, never a free float.
  if (patch.edge.startsWith('top') && score < .5) for (const side of ['own', 'opposite'] as const) for (const factor of PATCH_ROOT_FACTORS) {
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
  // Visible motion (owner direction, 2026-11-09): tips travel several degrees; the sweep is part of the fitted bounds.
  const amplitude = ({ still: 1, grass: 7.5, branch: 4, hanging: 8.5, drift: 2.4, float: 3 } as const)[group.motion] * strength;
  // A floating bunch also bobs on its tethers by FLOAT_BOB authored units (10-20px on screen).
  return [0, -.55, 1, .28, 0].map(turn => `${group.motion === 'float' ? `translate(0px, ${(-turn * FLOAT_BOB).toFixed(2)}px) ` : ''}rotate(${(turn * amplitude).toFixed(3)}deg)`);
}

/** Fit complete rooted groups before the reading mask. A compact authored form
 * keeps broad leaves and complete seedheads where a tall clump cannot fit. */
export function fitHabitatGroup(group: SceneArtGroup, patch: ScenePatch, box: HabitatBox, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean) {
  const scale = box.width / patch.viewBox[0], [ox, oy] = patch.origin ?? [0, 0];
  const turns = habitatMotion(group, weather, quiet).map(value => Number(/rotate\((-?[\d.]+)deg\)/.exec(value)![1]) * Math.PI / 180);
  const bob = group.motion === 'float' ? FLOAT_BOB : 0;
  const shape = (bounds: SceneArtGroup['bounds']) => {
    const [x, y0, w, h0] = bounds, [px, py] = group.pivot, y = y0 - bob, h = h0 + bob * 2;
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
    const xs = corners.map(p => box.mirror ? patch.viewBox[0] - (p.x - ox) : p.x - ox);
    return { left: box.x + Math.min(...xs) * scale, right: box.x + Math.max(...xs) * scale,
      top: box.y + (Math.min(...corners.map(p => p.y)) - oy) * scale, bottom: box.y + (Math.max(...corners.map(p => p.y)) - oy) * scale };
  };
  const fit = (bounds: SceneArtGroup['bounds']) => {
    const swept = shape(bounds), rootY = box.y + (group.pivot[1] - oy) * scale, rootX = box.x + (box.mirror ? patch.viewBox[0] - (group.pivot[0] - ox) : group.pivot[0] - ox) * scale;
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

/** Three related precipitation groups in two depths, not independently scheduled
 * icons. Near streaks are longer and brighter; a storm slants and lengthens both. */
export function rainField(width: number, height: number, group: number, depth: 0 | 1 = 0, storm = false) {
  const count = depth ? 13 : 11, slant = storm ? .62 : .33, reach = (depth ? 2.3 : 1.25) * (storm ? 1.3 : 1);
  return Array.from({ length: count }, (_, index) => {
    const landing = !depth && index >= 8;
    const x = landing ? rainLanding(width, group, index - 8) + height * .035 : width * (.02 + ((index * (depth ? .149 : .173) + group * .11 + depth * .07) % .98));
    const y = landing ? height * .88 : height * (.02 + ((index * (depth ? .197 : .231) + group * .15 + depth * .31) % .84));
    const length = Math.min(width, height) * (.012 + index % 3 * .006) * reach;
    return `M${x.toFixed(2)} ${y.toFixed(2)}l${(-length * slant).toFixed(2)} ${length.toFixed(2)}`;
  }).join(' ');
}

function rainLanding(width: number, group: number, index: number) {
  return width * (.12 + ((index * .31 + group * .09) % .78));
}
export function rainImpacts(width: number, height: number, group: number) {
  const radius = Math.min(width, height) * .022;
  return [0, 1, 2].map(index => {
    const x = rainLanding(width, group, index), y = height * .972;
    return `M${x - radius} ${y}q${radius} ${radius * .3} ${radius * 2} 0 M${x - radius * .65} ${y - radius * .3}q${radius * .65} ${-radius * .18} ${radius * 1.3} 0`;
  }).join(' ');
}
