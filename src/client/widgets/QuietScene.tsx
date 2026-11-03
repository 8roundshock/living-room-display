import { CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './quiet-scene.css';
function QuietScene({ now, size }: WidgetContentProps) {
  const hour = now.getHours(),
    night = hour < 6 || hour >= 20,
    phase = night ? 'Night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  // A drawn scene, never a local horizon or astronomical position. The shared board moves it.
  return (
    <CollectionFace
      name="Quiet scene"
      size={size}
      className={`quiet-scene-face quiet-scene-${night ? 'night' : 'day'}`}
    >
      <svg
        className="quiet-scene-drawing"
        viewBox="0 0 240 110"
        role="img"
        aria-label={`Illustrated ${phase.toLowerCase()} landscape`}
      >
        <path className="quiet-scene-far" d="M5 65 Q35 10 70 60 T140 48 T235 60" />
        <path d="M5 88 Q60 34 110 76 T235 75" />
        <path className="quiet-scene-near" d="M12 103 Q80 70 138 96 T230 93" />
        {night ? (
          <>
            <path className="quiet-scene-sky" d="M180 12 a12 12 0 1 0 15 17 a14 14 0 0 1 -15 -17" />
            <g className="quiet-scene-stars">
              <path d="M50 12h1 M111 20h1 M145 9h1 M219 28h1 M20 31h1" />
            </g>
          </>
        ) : (
          <circle className="quiet-scene-sky" cx={hour < 12 ? 65 : 182} cy="24" r="10" />
        )}
      </svg>
      <p className="collection-detail">{phase}</p>
    </CollectionFace>
  );
}
export const QuietSceneWidget: WidgetModule = {
  Renderer: QuietScene,
  sample: collectionSample,
  Settings: () => <p className="hint">An illustrated landscape that follows this computer’s time of day.</p>,
};
