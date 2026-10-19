import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Photo({ state, photoPreview, embedded }: WidgetContentProps) {
  const source = photoPreview === undefined ? state.photo?.available && state.photo.id ? `/api/photo/image?id=${state.photo.id}` : null : photoPreview;
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [source]);
  return source && !failed ? <div className="photo-image-shell"><img className="ambient-photo-image" src={source} alt="Selected local photo" onError={() => setFailed(true)} /></div> : embedded || failed ? <div className="widget-body image-placeholder"><Icon name="photo" size={null} /><div className="ambient-label">Photo</div><div className="ambient-description">{failed ? 'Photo unavailable' : 'Choose a photo'}</div></div> : null;
}

export const PhotoWidget: WidgetModule = {
  Renderer: Photo,
  visible: props => props.embedded || Boolean(props.photoPreview === undefined ? props.state.photo?.available : props.photoPreview),
};
