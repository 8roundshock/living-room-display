import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppState, LocationResult, Settings, WeatherState } from '../shared/contracts';
import { api, apiTagged, rememberRevision, revisionOf, settingsConflict } from './api';
import { CitySearch } from './CitySearch';
import { DataRecovery } from './DataRecovery';
import { same, rebaseSettings, settingsChanges } from './draft';
import { ageLabel } from './format';
import { Icon } from './icons';
import { InfoTip } from './InfoTip';
import { browserLocationPlatform, getDeviceLocation } from './location';
import { ScreenSettings } from './ScreenSettings';
import { StudioHeader } from './StudioHeader';
import { useDisplayWindow } from './displayWindow';
import './settings.css';

export function SettingsPage({ state, setState, connectionError, reload }: {
  state: AppState; setState: Dispatch<SetStateAction<AppState | null>>;
  connectionError: string | null; reload: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(state.settings), [draft, setDraft] = useState(() => structuredClone(state.settings));
  const base = useRef(saved), live = useRef(draft), revision = useRef(revisionOf(state.settings));
  live.current = draft;
  const [saving, setSaving] = useState(false), savingNow = useRef(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [locationMessage, setLocationMessage] = useState('');
  const [locating, setLocating] = useState(false), lookup = useRef(0), mounted = useRef(true);
  const lastControl = useRef<HTMLElement | null>(null);
  const controls = useDisplayWindow();
  const dirty = !same(settingsChanges(saved, draft), {});
  function update(next: Settings) { live.current = next; setDraft(next); setMessage(''); }
  function change(patch: Partial<Settings>) { update({ ...live.current, ...patch }); setError(''); }
  function adopt(current: Settings, etag: string | null) {
    update(rebaseSettings(base.current, live.current, current));
    base.current = current; revision.current = etag; setSaved(current);
  }
  useEffect(() => {
    if (same(state.settings, base.current)) return;
    const changedWhileEditing = !same(settingsChanges(base.current, live.current), {});
    adopt(state.settings, revisionOf(state.settings));
    if (changedWhileEditing) setMessage('Settings changed in another window. Your edits are kept.');
  }, [state.settings]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; lookup.current++; };
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('focus') === 'city') document.getElementById('city-search')?.focus();
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty || saving) event.preventDefault(); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, saving]);
  // Settings may need a forecast while all weather widgets are off. No draft lookup is sent.
  useEffect(() => {
    let active = true;
    const refresh = () => api<WeatherState>('/api/weather').then(weather => {
      if (active) setState(previous => previous ? { ...previous, weather } : previous);
    }, () => undefined);
    void refresh(); const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [saved.location.latitude, saved.location.longitude, saved.units, setState]);
  function restoreFocus() { window.requestAnimationFrame(() => lastControl.current?.isConnected && lastControl.current.focus()); }
  async function save() {
    if (savingNow.current || locating || !dirty) return;
    savingNow.current = true; setSaving(true); setError('');
    const submitted = structuredClone(live.current), submittedBase = base.current;
    try {
      const result = await apiTagged<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(settingsChanges(submittedBase, submitted)), ...(revision.current ? { headers: { 'If-Match': revision.current } } : {}) });
      if (!mounted.current) return;
      rememberRevision(result.body, result.etag);
      update(rebaseSettings(submitted, live.current, result.body));
      base.current = result.body; revision.current = result.etag; setSaved(result.body);
      setState(previous => previous ? { ...previous, settings: result.body } : previous);
      setMessage('Settings saved.'); setLocationMessage(''); restoreFocus();
    } catch (caught) {
      if (!mounted.current) return;
      const conflict = settingsConflict(caught);
      if (conflict) {
        rememberRevision(conflict.settings, conflict.etag); adopt(conflict.settings, conflict.etag);
        setState(previous => previous ? { ...previous, settings: conflict.settings } : previous);
        setError('Settings changed in another window. Review your edits, then save again.');
      } else setError(caught instanceof Error ? caught.message : 'Could not save. Your changes are kept.');
    } finally { savingNow.current = false; if (mounted.current) setSaving(false); }
  }
  function cancel() {
    lookup.current++; setLocating(false); update(structuredClone(base.current));
    setQuery(''); setLocationMessage(''); setError(''); setMessage('Changes discarded.'); restoreFocus();
  }
  function selectCity(city: LocationResult) {
    lookup.current++; setLocating(false);
    change({ locationSource: 'manual', location: { name: city.name, latitude: city.latitude, longitude: city.longitude, timezone: city.timezone } });
    setQuery(''); setLocationMessage('City ready to save.');
  }
  async function locate() {
    if (savingNow.current || locating) return;
    const request = ++lookup.current; setLocating(true); setLocationMessage('Finding your area…');
    const result = await getDeviceLocation(browserLocationPlatform(), true);
    if (!mounted.current || request !== lookup.current) return;
    setLocating(false);
    if (result.status === 'success') {
      change({ locationSource: 'device', location: { name: 'Device area', latitude: result.latitude, longitude: result.longitude, timezone: 'auto' } });
      setLocationMessage('Area ready to save.');
    } else setLocationMessage(result.status === 'denied' ? 'Location blocked. Choose a city instead.' : 'Location unavailable. Your city is kept.');
  }
  return <div className="studio settings-page">
    <StudioHeader page="settings" displayControls={controls} />
    <main className="settings-main" onFocusCapture={event => {
      if ((event.target as HTMLElement).closest('.settings-savebar')) return;
      lastControl.current = event.target as HTMLElement;
    }}>
      <div className="settings-heading"><div><p className="eyebrow">Your preferences</p><h1>Settings</h1></div></div>
      {(error || connectionError) && <div className="settings-alert" role="alert"><span>{error || connectionError}</span>{error && <button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><Icon name="close" size={15} /></button>}</div>}
      <div className="settings-sections">
        <section className="settings-card" aria-labelledby="weather-heading">
          <div className="settings-section-title"><Icon name="location" size={19} /><h2 id="weather-heading">Weather</h2><InfoTip label="About weather location">Only a rounded area is kept. Device location is requested only when you choose it; a city works without location access.</InfoTip></div>
          <div className="current-location"><div><strong>{draft.location.name}</strong><span>{draft.locationSource === 'device' ? 'Approximate device area' : draft.locationSource === 'fallback' ? 'Default location' : 'Chosen city'}</span></div>{!same(saved.location, draft.location) && <span className="draft-badge">Draft</span>}</div>
          <div className="city-field"><label className="field-label" htmlFor="city-search">City</label><CitySearch value={query} onChange={setQuery} onSelect={selectCity} disabled={saving} label="City" description="Type two or more letters to search for a city" /></div>
          <div className="settings-location-actions"><button className="button small" disabled={saving || locating} onClick={() => void locate()}><Icon name="location" size={15} />{locating ? 'Finding your area…' : 'Use device location'}</button>{locating && <button className="text-button" onClick={() => { lookup.current++; setLocating(false); setLocationMessage(''); }}>Cancel lookup</button>}</div>
          <p className="inline-message" role="status">{locationMessage}</p>
          <div className="settings-fields"><label><span className="field-label">Units</span><select className="select-input" value={draft.units} onChange={event => change({ units: event.target.value as Settings['units'] })}><option value="metric">°C · metric</option><option value="imperial">°F · imperial</option></select></label><label><span className="field-label">Time format</span><select className="select-input" value={draft.clockFormat} onChange={event => change({ clockFormat: event.target.value as Settings['clockFormat'] })}><option value="12h">12-hour</option><option value="24h">24-hour</option></select></label></div>
          <p className="settings-weather-age">{state.weather.status === 'fresh' ? ageLabel(state.weather.updatedAt) : state.weather.status === 'stale' ? `Saved forecast · ${ageLabel(state.weather.updatedAt).toLowerCase()}` : 'Forecast unavailable'}{state.weather.error && <span>{state.weather.error}</span>}</p>
          <a className="weather-credit" href={state.weather.sourceUrl} target="_blank" rel="noreferrer">Forecast estimates by Open-Meteo</a>
        </section>
        <section className="settings-card" aria-labelledby="device-heading"><h2 id="device-heading">This device</h2><ScreenSettings keepAwake={draft.screen.keepAwake} active onKeepAwake={value => change({ screen: { ...live.current.screen, keepAwake: value } })} /></section>
        <DataRecovery dirty={dirty || saving} clockFormat={draft.clockFormat} reload={reload} />
      </div>
      <p className="settings-status" role="status">{message}</p>
    </main>
    {dirty && <div className="settings-savebar"><span>Unsaved changes</span><button className="button small" disabled={saving} onClick={cancel}>Cancel</button><button className="button primary" disabled={saving || locating} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
  </div>;
}
