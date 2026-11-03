import { temperature } from '../format.ts';
import {
  CollectionEmpty,
  CollectionFace,
  CollectionValue,
  HourValues,
  useWeatherDetails,
  WeatherFooter,
} from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './humidity.css';
function Humidity(props: WidgetContentProps) {
  const { current, hours } = useWeatherDetails(props);
  return (
    <CollectionFace name="Outdoor humidity" size={props.size} className="humidity-face">
      {current?.humidity == null ? (
        <CollectionEmpty>Humidity unavailable</CollectionEmpty>
      ) : (
        <>
          <CollectionValue value={String(Math.round(current.humidity))} unit="%" />
          <p className="collection-detail">
            Dew point {temperature(current.dewPoint)}
            {props.state.weather.units.temperature.slice(1)}
          </p>
          {props.size === 'medium' && (
            <HourValues
              hours={hours}
              field="humidity"
              format={(value) => (value === null ? '—' : `${Math.round(value)}%`)}
              props={props}
            />
          )}
        </>
      )}
      <WeatherFooter props={props} readingTime={current?.time} />
    </CollectionFace>
  );
}
export const HumidityWidget: WidgetModule = {
  Renderer: Humidity,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Outdoor relative humidity and dew point from the weather model. This is not a measurement inside your
      room.
    </p>
  ),
};
