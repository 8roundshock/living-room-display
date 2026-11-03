import { useMemo } from 'react';
import { timeOverlap } from '../collection.ts';
import { localTimeZone } from '../astronomy.ts';
import { dateTimeFormat } from '../format.ts';
import { CollectionEmpty, CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './time-overlap.css';
function TimeOverlap({ settings, now, size }: WidgetContentProps) {
  const localZone = useMemo(() => localTimeZone(), []),
    minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const overlap = useMemo(
    () => timeOverlap(settings.widgetData.worldClocks, minute, localZone),
    [settings.widgetData.worldClocks, minute, localZone],
  );
  const range = (zone: string) =>
    `${dateTimeFormat('en', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).format(overlap.start!)} – ${dateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).format(overlap.end!)}`;
  return (
    <CollectionFace name="Time overlap" size={size} className="time-overlap-face">
      {!settings.widgetData.worldClocks.length ? (
        <CollectionEmpty>Add world-clock cities</CollectionEmpty>
      ) : !overlap.start ? (
        <CollectionEmpty>No shared window in the next 48 hours</CollectionEmpty>
      ) : (
        <>
          <p className="collection-title">{range(localZone)}</p>
          {size === 'large' && (
            <ul className="collection-list">
              {overlap.places.slice(1).map((place, index) => (
                <li key={`${place.timezone}-${index}`}>
                  <p className="collection-detail">{place.label}</p>
                  <p className="collection-title">{range(place.timezone)}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="collection-detail">09–17 weekdays · reference hours</p>
      {size === 'medium' && (
        <p className="collection-detail">
          Here + {settings.widgetData.worldClocks.length} saved{' '}
          {settings.widgetData.worldClocks.length === 1 ? 'city' : 'cities'}
        </p>
      )}
    </CollectionFace>
  );
}
export const TimeOverlapWidget: WidgetModule = {
  Renderer: TimeOverlap,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Uses the cities saved in World clocks plus this computer. Finds a common weekday 09:00–17:00 window in
      the next 48 hours. These reference hours do not represent anyone’s availability.
    </p>
  ),
};
