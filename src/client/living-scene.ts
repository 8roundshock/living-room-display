import type { ScenePatch, SceneArtGroup } from '../shared/living-scene-art.ts';
import { LIVING_SCENE_BUDGET } from '../shared/theme-registry.ts';
import type { WeatherMotif } from './ambient-theme.ts';

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

/** Three related precipitation groups, not an independently scheduled icon set.
 * Each is a sparse slice of the same directional field; the habitat gets its gust. */
export function rainField(width: number, height: number, group: number) {
  return Array.from({ length: 11 }, (_, index) => {
    const x = width * (.04 + ((index * .173 + group * .11) % .94));
    const y = height * (.04 + ((index * .231 + group * .15) % .8));
    const length = Math.min(width, height) * (.012 + index % 3 * .006);
    return `M${x.toFixed(2)} ${y.toFixed(2)}l${(-length * .33).toFixed(2)} ${length.toFixed(2)}`;
  }).join(' ');
}
