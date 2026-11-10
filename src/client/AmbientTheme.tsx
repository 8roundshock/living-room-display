import { memo, useRef } from 'react';
import { THEME_SCENES } from '../shared/theme-registry';
import type { ThemeRect, ThemeScene } from './ambient-theme';
import { LivingTheme } from './LivingTheme';
import { SceneForeground, type PassageHistory, type PassageMeasure } from './SceneForeground';
import './ambient-theme.css';

type Exclusions = () => readonly ThemeRect[];
interface ThemeProps { scene: ThemeScene | null; animated: boolean; still?: boolean; exclusions: Exclusions; layoutKey: string; inkRevision: number; foreground?: boolean; passageMeasure: PassageMeasure }

/** Static editor art is explicit; disabled/reduced display motion never mounts a scene. */
export const AmbientTheme = memo(function AmbientTheme({ scene, animated, still = false, exclusions, layoutKey, inkRevision, foreground = false, passageMeasure }: ThemeProps) {
  const history = useRef<PassageHistory>({ lastGlobal: performance.now() - 45_000, lastByTarget: {} });
  if (!scene || !(animated || still)) return null;
  const composition = THEME_SCENES[scene.habitat ?? scene.motif].composition;
  if (!composition) return null;
  return <>
    <LivingTheme key={`${scene.motif}:${scene.habitat}:${scene.quiet}:${still}:${layoutKey}`} scene={scene} art={composition} still={still} exclusions={exclusions} inkRevision={inkRevision} />
    <SceneForeground scene={scene} art={composition.passage} enabled={foreground && animated && !still} measure={passageMeasure} inkRevision={inkRevision} history={history.current} />
  </>;
});
