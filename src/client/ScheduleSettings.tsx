import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppState, SavedPreset } from '../shared/contracts';
import { emptySchedule, overlappingRules, SCHEDULE_RULE_LIMIT, WEEKDAY_NAMES, type PresetSchedule, type ScheduleSnapshot } from '../shared/schedule';
import { api } from './api';
import './schedule.css';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Held by Editor, so switching inspector tabs cannot discard a schedule draft. */
export function useScheduleDraft(snapshot: ScheduleSnapshot | undefined) {
  const [base, setBase] = useState(() => ({ config: structuredClone(snapshot?.config ?? emptySchedule()), revision: snapshot?.revision ?? '' }));
  const [draft, setDraft] = useState(() => structuredClone(base.config));
  const dirty = !same(base.config, draft);
  const reset = (next = snapshot) => {
    const config = structuredClone(next?.config ?? emptySchedule());
    setBase({ config, revision: next?.revision ?? '' }); setDraft(config);
  };
  useEffect(() => {
    if (!snapshot || snapshot.revision === base.revision) return;
    if (!dirty) reset(snapshot);
    else if (same(snapshot.config, base.config)) setBase(current => ({ ...current, revision: snapshot.revision }));
  }, [snapshot?.revision, base.revision, dirty]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  return { base, draft, setDraft, dirty, reset };
}

export function scheduleStatus(snapshot: ScheduleSnapshot | undefined, presets: readonly SavedPreset[]): string {
  if (!snapshot?.config.enabled) return 'Schedule off. Your manual appearance is on the display.';
  const { selection } = snapshot;
  if (selection.source === 'override' && snapshot.overrideUntil) {
    const until = new Date(snapshot.overrideUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: snapshot.timeZone });
    return `Using your saved manual appearance until ${until}. The schedule resumes automatically.`;
  }
  const name = presets.find(item => item.id === selection.presetId)?.name;
  if (selection.source === 'rule') return `On your display: ${name ?? 'saved style'}, from schedule row ${snapshot.config.rules.findIndex(row => row.id === selection.ruleId) + 1}.`;
  if (selection.source === 'fallback') return `On your display: ${name ?? 'saved style'}, the fallback outside scheduled times.`;
  return 'Outside a usable schedule range. Your manual appearance is on the display.';
}

