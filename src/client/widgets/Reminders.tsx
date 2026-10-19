import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { pendingReminders } from '../../shared/reminders.ts';
import { reminderPresentation } from '../model.ts';
import { reminderDue } from '../reminder.ts';
import { TransitionText } from './TransitionText.tsx';
import type { WidgetContentProps, WidgetModule } from './types.ts';

/** Candidate rows laid out for measurement; any further pending reminders are only counted. */
const MAX_ROWS = 60;

/**
 * Fits as many complete rows as the actual box holds, plus an honest "+N more". Stable by design:
 * the body is fixed at 100cqh (so the shared Widget fit stays at 1 and its per-second refit never
 * changes this box), measurement runs only when the rows or the widget's own box change, and
 * state changes only when the visible count does. Overflow rows take no layout outside measuring.
 * Returns 0 when even one row overflows; the widget then shows one row and zooms out as a whole.
 * While measuring, the body is back at its fixed 100cqh box even in that overfull state (see
 * widgets.css), so a later remeasure never counts rows against the grown body.
 */
function measureRows(body: HTMLElement, total: number): number | null {
  const items = [...body.querySelectorAll<HTMLElement>('.ambient-reminder-list > li')];
  if (!items.length) return null;
  // Measure at the natural width, never the widened width of an earlier zoom-out.
  const content = body.parentElement;
  const width = content?.style.width ?? '';
  if (content) content.style.width = '100%';
  body.setAttribute('data-measuring', '');
  try {
    const box = body.getBoundingClientRect();
    // Rectangles include the widget's fit transform; computed margins do not.
    const scale = body.offsetHeight ? box.height / body.offsetHeight : 1;
    const extent = (element: Element | null) => element ? element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginTop) * scale : 0;
    const more = extent(body.querySelector('.reminder-more-probe'));
    const offline = extent(body.querySelector('.reminder-offline'));
    for (let count = items.length; count >= 1; count--) {
      const bottom = items[count - 1]!.getBoundingClientRect().bottom + offline + (count < total ? more : 0);
      if (bottom <= box.bottom + 0.5) return count;
    }
    return 0;
  } finally {
    body.removeAttribute('data-measuring');
    if (content) content.style.width = width;
  }
}

function Reminders({ state, settings, now, disconnected }: WidgetContentProps) {
  const status = reminderPresentation(settings, state.reminders, disconnected);
  const source = state.reminders;
  const format = settings.clockFormat;
  // Order and labels change at most once a minute; polling replaces the array every 30 s.
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const pending = useMemo(() => Array.isArray(source) ? pendingReminders(source, minute) : [], [source, minute]);
  const rows = useMemo(() => pending.slice(0, MAX_ROWS).map(reminder => ({ id: reminder.id, text: reminder.text, due: reminderDue(reminder, new Date(minute), format) })), [pending, minute, format]);
  const total = pending.length;
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
  const offline = disconnected && total > 0;
  const layoutKey = JSON.stringify([rows, total, offline, settings.appearance.fontScale, settings.appearance.fontFamily]);
  const body = useRef<HTMLDivElement>(null);
  const totalRef = useRef(total);
  totalRef.current = total;
  const [fit, setFit] = useState(rows.length);

  useLayoutEffect(() => {
    if (!body.current) return;
    const next = measureRows(body.current, totalRef.current);
    if (next !== null) setFit(next);
  }, [layoutKey]);
  useLayoutEffect(() => {
    const element = body.current;
    const container = element?.closest('.ambient-widget');
    if (!element || !container) return;
    let active = true;
    const remeasure = () => {
      if (!active || !body.current) return;
      const next = measureRows(body.current, totalRef.current);
      if (next !== null) flushSync(() => setFit(next));
    };
    // Observe the widget's own box: the shared fit only widens the content, never this box.
    const observer = new ResizeObserver(remeasure);
    observer.observe(container);
    void document.fonts?.ready.then(remeasure);
    return () => { active = false; observer.disconnect(); };
  }, []);

  const shown = Math.max(1, Math.min(fit, rows.length));
  const more = total - shown;
  return <div ref={body} className={['widget-body', 'reminders-body', fit === 0 && rows.length ? 'reminders-overfull' : ''].filter(Boolean).join(' ')}>
    <div className="ambient-label">Up next</div>
    {rows.length ? <>
      <ul className={`ambient-reminder-list ${total === 1 ? 'single' : ''}`}>
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
      {offline && <div className="ambient-description reminder-offline">Saved reminders · offline</div>}
    </> : status === 'empty' ? <div className="ambient-title reminders-clear">All clear</div> : <div className="ambient-title">Reminders unavailable</div>}
  </div>;
}

export const RemindersWidget: WidgetModule = {
  Renderer: Reminders,
  visible: props => reminderPresentation(props.settings, props.state.reminders, props.disconnected) !== 'hidden',
  sizeHint: 'Shows as many reminders as fit · soonest first',
};
