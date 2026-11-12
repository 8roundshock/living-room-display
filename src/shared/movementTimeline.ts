import type { WidgetGrid, WidgetId } from './contracts.ts';
import { composeWidgetGrid } from './widgets.ts';

/** Shared with the live renderer: a swap never fades the board to black. */
export const SWAP_DIM = 0.4;
export function glideSeconds(fadeSeconds: number): number { return Math.min(6, Math.max(1.2, fadeSeconds * 1.5)); }
export function dimSeconds(fadeSeconds: number): number { return fadeSeconds <= 0 ? 0 : Math.min(fadeSeconds / 2, 0.6); }

/** Identical FLIP keyframes for live playback and a paused, seekable preview animation. */
export function glideKeyframes(dx: number, dy: number, index: number, count: number) {
  const middle = count > 1 ? 0.35 + 0.3 * index / (count - 1) : 0.5;
  return [
    { offset: 0, transform: `translate(${dx}px, ${dy}px)`, opacity: 1 },
    { offset: middle, opacity: SWAP_DIM },
    { offset: 1, transform: 'translate(0px, 0px)', opacity: 1 },
  ];
}

export interface MovementTiming { interval: number; swaps: boolean; glide: boolean; fade: number }
export interface MovementFrame {
  /** Board currently laid out. For a glide this is the destination, with an inverse transform. */
  cycle: number;
  /** Swap whose transition is visible (zero means no transition). */
  transition: number;
  phase: 'still' | 'glide' | 'dim';
  elapsed: number;
  duration: number;
}

export function movementFrame(seconds: number, timing: MovementTiming): MovementFrame {
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const next = Math.floor(time / timing.interval), elapsed = Math.round((time - next * timing.interval) * 1e9) / 1e9;
  const still = (cycle: number): MovementFrame => ({ cycle, transition: 0, phase: 'still', elapsed: 0, duration: 0 });
  if (!timing.swaps || next === 0) return still(0);
  if (timing.glide) {
    const duration = glideSeconds(timing.fade);
    return elapsed < duration ? { cycle: next, transition: next, phase: 'glide', elapsed, duration } : still(next);
  }
  const half = dimSeconds(timing.fade), duration = 2 * half;
  return elapsed < duration
    ? { cycle: elapsed < half ? next - 1 : next, transition: next, phase: 'dim', elapsed, duration }
    : still(next);
}

/** The editor's movement preview covers one hour of the display (#686), whatever the interval. */
export const MOVEMENT_PREVIEW_SECONDS = 3600;

/**
 * Replay the same history-dependent composer as the display, in order, before seeking. Caching is
 * local to this preview's authored layout and enabled widgets; seeking backward cannot alter history.
 * The preview covers one hour (MOVEMENT_PREVIEW_SECONDS), so this holds at most 121 boards at the shortest 30 s interval.
 */
export function compositionTimeline(authored: WidgetGrid, enabled: Partial<Record<WidgetId, boolean>>) {
  const source = structuredClone(authored), active = { ...enabled }, boards = [structuredClone(authored)];
  return (cycle: number): WidgetGrid => {
    const target = Math.max(0, Math.floor(Number.isFinite(cycle) ? cycle : 0));
    for (let index = boards.length; index <= target; index++) {
      // Runtime records its first cloned authored board as `previous`, with the authored input as
      // `earlier`. Include that initial history as well as the previous two later arrangements.
      boards.push(composeWidgetGrid(source, active, index, boards[index - 1]!, [boards[Math.max(0, index - 2)]!]));
    }
    return boards[target]!;
  };
}

/** Minutes and seconds into the preview's hour: `12:30`, `60:00` at its end (#686). */
export function previewTimeLabel(seconds: number): string {
  const whole = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
