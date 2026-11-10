/** Which 3D module, if any, draws a resolved scene. Pure: the lists of module ids come from the
 * caller (modules.ts discovers them from the files), so this is testable without a bundler. */
import type { ThemeScene, WeatherMotif } from '../ambient-theme.ts';

/** Scenes that borrow another scene's module until their own file exists. A file named after
 * the scene always wins, so adding `scenes/birthday-russian.js` needs no edit here. */
export const SCENE_MODULE_FALLBACK: Readonly<Record<string, string>> = { 'birthday-russian': 'birthday', 'birthday-korean': 'birthday' };

export interface Scene3dPlan {
  /** The registry id of the scene being shown (`ctx.id`). */
  sceneId: string;
  /** The file under scenes/ that builds it. */
  module: string;
  /** The weather overlay under weather/ applied on top (Combined mode), or null. */
  weather: WeatherMotif | null;
}

export function sceneModuleFor(sceneId: string, sceneModules: readonly string[]): string | null {
  if (sceneModules.includes(sceneId)) return sceneId;
  const fallback = SCENE_MODULE_FALLBACK[sceneId];
  return fallback && sceneModules.includes(fallback) ? fallback : null;
}

/** Null means the flat renderer draws this scene: no module yet, or weather is over the scene
 * and its overlay does not exist yet (the flat renderer still shows that weather). */
export function planScene3d(scene: Pick<ThemeScene, 'motif' | 'habitat' | 'source'>, sceneModules: readonly string[], weatherModules: readonly string[]): Scene3dPlan | null {
  const sceneId = scene.habitat ?? scene.motif;
  const module = sceneModuleFor(sceneId, sceneModules);
  if (!module) return null;
  const weather = scene.source === 'weather' && scene.habitat ? scene.motif as WeatherMotif : null;
  if (weather && !weatherModules.includes(weather)) return null;
  return { sceneId, module, weather };
}
