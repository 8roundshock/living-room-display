/** Look of the 3D scene layer. Read src/client/scene3d/README.md and docs/ambient-themes.md
 * ("3D scenes") before changing a number here: these are the owner's picks, not defaults to tune. */

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
  /** Scene opacity as a share of the app's ambient brightness; the product never exceeds that brightness. */
  brightness: .45,
  /** How much is in a scene, 0-1. A scene module turns this into counts. */
  amount: .3,
} as const;
/** Owner's per-scene "how much" where it differs from the default (same pick, 2026-11-10). */
export const OWNER_SCENE_AMOUNT: Readonly<Record<string, number>> = { 'canada-day': .15 };

export type SceneTier = 'special' | 'everyday';
/** Owner direction, 2026-11-10: one-day occasions "can be more intense, bigger"; scenes that stay
 * for weeks or months "need to be more low-key". Applied gently around the picks above. */
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

export interface SceneLook {
  amount: number; size: number;
  /** Multiplier of the ambient brightness; never above 1. */
  opacity: number;
  glow: number; shine: number; seeThrough: number; timeScale: number; fadeToMiddle: number;
  particles: boolean; saturation: number;
}

/** The owner's picks with the tier and quiet-date rules applied. Pure. */
export function sceneLook(sceneId: string, tier: SceneTier, quiet = false): SceneLook {
  const rule = TIER_LOOK[tier];
  return {
    amount: (OWNER_SCENE_AMOUNT[sceneId] ?? OWNER_LOOK.amount) * rule.amount * (quiet ? QUIET_LOOK.amount : 1),
    size: OWNER_LOOK.size * rule.size,
    opacity: Math.min(1, OWNER_LOOK.brightness * rule.opacity * (quiet ? QUIET_LOOK.opacity : 1)),
    glow: OWNER_LOOK.glow, shine: OWNER_LOOK.shine, seeThrough: OWNER_LOOK.seeThrough,
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
