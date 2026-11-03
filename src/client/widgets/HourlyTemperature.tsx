import { temperature } from '../format.ts';
import {
  CollectionEmpty,
  CollectionFace,
  HourValues,
  Sparkline,
  useWeatherDetails,
  WeatherFooter,
} from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './hourly-temperature.css';
function HourlyTemperature(props: WidgetContentProps) {
  const { hours } = useWeatherDetails(props),
    values = hours.map((hour) => hour.temperature);
  return (
    <CollectionFace
      name={`Hourly temperature · ${props.state.weather.units.temperature}`}
      size={props.size}
      className="hourly-temperature-face"
    >
      {!values.some((value) => value !== null) ? (
        <CollectionEmpty>Hourly temperatures unavailable</CollectionEmpty>
      ) : (
        <>
          <Sparkline values={values} label="Estimated temperature trend" />
          <HourValues hours={hours} field="temperature" format={temperature} props={props} />
        </>
      )}
      <WeatherFooter props={props} />
    </CollectionFace>
  );
}
export const HourlyTemperatureWidget: WidgetModule = {
  Renderer: HourlyTemperature,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Hourly model estimates at the shown times, in the saved weather city’s time zone. Larger size shows
      eight hours instead of four.
    </p>
  ),
};
