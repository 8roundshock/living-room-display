import { memo, useEffect, useState, type CSSProperties } from 'react';
import { THEME_ACTIVE_MS, themeCadence, themeParticle, type ThemeMotif, type ThemeScene } from './ambient-theme';
import './ambient-theme.css';

function Mark({ motif }: { motif: ThemeMotif }) {
  if (motif === 'rain' || motif === 'storm') return <path d="M16 3 9 24" />;
  if (motif === 'fog' || motif === 'wind') return <path d={motif === 'fog' ? 'M1 14 Q14 7 29 14 M5 20 Q18 14 27 20' : 'M1 19 Q9 9 20 13 T29 8'} />;
  if (motif === 'snow' || motif === 'winter') return <path d="M15 4v22M5.5 9.5l19 11M5.5 20.5l19-11M12 6l3 3 3-3M12 24l3-3 3 3" />;
  if (motif === 'autumn' || motif === 'harvest') return <path d="M7 23C3 11 14 4 25 4c1 12-5 21-18 19Zm0 0L22 7M12 18l-1-7M16 14l6-1" />;
  if (motif === 'halloween') return <path d="m2 14 5-7 4 5 3-5 2 0 3 5 4-5 5 7-6-1-4 5-3-2-3 2-4-5Z" />;
  if (motif === 'christmas') return <path d="m15 3-6 7h4l-7 8h6l-8 8h22l-8-8h6l-7-8h4Z" />;
  if (motif === 'lanterns') return <path d="M10 5h10M10 25h10M15 2v3m0 20v4M10 6c-7 4-7 14 0 18h10c7-4 7-14 0-18Zm5 0v18M10 6c-3 6-3 12 0 18m10-18c3 6 3 12 0 18" />;
  if (motif === 'remembrance') return <path d="M15 27V14M15 19c-6 0-8-4-8-4 6-1 8 4 8 4Zm0-5c-8 0-10-10-5-10 3 0 5 4 5 4s2-4 5-4c5 0 3 10-5 10Z" />;
  if (motif === 'spring') return <path d="M15 16C1 12 7 1 15 12 23 1 29 12 15 16Zm0 0c13-2 12 10 0 5-12 5-13-7 0-5Zm0 5v7" />;
  if (motif === 'summer') return <><circle cx="15" cy="15" r="2" /><path d="M15 7v2m0 12v2M7 15h2m12 0h2" /></>;
  return <path d="m15 3 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" />;
}

/** Unmount the sequence when inactive so resumed motion always starts a fresh cadence. */
export const AmbientTheme = memo(function AmbientTheme({ scene, animated }: { scene: ThemeScene | null; animated: boolean }) {
  return scene && animated ? <ThemeSequence key={scene.motif} scene={scene} /> : null;
});

/** A few staggered finite animations; one expired slot renews every 2–4 seconds. */
function ThemeSequence({ scene }: { scene: ThemeScene }) {
  const [tick, setTick] = useState(0);
  const [seed] = useState(() => Math.floor(Date.now() / 1000));
  const { slots, interval } = themeCadence(scene.motif);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return <div className="ambient-theme" aria-hidden="true" data-theme-motif={scene.motif} data-theme-source={scene.source} data-theme-tick={tick} data-theme-interval={interval}
    style={{ '--theme-tint': scene.tint, '--theme-duration': `${THEME_ACTIVE_MS}ms` } as CSSProperties}>
    {Array.from({ length: Math.min(tick + 1, slots) }, (_, index) => {
      const generation = tick - ((tick - index) % slots);
      const point = themeParticle(index, seed + generation);
      return <svg key={generation} data-theme-generation={generation} className="theme-mark" viewBox="0 0 30 30" preserveAspectRatio="none" style={{ left: `${point.x}%`, top: `${point.y}%`, '--theme-scale': point.scale, '--theme-travel': `${point.travel}cqh` } as CSSProperties}><Mark motif={scene.motif} /></svg>;
    })}
  </div>;
}
