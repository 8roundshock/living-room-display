import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { AppState, Settings, WidgetId } from '../shared/contracts';
import {
  ageLabel,
  forecastDay,
  forecastPeriod,
  nextComposition,
  precipitation,
  reminderDate,
  temperature,
  weatherTime,
} from './format';
import { Icon, weatherIcon } from './icons';
import { precipitationOutlook, reminderPresentation, sortReminders } from './model';

const conditions: Record<number, string> = {
  0: 'Clear skies',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms with hail',
  99: 'Thunderstorms with hail',
};

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Widget({
  id,
  settings,
  children,
  index,
  className = '',
}: {
  id: WidgetId;
  settings: Settings;
  children: ReactNode;
  index: number;
  className?: string;
}) {
  const transform = settings.widgetOverrides[id];
  const region = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const update = () => {
      if (!region.current || !content.current) return;
      setFit(
        Math.min(
          1,
          region.current.clientHeight /
            Math.max(1, content.current.scrollHeight),
          region.current.clientWidth / Math.max(1, content.current.scrollWidth),
        ),
      );
    };
    const observer = new ResizeObserver(update);
    if (region.current) observer.observe(region.current);
    if (content.current) observer.observe(content.current);
    update();
    return () => observer.disconnect();
  }, [settings.appearance.fontScale, settings.appearance.fontFamily, children]);
  return (
    <section
      ref={region}
      className={`ambient-widget ambient-${id} ${className}`}
      style={{ '--widget-index': index } as CSSProperties}
      aria-label={
        className === 'ambient-rain'
          ? 'Rain and precipitation outlook'
          : id === 'preview'
            ? 'Last desktop snapshot'
            : id
      }
    >
      <div
        ref={content}
        className="widget-content"
        style={{
          transform: `translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale * fit})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function AmbientDisplay({
  state,
  settings = state.settings,
  embedded = false,
  disconnected = false,
  compositionOverride,
}: {
  state: AppState;
  settings?: Settings;
  embedded?: boolean;
  disconnected?: boolean;
  compositionOverride?: number;
}) {
  const now = useNow();
  const [composition, setComposition] = useState(0);
  const [fading, setFading] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (
      !settings.appearance.motionEnabled ||
      reducedMotion ||
      compositionOverride !== undefined
    ) {
      setFading(false);
      return;
    }
    let fade: number | undefined;
    const cycle = window.setInterval(() => {
      setFading(true);
      fade = window.setTimeout(() => {
        setComposition(nextComposition);
        setFading(false);
      }, settings.appearance.fadeSeconds * 1000);
    }, settings.appearance.motionIntervalSeconds * 1000);
    return () => {
      window.clearInterval(cycle);
      window.clearTimeout(fade);
    };
  }, [
    settings.appearance.motionEnabled,
    settings.appearance.motionIntervalSeconds,
    settings.appearance.fadeSeconds,
    reducedMotion,
    compositionOverride,
  ]);
  useEffect(() => {
    if (!interacting) return;
    const timer = window.setTimeout(() => setInteracting(false), 3500);
    return () => window.clearTimeout(timer);
  }, [interacting]);
  useEffect(() => {
    if (embedded) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.location.assign('/editor');
      if (event.key.toLowerCase() === 'e') window.location.assign('/editor');
      if (event.key === 'Tab') setInteracting(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [embedded]);

  const { weather, preview } = state;
  useEffect(() => setPreviewImageFailed(false), [preview.capturedAt]);
  const current = weather.current;
  const parts = new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: settings.clockFormat === '12h',
  }).formatToParts(now);
  const clock = parts
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  const period = parts.find((part) => part.type === 'dayPeriod')?.value;
  const {
    intervals: rain,
    wet,
    rainy,
    chance,
    rainExpected,
    rainDataIncomplete,
    incomplete,
    coverageComplete,
    hasGaps,
    coverageStart,
    coverageEnd,
  } = precipitationOutlook(
    weather.hourly,
    weather.units.precipitation,
    now.getTime(),
  );
  const rainPeriod =
    coverageStart && coverageEnd
      ? forecastPeriod(
          coverageStart,
          coverageEnd,
          weather.location.timezone,
          settings.clockFormat,
          now,
        )
      : '';
  const reminderState = reminderPresentation(settings, state.reminders, disconnected);
  const reminders = sortReminders(state.reminders ?? [])
    .filter((reminder) => !reminder.completed)
    .slice(0, 2);
  const ambientStyle = {
    '--ambient-accent': settings.appearance.accentColor,
    '--ambient-text': settings.appearance.textColor,
    '--ambient-brightness': settings.appearance.brightness,
    '--font-scale': settings.appearance.fontScale,
    '--fade-duration': `${settings.appearance.fadeSeconds}s`,
  } as CSSProperties;
  const Surface = embedded ? 'div' : 'main';

  return (
    <Surface
      className={
        embedded
          ? 'preview-surface'
          : `display-page ${interacting ? 'interacting' : ''}`
      }
      onPointerMove={() => {
        if (!embedded) setInteracting(true);
      }}
    >
      <div
        className={`ambient composition-${compositionOverride ?? composition} font-${settings.appearance.fontFamily} layout-${settings.appearance.layout} ${!settings.appearance.motionEnabled || reducedMotion ? 'static' : ''}`}
        style={ambientStyle}
      >
        <div className={`ambient-content ${fading ? 'fading' : ''}`}>
          {settings.widgets.clock && (
            <Widget id="clock" settings={settings} index={0}>
              <div className="ambient-label">
                {new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now)}
              </div>
              <div className="clock-time">
                {clock}
                {period && <span className="clock-period">{period}</span>}
              </div>
              <div className="clock-date">
                {new Intl.DateTimeFormat('en', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                }).format(now)}
              </div>
            </Widget>
          )}
          {settings.widgets.weather && (
            <Widget id="weather" settings={settings} index={1}>
              <div className="ambient-label">
                <Icon name="location" />
                {weather.location.name}
              </div>
              {current ? (
                <>
                  <div className="current-weather-main">
                    <Icon
                      name={weatherIcon(
                        current.weatherCode ?? 3,
                        current.isDay,
                      )}
                      className="weather-symbol"
                    />
                    <span className="current-temperature">
                      {temperature(current.temperature)}
                      <span className="sr-only">
                        {weather.units.temperature}
                      </span>
                    </span>
                  </div>
                  <div className="weather-condition">
                    {current.weatherCode === null
                      ? 'Conditions unavailable'
                      : (conditions[current.weatherCode] ??
                        'Weather conditions')}
                  </div>
                  <div className="weather-details">
                    Feels like {temperature(current.feelsLike)} ·{' '}
                    {current.windSpeed === null
                      ? 'Wind unavailable'
                      : `${Math.round(current.windSpeed)} ${weather.units.windSpeed} wind`}
                  </div>
                </>
              ) : (
                <>
                  <div className="ambient-title">Weather unavailable</div>
                  <div className="ambient-description">
                    Your forecast will appear when connected.
                  </div>
                </>
              )}
              <div
                className={`weather-age ${weather.status !== 'fresh' ? 'stale' : ''}`}
              >
                {weather.status === 'stale' ? 'Saved forecast · ' : ''}
                {ageLabel(weather.updatedAt, now.getTime())}
              </div>
            </Widget>
          )}
          {settings.widgets.weather && (
            <Widget
              id="weather"
              settings={settings}
              index={2}
              className="ambient-rain"
            >
              <div className="ambient-label">
                <Icon name="rain" />
                Rain & precipitation
                {weather.status === 'stale' ? ' · saved' : ''}
              </div>
              {rain.length ? (
                <>
                  <div className="ambient-title">
                    {chance === null
                      ? 'Chance unavailable'
                      : wet.length
                        ? `${chance}% peak hourly chance`
                        : incomplete
                          ? 'Forecast incomplete'
                          : 'Mostly dry ahead'}
                  </div>
                  <div className="ambient-description">
                    {rainy.length
                      ? `Rain estimate ${new Date(rainy[0].intervalStart).getTime() <= now.getTime() ? 'now' : weatherTime(rainy[0].intervalStart, weather.location.timezone, settings.clockFormat)}–${weatherTime(rainy[rainy.length - 1].intervalEnd, weather.location.timezone, settings.clockFormat)}`
                      : rainDataIncomplete
                        ? 'Rain timing unavailable'
                        : 'No rain forecast in shown intervals'}
                    <br />
                    {rainExpected === null
                      ? 'Rain amount unavailable'
                      : `${rainDataIncomplete ? 'Known rain ' : ''}${precipitation(rainExpected, weather.units.precipitation)}${rainDataIncomplete ? '' : ' rain'} · ${rainPeriod}`}
                    <br />
                    {!coverageComplete
                      ? 'Partial forecast'
                      : incomplete || rainDataIncomplete
                        ? 'Partial data'
                        : 'Forecast estimate'}
                    {hasGaps ? ' · gaps in coverage' : ''}
                  </div>
                  <div
                    className="rain-bars"
                    aria-label="Hourly precipitation probabilities"
                  >
                    {rain.map((hour) => (
                      <span
                        className="rain-bar"
                        key={hour.intervalStart}
                        style={{
                          height: `${Math.max(hour.precipitationProbability ?? 0, 2)}%`,
                        }}
                        title={`${weatherTime(hour.intervalStart, weather.location.timezone, settings.clockFormat)}: ${hour.precipitationProbability === null ? 'unknown' : `${hour.precipitationProbability}%`}`}
                      />
                    ))}
                  </div>
                  <div className="rain-hours">
                    <span>
                      {weatherTime(
                        rain[0].intervalStart,
                        weather.location.timezone,
                        settings.clockFormat,
                      )}
                    </span>
                    <span>
                      {weatherTime(
                        rain[rain.length - 1].intervalEnd,
                        weather.location.timezone,
                        settings.clockFormat,
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="ambient-title">Outlook unavailable</div>
                  <div className="ambient-description">
                    Hourly forecasts will appear here.
                  </div>
                </>
              )}
            </Widget>
          )}
          {reminderState !== 'hidden' && (
            <Widget id="reminders" settings={settings} index={3}>
              <div className="ambient-label">Up next</div>
              {reminders.length ? (
                <ul className="ambient-reminder-list">
                  {reminders.map((reminder) => (
                    <li key={reminder.id}>
                      <span className="ambient-reminder-dot" />
                      <div>
                        <p className="ambient-reminder-title">
                          {reminder.text}
                        </p>
                        <p className="ambient-reminder-date">
                          {reminderDate(reminder.dueAt, now)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : reminderState === 'unavailable' ? (
                <>
                  <div className="ambient-title">Reminders unavailable</div>
                  <div className="ambient-description">
                    Waiting for the local server.
                  </div>
                </>
              ) : (
                <>
                  <div className="ambient-title">A little breathing room.</div>
                  <div className="ambient-description">
                    No reminders waiting.
                  </div>
                </>
              )}
              {disconnected && reminders.length > 0 && (
                <div className="ambient-description">Saved reminders · offline</div>
              )}
            </Widget>
          )}
          {settings.widgets.preview && settings.preview.enabled && (
            <Widget id="preview" settings={settings} index={4}>
              {preview.available &&
              preview.capturedAt &&
              !previewImageFailed ? (
                <>
                  <img
                    className="preview-image"
                    src={`/api/preview/image?t=${encodeURIComponent(preview.capturedAt)}`}
                    alt="Desktop captured before the display opened"
                    onError={() => setPreviewImageFailed(true)}
                    style={{
                      opacity: settings.preview.opacity,
                      width: `${Math.min(100, (settings.preview.widthPercent / 33) * 100)}%`,
                    }}
                  />
                  <div className="preview-caption">
                    Last screen ·{' '}
                    {new Intl.DateTimeFormat('en', {
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(preview.capturedAt))}
                  </div>
                </>
              ) : embedded ? (
                <>
                  <div className="ambient-label">
                    <Icon name="monitor" />
                    Last screen
                  </div>
                  <div className="ambient-description">
                    {previewImageFailed
                      ? 'Snapshot unavailable. A new capture will appear when the Windows helper opens the display.'
                      : 'A dim snapshot appears here when the Windows helper opens the display.'}
                  </div>
                </>
              ) : null}
            </Widget>
          )}
          {settings.widgets.forecast && (
            <Widget id="forecast" settings={settings} index={5}>
              {weather.daily.length ? (
                <>
                  <div className="forecast-strip">
                    {weather.daily.slice(0, 7).map((day) => (
                      <div className="forecast-day" key={day.date}>
                        <span className="forecast-day-label">
                          {forecastDay(
                            day.date,
                            weather.location.timezone,
                            now,
                          )}
                        </span>
                        <Icon name={weatherIcon(day.weatherCode ?? 3)} />
                        <div className="forecast-temperatures">
                          <span>{temperature(day.temperatureMax)}</span>
                          <span className="forecast-low">
                            {temperature(day.temperatureMin)}
                          </span>
                        </div>
                        <span className="forecast-rain">
                          <Icon name="rain" />
                          {day.precipitationProbability === null
                            ? '—'
                            : `${day.precipitationProbability}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="forecast-attribution">
                    {weather.status === 'stale' ? 'Saved forecast · ' : ''}
                    Forecast by {weather.source} · {weather.units.temperature}
                  </div>
                </>
              ) : (
                <>
                  <div className="ambient-label">Seven-day forecast</div>
                  <div className="ambient-description">
                    No forecast available yet.
                  </div>
                </>
              )}
            </Widget>
          )}
        </div>
        {disconnected && (
          <p className="display-disconnected">
            Local server disconnected · showing last received data
          </p>
        )}
      </div>
      {!embedded && (
        <nav className="display-help" aria-label="Display controls">
          <button
            className="button"
            onClick={() => {
              void document.documentElement
                .requestFullscreen?.()
                .catch(() => undefined);
            }}
          >
            <Icon name="monitor" size={15} />
            Fullscreen
          </button>
          <a className="button" href="/editor">
            <Icon name="settings" size={15} />
            Editor · Esc
          </a>
        </nav>
      )}
    </Surface>
  );
}
