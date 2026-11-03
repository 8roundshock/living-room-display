import { compass } from '../collection.ts';
import { CollectionEmpty, CollectionFace, CollectionValue, HourValues, useWeatherDetails, WeatherFooter } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './wind.css';
function Wind(props: WidgetContentProps) {
  const { current, hours } = useWeatherDetails(props), unit = props.state.weather.units.windSpeed;
  return <CollectionFace name="Wind" size={props.size} className="wind-face">{current?.windSpeed == null ? <CollectionEmpty>Wind unavailable</CollectionEmpty> : <><div className="wind-heading"><CollectionValue value={String(Math.round(current.windSpeed))} unit={unit} /><span className="wind-direction">{compass(current.windDirection)}</span></div><p className="collection-detail">Gust {current.windGust === null ? '—' : Math.round(current.windGust)} {unit} · previous hour</p>{props.size === 'medium' && <HourValues hours={hours} field="windSpeed" format={value => value === null ? '—' : String(Math.round(value))} props={props} />}</>}<WeatherFooter props={props} readingTime={current?.time} /></CollectionFace>;
}
export const WindWidget: WidgetModule = { Renderer: Wind, sample: collectionSample, Settings: () => <p className="hint">Model wind at 10 metres above ground. Direction names where wind comes from; gusts are the maximum in the hour ending at the reading time.</p> };
