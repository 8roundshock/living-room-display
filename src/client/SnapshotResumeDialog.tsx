import { useEffect, useId, useRef } from 'react';
import { Icon } from './icons';

/** Explicit recovery for an unacknowledged browser-display close; opening never resumes capture. */
export function SnapshotResumeDialog({ pending, error, onConfirm, onClose, returnFocus }: {
  pending: boolean; error: string; onConfirm: () => void; onClose: () => void; returnFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const title = useId(), description = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal(); cancel.current?.focus();
    return () => { element.close(); returnFocus(); };
  }, []);
  return <dialog ref={dialog} className="home-sheet snapshot-resume-dialog" aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onMouseDown={event => { if (event.target === dialog.current) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')].filter(control => !control.disabled && control.checkVisibility());
      const first = controls[0], last = controls.at(-1);
      const target = event.shiftKey && document.activeElement === first ? last : !event.shiftKey && document.activeElement === last ? first : null;
      if (target) { event.preventDefault(); target.focus(); }
    }}>
    <div className="home-sheet-panel">
      <div className="home-sheet-header">
        <h2 id={title} className="home-sheet-title">Resume snapshots?</h2>
        <button type="button" className="home-icon-button home-sheet-close" aria-label="Close snapshot confirmation" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <div className="home-sheet-body">
        <p id={description} className="home-sheet-lede">Close every browser display before resuming desktop snapshots.</p>
        {error && <p className="home-notice" role="alert">{error}</p>}
        {pending && <p role="status" className="home-sheet-lede">Resuming snapshots…</p>}
        <div className="home-sheet-actions">
          <button ref={cancel} type="button" className="button" onClick={onClose}>{pending ? 'Close' : 'Cancel'}</button>
          <button type="button" className="button primary" aria-disabled={pending || undefined} onClick={() => { if (!pending) onConfirm(); }}>Resume snapshots</button>
        </div>
      </div>
    </div>
  </dialog>;
}
