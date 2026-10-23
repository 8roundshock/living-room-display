import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppState, SavedPreset } from '../shared/contracts';
import type { ScheduleSnapshot } from '../shared/schedule';
import { api } from './api';
import { scheduleStatus } from './schedule-status';
import './schedule.css';

/** Home's temporary override uses saved manual settings; it never applies an editor draft. */
export function ScheduleStatus({ snapshot, presets, setState, reload }: {
  snapshot: ScheduleSnapshot | undefined;
  presets: readonly SavedPreset[];
  setState: Dispatch<SetStateAction<AppState | null>>;
  reload: () => Promise<void>;
}) {
  const busyNow = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!snapshot?.config.enabled) return null;
  const override = async () => {
    if (busyNow.current) return;
    busyNow.current = true; setBusy(true); setError('');
    try {
      const next = await api<ScheduleSnapshot>('/api/schedule/override', {
        method: 'POST', headers: { 'If-Match': `"${snapshot.revision}"` },
        body: JSON.stringify({ manual: !snapshot.overrideUntil }),
      });
      setState(current => current ? { ...current, schedule: next } : current);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the schedule. Try again.');
      await reload();
    } finally { busyNow.current = false; setBusy(false); }
  };
  return <section className="schedule-home" aria-label="Scheduled style">
    <p className="schedule-status" role="status">{scheduleStatus(snapshot, presets)}</p>
    <div className="schedule-actions">
      <button type="button" className="button small" disabled={busy} onClick={() => void override()}>
        {snapshot.overrideUntil ? 'Return to schedule' : 'Use manual style for 1 hour'}
      </button>
      <a className="home-link" href="/settings#schedule">Schedule settings</a>
    </div>
    {error && <p className="schedule-warning" role="alert">{error}</p>}
  </section>;
}
