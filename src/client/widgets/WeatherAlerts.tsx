import { useMemo } from 'react';
import { ageLabel, weatherTimeZone } from '../format.ts';
import { alertStartLabel } from '../collection.ts';
import { CollectionEmpty, CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './weather-alerts.css';
function WeatherAlerts({ state, settings, now, size, disconnected }: WidgetContentProps) {
  const alerts = state.alerts;
  const zone = useMemo(() => weatherTimeZone(state.weather.location.timezone), [state.weather.location.timezone]);
  const known = alerts && ['fresh', 'stale'].includes(alerts.status), count = size === 'large' ? 2 : 1;
  const rows = known ? alerts.alerts.filter(alert => !alert.expiresAt || Date.parse(alert.expiresAt) > now.getTime()) : [];
  const quiet = alerts?.status === 'fresh' && !disconnected;
  const empty = alerts?.status === 'unsupported' ? 'No provider for this area' : !known ? 'Alerts unavailable' : quiet ? 'No current alerts' : 'Current alerts unknown';
  return <CollectionFace name="Weather alerts" size={size} className="weather-alerts-face">{!rows.length ? <CollectionEmpty>{empty}</CollectionEmpty> : <ul className="collection-list">{rows.slice(0, count).map(alert => <li key={alert.id}><p className="collection-detail">{alert.level}{alert.startsAt && Date.parse(alert.startsAt) > now.getTime() ? ` · starts ${alertStartLabel(alert.startsAt, zone, settings.clockFormat)}` : ''}</p><p className="collection-title">{alert.name}</p>{size === 'large' && alert.area && <p className="collection-detail">{alert.area}</p>}</li>)}</ul>}{rows.length > count && <p className="collection-detail">+{rows.length - count} more</p>}<div className="collection-footer">{(disconnected || alerts?.status === 'stale') && <span className="status-caution">{disconnected ? 'Offline' : 'Saved alerts'} · </span>}{alerts?.source ?? 'Canada and US coverage'}{alerts?.checkedAt && <><br />{ageLabel(alerts.checkedAt, now.getTime())}</>}</div></CollectionFace>;
}
export const WeatherAlertsWidget: WidgetModule = { Renderer: WeatherAlerts, sample: collectionSample, Settings: () => <p className="hint">Uses the same official Canadian and US providers as Dynamic, for the saved weather city. Other areas show unavailable coverage. Provider notices are information, not an emergency notification service.</p> };
