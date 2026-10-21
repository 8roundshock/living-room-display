import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';
import { useImageHold } from './SnapshotImage.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function PhotoShell({ src, hold, onError }: { src: string; hold: boolean; onError: () => void }) {
  const { ref, holding } = useImageHold(hold);
  return <div className="photo-image-shell" data-image-loading={holding ? '' : undefined}><img ref={ref} className="ambient-photo-image" src={src} alt="Selected local photo" onError={onError} /></div>;
}

function Photo({ state, photoPreview, embedded }: WidgetContentProps) {
  const source = photoPreview === undefined ? state.photo?.available && state.photo.id ? `/api/photo/image?id=${state.photo.id}` : null : photoPreview;
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [source]);
  // The photo shown with the widget appears with it; one inserted later waits until decoded (#173).
  const [shown, setShown] = useState(false); useEffect(() => setShown(true), []);
  return source && !failed ? <PhotoShell key={source} src={source} hold={shown} onError={() => setFailed(true)} /> : embedded || failed ? <div className="widget-body image-placeholder"><Icon name="photo" size={null} /><div className="ambient-label">Photo</div><div className="ambient-description">{failed ? 'Photo unavailable' : 'Choose a photo'}</div></div> : null;
}

export const PhotoWidget: WidgetModule = {
  Renderer: Photo,
  visible: props => props.embedded || Boolean(props.photoPreview === undefined ? props.state.photo?.available : props.photoPreview),
};
