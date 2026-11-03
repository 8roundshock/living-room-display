import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, Settings } from '../shared/contracts';
import { apiTagged, rememberRevision, settingsConflict } from './api';
import { rebaseDraft, same } from './draft';
import { forgetHomeDraftIf, forgetHomeDrafts, useHomeDraft } from './home-drafts';
import type { HomeContext } from './HomeParts';

type ListKey = 'worldClocks' | 'countdowns';
type Item = { id: string };
type Draft<T> = { base: T[]; items: T[] };

/** Home edits use the same item-aware merge as the visual editor and always save against an ETag. */
export function useHomeListEditor<T extends Item>(context: HomeContext, key: ListKey, saved: T[], limit: number) {
  const cacheKey = `list.${key}`;
  const [draft, setDraft] = useHomeDraft<Draft<T> | null>(cacheKey, () => null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), inFlight = useRef(false), mounted = useRef(true);
  const [message, setMessage] = useState('');
  const live = useRef(draft); live.current = draft;
  const items = draft?.items ?? saved;
  const dirty = !!draft && !same(draft.base, draft.items);
  const active = editing !== null || dirty;
  const excess = Math.max(0, items.length - limit);
  const limitMessage = excess ? `Up to ${limit} ${key === 'worldClocks' ? 'clocks' : 'countdowns'}. Remove ${excess} from this draft to save.` : null;
  function retain(next: Draft<T> | null) {
    const value = next && !same(next.base, next.items) ? next : null;
    live.current = value; setDraft(value);
    if (!value) forgetHomeDrafts(cacheKey);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!live.current || same(live.current.base, saved)) return;
    retain({ base: saved, items: rebaseDraft(live.current.base, live.current.items, saved) });
    setMessage('Updated in another window. Your edits are kept.');
  }, [saved]);
  function change(id: string, patch: Partial<T>) {
    const current = live.current ?? { base: saved, items: saved };
    retain({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) });
    setMessage('');
  }
  function move(id: string, offset: number) {
    const current = live.current ?? { base: saved, items: saved }, reordered = [...current.items];
    const index = reordered.findIndex(item => item.id === id), next = index + offset;
    if (index < 0 || next < 0 || next >= reordered.length) return;
    [reordered[index], reordered[next]] = [reordered[next]!, reordered[index]!];
    retain({ ...current, items: reordered }); setMessage('Order ready to save.');
  }
  function remove(id: string) {
    if (inFlight.current) return;
    const current = live.current ?? { base: saved, items: saved };
    const index = current.items.findIndex(item => item.id === id);
    if (index < 0) return;
    const remaining = current.items.filter(item => item.id !== id);
    retain({ ...current, items: remaining });
    if (editing === id) setEditing(null);
    setMessage('Removed from this draft. Save edits to apply.');
    const neighbour = remaining[index] ?? remaining[index - 1];
    context.focusLater(neighbour ? `.home-list-row[data-item-id="${neighbour.id}"] .home-edit-item` : '.home-list-edit-actions button', '.home-sheet-close');
  }
  function finish() {
    const id = editing;
    retain(null); setEditing(null); setMessage('');
    context.focusLater(id ? `.home-list-row[data-item-id="${id}"] .home-edit-item` : '.home-list-row .home-edit-item', key === 'worldClocks' ? '#home-city-search' : '#home-countdown-title');
  }
  async function save() {
    if (inFlight.current || context.offline || !live.current || live.current.items.length > limit) return;
    const submitted = live.current;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      // Home add/delete responses may not carry a remembered revision. Read one rather than
      // ever sending an unconditional list replacement, including immediately after an add.
      const latest = await apiTagged<AppState>('/api/state');
      const incoming = latest.body.settings.widgetData[key] as unknown as T[];
      if (!latest.etag) throw new Error('Could not verify the saved version. Your edits are kept. Try again.');
      if (!same(submitted.base, incoming)) {
        rememberRevision(latest.body.settings, latest.etag);
        context.applySettings(latest.body.settings);
        if (mounted.current) {
          retain({ base: incoming, items: rebaseDraft(submitted.base, submitted.items, incoming) });
          setMessage('Updated in another window. Review your edits, then save again.');
        }
        return;
      }
      const result = await apiTagged<Settings>('/api/settings', { method: 'PATCH', headers: { 'If-Match': latest.etag }, body: JSON.stringify({ widgetData: { [key]: submitted.items } }) });
      rememberRevision(result.body, result.etag); context.applySettings(result.body);
      // The sheet may have closed during the request. Clear its RAM draft in either case.
      forgetHomeDraftIf(cacheKey, submitted);
      if (mounted.current) finish();
      context.announce({ text: key === 'worldClocks' ? 'World clocks saved.' : 'Countdowns saved.' });
    } catch (caught) {
      const conflict = settingsConflict(caught);
      if (conflict) {
        rememberRevision(conflict.settings, conflict.etag); context.applySettings(conflict.settings);
        if (mounted.current) {
          const incoming = conflict.settings.widgetData[key] as unknown as T[];
          retain({ base: incoming, items: rebaseDraft(submitted.base, submitted.items, incoming) });
          setMessage('Updated in another window. Review your edits, then save again.');
        }
      } else if (mounted.current) setMessage(caught instanceof Error ? caught.message : 'Could not save. Your edits are kept.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return { items, editing, active, busy, dirty, message, limitMessage, change, move, remove, save, cancel: finish,
    edit(id: string) { setEditing(id); setMessage(''); context.focusLater(`.home-list-row[data-item-id="${id}"] .home-item-fields input`); },
  };
}