export function ScheduleSettings({ snapshot, presets, editor, visualDirty, setState, reload }: {
  snapshot: ScheduleSnapshot | undefined; presets: readonly SavedPreset[]; editor: ReturnType<typeof useScheduleDraft>;
  visualDirty: boolean; setState: Dispatch<SetStateAction<AppState | null>>; reload: () => Promise<void>;
}) {
  const { draft, setDraft, dirty, base, reset } = editor;
  const [busy, setBusy] = useState(false), busyNow = useRef(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [backup, setBackup] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null), addButton = useRef<HTMLButtonElement>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  useEffect(() => { if (focusRow) { document.getElementById(`schedule-style-${focusRow}`)?.focus(); setFocusRow(null); } }, [focusRow]);
  const conflicts = overlappingRules(draft.rules);
  const stale = dirty && snapshot && base.revision !== snapshot.revision;
  const invalid = draft.rules.some(row => !row.days.length || !row.start || !row.end);
  const change = (update: (current: PresetSchedule) => PresetSchedule) => { setDraft(update); setMessage(''); setError(''); };
  const apply = async (path: string, method: string, value: unknown, revision: string, replaceDraft: boolean, success: string) => {
    if (busyNow.current) return;
    busyNow.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const next = await api<ScheduleSnapshot>(path, { method, headers: { 'If-Match': `"${revision}"` }, body: JSON.stringify(value) });
      setState(current => current ? { ...current, schedule: next } : current);
      if (replaceDraft) reset(next);
      setBackup(null); setMessage(success); await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the schedule. Your changes are kept.'); await reload(); }
    finally { busyNow.current = false; setBusy(false); }
  };
  const move = (index: number, direction: -1 | 1) => change(current => {
    const rules = [...current.rules]; setFocusRow(rules[index]!.id);
    [rules[index], rules[index + direction]] = [rules[index + direction]!, rules[index]!]; return { ...current, rules };
  });
  const readBackup = async (file: File) => {
    setError(''); setMessage('');
    if (file.size > 64 * 1024) { setError('Choose a schedule backup smaller than 64 KB.'); return; }
    try {
      const parsed = JSON.parse(await file.text()) as { kind?: unknown };
      if (parsed?.kind !== 'still-schedule') throw new Error('Choose a schedule backup downloaded from this section.');
      setBackup(parsed);
      window.requestAnimationFrame(() => document.getElementById('schedule-restore-cancel')?.focus());
    } catch (caught) { setError(caught instanceof SyntaxError ? 'This file is not readable JSON. Nothing was restored.' : caught instanceof Error ? caught.message : 'Could not read this file.'); }
  };
  return <section className="schedule-settings" aria-labelledby="schedule-heading">
    <h3 id="schedule-heading">Schedule</h3>
    <p className="schedule-status" role="status">{scheduleStatus(snapshot, presets)}</p>
    {snapshot?.config.enabled && <div className="schedule-override">
      <p className="hint">The editor canvas shows your manual appearance. Saving or applying a style does not pause the schedule. {visualDirty ? 'Save your visual changes first, then use them for 1 hour.' : 'Use your saved manual appearance temporarily, then return to the schedule.'}</p>
      {snapshot.overrideUntil
        ? <button type="button" className="button small" disabled={busy} onClick={() => void apply('/api/schedule/override', 'POST', { manual: false }, snapshot.revision, false, 'Returned to schedule.')}>Return to schedule now</button>
        : <button type="button" className="button small" disabled={busy || visualDirty} onClick={() => void apply('/api/schedule/override', 'POST', { manual: true }, snapshot.revision, false, 'Using your saved manual appearance for 1 hour.')}>Use manual appearance for 1 hour</button>}
    </div>}
    {snapshot?.warning && <p className="schedule-warning" role="alert">{snapshot.warning}</p>}
    {!!snapshot?.selection.missingPresetIds.length && <p className="schedule-warning">A scheduled style was deleted or is missing. Those rows are skipped; the next matching row, fallback, or manual appearance is used.</p>}
    <details className="disclosure schedule-disclosure">
      <summary>Edit schedule<span>{dirty ? 'Unsaved' : draft.rules.length || ''}</span></summary>
      <div className="disclosure-body">
        <p className="hint">Times use this computer’s local time ({snapshot?.timeZone ?? 'local time'}), including daylight saving changes. Rows run from the start time up to the end time. Skipped clock times do not run; repeated clock times match both times.</p>
        <fieldset disabled={busy} className="schedule-fields">
          <label className="toggle-row"><span>Enable schedule</span><input className="toggle" type="checkbox" checked={draft.enabled} onChange={event => change(current => ({ ...current, enabled: event.target.checked }))} /></label>
          <label><span className="field-label">Outside scheduled times</span><select value={draft.fallbackPresetId ?? ''} onChange={event => change(current => ({ ...current, fallbackPresetId: event.target.value || null }))}>
            <option value="">Manual appearance</option>
            {draft.fallbackPresetId && !presets.some(preset => preset.id === draft.fallbackPresetId) && <option value={draft.fallbackPresetId}>Missing saved style — uses manual appearance</option>}
            {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select></label>
          <p className="hint">If ranges overlap, the first matching row wins. Move rows up or down to set priority. Overnight ranges continue into the next day; equal times run until that time the next day.</p>
          {!presets.length && <p className="hint">Save a style in Saved styles, then save your editor changes before adding it to a schedule.</p>}
          {draft.rules.map((row, index) => <fieldset className="schedule-row" key={row.id}>
            <legend>Row {index + 1}{snapshot?.selection.ruleId === row.id ? ' · active' : ''}</legend>
            <label><span className="field-label">Saved style</span><select id={`schedule-style-${row.id}`} value={row.presetId} onChange={event => change(current => ({ ...current, rules: current.rules.map(item => item.id === row.id ? { ...item, presetId: event.target.value } : item) }))}>
              {!presets.some(preset => preset.id === row.presetId) && <option value={row.presetId}>Missing saved style — skipped</option>}
              {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select></label>
            <fieldset className="schedule-weekdays"><legend>Starts on</legend>{WEEKDAY_NAMES.map((day, value) => <label key={day} title={day}>
              <input type="checkbox" aria-label={day} checked={row.days.includes(value)} onChange={event => change(current => ({ ...current, rules: current.rules.map(item => item.id === row.id ? { ...item, days: event.target.checked ? [...item.days, value].sort() : item.days.filter(selected => selected !== value) } : item) }))} />
              <span aria-hidden="true">{day.slice(0, 2)}</span>
            </label>)}</fieldset>
            {!row.days.length && <p className="schedule-warning">Choose at least one starting weekday.</p>}
            <div className="schedule-times">{(['start', 'end'] as const).map(key => <label key={key}><span className="field-label">{key === 'start' ? 'From' : 'Until'}</span><input type="time" required value={row[key]} onChange={event => change(current => ({ ...current, rules: current.rules.map(item => item.id === row.id ? { ...item, [key]: event.target.value } : item) }))} /></label>)}</div>
            {row.start && row.end && row.end <= row.start && <p className="hint">{row.end === row.start ? 'Runs until this time the next day.' : 'Ends the following day.'}</p>}
            <div className="schedule-actions"><button type="button" className="button small" aria-label={`Move row ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</button><button type="button" className="button small" aria-label={`Move row ${index + 1} down`} disabled={index === draft.rules.length - 1} onClick={() => move(index, 1)}>Down</button><button type="button" className="button small" aria-label={`Remove row ${index + 1}`} onClick={() => { change(current => ({ ...current, rules: current.rules.filter(item => item.id !== row.id) })); addButton.current?.focus(); }}>Remove</button></div>
          </fieldset>)}
          <button ref={addButton} type="button" className="button small" disabled={!presets.length || draft.rules.length >= SCHEDULE_RULE_LIMIT} onClick={() => {
            const id = crypto.randomUUID();
            change(current => ({ ...current, rules: [...current.rules, { id, presetId: presets[0]!.id, days: [], start: '', end: '' }] })); setFocusRow(id);
          }}>Add schedule row</button>
          {draft.rules.length >= SCHEDULE_RULE_LIMIT && <p className="hint">Up to {SCHEDULE_RULE_LIMIT} rows.</p>}
          {!!conflicts.length && <p className="schedule-warning">Overlapping rows: {conflicts.map(([first, second]) => `${draft.rules.findIndex(row => row.id === first) + 1} and ${draft.rules.findIndex(row => row.id === second) + 1}`).join('; ')}. The earlier row has priority; missing styles are skipped.</p>}
          <div className="schedule-actions"><button type="button" className="button small primary" disabled={!dirty || invalid || !!stale} onClick={() => void apply('/api/schedule', 'PUT', draft, base.revision, true, 'Schedule saved.')}>Save schedule</button><button type="button" className="button small" disabled={!dirty} onClick={() => { reset(); setError(''); setMessage('Schedule edits discarded.'); }}>Cancel schedule edits</button></div>
        </fieldset>
        {stale && <p className="schedule-warning" role="alert">The schedule changed in another window. Your draft is kept. Cancel schedule edits to load the latest schedule before editing again.</p>}
        <p className="hint">Schedule changes save separately from the editor. A schedule backup refers to your saved styles but does not include them. Download both backups to move styles and their schedule to another computer.</p>
        <div className="schedule-actions"><a className="button small" href="/api/schedule/export" download="still-schedule.json">Download saved schedule</a><button type="button" className="button small" disabled={busy || dirty} onClick={() => input.current?.click()}>Restore schedule…</button></div>
        <input ref={input} type="file" hidden accept="application/json,.json" aria-label="Schedule backup file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readBackup(file); }} />
        {backup !== null && <div className="schedule-restore" role="group" aria-label="Restore schedule"><p>Replace this computer’s schedule with the selected backup? Saved styles stay as they are. Any temporary override ends; missing styles will be skipped.</p><div className="schedule-actions"><button type="button" className="button small" disabled={busy || dirty} onClick={() => void apply('/api/schedule/import', 'POST', backup, snapshot?.revision ?? '', true, 'Schedule restored.')}>Replace schedule</button><button id="schedule-restore-cancel" type="button" className="button small" disabled={busy} onClick={() => { setBackup(null); setMessage('Nothing was restored.'); }}>Keep current schedule</button></div></div>}
      </div>
    </details>
    {error && <p className="schedule-warning" role="alert">{error}</p>}
    {message && <p className="hint" role="status">{message}</p>}
  </section>;
}
