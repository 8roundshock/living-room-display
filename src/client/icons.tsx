import { Fragment, type CSSProperties, type ReactNode, type SVGProps } from 'react';

export type IconName =
  | 'clock'
  | 'calendar'
  | 'photo'
  | 'sun'
  | 'moon'
  | 'cloud'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'wind'
  | 'arrow'
  | 'check'
  | 'plus'
  | 'close'
  | 'settings'
  | 'monitor'
  | 'eye'
  | 'location'
  | 'refresh'
  | 'trash'
  | 'edit'
  | 'sparkles'
  | 'alert'
  | 'download'
  | 'globe'
  | 'hourglass'
  | 'note'
  | 'air'
  | 'sunrise'
  | 'forecast'
  | 'undo';
export type WeatherIconName = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'storm';
export interface GlyphPart { id: string; node: ReactNode }
/**
 * Weather symbols as separately movable parts (#76). WeatherGlyph stacks one small SVG per part
 * with the same 24-unit geometry and stroke, so resting pixels match the single-SVG Icon.
 */
export const GLYPH_PARTS: Record<WeatherIconName, readonly GlyphPart[]> = {
  sun: [
    { id: 'core', node: <circle cx="12" cy="12" r="4" /> },
    { id: 'rays', node: <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /> },
  ],
  moon: [{ id: 'moon', node: <path d="M20.2 15.4A8.8 8.8 0 0 1 8.6 3.8a8.8 8.8 0 1 0 11.6 11.6Z" /> }],
  cloud: [{ id: 'cloud', node: <path d="M6 18h12a4 4 0 0 0 .4-8 6.5 6.5 0 0 0-12.6-1A4.5 4.5 0 0 0 6 18Z" /> }],
  rain: [
    { id: 'cloud', node: <path d="M6 15a4.5 4.5 0 0 1-.2-9 6.5 6.5 0 0 1 12.6 1 4 4 0 0 1 .6 7.9" /> },
    { id: 'drop-1', node: <path d="M8 17l-1 3" /> },
    { id: 'drop-2', node: <path d="M13 17l-1 3" /> },
    { id: 'drop-3', node: <path d="M18 17l-1 3" /> },
  ],
  snow: [{ id: 'flake', node: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 4.5l3 3 3-3M9 19.5l3-3 3 3M4.5 11l4-1-1-4M19.5 13l-4 1 1 4M4.5 13l4 1-1 4M19.5 11l-4-1 1-4" /> }],
  storm: [
    { id: 'cloud', node: <path d="M6 15a4.5 4.5 0 0 1-.2-9 6.5 6.5 0 0 1 12.6 1 4 4 0 0 1 .6 7.9" /> },
    { id: 'bolt', node: <path d="m13 12-4 6h5l-2 5" /> },
  ],
};
function glyph(name: WeatherIconName): ReactNode {
  return <>{GLYPH_PARTS[name].map(part => <Fragment key={part.id}>{part.node}</Fragment>)}</>;
}
const paths: Record<IconName, React.ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 5 5" />
    </>
  ),
  sun: glyph('sun'),
  moon: glyph('moon'),
  cloud: glyph('cloud'),
  rain: glyph('rain'),
  snow: glyph('snow'),
  storm: glyph('storm'),
  wind: (
    <>
      <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  settings: (
    <>
      <path
        d="M9.5 3h5l.7 3 2.5 1.4 2.9-.8 2.5 4.4-2.2 2.2v2.8l2.2 2.2-2.5 4.3-2.9-.7-2.5 1.4-.7 3h-5l-.7-3-2.5-1.4-2.9.7-2.5-4.3 2.2-2.2v-2.8L.9 11l2.5-4.4 2.9.8L8.8 6Z"
        transform="translate(2 0) scale(.83)"
      />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-5v5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  location: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 13.6 5M4.4 13A8 8 0 0 0 18 18" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4" />
    </>
  ),
  // Official alerts only (#437): an outline triangle with an exclamation mark, the standard 1.5 stroke.
  alert: (
    <>
      <path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5m0 3h.01" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5Z" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12M7.5 3c0 4.5 4.5 6 4.5 9s-4.5 4.5-4.5 9m9-18c0 4.5-4.5 6-4.5 9s4.5 4.5 4.5 9" />
      <path d="M10 18.5h4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h14v10.5L13.5 20H5Z" />
      <path d="M13.5 20v-5.5H19M8.5 8.5h7M8.5 12h4" />
    </>
  ),
  air: (
    <path d="M3 8c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 12.5c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0M3 17c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
  ),
  sunrise: (
    <>
      <path d="M2.5 19h19M7 19a5 5 0 0 1 10 0" />
      <path d="M12 3.5v5M9.8 5.7 12 3.5l2.2 2.2M5.6 12.6 7 14m11.4-1.4L17 14" />
    </>
  ),
  forecast: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 10h18" />
      <circle cx="12" cy="15.5" r="2" />
      <path d="M12 11.6v.9m0 6v.9m-3.9-3.9h.9m6 0h.9" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
};

/** `size={null}` omits width, height and inline size so CSS controls it; other SVG attributes (for example data-glyph) pass through. */
export function Icon({
  name,
  size = 20,
  className,
  style,
  ...attributes
}: {
  name: IconName;
  size?: number | string | null;
  className?: string;
  style?: CSSProperties;
} & Omit<SVGProps<SVGSVGElement>, 'name' | 'width' | 'height' | 'className' | 'style' | 'ref' | 'children'>) {
  return (
    <svg
      {...attributes}
      width={size ?? undefined}
      height={size ?? undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={size === null ? { flexShrink: 0, ...style } : { width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function weatherIcon(code: number, isDay = true): WeatherIconName {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code <= 3 || code === 45 || code === 48) return 'cloud';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain';
}
