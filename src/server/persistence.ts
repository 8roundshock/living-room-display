/**
 * Additive fields the previous release cannot parse, omitted at rest while equal to the value the
 * current reader restores. validation.ts reads its defaults from here (single source).
 */
export const AT_REST = { appearance: { accentMode: 'color', animation: 'subtle' } } as const;
