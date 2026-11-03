import { useMemo } from 'react';
import { compactWeatherTime, precipitation, weatherTimeZone } from '../format.ts';
import { CollectionEmpty, CollectionFace, WeatherFooter } from './CollectionParts.tsx';
import { TransitionText } from './TransitionText.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './precipitation.css';
function Precipitation(props: WidgetContentProps) {
  const weather = props.state.weather, count = props.size === 'large' ? 6 : 3;
  const zone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  const hours = weather.hourly.filter(hour => Date.parse(hour.intervalEnd) > props.now.getTime()).slice(0, count);
  return <CollectionFace name="Precipitation outlook" size={props.size} className="precipitation-face">{!hours.length ? <CollectionEmpty>Precipitation outlook unavailable</CollectionEmpty> : <div className="precipitation-hours">{hours.map(hour => <div className="precipitation-hour" key={hour.intervalEnd}><span className="collection-detail">{compactWeatherTime(hour.intervalStart, zone, props.settings.clockFormat)}–{compactWeatherTime(hour.intervalEnd, zone, props.settings.clockFormat)}</span><TransitionText className="collection-title" value={hour.precipitationAmount === null ? '—' : precipitation(hour.precipitationAmount, weather.units.precipitation)} /><span className="collection-detail">{hour.precipitationProbability === null ? 'Chance unknown' : `${hour.precipitationProbability}% chance`}</span></div>)}</div>}<p className="collection-detail">Rain, showers and snow · hourly estimate</p><WeatherFooter props={props} /></CollectionFace>;
}
export const PrecipitationWidget: WidgetModule = { Renderer: Precipitation, sample: collectionSample, Settings: () => <p className="hint">Amounts and probabilities cover each displayed hour and all precipitation, including snow’s water equivalent. A dash means unknown, never zero.</p> };
