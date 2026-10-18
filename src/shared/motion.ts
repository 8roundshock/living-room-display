/** Motion inside widgets and the editor. Relocation through black is unaffected. #76 adds the rest. */
export const ANIMATION_LEVELS = ['off', 'subtle', 'lively'] as const;
export type AnimationLevel = typeof ANIMATION_LEVELS[number];
export const DEFAULT_ANIMATION_LEVEL: AnimationLevel = 'subtle';
export const ANIMATION_LABELS: Record<AnimationLevel, string> = { off: 'Off', subtle: 'Subtle', lively: 'Lively' };
