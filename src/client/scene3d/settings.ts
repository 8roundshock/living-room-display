/** Look of the 3D scene layer. Read src/client/scene3d/README.md and docs/ambient-themes.md
 * ("3D scenes") before changing a number here: these are the owner's picks, not defaults to tune. */
import { TRANSPARENCY } from '../../shared/themes.ts';

/** Owner's pick in the scene style picker, 2026-11-10 (#600), for the "All together"
 * compositions: brightness 45%, how much 30% (Canada Day 15%), size 85%, glow 65%, motion 5%,
 * shine 80%, see-through 100%, fade to middle 60%. */
export const OWNER_LOOK = {
  /** How far a lit body thins to glass: its rim and highlights stay, the body fades. */
  seeThrough: 1,
  /** Strength of halos around lights and of soft out-of-focus discs. */
  glow: .65,
  /** Strength of the studio reflections on metal, glaze and satin. */
  shine: .8,
  /** Scale of objects (their radius and length), not of their positions. */
  size: .85,
  /** Scene seconds per real second. The picker advanced its clock by `motion / 40`; the owner chose motion 5. */
  timeScale: 5 / 40,
  /** How far the scene fades out toward the middle of the screen (the picker's radial mask). */
  fadeToMiddle: .6,
  /** Scene opacity as a share of the app's ambient brightness; the layer never exceeds that brightness.
   * Not the picker's 45% taken literally (coordinator decision, 2026-11-10, #636): in the picker the
   * owner's 45% sat beside stand-in text drawn at roughly the same luminance, so the look he approved
   * has scene highlights about as bright as the text, a ratio close to 1 and not 0.45. In the app the
   * text is already dimmed by the ambient brightness, so the scene takes nearly all of it. */
  brightness: .95,
  /** How much is in a scene, 0-1. A scene module turns this into counts. */
  amount: .3,
} as const;
/** Owner's per-scene "how much" where it differs from the default (same pick, 2026-11-10). */
export const OWNER_SCENE_AMOUNT: Readonly<Record<string, number>> = { 'canada-day': .15 };

export type SceneTier = 'special' | 'everyday';
/** Owner direction, 2026-11-10: one-day occasions "can be more intense, bigger"; scenes that stay
 * for weeks or months "need to be more low-key". Applied gently around the picks above. The
 * product of brightness share and tier is clamped to 1 (sceneLook), so a special scene is drawn
 * at the saved brightness itself and never above it. */
export const TIER_LOOK: Readonly<Record<SceneTier, { opacity: number; amount: number; size: number }>> = {
  everyday: { opacity: .9, amount: .8, size: 1 },
  special: { opacity: 1.15, amount: 1, size: 1.1 },
};
/** Selected quiet dates: a much reduced, neutral, motionless version with nothing in the air. */
export const QUIET_LOOK = { amount: .4, opacity: .38, timeScale: 0, particles: false, saturation: .15 } as const;
/** Runtime caps: backing-store pixels and frame rate. Motion is very slow, so 20 frames a second is smooth. */
export const RENDER_LIMITS = { maxWidth: 2560, maxHeight: 1440, framesPerSecond: 20 } as const;
/** Scene clock at start, and the fixed instant of a still or quiet frame (the picker's thumbnail instant). */
export const SCENE_CLOCK = { start: 12, still: 14 } as const;

/** The Transparency setting (#670, `appearance.theme.transparency`, 0-100; absent is the standard 50)
 * as the multiplier the kit applies to every see-through value: 0 is solid, 1 is the owner's picks
 * exactly (the standard 50%), 2 is the most see-through (100%). The kit's curve for it is `thinned`. */
export function seeScale(transparency: number | undefined): number {
  const value = transparency ?? TRANSPARENCY.standard;
  return Math.min(TRANSPARENCY.max, Math.max(TRANSPARENCY.min, value)) / TRANSPARENCY.standard;
}

/** How much of a surface is left after the see-through look: `alpha` is the surface's alpha at the
 * owner's picks (a body's own solidity, or the kit glass's factor) and `scale` the seeScale share it
 * takes. Up to 1 it moves from solid (1) to `alpha` along a straight line, exactly as the picks always
 * did; beyond 1, toward 2, it is `alpha` raised to `scale`, so a body thins further but never reaches
 * zero and a solid rim (alpha 1) stays solid. kit/core.js uses the same curve in its shader. Pure. */
export function thinned(alpha: number, scale: number): number {
  return scale <= 1 ? alpha * scale + (1 - scale) : alpha ** scale;
}

export interface SceneLook {
  amount: number; size: number;
  /** Multiplier of the ambient brightness; never above 1. */
  opacity: number;
  glow: number; shine: number; seeThrough: number; timeScale: number; fadeToMiddle: number;
  /** The Transparency setting as a multiplier of every see-through value (see seeScale): 1 is the standard look. */
  seeScale: number;
  particles: boolean; saturation: number;
}

/** The owner's picks with the tier and quiet-date rules applied, and the Transparency setting. Pure.
 * Transparency applies on a quiet date too: the quiet rule does not touch see-through. */
export function sceneLook(sceneId: string, tier: SceneTier, quiet = false, transparency?: number): SceneLook {
  const rule = TIER_LOOK[tier];
  return {
    amount: (OWNER_SCENE_AMOUNT[sceneId] ?? OWNER_LOOK.amount) * rule.amount * (quiet ? QUIET_LOOK.amount : 1),
    size: OWNER_LOOK.size * rule.size,
    // Share and tier are clamped together first, so no tier is ever above the saved brightness; a quiet date dims that.
    opacity: Math.min(1, OWNER_LOOK.brightness * rule.opacity) * (quiet ? QUIET_LOOK.opacity : 1),
    glow: OWNER_LOOK.glow, shine: OWNER_LOOK.shine, seeThrough: OWNER_LOOK.seeThrough, seeScale: seeScale(transparency),
    timeScale: quiet ? QUIET_LOOK.timeScale : OWNER_LOOK.timeScale,
    fadeToMiddle: OWNER_LOOK.fadeToMiddle,
    particles: quiet ? QUIET_LOOK.particles : true,
    saturation: quiet ? QUIET_LOOK.saturation : 1,
  };
}

/** The picker's radial mask: full strength at the edges, `1 - fade` in the middle. */
export function fadeMask(fade: number): string {
  const amount = Math.min(1, Math.max(0, fade));
  return `radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,${(1 - amount).toFixed(2)}) ${Math.round(18 + amount * 22)}%, #000 100%)`;
}

/** A stable whole number per scene id for a module's own deterministic variation. It does not change from day to day. */
export function sceneSeed(sceneId: string): number {
  let hash = 2166136261;
  for (const character of sceneId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % 9973;
}

/** The civil day in the computer's zone as a whole number that grows by one at local midnight (`ctx.day`). */
export function civilDay(at: Date): number {
  return Math.floor(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86_400_000);
}

/** Backing-store size for a canvas of the given CSS size: device pixels, capped on both axes. */
export function renderSize(cssWidth: number, cssHeight: number, devicePixelRatio = 1, limits: { maxWidth: number; maxHeight: number } = RENDER_LIMITS): { width: number; height: number } {
  if (!(cssWidth > 0 && cssHeight > 0)) return { width: 0, height: 0 };
  const ratio = Math.min(Math.max(devicePixelRatio, .5), limits.maxWidth / cssWidth, limits.maxHeight / cssHeight);
  return { width: Math.max(2, Math.round(cssWidth * ratio)), height: Math.max(2, Math.round(cssHeight * ratio)) };
}
