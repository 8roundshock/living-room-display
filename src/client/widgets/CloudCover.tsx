import { CollectionEmpty, CollectionFace, CollectionValue, HourValues, useWeatherDetails, WeatherFooter } from './CollectionParts.tsx';
import { WeatherGlyph } from './WeatherGlyph.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './cloud-cover.css';
function CloudCover(props: WidgetContentProps) {
  const { current, hours } = useWeatherDetails(props);
  return <CollectionFace name="Cloud cover" size={props.size} className="cloud-cover-face">{current?.cloudCover == null ? <CollectionEmpty>Cloud cover unavailable</CollectionEmpty> : <><div className="cloud-cover-heading"><WeatherGlyph code={3} still size={null} /><CollectionValue value={String(Math.round(current.cloudCover))} unit="%" /></div><p className="collection-detail">Estimated sky coverage</p>{props.size === 'medium' && <HourValues hours={hours} field="cloudCover" format={value => value === null ? '—' : `${Math.round(value)}%`} props={props} />}</>}<WeatherFooter props={props} readingTime={current?.time} /></CollectionFace>;
}
export const CloudCoverWidget: WidgetModule = { Renderer: CloudCover, sample: collectionSample, Settings: () => <p className="hint">The model’s total cloud area fraction. The cloud icon identifies this measurement; it is not a separate current-condition forecast.</p> };
