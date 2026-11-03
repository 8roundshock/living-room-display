import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '../icons.tsx';
import { SnapshotImage, useImageHold } from './SnapshotImage.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/** Width over height when both are usable, else null. */
function aspect(width: number | null | undefined, height: number | null | undefined): number | null {
  return width && height && width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : null;
}

function SnapshotShell({ src, opacity, hold, onError, onLoad }: { src: string; opacity: number; hold: boolean; onError: () => void; onLoad: (image: HTMLImageElement) => void }) {
  const { ref, holding } = useImageHold(hold);
  return <div className="preview-image-shell" data-image-loading={holding ? '' : undefined}><SnapshotImage ref={ref} src={src} opacity={opacity} onError={onError} onLoad={onLoad} /></div>;
}

/**
 * Picture-only presentation; capture metadata still binds the exact image request.
 * The shell takes the snapshot's own shape at the largest size that fits the cell.
 */
function Preview({ state: { preview }, settings }: WidgetContentProps) {
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [preview.capturedAt]);
  const [natural, setNatural] = useState<{ at: string; aspect: number } | null>(null);
  // The snapshot shown with the widget appears with it; one inserted later waits until decoded (#173).
  const [shown, setShown] = useState(false); useEffect(() => setShown(true), []);
  if (!preview.available || !preview.capturedAt || failed) return <div className="widget-body image-placeholder"><Icon name="monitor" size={null} /><div className="ambient-label">Last screen</div><div className="ambient-description">{failed ? 'Screenshot unavailable' : 'Waiting for screenshot'}</div></div>;
  const capturedAt = preview.capturedAt;
  const shape = aspect(preview.width, preview.height) ?? (natural?.at === capturedAt ? natural.aspect : null) ?? 16 / 9;
  const loaded = (image: HTMLImageElement) => { const value = aspect(image.naturalWidth, image.naturalHeight); if (value && !aspect(preview.width, preview.height)) setNatural({ at: capturedAt, aspect: value }); };
  return <div className="widget-body snapshot-body" style={{ '--snapshot-ratio': shape } as CSSProperties}>
    <div className="snapshot-frame">
      <SnapshotShell key={capturedAt} src={`/api/preview/image?t=${encodeURIComponent(capturedAt)}`} opacity={settings.preview.opacity} hold={shown} onError={() => setFailed(true)} onLoad={loaded} />
    </div>
  </div>;
}

export const PreviewWidget: WidgetModule = {
  Renderer: Preview,
  visible: props => props.settings.preview.enabled,
};
