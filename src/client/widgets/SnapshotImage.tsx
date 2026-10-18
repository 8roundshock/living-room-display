import { useId } from 'react';

/** Presentation only: original desktop pixels stay unchanged in the RAM endpoint. */
export function SnapshotImage({
  src,
  opacity,
  onError,
}: {
  src: string;
  opacity: number;
  onError: () => void;
}) {
  const toneId = useId();
  return (
    <>
      <svg
        className="snapshot-processing"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id={toneId}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncG type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncB type="gamma" amplitude="1" exponent="0.65" offset="0" />
              <feFuncA type="identity" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <img
        className="preview-image"
        src={src}
        alt="Desktop captured before the display opened"
        onError={onError}
        style={{ opacity, filter: `url(#${toneId}) saturate(0.45)` }}
      />
    </>
  );
}
