import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';
import { SnapshotImage } from './SnapshotImage.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Preview({ state: { preview }, settings, embedded }: WidgetContentProps) {
  const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [preview.capturedAt]);
  return preview.available && preview.capturedAt && !failed ? <div className="widget-body snapshot-body"><div className="preview-image-shell" key={preview.capturedAt}><SnapshotImage src={`/api/preview/image?t=${encodeURIComponent(preview.capturedAt)}`} opacity={settings.preview.opacity} onError={() => setFailed(true)} /></div><div className="preview-caption">Last screen · {new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).format(new Date(preview.capturedAt))}</div></div> : embedded || failed ? <div className="widget-body image-placeholder"><Icon name="monitor" size={null} /><div className="ambient-label">Last screen</div><div className="ambient-description">{failed ? 'Snapshot unavailable' : 'Captured on activation'}</div></div> : null;
}

export const PreviewWidget: WidgetModule = {
  Renderer: Preview,
  visible: props => props.settings.preview.enabled && (props.embedded || props.state.preview.available),
};
