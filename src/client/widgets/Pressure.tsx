import { CollectionEmpty, CollectionFace, CollectionValue, Sparkline, useWeatherDetails, WeatherFooter } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './pressure.css';
function Pressure(props: WidgetContentProps) {
  const { current, hours } = useWeatherDetails(props), final = hours.at(-1), delta = current?.pressure != null && final?.pressure != null ? final.pressure - current.pressure : null;
  return <CollectionFace name="Surface pressure" size={props.size} className="pressure-face">{current?.pressure == null ? <CollectionEmpty>Pressure unavailable</CollectionEmpty> : <><CollectionValue value={String(Math.round(current.pressure))} unit="hPa" />{props.size === 'medium' && <><Sparkline values={[current.pressure, ...hours.map(hour => hour.pressure)]} label="Surface pressure forecast trend" /><p className="collection-detail">{delta === null ? 'Trend unavailable' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} hPa over ${Math.round((Date.parse(final!.time) - Date.parse(current.time)) / 3600_000)} hours`}</p></>}</>}<WeatherFooter props={props} readingTime={current?.time} /></CollectionFace>;
}
export const PressureWidget: WidgetModule = { Renderer: Pressure, sample: collectionSample, Settings: () => <p className="hint">Pressure at the model’s surface elevation, in hPa. The outlook shows numerical change only; it does not infer a weather warning.</p> };
