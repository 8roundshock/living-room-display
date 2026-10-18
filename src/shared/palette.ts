/** How widget accents are coloured. Rendering arrives with #75. */
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
 *
 * #75 adds the colour values for each role.
 */
export const PALETTE_ROLES = ['time', 'sky', 'water', 'sun', 'personal', 'stone'] as const;
export type PaletteRole = typeof PALETTE_ROLES[number];
