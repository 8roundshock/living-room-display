import { Fragment, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Settings } from '../../shared/contracts.ts';
import { pendingReminders } from '../../shared/reminders.ts';
import { Icon } from '../icons.tsx';
import { reminderPresentation } from '../model.ts';
import { reminderDue } from '../reminder.ts';
import { atNaturalWidth, fittingCount, layoutExtent, useMeasured } from './measure.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/** Candidate rows laid out for measurement; any further pending reminders are only counted. */
const MAX_ROWS = 60;
/** Title lines when every pending reminder fits with room to spare (#254), most first. */
const RELAXED_LINES = [4, 3];
/** Title growth toward the display cap when every reminder still fits (#254), largest first. */
const GROWTH = [1.5, 1.4, 1.3, 1.2, 1.1];

interface Row { id: string; text: string; due: ReturnType<typeof reminderDue> }
/** The measured list: visible rows (0 when even one overflows), title lines and title growth. */
interface ListLayout { fit: number; lines: number; grow: number }
const sameLayout = (a: ListLayout, b: ListLayout) => a.fit === b.fit && a.lines === b.lines && a.grow === b.grow;

const titleOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.ambient-reminder-title');
/**
 * Titles cut by their line clamp. A clamp hides at least one whole line (1.2em), while glyphs taller
 * than the 1.2 line height only overflow by a fraction of an em, so half an em tells them apart.
 */
const truncated = (rows: readonly HTMLElement[]) => rows.filter(row => {
  const title = titleOf(row);
  return title !== null && title.scrollHeight - title.clientHeight > parseFloat(getComputedStyle(title).fontSize) * 0.5;
}).length;
const titleSize = (rows: readonly HTMLElement[]) => { const title = titleOf(rows[0]!); return title ? parseFloat(getComputedStyle(title).fontSize) : 0; };

/**
 * Fits as many complete rows as the actual box holds, plus an honest "+N more". Stable by design:
 * the body is fixed at 100cqh (so the shared Widget fit stays at 1 and its per-second refit never
 * changes this box), measurement runs only when the rows or the widget's own box change, and
 * state changes only when the result does. Overflow rows take no layout outside measuring.
 * `fit` is 0 when even one row overflows; the widget then shows one row and zooms out as a whole.
 * While measuring, the body is back at its fixed 100cqh box even in that overfull state (see
 * widgets.css), so a later remeasure never counts rows against the grown body.
 *
 * Rows are measured from layout boxes (#216), so a row transform cannot change the count. When every
 * pending reminder fits, clamped titles may use up to four lines; then, if every title shows in full,
 * titles grow toward the 3.2% display cap as long as everything still fits and stays whole (#254).
 * Each measurement starts from the base clamp and size, so a remeasure at the same size finds the
 * same layout.
 */
function measureList(body: HTMLElement, total: number, base: number): ListLayout | null {
  const rows = [...body.querySelectorAll<HTMLElement>('.ambient-reminder-list > li')];
  if (!rows.length) return null;
  const style = body.style;
  const saved = [style.getPropertyValue('--reminder-lines'), style.getPropertyValue('--reminder-grow')] as const;
  body.setAttribute('data-measuring', '');
  const trial = (lines: number, grow: number) => {
    style.setProperty('--reminder-lines', String(lines));
    style.setProperty('--reminder-grow', String(grow));
    const more = layoutExtent(body.querySelector('.reminder-more-probe'));
    const offline = layoutExtent(body.querySelector('.reminder-offline'));
    return fittingCount(body, rows, count => offline + (count < total ? more : 0));
  };
  try {
    return atNaturalWidth(body, () => {
      const fit = trial(base, 1);
      if (fit !== total) return { fit, lines: base, grow: 1 };
      let lines = base;
      if (truncated(rows)) for (const relaxed of RELAXED_LINES) if (relaxed > base && trial(relaxed, 1) === total) { lines = relaxed; break; }
      // Picker samples have no display plane, so there is no cap to grow toward.
      if (!body.closest('.widget-grid-plane')) return { fit, lines, grow: 1 };
      // Growth only ever trades spare height for size: never while a title is cut, never cutting one.
      trial(lines, 1);
      if (truncated(rows)) return { fit, lines, grow: 1 };
      const size = titleSize(rows);
      for (const grow of GROWTH) if (trial(lines, grow) === total && !truncated(rows) && titleSize(rows) > size + 0.25) return { fit, lines, grow };
      return { fit, lines, grow: 1 };
    });
  } finally {
    body.removeAttribute('data-measuring');
    if (saved[0]) style.setProperty('--reminder-lines', saved[0]); else style.removeProperty('--reminder-lines');
    if (saved[1]) style.setProperty('--reminder-grow', saved[1]); else style.removeProperty('--reminder-grow');
  }
}

