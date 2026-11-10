import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScenePassageArt } from '../shared/living-scene-art';
import type { ThemeScene } from './ambient-theme';
import type { PassageGeometry } from './scene-passage-dom';
import { passagePathMetrics, planScenePassage, PASSAGE_MAX_INTERSECTION, PASSAGE_MAX_FOOTPRINT, type PassagePlan } from './scene-passage';

export interface PassageHistory { lastGlobal: number | null; lastByTarget: Record<string, number | undefined> }
export type PassageMeasure = () => PassageGeometry | null;

/** One optional foreground actor; global history survives scene/mode changes.
 * A finite linear path uses the exact planner geometry. No frame loop or layout
 * sampling is needed; existing ink invalidation and user interaction cancel it. */
export function SceneForeground({ scene, art, enabled, measure, inkRevision, history }: {
  scene: ThemeScene; art: ScenePassageArt; enabled: boolean; measure: PassageMeasure; inkRevision: number; history: PassageHistory;
}) {
  const actor = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ plan: PassagePlan; born: number } | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => {
    if (!enabled || scene.quiet) { setActive(null); return; }
    const attempt = () => {
      if (activeRef.current) return;
      const geometry = measure(); if (!geometry) return;
      const now = performance.now();
      const plan = planScenePassage({ ...geometry, now, lastGlobal: history.lastGlobal, lastByTarget: history.lastByTarget });
      if (!plan) return;
      history.lastGlobal = now; history.lastByTarget[plan.targetId] = now;
      setActive({ plan, born: now });
    };
    // Wait beyond initial entrances. A rejected attempt consumes no cooldown.
    const timer = window.setInterval(attempt, 4000);
    return () => { window.clearInterval(timer); setActive(null); };
  }, [enabled, scene.motif, scene.habitat, scene.quiet, measure, history]);
  useLayoutEffect(() => {
    if (!active) return;
    const geometry = measure(), target = geometry?.targets.find(t => t.id === active.plan.targetId);
    const metrics = target && passagePathMetrics(active.plan, target.swept);
    const protectedRects = geometry && [...geometry.protectedRects, ...(active.plan.kind === 'near' ? geometry.targets.map(t => t.swept) : [])];
    if (!geometry || !protectedRects || active.plan.kind === 'incursion' && (!target || !metrics || metrics.intersectionMs > PASSAGE_MAX_INTERSECTION || metrics.footprintRatio > PASSAGE_MAX_FOOTPRINT)
      || protectedRects.some(rect => { const value = passagePathMetrics(active.plan, rect); return !value || value.intersectionMs > 0 || value.footprintRatio > 0; })) setActive(null);
  }, [inkRevision, measure, active]);
  useLayoutEffect(() => {
    if (!active || !actor.current) return;
    const { plan } = active;
    const animation = actor.current.animate(plan.steps.map(step => ({ offset: step.offset, transform: `translate(${step.x - plan.width / 2}px,${step.y - plan.height / 2}px)` })), { duration: plan.duration, easing: 'linear', fill: 'both' });
    const opacity = actor.current.animate([{ opacity: 0, offset: 0 }, { opacity: 1, offset: .14 }, { opacity: 1, offset: .86 }, { opacity: 0, offset: 1 }], { duration: plan.duration, easing: 'linear', fill: 'both' });
    const timeout = window.setTimeout(() => setActive(null), plan.duration);
    const cancel = () => setActive(null);
    window.addEventListener('pointermove', cancel, { passive: true }); window.addEventListener('focusin', cancel); window.addEventListener('resize', cancel);
    return () => { animation.cancel(); opacity.cancel(); window.clearTimeout(timeout); window.removeEventListener('pointermove', cancel); window.removeEventListener('focusin', cancel); window.removeEventListener('resize', cancel); };
  }, [active]);
  if (!enabled || scene.quiet || !active) return null;
  const palette = [scene.tint, scene.companion, scene.accent];
  return <div className="living-foreground" aria-hidden="true" data-passage-born={active.born} data-passage-target={active.plan.targetId} data-passage-kind={active.plan.kind}>
    <div ref={actor} className="living-passage" style={{ width: active.plan.width, height: active.plan.height }}>
      <svg viewBox={`0 0 ${art.viewBox[0]} ${art.viewBox[1]}`} width="100%" height="100%">
        {art.paths.map((path, index) => <path key={index} d={path.d} fill="none" stroke={palette[path.tone]} strokeWidth={path.stroke ?? 1.5} opacity={path.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
    </div>
  </div>;
}
