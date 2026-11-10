/** Discovery of scene and weather modules from the files themselves, so adding
 * `scenes/<id>.js` or `weather/<kind>.js` never edits a shared list. Each module (and the
 * engine) is its own lazily loaded chunk; only this small table of loaders is in the dashboard bundle.
 * Vite only: unit tests take the id lists as arguments (resolve.ts) and read the folders themselves. */
import type { SceneBuilder } from './engine';

type Loader = () => Promise<{ default: SceneBuilder }>;
const byId = (found: Record<string, Loader>): Readonly<Record<string, Loader>> =>
  Object.fromEntries(Object.entries(found).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1, -'.js'.length), load]));

/** Files whose name starts with an underscore are private helpers, not scenes. */
export const SCENE_LOADERS = byId(import.meta.glob<{ default: SceneBuilder }>(['./scenes/*.js', '!./scenes/_*.js']));
export const WEATHER_LOADERS = byId(import.meta.glob<{ default: SceneBuilder }>(['./weather/*.js', '!./weather/_*.js']));
export const SCENE_MODULE_IDS: readonly string[] = Object.keys(SCENE_LOADERS);
export const WEATHER_MODULE_IDS: readonly string[] = Object.keys(WEATHER_LOADERS);