function ReminderList({ rows, total, fresh, offline, settings }: { rows: Row[]; total: number; fresh: ReadonlySet<string>; offline: boolean; settings: Settings }) {
  // A single pending reminder may always use four lines.
  const base = total === 1 ? 4 : 2;
  const body = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([rows, total, offline, settings.appearance.fontScale, settings.appearance.fontFamily]);
  const layout = useMeasured<ListLayout>(body, key, element => measureList(element, total, base), { fit: rows.length, lines: base, grow: 1 }, sameLayout);
  const shown = Math.max(1, Math.min(layout.fit, rows.length));
  const more = total - shown;
  // Relaxed lines and growth apply only while every pending reminder is shown.
  const all = layout.fit === total;
  const lines = all ? Math.max(layout.lines, base) : base, grow = all ? layout.grow : 1;
  return <div
    ref={body}
    className={['widget-body', 'reminders-body', layout.fit === 0 ? 'reminders-overfull' : ''].filter(Boolean).join(' ')}
    style={{ '--reminder-lines': lines, '--reminder-grow': grow } as CSSProperties}
  >
    <div className="ambient-label">Up next</div>
    <ul className="ambient-reminder-list">
      {rows.map((row, index) => <li key={row.id} className={index >= shown ? 'reminder-overflow' : undefined} data-new={fresh.has(row.id) ? '' : undefined}>
        <span className="ambient-reminder-dot" />
        <div className="ambient-reminder-copy">
          <p className="ambient-reminder-title">{row.text}</p>
          {row.due && <p className="ambient-reminder-date">
            {row.due.overdue && <><span className="ambient-reminder-overdue">Overdue</span> · </>}
            {/* Lines break only between parts, never inside "7:00 AM". */}
            {row.due.when.split(' · ').map((part, partIndex) => <Fragment key={partIndex}>{partIndex ? ' · ' : ''}<span className="reminder-segment">{part}</span></Fragment>)}
          </p>}
        </div>
      </li>)}
    </ul>
    {more > 0 && <div className="ambient-description reminder-more">+<TransitionText value={String(more)} /> more</div>}
    <div className="ambient-description reminder-more-probe" aria-hidden="true">+{total} more</div>
    {/* Saved items shown while the display cannot reach the app keep the shared status tone (#223). */}
    {offline && <div className="ambient-description reminder-offline status-caution">Saved reminders · offline</div>}
  </div>;
}

function Reminders({ state, settings, now, disconnected, embedded }: WidgetContentProps) {
  const status = reminderPresentation(settings, state.reminders, disconnected);
  const source = state.reminders;
  const format = settings.clockFormat;
  // Order and labels change at most once a minute; polling replaces the array every 30 s.
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const pending = useMemo(() => Array.isArray(source) ? pendingReminders(source, minute) : [], [source, minute]);
  const rows = useMemo(() => pending.slice(0, MAX_ROWS).map(reminder => ({ id: reminder.id, text: reminder.text, due: reminderDue(reminder, new Date(minute), format) })), [pending, minute, format]);
  // Only reminders that were not pending at the previous update may fade in (#76). React moves a
  // re-sorted row with insertBefore, which would otherwise replay its entrance (#172). The first
  // render marks nothing; the mark lasts until the next poll or minute.
  const pendingIds = useMemo(() => pending.map(reminder => reminder.id), [pending]);
  const previousIds = useRef<ReadonlySet<string> | null>(null);
  const fresh = useMemo(() => {
    const before = previousIds.current;
    return new Set(before ? pendingIds.filter(id => !before.has(id)) : []);
  }, [pendingIds]);
  useEffect(() => { previousIds.current = new Set(pendingIds); }, [pendingIds]);
  // The display hides a confirmed empty list while Hide when empty is on. The editor canvas keeps the
  // widget at its real span instead, so adding and resizing it stay visible (#233).
  if (status === 'hidden') return embedded ? <div className="widget-body image-placeholder reminders-placeholder">
    <Icon name="check" size={null} />
    <div className="ambient-label">Reminders</div>
    <div className="ambient-description"><span className="reminder-segment">Hidden while empty</span> · <span className="reminder-segment">Add a reminder</span></div>
  </div> : null;
  if (rows.length) return <ReminderList rows={rows} total={pending.length} fresh={fresh} offline={disconnected && pending.length > 0} settings={settings} />;
  return <div className="widget-body reminders-body">
    <div className="ambient-label">Up next</div>
    {status === 'empty' ? <div className="ambient-title reminders-clear">All clear</div> : <div className="ambient-title">Reminders unavailable</div>}
  </div>;
}

export const RemindersWidget: WidgetModule = {
  Renderer: Reminders,
  visible: props => props.embedded || reminderPresentation(props.settings, props.state.reminders, props.disconnected) !== 'hidden',
  sizeHint: 'Shows as many reminders as fit · soonest first',
};
