import { yearProgress } from '../collection.ts';
import { CollectionFace, CollectionValue } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './year-progress.css';
function YearProgress({ now, size }: WidgetContentProps) {
  const year = yearProgress(now);
  return (
    <CollectionFace name={String(year.year)} size={size} className="year-progress-face">
      <CollectionValue value={String(year.day)} unit={`of ${year.total} days`} />
      <p className="collection-detail">{year.remaining} days after today</p>
      {size === 'medium' && (
        <div className="year-progress-months">
          {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((month, index) => (
            <span
              key={index}
              className={index < now.getMonth() ? 'past' : index === now.getMonth() ? 'current' : ''}
            >
              {month}
            </span>
          ))}
        </div>
      )}
    </CollectionFace>
  );
}
export const YearProgressWidget: WidgetModule = {
  Renderer: YearProgress,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">A civil-calendar view of the year, including leap days. Uses this computer’s date.</p>
  ),
};
