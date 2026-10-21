import type { CSSProperties } from 'react';
import { GLYPH_PARTS, weatherIcon } from '../icons.tsx';
import { useMotion } from '../useMotion.ts';

/**
 * The one weather symbol for every widget. `hero` marks a widget's main condition glyph and
 * `still` one that must never animate (stale, offline or unavailable data); both are data
 * attributes for styling only. Without `size` the Icon default (20) applies; `size={null}` lets
 * CSS control it.
 *
 * Each part (sun core and rays, cloud, drops, bolt…) is its own absolutely positioned SVG with the
 * same 24-unit geometry and stroke, so the resting pixels match a single SVG while motion.css can
 * move a part with compositable transforms (#76): the part settles once (a condition change or a
 * reveal remounts it, so @starting-style applies) and its inner HTML wrapper carries any Lively
 * loop, because Chromium composites transform animations on HTML boxes but not on SVG roots.
 * A part of a two-tone symbol carries its own `data-glyph` (partly cloudy's sun or moon, #251), so
 * palette.css paints it with that glyph's sub-tone while the rest keeps the symbol's.
 */
export function WeatherGlyph({ code, isDay = true, hero = false, still = false, size, className }: {
  code: number;
  isDay?: boolean;
  hero?: boolean;
  still?: boolean;
  size?: number | string | null;
  className?: string;
}) {
  const name = weatherIcon(code, isDay);
  const { revealEpoch } = useMotion();
  const replay = hero ? revealEpoch : 0;
  const dimension = size === undefined ? 20 : size;
  const style: CSSProperties = dimension === null ? { flexShrink: 0 } : { width: dimension, height: dimension, flexShrink: 0 };
  return <span
    className={className ? `weather-glyph ${className}` : 'weather-glyph'}
    style={style}
    aria-hidden="true"
    data-glyph={name}
    data-glyph-hero={hero ? 'true' : undefined}
    data-glyph-still={still ? 'true' : undefined}
  >
    {GLYPH_PARTS[name].map(part => <span key={`${name}-${part.id}-${replay}`} className={`glyph-part glyph-part-${part.id}`} data-glyph-part={part.id} data-glyph={part.glyph}>
      <span className="glyph-motion"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">{part.node}</svg></span>
    </span>)}
  </span>;
}