export function HomeItemFields({ children, name, index, count, busy, move }: {
  children: ReactNode; name: string; index: number; count: number; busy: boolean; move: (offset: number) => void;
}) {
  return <fieldset className="home-fieldset home-item-fields" disabled={busy}>
    <legend className="sr-only">Edit {name}</legend>
    {children}
    {count > 1 && <div className="home-item-order" role="group" aria-label={`Order of ${name}`}>
      <span>Position {index + 1} of {count}</span>
      <button type="button" className="home-chip-button" disabled={index === 0} onClick={() => move(-1)}>Move earlier</button>
      <button type="button" className="home-chip-button" disabled={index === count - 1} onClick={() => move(1)}>Move later</button>
    </div>}
  </fieldset>;
}

export function HomeListActions({ editor, offline, invalid }: {
  editor: Pick<ReturnType<typeof useHomeListEditor>, 'active' | 'busy' | 'dirty' | 'message' | 'limitMessage' | 'save' | 'cancel'>;
  offline: boolean; invalid: string | null;
}) {
  const anchor = useRef<HTMLSpanElement>(null), [footer, setFooter] = useState<HTMLElement | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null), retryFocus = useRef(false);
  useLayoutEffect(() => { setFooter(anchor.current?.closest('dialog')?.querySelector<HTMLElement>('.home-sheet-footer') ?? null); }, []);
  useEffect(() => {
    if (editor.busy || !retryFocus.current) return;
    retryFocus.current = false;
    if (!document.activeElement || document.activeElement === document.body || document.activeElement === saveButton.current) saveButton.current?.focus();
  }, [editor.busy]);
  return <><span ref={anchor} hidden />{editor.active && footer && createPortal(<div className="home-list-edit-actions">
    {(editor.limitMessage || invalid || editor.message) && <p className="home-hint" role="status">{editor.limitMessage || invalid || editor.message}</p>}
    <div className="home-sheet-actions">
      <button type="button" className="button" disabled={editor.busy} onClick={editor.cancel}>{editor.dirty ? 'Cancel edits' : 'Done editing'}</button>
      {editor.dirty && <button ref={saveButton} type="button" className="button primary" disabled={editor.busy || offline || !!invalid || !!editor.limitMessage} onClick={() => { retryFocus.current = true; void editor.save(); }}>{editor.busy ? 'Saving…' : 'Save edits'}</button>}
    </div>
  </div>, footer)}</>;
}
