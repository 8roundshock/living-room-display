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

/** Authored wind, not a compass claim. Attached groups share one twelve-second
 * phrase; their small phase differences describe a gust passing through roots. */
export function habitatMotion(group: SceneArtGroup, weather: WeatherMotif | undefined, quiet: boolean) {
  const strength = quiet ? .35 : weather === 'storm' ? 1.65 : weather === 'wind' || weather === 'rain' ? 1.3 : 1;
  const amplitude = ({ still: .25, grass: 4, branch: 1.5, hanging: 5, drift: .8 } as const)[group.motion] * strength;
  return [0, -.55, 1, .28, 0].map(turn => `rotate(${(turn * amplitude).toFixed(3)}deg)`);
}

/** Fit complete rooted groups before the reading mask. A compact authored form
 * keeps broad leaves and complete seedheads where a tall clump cannot fit. */
export function fitHabitatGroup(group: SceneArtGroup, patch: ScenePatch, box: ReturnType<typeof habitatBox>, holes: readonly ThemeRect[], weather: WeatherMotif | undefined, quiet: boolean) {
  const scale = box.width / patch.viewBox[0];
  const turns = habitatMotion(group, weather, quiet).map(value => Number(value.slice(7, -4)) * Math.PI / 180);
  const shape = (bounds: SceneArtGroup['bounds']) => {
    const [x, y, w, h] = bounds, [px, py] = group.pivot;
    const corners = turns.flatMap(angle => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy]) => ({
      x: px + (cx! - px) * Math.cos(angle) - (cy! - py) * Math.sin(angle),
      y: py + (cx! - px) * Math.sin(angle) + (cy! - py) * Math.cos(angle),
    })));
    return { left: box.x + Math.min(...corners.map(p => p.x)) * scale, right: box.x + Math.max(...corners.map(p => p.x)) * scale,
      top: box.y + Math.min(...corners.map(p => p.y)) * scale, bottom: box.y + Math.max(...corners.map(p => p.y)) * scale };
  };
  const fit = (bounds: SceneArtGroup['bounds']) => {
    const swept = shape(bounds), rootY = box.y + group.pivot[1] * scale, rootX = box.x + group.pivot[0] * scale;
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
  return { paths, compact, visible: yScale >= .65, yScale: actualY, xScale,
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

export function snowField(width: number, height: number, group: number, quiet = false) {
  return Array.from({ length: quiet ? 3 : 7 }, (_, index) => {
    const x = width * (.05 + ((index * .193 + group * .137) % .90));
    const y = height * (.03 + ((index * .271 + group * .173) % .82));
    const r = Math.min(width, height) * (.0025 + index % 3 * .0018);
    return `M${x} ${y - r}v${r * 2} M${x - r * .86} ${y - r * .5}l${r * 1.72} ${r} M${x - r * .86} ${y + r * .5}l${r * 1.72} ${-r}`;
  }).join(' ');
}

export function fogContour(width: number, height: number, group: number) {
  const x = width * (.03 + group * .17), y = height * (.86 - group * .11), w = width * .42, h = height * .025;
  return `M${x} ${y}c${w * .3} ${-h * 2} ${w * .62} ${h} ${w} 0 M${x + w * .09} ${y + h * .8}q${w * .4} ${-h} ${w * .78} ${h * .15}`;
}
