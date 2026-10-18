import { forecastPeriod, precipitation, weatherTime } from '../format.ts';
import { Icon } from '../icons.tsx';
import { precipitationOutlook } from '../model.ts';
import { SourceCredit, WeatherAge } from './common.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Rain({ state: { weather }, now, settings, size, disconnected }: WidgetContentProps) {
  const { intervals: rain, wet, rainy, chance, rainExpected, rainDataIncomplete, incomplete, coverageComplete, hasGaps, coverageStart, coverageEnd } = precipitationOutlook(weather.hourly, weather.units.precipitation, now.getTime());
  const period = coverageStart && coverageEnd ? forecastPeriod(coverageStart, coverageEnd, weather.location.timezone, settings.clockFormat, now) : '';
  return <div className="widget-body rain-body"><div className="rain-heading"><div className="ambient-label"><Icon name="rain" />Rain & precipitation</div><div className="weather-context">{weather.location.name}</div></div>
    {rain.length ? <><div className="rain-summary"><div className="rain-chance">{chance === null ? '—' : `${chance}%`}<span>peak hourly chance</span></div><div className="rain-timing">{rainy.length ? <><span className="metric-label">Rain estimate</span>{new Date(rainy[0]!.intervalStart).getTime() <= now.getTime() ? 'Now' : weatherTime(rainy[0]!.intervalStart, weather.location.timezone, settings.clockFormat)}–{weatherTime(rainy[rainy.length - 1]!.intervalEnd, weather.location.timezone, settings.clockFormat)}</> : rainDataIncomplete ? 'Rain timing unavailable' : wet.length ? 'Precipitation possible' : incomplete ? 'Forecast incomplete' : 'Mostly dry ahead'}</div></div>{<div className="rain-amount">{rainExpected === null ? 'Rain amount unavailable' : `${rainDataIncomplete ? 'Known rain ' : ''}${precipitation(rainExpected, weather.units.precipitation)}${rainDataIncomplete ? '' : ' rain'}`}<span>{period}</span></div>}
      {size === 'large' && <><div className="rain-bars" aria-label="Hourly precipitation probabilities">{rain.map(hour => <span className={`rain-bar ${hour.precipitationProbability === null ? 'rain-bar-unknown' : ''}`} key={hour.intervalStart} style={{ height: `${hour.precipitationProbability === null ? 8 : Math.max(hour.precipitationProbability, 2)}%` }} title={`${weatherTime(hour.intervalStart, weather.location.timezone, settings.clockFormat)}: ${hour.precipitationProbability === null ? 'unknown' : `${hour.precipitationProbability}%`}`} />)}</div><div className="rain-hours"><span>{weatherTime(rain[0]!.intervalStart, weather.location.timezone, settings.clockFormat)}</span><span>{weatherTime(rain[rain.length - 1]!.intervalEnd, weather.location.timezone, settings.clockFormat)}</span></div></>}</> : <div className="ambient-title">Outlook unavailable</div>}
    <div className="rain-footer">
      {rain.length > 0 && <div className="rain-confidence">{chance === null ? 'Chance unavailable · ' : ''}{!coverageComplete ? 'Partial forecast' : incomplete || rainDataIncomplete ? 'Partial data' : 'Forecast estimate'}{hasGaps ? ' · coverage gaps' : ''}</div>}
    <WeatherAge weather={weather} disconnected={disconnected} now={now} /><SourceCredit id="rain" settings={settings} /></div></div>;
}

export const RainWidget: WidgetModule = { Renderer: Rain };
