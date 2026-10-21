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
}
// #436: the display never fades out or rests on black, so there is no resting or black state; loops
// never pause and analog hands accumulate instead of re-basing on black.

export const STILL_MOTION: MotionState = {
  plan: motionPlan({ level: 'off', reducedMotion: true, softMotion: false, fadeSeconds: 0, surface: 'sample' }),
  revealEpoch: 0,
  revealing: false,
};

export const MotionContext = createContext<MotionState>(STILL_MOTION);

export function useMotion(): MotionState {
  return useContext(MotionContext);
}
