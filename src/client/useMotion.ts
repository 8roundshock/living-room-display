import { createContext, useContext, useEffect, useState } from 'react';
import { motionPlan, type MotionPlan } from '../shared/motion.ts';

export { ANIMATION_LABELS, ANIMATION_LEVELS } from '../shared/motion.ts';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** This screen's own preference; on the TV it follows Windows Animation effects. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION);
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Motion state a renderer may read; the default (picker samples, tests) is completely still. */
export interface MotionState {
  plan: MotionPlan;
  /** Increments when a reveal starts, so one-shot settles can replay. */
  revealEpoch: number;
  /** A reveal (entrance) is in progress. */
  revealing: boolean;
  /** The arrangement is fading out or resting on black. */
  resting: boolean;
  /** The arrangement is fully black: from the end of the fade-out until the next reveal (#174). */
  black: boolean;
}

export const STILL_MOTION: MotionState = {
  plan: motionPlan({ level: 'off', reducedMotion: true, softMotion: false, fadeSeconds: 0, surface: 'sample' }),
  revealEpoch: 0,
  revealing: false,
  resting: false,
  black: false,
};

export const MotionContext = createContext<MotionState>(STILL_MOTION);

export function useMotion(): MotionState {
  return useContext(MotionContext);
}
