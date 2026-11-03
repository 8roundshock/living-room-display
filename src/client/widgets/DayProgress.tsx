import { dayProgress } from '../collection.ts';
import { timeLeft } from '../timer.ts';
import { CollectionFace, CollectionValue } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './day-progress.css';
function DayProgress({ now, size }: WidgetContentProps) {
  const day = dayProgress(now),
    percent = Math.floor(day.fraction * 100);
  return (
    <CollectionFace name="Day progress" size={size} className="day-progress-face">
      <CollectionValue value={String(percent)} unit="%" />
      <p className="collection-detail">{timeLeft(day.remaining)} until midnight</p>
      {size === 'medium' && (
        <div className="collection-dots" aria-label={`${percent}% of the local day elapsed`}>
          {Array.from({ length: 24 }, (_, index) => (
            <span className={index / 24 < day.fraction ? 'elapsed' : ''} key={index} />
          ))}
        </div>
      )}
    </CollectionFace>
  );
}
export const DayProgressWidget: WidgetModule = {
  Renderer: DayProgress,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Uses this computer’s day, midnight to midnight. Daylight-saving changes can make a day shorter or
      longer.
    </p>
  ),
};
