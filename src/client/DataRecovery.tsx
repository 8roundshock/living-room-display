import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../shared/contracts';
import { api, isNetworkError } from './api';
import { BACKUP_MAX_BYTES, BackupError, backupContents, backupDate, parseBackup, restoreFailure, type BackupFile } from './backup';
import { Icon } from './icons';

/** App-wide recovery stays separate from visual-style editing. No replacement happens before confirmation. */
export function DataRecovery({ dirty, clockFormat, reload }: { dirty: boolean; clockFormat: Settings['clockFormat']; reload: () => Promise<void> }) {
  const [backup, setBackup] = useState<BackupFile | null>(null), [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; detail?: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), question = useRef<HTMLParagraphElement>(null), mounted = useRef(true), inFlight = useRef(false);
  const retry = useRef<HTMLButtonElement>(null), retryFocus = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (backup) question.current?.focus(); }, [backup]);
  useEffect(() => {
    if (restoring || !retryFocus.current) return;
    retryFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active === retry.current) retry.current?.focus();
  }, [restoring]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (restoring) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [restoring]);
  const focusTrigger = () => window.requestAnimationFrame(() => trigger.current?.focus());
  async function read(file: File) {
    try {
      if (file.size > BACKUP_MAX_BYTES) throw new BackupError('That file is too large to be a backup. Choose one made with Export saved data.');
      const parsed = parseBackup(await file.text());
      if (mounted.current) { setBackup(parsed); setMessage(null); }
    } catch (caught) { if (mounted.current) { setBackup(null); setMessage({ text: caught instanceof BackupError ? caught.message : 'Could not read that file.', error: true }); } }
  }
  async function restore() {
    if (!backup || inFlight.current) return;
    if (dirty) { setMessage({ text: 'Save or cancel your changes before restoring a backup.', error: true }); return; }
    const selected = backup; inFlight.current = true; setRestoring(true); setMessage({ text: 'Restoring…' });
    try {
      await api('/api/import', { method: 'POST', body: JSON.stringify(selected) });
      if (!mounted.current) return;
      setBackup(null); setMessage({ text: `Backup restored: ${backupContents(selected)}.` }); await reload(); focusTrigger();
    } catch (caught) {
      if (!mounted.current) return;
      if (!isNetworkError(caught)) { setBackup(null); focusTrigger(); }
      else retryFocus.current = true;
      const failure = restoreFailure(caught); setMessage({ ...failure, error: true });
    } finally { inFlight.current = false; if (mounted.current) setRestoring(false); }
  }
  return <section className="settings-card data-disclosure" aria-labelledby="recovery-heading">
    <h2 id="recovery-heading">Data &amp; recovery</h2>
    <p className="hint">Back up saved settings, styles and reminders. Photos stay on this device. Download schedules separately in Schedule.</p>
    <div className="data-actions"><a className="button small" href="/api/export" download="still-backup.json"><Icon name="download" size={15} />Export saved data</a><button ref={trigger} className="button small restore-backup" disabled={restoring} onClick={() => { setBackup(null); if (dirty) setMessage({ text: 'Save or cancel your changes before restoring a backup.', error: true }); else { setMessage(null); input.current?.click(); } }}>Restore from backup…</button><input ref={input} type="file" accept="application/json,.json" aria-label="Backup file" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file); }} /></div>
    {backup && <div className="data-confirm restore-confirm" role="group" aria-label="Restore backup" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !restoring) { event.preventDefault(); event.stopPropagation(); setBackup(null); focusTrigger(); } }}>
      <p ref={question} className="data-confirm-title" tabIndex={-1}>Restore the backup from {backupDate(backup, clockFormat)}?</p><p>Replaces saved settings, styles and reminders with {backupContents(backup)}. Your photo and schedule stay; missing scheduled styles are skipped.</p><p className="hint">Export your current data first to keep a copy. Automatic recovery retains the replaced state only until the next saved change.</p><div className="data-confirm-actions"><button ref={retry} className="button small primary" disabled={restoring || dirty} onClick={() => void restore()}>{restoring ? 'Restoring…' : 'Restore'}</button><button className="button small" disabled={restoring} onClick={() => { setBackup(null); setMessage({ text: 'Nothing was restored.' }); focusTrigger(); }}>Don't restore</button></div>
    </div>}
    {message && <p className={`inline-message data-status ${message.error ? 'error' : ''}`} role="status">{message.text}</p>}
    {message?.detail && <details className="data-detail"><summary>Technical details</summary><p>{message.detail}</p></details>}
  </section>;
}
