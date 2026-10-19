import type { AppearanceSettings } from './contracts.ts';

/** How widget accents are coloured: one accent colour, or each widget's native palette tone (#75). */
export const ACCENT_MODES = ['color', 'native'] as const;
export type AccentMode = typeof ACCENT_MODES[number];

/**
 * Palette roles a catalog entry can declare as its `tone`:
 * - time: time and night
 * - sky: sky and conditions
 * - water: precipitation
 * - sun: clear daytime and daylight
 * - personal: your own items
 * - stone: images and neutral
 */
export const PALETTE_ROLES = ['time', 'sky', 'water', 'sun', 'personal', 'stone'] as const;
export type PaletteRole = typeof PALETTE_ROLES[number];

export interface PaletteTone {
  name: string;
  hex: string;
  /** Declared OKLCH: lightness 0–1, chroma, hue in degrees. src/shared/palette.test.ts proves `hex` matches. */
  oklch: readonly [number, number, number];
  meaning: string;
}

/**
 * The native palette: one lightness band (OKLCH L 0.72–0.73) and a low chroma band, so every
 * tone has the same perceived weight as the default Mist accent and Native never lights the
 * panel more than one accent colour would. Hues are spread so tones that can share a screen stay
 * distinct, and Gold stays clear of the stale amber. See docs/design.md#native-palette.
 */
export const NATIVE_PALETTE: Record<PaletteRole, PaletteTone> = {
  time: { name: 'Lilac', hex: '#aaa0ca', oklch: [0.729, 0.061, 296], meaning: 'Time and night' },
  sky: { name: 'Mist', hex: '#8aa8c2', oklch: [0.718, 0.050, 245], meaning: 'Sky and conditions' },
  water: { name: 'Sea glass', hex: '#73b1ab', oklch: [0.717, 0.065, 188], meaning: 'Precipitation' },
  sun: { name: 'Gold', hex: '#b3a774', oklch: [0.726, 0.070, 96], meaning: 'Clear daytime' },
  personal: { name: 'Rose', hex: '#c99695', oklch: [0.721, 0.062, 20], meaning: 'Your own items' },
  stone: { name: 'Stone', hex: '#a9a49c', oklch: [0.721, 0.013, 80], meaning: 'Images, clouds and neutral' },
};

/**
 * Status cues that never change with the accent mode; equal to --ambient-caution in styles.css.
 * Stale and offline share the amber (#223, #133): there is no separate offline colour.
 */
export const STATUS_TONES = { caution: '#b0926b' } as const;
export type StatusTone = keyof typeof STATUS_TONES;

/**
 * Single-colour accent choices in the editor's Style tab. Each stays at least 0.05 OKLab from every
 * status tone (src/shared/palette.test.ts); Sand was retuned for that in #224.
 */
export const ACCENT_SWATCHES = [
  { value: '#8aa8c2', name: 'Mist' },
  { value: '#aaa0ca', name: 'Lilac' },
  { value: '#8d9dcc', name: 'Dusk' },
  { value: '#b6a588', name: 'Sand' },
  { value: '#88afa6', name: 'Sage' },
] as const;
export type AccentSwatch = typeof ACCENT_SWATCHES[number];

/**
 * Earlier swatch values and the swatch that replaced each (#224: Sand was #b8a17a, too close to the
 * stale amber). They are read-time aliases only: a stored old value stays as it is on disk, reads as
 * that swatch in the editor and renders with the swatch's current value.
 */
export const ACCENT_ALIASES: Readonly<Record<string, AccentSwatch['value']>> = { '#b8a17a': '#b6a588' };

/** The colour an accent value renders as: a retired swatch value becomes its current swatch. */
export function renderedAccent(color: string): string {
  return ACCENT_ALIASES[color.toLowerCase()] ?? color;
}

/** The swatch an accent value selects, including a retired value of that swatch; null for a custom colour. */
export function accentSwatch(color: string): AccentSwatch | null {
  const value = renderedAccent(color).toLowerCase();
  return ACCENT_SWATCHES.find(swatch => swatch.value === value) ?? null;
}

/** Every role's colour: the accent colour for all of them in `color` mode, the palette in `native`. */
export function paletteTones(appearance: Pick<AppearanceSettings, 'accentMode' | 'accentColor'>): Record<PaletteRole, string> {
  const accent = renderedAccent(appearance.accentColor);
  return Object.fromEntries(PALETTE_ROLES.map(role => [role, appearance.accentMode === 'native' ? NATIVE_PALETTE[role].hex : accent])) as Record<PaletteRole, string>;
}

export type ToneVariable = `--tone-${PaletteRole}`;
/** CSS custom properties for the ambient root; src/client/palette.css maps them onto each widget's accent. */
export function toneVariables(appearance: Pick<AppearanceSettings, 'accentMode' | 'accentColor'>): Record<ToneVariable, string> {
  const tones = paletteTones(appearance);
  return Object.fromEntries(PALETTE_ROLES.map(role => [`--tone-${role}`, tones[role]])) as Record<ToneVariable, string>;
}

/** Sub-tone of each weather glyph (WeatherGlyph's data-glyph), wherever it appears inside a widget. */
export const WEATHER_GLYPH_TONE = { sun: 'sun', moon: 'time', cloud: 'stone', rain: 'water', storm: 'water', snow: 'sky' } as const satisfies Record<string, PaletteRole>;
export type WeatherGlyphName = keyof typeof WEATHER_GLYPH_TONE;

/**
 * Pairs of colours that can appear on one screen: every two palette roles (any widgets can be
 * enabled together and glyphs mix tones inside one widget), and every role against every status tone.
 */
export const CO_OCCURRING_TONES: readonly (readonly [PaletteRole | StatusTone, PaletteRole | StatusTone])[] = [
  ...PALETTE_ROLES.flatMap((role, index) => PALETTE_ROLES.slice(index + 1).map(other => [role, other] as const)),
  ...PALETTE_ROLES.flatMap(role => (Object.keys(STATUS_TONES) as StatusTone[]).map(status => [role, status] as const)),
];
