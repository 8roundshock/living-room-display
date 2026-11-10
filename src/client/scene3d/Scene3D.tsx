import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { ThemeScene } from '../ambient-theme';
import type { Stage } from './engine';
import { SCENE_LOADERS, WEATHER_LOADERS } from './modules';
import type { Scene3dPlan } from './resolve';
import { civilDay, fadeMask, RENDER_LIMITS, SCENE_CLOCK, sceneLook, sceneSeed } from './settings';
import { sceneTier } from './tier';
import { softwareAllowed } from './webgl';
import './scene3d.css';

interface Props { scene: ThemeScene; plan: Scene3dPlan; still: boolean; onFail: () => void }

/** The 3D scene behind the widgets. The engine, three.js and the scene module load only when
 * this mounts. Any failure calls `onFail`, and the caller shows the flat renderer instead. */
export const Scene3D = memo(function Scene3D({ scene, plan, still, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null), failed = useRef(onFail);
  failed.current = onFail;
  const { tint, companion, accent, quiet } = scene, today = new Date(), day = civilDay(today);
  const tier = sceneTier(scene, today.getFullYear()), look = sceneLook(plan.sceneId, tier, quiet);
  useEffect(() => {
    const element = host.current, loadScene = SCENE_LOADERS[plan.module], loadWeather = plan.weather ? WEATHER_LOADERS[plan.weather] : null;
    if (!element) return;
    let cancelled = false, stage: Stage | null = null;
    const fail = () => { if (!cancelled) failed.current(); };
    if (!loadScene || (plan.weather && !loadWeather)) { fail(); return; }
    const settings = sceneLook(plan.sceneId, tier, quiet);
    Promise.all([import('./engine.js'), loadScene(), loadWeather ? loadWeather() : null]).then(([engine, sceneModule, weatherModule]) => {
      if (cancelled) return;
      stage = engine.createStage(element, {
        build: sceneModule.default, overlay: weatherModule?.default ?? null,
        ctx: { id: plan.sceneId, amount: settings.amount, size: settings.size, tier, weather: plan.weather, quiet, palette: [tint, companion, accent], seed: sceneSeed(plan.sceneId), day },
        look: settings, still, limits: RENDER_LIMITS, clock: SCENE_CLOCK, allowSoftware: softwareAllowed(), onFail: fail,
      });
    }).catch(fail);
    return () => { cancelled = true; stage?.dispose(); };
  }, [plan.module, plan.sceneId, plan.weather, still, quiet, tier, tint, companion, accent, day]);
  const mask = fadeMask(look.fadeToMiddle);
  return <div ref={host} className="ambient-theme scene3d" aria-hidden="true" data-scene-renderer="3d" data-scene-module={plan.module} data-scene-tier={tier}
    data-scene-weather={plan.weather ?? undefined} data-theme-motif={scene.motif} data-theme-habitat={scene.habitat ?? scene.motif} data-theme-source={scene.source}
    data-theme-quiet={quiet || undefined} data-theme-still={still || undefined}
    style={{ '--scene3d-opacity': look.opacity, maskImage: mask, WebkitMaskImage: mask, filter: look.saturation < 1 ? `saturate(${look.saturation})` : undefined } as CSSProperties} />;
});
