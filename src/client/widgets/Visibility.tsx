import { distance } from '../collection.ts';
import { CollectionEmpty, CollectionFace, CollectionValue, HourValues, useWeatherDetails, WeatherFooter } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './visibility.css';
function Visibility(props: WidgetContentProps) {
  const { current, hours } = useWeatherDetails(props), imperial = props.settings.units === 'imperial', format = (value: number | null) => distance(value, imperial);
  return <CollectionFace name="Visibility" size={props.size} className="visibility-face">{current?.visibility == null ? <CollectionEmpty>Visibility unavailable</CollectionEmpty> : <><CollectionValue value={format(current.visibility)} /><p className="collection-detail">Model viewing distance</p>{props.size === 'medium' && <HourValues hours={hours.slice(0, 3)} field="visibility" format={format} props={props} />}</>}<WeatherFooter props={props} readingTime={current?.time} /></CollectionFace>;
}
export const VisibilityWidget: WidgetModule = { Renderer: Visibility, sample: collectionSample, Settings: () => <p className="hint">Estimated viewing distance from the weather model. Local conditions vary; this does not assess travel safety.</p> };
