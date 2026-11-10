/** Per-scene edge dressing (#586, owner direction 2026-11-09): which continuous
 * ground runs along the bottom edge, what hangs from the top edge and which
 * particles stay in flight. Shapes are generated in the client; this is only the
 * authored choice. These are art decisions, not cultural or weather claims. */
export type GroundKind = 'grass' | 'drift' | 'leaf' | 'cloth' | 'water' | 'mist';
export type TopKind = 'cloud' | 'icicle' | 'fir' | 'foliage' | 'blossom' | 'bunting' | 'streamer' | 'lantern';
export type ParticleKind = 'flake' | 'petal' | 'leaf' | 'firefly' | 'confetti' | 'sparkle';
export interface SceneDressing { ground: GroundKind; top?: TopKind; particles?: ParticleKind; count?: number;
  /** Fixed colours where the scene palette's first role is not ground- or canopy-coloured. */
  groundColors?: readonly [string, string, string]; topColors?: readonly [string, string, string] }
const SNOW = ['#bfe3f7', '#9fd0f2', '#d6c8f5'] as const, MEADOW = ['#4fbf5e', '#f6cf3c', '#b6e04a'] as const;

const birthday: SceneDressing = { ground: 'cloth', top: 'bunting', particles: 'confetti', count: 42 };
export const SCENE_DRESSING: Readonly<Record<string, SceneDressing>> = {
  birthday, 'birthday-russian': birthday, 'birthday-korean': birthday,
  spring: { ground: 'grass', top: 'blossom', particles: 'petal', count: 39 },
  summer: { ground: 'grass', top: 'foliage', particles: 'firefly', count: 36 },
  autumn: { ground: 'leaf', top: 'foliage', particles: 'leaf', count: 36 },
  winter: { ground: 'drift', top: 'icicle', particles: 'flake', count: 62 },
  christmas: { ground: 'drift', top: 'fir', particles: 'flake', count: 56, groundColors: SNOW },
  'new-year': { ground: 'cloth', top: 'streamer', particles: 'confetti', count: 48 },
  'new-year-tree': { ground: 'drift', top: 'fir', particles: 'flake', count: 56, groundColors: SNOW },
  'orthodox-christmas': { ground: 'drift', top: 'icicle', particles: 'flake', count: 45 },
  halloween: { ground: 'leaf', top: 'foliage', particles: 'leaf', count: 34 },
  thanksgiving: { ground: 'leaf', top: 'foliage', particles: 'leaf', count: 34 },
  'canada-day': { ground: 'grass', top: 'foliage', particles: 'leaf', count: 31, groundColors: MEADOW },
  easter: { ground: 'grass', top: 'blossom', particles: 'petal', count: 36 },
  seollal: { ground: 'cloth', top: 'streamer', particles: 'sparkle', count: 31 },
  chuseok: { ground: 'grass', top: 'foliage', particles: 'firefly', count: 34, groundColors: ['#c9a83a', '#f7d264', '#9fd070'], topColors: ['#7fb85a', '#f7d264', '#d79ae0'] },
  'lotus-lanterns': { ground: 'grass', top: 'lantern', particles: 'petal', count: 34, groundColors: MEADOW },
  maslenitsa: { ground: 'cloth', top: 'streamer', particles: 'sparkle', count: 31 },
  pascha: { ground: 'grass', top: 'blossom', particles: 'petal', count: 34, groundColors: MEADOW, topColors: ['#5fc46a', '#ee5562', '#f7ce5a'] },
  mimosa: { ground: 'grass', top: 'blossom', particles: 'firefly', count: 36 },
  rain: { ground: 'water', top: 'cloud' },
  snow: { ground: 'drift', top: 'icicle', particles: 'flake', count: 64 },
  storm: { ground: 'water', top: 'cloud' },
  fog: { ground: 'water' },
  wind: { ground: 'grass', top: 'foliage', particles: 'leaf', count: 42 },
};
