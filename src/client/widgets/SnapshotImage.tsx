import { useEffect, useId, useRef, useState, type Ref } from 'react';

/** A decode that never settles must not keep a new image hidden for longer than this. */
export const IMAGE_HOLD_TIMEOUT_MS = 4000;

/**
 * #173: an image inserted after its widget was shown (a new photo or snapshot) holds its shell
 * (`data-image-loading`) until the image has loaded and decoded, or the timeout passes. At Subtle
 * and Lively the CSS keeps a held shell at opacity 0, so the fade to its resting opacity starts on
 * real pixels instead of an empty box; Off and reduced motion ignore the hold, so their image
 * appears as soon as it is ready. The image a widget is first shown with is never held.
 */
export function useImageHold(hold: boolean): { ref: Ref<HTMLImageElement>; holding: boolean } {
  const ref = useRef<HTMLImageElement>(null);
  // Only the first render decides: a shell that starts shown is never hidden later.
  const [holding, setHolding] = useState(hold);
  useEffect(() => {
    if (!holding) return;
    let active = true;
    const release = () => { if (active) setHolding(false); };
    const timer = window.setTimeout(release, IMAGE_HOLD_TIMEOUT_MS);
    // decode() waits for the response and resolves once the pixels can be painted; it rejects
    // for a broken image, which then shows its placeholder through onError.
    if (ref.current) ref.current.decode().then(release, release); else release();
    return () => { active = false; window.clearTimeout(timer); };
  }, [holding]);
  return { ref, holding };
}

/** Presentation only: original desktop pixels stay unchanged in the RAM endpoint. */
export function SnapshotImage({
  src,
  opacity,
  onError,
  onLoad,
  ref,
}: {
  src: string;
  opacity: number;
  onError: () => void;
  onLoad?: (image: HTMLImageElement) => void;
  ref?: Ref<HTMLImageElement>;
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
        ref={ref}
        className="preview-image"
        src={src}
        alt="Desktop captured before the display opened"
        onError={onError}
        onLoad={onLoad ? event => onLoad(event.currentTarget) : undefined}
        style={{ opacity, filter: `url(#${toneId}) saturate(0.45)` }}
      />
    </>
  );
}
