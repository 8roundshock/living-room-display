import { useEffect, useState } from 'react';
import type { Settings, WeatherState } from '../shared/contracts';
import { THEME_LABELS, THEME_MODES, type ThemeSettings } from '../shared/themes';
import { resolveTheme } from './ambient-theme';
import { usePrefersReducedMotion } from './useMotion';
import { HolidayCalendars } from './HolidayCalendars';
import { THEME_SCENES, THEME_SCENE_IDS, type ThemeSceneId } from '../shared/theme-registry';

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
      <small>{reduced ? 'Atmosphere hidden by your system’s reduced-motion setting.' : settings.appearance.animation === 'off' ? 'Turn on Animation to show the atmosphere.' : theme.mode === 'combined' ? 'Seasonal until noteworthy weather is near.' : theme.mode === 'weather' ? 'Current weather and the next few hours.' : 'Changes with the season and selected holidays.'}</small>
    </p>}
  </div>;
}

/** Canvas-local illustration control, deliberately outside the saved appearance form. */
export function ThemePreviewControls({ value, onChange, motionAllowed }: { value: ThemeSceneId | null; onChange: (scene: ThemeSceneId | null) => void; motionAllowed: boolean }) {
  return <details className="theme-try" onKeyDown={event => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary>{value ? <strong>Preview: {THEME_SCENES[value].label}<small>Display unchanged</small></strong> : 'Try a scene'}</summary>
    <div className="theme-try-panel">
      <label className="field-label" htmlFor="theme-scene-preview">Scene preview</label>
      <select id="theme-scene-preview" className="select-input" value={value ?? 'automatic'} onChange={event => onChange(event.target.value === 'automatic' ? null : event.target.value as ThemeSceneId)}>
        <option value="automatic">Automatic · current date and weather</option>
        {(['Seasons', 'Celebrations', 'Weather'] as const).map(group => <optgroup key={group} label={group}>
          {THEME_SCENE_IDS.filter(id => THEME_SCENES[id].group === group).map(id => <option key={id} value={id}>{THEME_SCENES[id].label}</option>)}
        </optgroup>)}
      </select>
      <p className="theme-current">Illustration only. Your display, date and weather stay unchanged.
        {!motionAllowed && <small>Atmosphere is hidden while Animation is Off or your system reduces motion.</small>}
      </p>
      {value && <button type="button" className="text-button theme-demo-return" onClick={() => onChange(null)}>Return to Automatic</button>}
    </div>
  </details>;
}
