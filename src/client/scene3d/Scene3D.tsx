import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { ThemeScene } from '../ambient-theme';
import type { Stage } from './engine';
import { SCENE_LOADERS, WEATHER_LOADERS } from './modules';
import type { Scene3dPlan } from './resolve';
import { civilDay, fadeMask, RENDER_LIMITS, SCENE_CLOCK, sceneLook, sceneSeed, seeScale } from './settings';
import { sceneTier } from './tier';
import { softwareAllowed } from './webgl';
import './scene3d.css';

/** `transparency` is the saved or draft Transparency setting (#670, 0-100; undefined is the standard look).
 * `float` (#675) is the board's motion interval and whether it eases (Float gently on, motion allowed), and
 * `preview` the editor's movement-preview time in seconds while one is shown (#678): the scene's float and
 * its own clock then follow it, as the board does. Absent or null: real time. */
interface Props { scene: ThemeScene; plan: Scene3dPlan; still: boolean; transparency?: number; float?: SceneFloat; onFail: () => void }
export interface SceneFloat { interval: number; gentle: boolean; preview?: number | null }

/** The 3D scene behind the widgets. The engine, three.js and the scene module load only when
 * this mounts. Any failure calls `onFail`, and the caller shows the flat renderer instead.
 * A new Transparency retunes the live stage (one rebuild in the same WebGL context once the
 * slider rests), never a new stage; new float settings and each movement-preview step change it in place. */
export const Scene3D = memo(function Scene3D({ scene, plan, still, transparency, float, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null), failed = useRef(onFail), live = useRef<Stage | null>(null), see = seeScale(transparency), seeNow = useRef(see);
  const floatInterval = float?.interval ?? 180, floatGentle = float?.gentle ?? true, floatNow = useRef({ interval: floatInterval, gentle: floatGentle });
  const floatPreview = float?.preview ?? null, previewNow = useRef(floatPreview);
  failed.current = onFail; seeNow.current = see; floatNow.current = { interval: floatInterval, gentle: floatGentle }; previewNow.current = floatPreview;
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
        // The Transparency in effect when the modules arrived; later changes go through retune().
        look: { ...settings, seeScale: seeNow.current }, still, float: floatNow.current, preview: previewNow.current, limits: RENDER_LIMITS, clock: SCENE_CLOCK, allowSoftware: softwareAllowed(), onFail: fail,
      });
      live.current = stage;
    }).catch(fail);
    return () => { cancelled = true; live.current = null; stage?.dispose(); };
  }, [plan.module, plan.sceneId, plan.weather, still, quiet, tier, tint, companion, accent, day]);
  // The stage waits RETUNE_DELAY_MS after the last change before it builds again, so a drag is one rebuild.
  useEffect(() => { live.current?.retune({ seeScale: see }); }, [see]);
  // The float follows the board's settings without rebuilding the scene (#675).
  useEffect(() => { live.current?.setFloat({ interval: floatInterval, gentle: floatGentle }); }, [floatInterval, floatGentle]);
  // The movement preview's clock (#678) reaches the live stage the same way: no new stage per step.
  useEffect(() => { live.current?.setPreview(floatPreview); }, [floatPreview]);
  const mask = fadeMask(look.fadeToMiddle);
  return <div ref={host} className="ambient-theme scene3d" aria-hidden="true" data-scene-renderer="3d" data-scene-module={plan.module} data-scene-tier={tier}
    data-scene-weather={plan.weather ?? undefined} data-theme-motif={scene.motif} data-theme-habitat={scene.habitat ?? scene.motif} data-theme-source={scene.source}
    data-theme-quiet={quiet || undefined} data-theme-still={still || undefined} data-scene-transparency={transparency}
    style={{ '--scene3d-opacity': look.opacity, maskImage: mask, WebkitMaskImage: mask, filter: look.saturation < 1 ? `saturate(${look.saturation})` : undefined } as CSSProperties} />;
});
