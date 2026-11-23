import { useMemo } from 'react';
import { weatherTimeZone } from '../format.ts';
import { alertStartLabel, alertsWidgetStatus, unexpiredAlerts } from '../collection.ts';
import { CollectionEmpty, CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './weather-alerts.css';
function WeatherAlerts({ state, settings, now, size, disconnected }: WidgetContentProps) {
  const alerts = state.alerts;
  const zone = useMemo(
    () => weatherTimeZone(state.weather.location.timezone),
    [state.weather.location.timezone],
  );
  const known = alerts && ['fresh', 'stale'].includes(alerts.status),
    count = size === 'large' ? 2 : 1;
  const rows = known ? unexpiredAlerts(alerts.alerts, now.getTime()) : [];
  const quiet = alerts?.status === 'fresh' && !disconnected;
  const empty =
    alerts?.status === 'unsupported'
      ? 'No provider for this area'
      : !known
        ? 'Alerts unavailable'
        : quiet
          ? 'No current alerts'
          : 'Current alerts unknown';
  const status = alertsWidgetStatus(alerts, disconnected, now.getTime());
  return (
    <CollectionFace name="Weather alerts" size={size} className="weather-alerts-face">
      {!rows.length ? (
        <CollectionEmpty>{empty}</CollectionEmpty>
      ) : (
        <ul className="collection-list">
          {rows.slice(0, count).map((alert) => (
            <li key={alert.id}>
              <p className="collection-detail">
                {alert.level}
                {alert.startsAt && Date.parse(alert.startsAt) > now.getTime()
                  ? ` · starts ${alertStartLabel(alert.startsAt, zone, settings.clockFormat)}`
                  : ''}
              </p>
              <p className="collection-title">{alert.name}</p>
              {size === 'large' && alert.area && <p className="collection-detail">{alert.area}</p>}
            </li>
          ))}
        </ul>
      )}
      {rows.length > count && <p className="collection-detail">+{rows.length - count} more</p>}
      {/* Fresh alerts need no footer (#715): no issuer line and no update age on the display; the providers are
          named in this widget's settings. Saved and unavailable alerts and an offline display keep their
          status-tone line, with the age only there. */}
      {status && (
        <div className="collection-footer">
          <span className="status-caution collection-status">
            {status.label}
            {status.label && status.age && ' · '}
            {status.age && <span className="collection-age">{status.age}</span>}
          </span>
        </div>
      )}
    </CollectionFace>
  );
}
export const WeatherAlertsWidget: WidgetModule = {
  Renderer: WeatherAlerts,
  sample: collectionSample,
  Settings: () => (
    <p className="hint">
      Official notices from Environment Canada or the US National Weather Service, for the saved weather
      city. Data Source: Environment and Climate Change Canada. Other areas show unavailable coverage.
      Provider notices are information, not an emergency notification service.
    </p>
  ),
};
