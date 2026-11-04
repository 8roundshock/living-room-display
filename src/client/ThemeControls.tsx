import { useEffect, useState } from 'react';
import type { Settings, WeatherState } from '../shared/contracts';
import { THEME_LABELS, THEME_MODES, type ThemeSettings } from '../shared/themes';
import { resolveTheme } from './ambient-theme';
import { usePrefersReducedMotion } from './useMotion';
import { HolidayCalendars } from './HolidayCalendars';

export function ThemeControls({ settings, weather, disconnected, onChange, saving }: { settings: Settings; weather: WeatherState; disconnected: boolean; onChange: (value: ThemeSettings) => void; saving: boolean }) {
  const theme = settings.appearance.theme;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  const reduced = usePrefersReducedMotion(), scene = resolveTheme(settings, weather, now, disconnected);
  const showCalendars = theme.mode === 'seasonal' || theme.mode === 'combined' || settings.widgetData.dynamic.holidays;
  return <div className="theme-controls">
    <label className="theme-mode"><span className="field-label">Theme</span><select className="select-input" aria-label="Theme" disabled={saving} value={theme.mode} onChange={event => onChange({ ...theme, mode: event.target.value as ThemeSettings['mode'] })}>
      {THEME_MODES.map(mode => <option key={mode} value={mode}>{THEME_LABELS[mode]}</option>)}
    </select></label>
    {showCalendars && <HolidayCalendars value={theme.calendars} disabled={saving} onChange={calendars => onChange({ ...theme, calendars })} />}
    {theme.mode !== 'off' && <p className="theme-current">{scene?.label ?? 'No weather effect right now'}
      <small>{reduced ? 'Motion paused by your system.' : settings.appearance.animation === 'off' ? 'Turn on Animation to show the atmosphere.' : theme.mode === 'combined' ? 'Seasonal until noteworthy weather is near.' : theme.mode === 'weather' ? 'Current weather and the next few hours.' : 'Changes with the season and selected holidays.'}</small>
    </p>}
  </div>;
}
