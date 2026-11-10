import { memo, useCallback, useRef, useState } from 'react';
import { THEME_SCENES } from '../shared/theme-registry';
import type { ThemeRect, ThemeScene } from './ambient-theme';
import { LivingTheme } from './LivingTheme';
import { SceneForeground, type PassageHistory, type PassageMeasure } from './SceneForeground';
import { SCENE_MODULE_IDS, WEATHER_MODULE_IDS } from './scene3d/modules';
import { planScene3d } from './scene3d/resolve';
import { Scene3D } from './scene3d/Scene3D';
import { webglAvailable } from './scene3d/webgl';
import './ambient-theme.css';

type Exclusions = () => readonly ThemeRect[];
interface ThemeProps { scene: ThemeScene | null; animated: boolean; still?: boolean; exclusions: Exclusions; layoutKey: string; inkRevision: number; foreground?: boolean; passageMeasure: PassageMeasure }

/** Static editor art is explicit; disabled/reduced display motion never mounts a scene.
 * A scene with a 3D module is drawn in WebGL (#600); the flat SVG renderer remains the fallback
 * when WebGL is unavailable, the 3D stage fails, or the scene has no 3D module yet. */
export const AmbientTheme = memo(function AmbientTheme({ scene, animated, still = false, exclusions, layoutKey, inkRevision, foreground = false, passageMeasure }: ThemeProps) {
  const history = useRef<PassageHistory>({ lastGlobal: performance.now() - 45_000, lastByTarget: {} });
  const [failed3d, setFailed3d] = useState<string | null>(null);
  const plan = scene && (animated || still) ? planScene3d(scene, SCENE_MODULE_IDS, WEATHER_MODULE_IDS) : null;
  const key3d = plan && scene ? `${plan.sceneId}:${plan.module}:${plan.weather}:${scene.quiet}:${still}` : null;
  const fail3d = useCallback(() => setFailed3d(key3d), [key3d]);
  if (!scene || !(animated || still)) return null;
  const composition = THEME_SCENES[scene.habitat ?? scene.motif].composition;
  if (!composition) return null;
  return <>
    {plan && key3d && failed3d !== key3d && webglAvailable()
      ? <Scene3D key={key3d} scene={scene} plan={plan} still={still} onFail={fail3d} />
      : <LivingTheme key={`${scene.motif}:${scene.habitat}:${scene.quiet}:${still}:${layoutKey}`} scene={scene} art={composition} still={still} exclusions={exclusions} inkRevision={inkRevision} />}
    <SceneForeground scene={scene} art={composition.passage} enabled={foreground && animated && !still} measure={passageMeasure} inkRevision={inkRevision} history={history.current} />
  </>;
});
