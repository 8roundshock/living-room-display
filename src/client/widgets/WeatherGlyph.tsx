import { Icon, weatherIcon } from '../icons.tsx';

/**
 * The one weather symbol for every widget. `hero` marks a widget's main condition glyph and
 * `still` one that must never animate; both are data attributes for styling only. Without `size`
 * the Icon default applies; `size={null}` lets CSS control it.
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
  return <Icon
    name={name}
    size={size}
    className={className ? `weather-glyph ${className}` : 'weather-glyph'}
    data-glyph={name}
    data-glyph-hero={hero ? 'true' : undefined}
    data-glyph-still={still ? 'true' : undefined}
  />;
}
