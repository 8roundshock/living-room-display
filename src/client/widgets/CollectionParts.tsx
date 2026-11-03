import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { WeatherDetailReading } from '../../shared/contracts.ts';
import {
  ageLabel,
  compactWeatherTime,
  lastKnownLabel,
  LAST_KNOWN_AFTER_MS,
  weatherTimeZone,
} from '../format.ts';
import { currentDetail, upcomingDetails } from '../collection.ts';
import type { WidgetContentProps } from './types.ts';
import type { WidgetSize } from '../../shared/widgets.ts';
import { TransitionText } from './TransitionText.tsx';
import './collection-parts.css';

export function CollectionFace({
  name,
  size,
  children,
  className = '',
}: {
  name: string;
  size: WidgetSize;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`collection-face collection-${size} ${className}`}>
      <div className="collection-label">{name}</div>
      {children}
    </div>
  );
}
export function CollectionEmpty({ children }: { children: ReactNode }) {
  return <p className="collection-empty">{children}</p>;
}
export function CollectionValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <div className="collection-reading">
      <TransitionText className="collection-value" value={value} />
      {unit && <span className="collection-unit">{unit}</span>}
    </div>
  );
}
export function useWeatherDetails(props: WidgetContentProps) {
  const { weather } = props.state,
    minute = Math.floor(props.now.getTime() / 60_000) * 60_000;
  const zone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  return useMemo(
    () => ({
      current: currentDetail(weather, minute),
      hours: upcomingDetails(weather, minute, props.size === 'large' ? 8 : 4),
      zone,
    }),
    [weather, minute, props.size, zone],
  );
}
export function WeatherFooter({ props, readingTime }: { props: WidgetContentProps; readingTime?: string }) {
  const weather = props.state.weather;
  const zone = useMemo(() => weatherTimeZone(weather.location.timezone), [weather.location.timezone]);
  const old = readingTime && props.now.getTime() - Date.parse(readingTime) > LAST_KNOWN_AFTER_MS;
  const status = props.disconnected
    ? 'Offline'
    : weather.status === 'stale'
      ? 'Saved forecast'
      : weather.status === 'unavailable'
        ? 'Unavailable'
        : null;
  return (
    <div className="collection-footer">
      {old && (
        <span className="status-caution collection-last-known">
          Last known · {lastKnownLabel(Date.parse(readingTime!), props.now, zone, props.settings.clockFormat)}
          <br />
        </span>
      )}
      {status && <span className="status-caution">{status} · </span>}
      {weather.location.name}
      <br />
      Open-Meteo · {ageLabel(weather.updatedAt, props.now.getTime())}
    </div>
  );
}
export function HourValues({
  hours,
  field,
  format,
  props,
}: {
  hours: WeatherDetailReading[];
  field: keyof Omit<WeatherDetailReading, 'time'>;
  format: (value: number | null) => string;
  props: WidgetContentProps;
}) {
  const zone = useMemo(
    () => weatherTimeZone(props.state.weather.location.timezone),
    [props.state.weather.location.timezone],
  );
  return (
    <div className="collection-hours">
      {hours.map((hour) => (
        <div className="collection-hour" key={hour.time}>
          <span className="collection-hour-label">
            {compactWeatherTime(hour.time, zone, props.settings.clockFormat)}
          </span>
          <TransitionText className="collection-hour-value" value={format(hour[field])} />
        </div>
      ))}
    </div>
  );
}
/** Missing samples break the line; no interpolation across unknown model values. */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const low = Math.min(...known),
    high = Math.max(...known),
    range = Math.max(1, high - low);
  const segments: string[] = [];
  let segment = '';
  values.forEach((value, index) => {
    if (value === null) {
      if (segment) segments.push(segment);
      segment = '';
      return;
    }
    segment += `${segment ? ' L' : 'M'}${(index * 100) / Math.max(1, values.length - 1)},${30 - ((value - low) / range) * 26}`;
  });
  if (segment) segments.push(segment);
  return (
    <svg className="collection-sparkline" viewBox="0 0 100 34" role="img" aria-label={label}>
      {segments.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
