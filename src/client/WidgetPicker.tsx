import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import { GRID_DENSITIES, WIDGET_CATALOG, WIDGET_CATEGORIES, freeSpanLimits, widgetSizes, widgetSpan, type WidgetSize } from '../shared/widgets';
import { same } from './draft';
import { RoomNotice } from './FreeSizeControls';
import { Icon } from './icons';
import { columnOutlook, listNames, roomProblem, type RoomFix, type RoomProblem } from './make-room';
import { filteredPickerGroups, filteredPickerSelection, firstPickerSelection, type PickerFilter } from './picker-catalog';
import { WidgetSample } from './WidgetSample';
import './picker-groups.css';
import './picker-sheet.css';

export { pickerGroups, firstPickerSelection } from './picker-catalog';

export function WidgetPicker({ settings, initial = null, onAdd, onFix, onClose }: {
  settings: Settings;
  /** Opens on this widget instead of the first one not on the display (#438, Home's Make room link). */
  initial?: WidgetId | null;
  /** Adds the widget as a draft; returns the no-room explanation when it does not fit. */
  onAdd: (id: WidgetId, size: WidgetSize) => RoomProblem | null;
  /** Applies a no-room fix and the add together; returns a fresh explanation if it no longer fits. */
  onFix: (problem: RoomProblem, fix: RoomFix) => RoomProblem | null;
  onClose: () => void;
}) {
  const [preferred, setSelected] = useState<WidgetId>(() => initial ?? firstPickerSelection(settings.widgets));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PickerFilter>('all');
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({});
  const [mobileDetail, setMobileDetail] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const navigationFocus = useRef(false);
  // The picker owns its "No room" message: one live region, gone when the picker closes (#238).
  const [problem, setProblem] = useState<RoomProblem | null>(null);
  const close = useRef<HTMLButtonElement>(null), catalog = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null), detail = useRef<HTMLDivElement>(null);
  const resultFocus = useRef<HTMLElement | null>(null);
  const groups = filteredPickerGroups(settings.widgets, query, filter);
  const visibleSelection = filteredPickerSelection(groups, preferred);
  const selected = visibleSelection ?? preferred;
  const resultCount = groups.reduce((count, group) => count + group.ids.length, 0);
  useEffect(() => {
    const dialog = sheet.current!;
    dialog.showModal();
    close.current?.focus();
    const trackFocus = (event: FocusEvent) => { resultFocus.current = results.current?.contains(event.target as Node) ? event.target as HTMLElement : null; };
    document.addEventListener('focusin', trackFocus);
    return () => { document.removeEventListener('focusin', trackFocus); dialog.close(); };
  }, []);
  useEffect(() => {
    const requested = navigationFocus.current;
    navigationFocus.current = false;
    if (window.matchMedia('(max-width: 600px)').matches && requested) {
      if (mobileDetail) heading.current?.focus();
      else (catalog.current?.querySelector<HTMLElement>('.catalog-item[aria-pressed="true"]') ?? search.current)?.focus();
    }
  }, [mobileDetail]);
  useEffect(() => {
    if (visibleSelection === null && mobileDetail) { navigationFocus.current = true; setMobileDetail(false); }
  }, [visibleSelection, mobileDetail]);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 600px)');
    const keepFocusedPreview = () => {
      if (compact.matches) setMobileDetail(!!sheet.current?.querySelector('.picker-detail')?.contains(document.activeElement));
    };
    compact.addEventListener('change', keepFocusedPreview);
    return () => compact.removeEventListener('change', keepFocusedPreview);
  }, []);
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0; }, [visibleSelection]);
  useEffect(() => {
    // Initial selection and filtered results scroll only the rail, never the typing user's page.
    const rail = catalog.current, item = rail?.querySelector<HTMLElement>('.catalog-item[aria-pressed="true"]');
    // A saved change can remove a filtered item or the entire detail. Restore focus only if its
    // previously focused node was removed; typing, filter and outside-editor focus stay untouched.
    const previous = resultFocus.current;
    if (previous && !previous.isConnected && (document.activeElement === document.body || document.activeElement === sheet.current)) {
      const preview = mobileDetail && visibleSelection !== null && window.matchMedia('(max-width: 600px)').matches;
      (preview ? heading.current : previous.classList.contains('catalog-item') ? item ?? search.current : search.current)?.focus();
    }
    if (rail && item && rail.scrollHeight > rail.clientHeight) {
      const top = item.offsetTop - rail.offsetTop, bottom = top + item.offsetHeight;
      if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = Math.max(0, top - (rail.clientHeight - item.offsetHeight) / 2);
    }
  }, [selected, query, filter, visibleSelection, settings.widgets]);
  const widget = WIDGET_CATALOG[selected];
  const size = sizes[selected] ?? widget.defaultSize;
  const added = settings.widgets[selected];
  const board = GRID_DENSITIES[settings.widgetGrid.density];
  const preflight = useMemo(() => visibleSelection && !added
    ? roomProblem(settings.widgetGrid, { kind: 'add', id: selected, size }, settings.widgets) : null,
  [visibleSelection, added, settings.widgetGrid, settings.widgets, selected, size]);
  // A stale explanation (another widget, size or board) is never shown.
  const shown = problem && problem.request.id === selected && problem.request.kind === 'add' && problem.request.size === size
    && same(problem.grid, settings.widgetGrid) && same(problem.enabled, settings.widgets) ? problem : preflight;
  // Free-size widgets (#73) say how far they can grow, qualified when this board has no room for a
  // full-height column (#238, #183).
  const free = !!freeSpanLimits(selected, settings.widgetGrid.density);
  const outlook = useMemo(
    () => (free ? columnOutlook(settings.widgetGrid, selected, settings.widgets, size) : null),
    [free, settings.widgetGrid, settings.widgets, selected, size],
  );
  const caption = !outlook ? null
    : outlook.fits ? `Resize freely${added ? '' : ' after adding'} — up to the full height`
    : `Resize freely${added ? '' : ' after adding'}. Full height needs room first: make ${outlook.blockers.length ? listNames(outlook.blockers, 'or') : 'another widget'} smaller.`;
  const addedNote = `${widget.name} is on your display`;
  const choose = (id: WidgetId) => {
    setSelected(id); setProblem(null);
    if (window.matchMedia('(max-width: 600px)').matches) { navigationFocus.current = true; setMobileDetail(true); }
  };
  return <dialog ref={sheet} className="widget-picker-dialog" aria-labelledby="widget-picker-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    // Match the Home sheets: retain keyboard cycling within the modal instead of reaching browser chrome.
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.checkVisibility());
    const first = controls[0], last = controls.at(-1);
    const target = event.shiftKey && document.activeElement === first ? last : !event.shiftKey && document.activeElement === last ? first : null;
    if (target) { event.preventDefault(); target.focus(); }
  }}>
  <div className="widget-picker picker-sheet" data-detail={mobileDetail ? '' : undefined}>
    <div className="panel-heading">
      <button className="button picker-back" onClick={() => { navigationFocus.current = true; setMobileDetail(false); }}>All widgets</button>
      <h2 id="widget-picker-title">Add a widget</h2>
      <button className="icon-button" aria-label="Close widget picker" ref={close} onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
    <div className="picker-body" ref={results}>
    <div className="picker-sidebar">
    <div className="picker-discovery">
      <div className="picker-search">
        <input ref={search} type="search" aria-label="Search widgets" placeholder="Search widgets" value={query} autoComplete="off" spellCheck={false} onChange={event => { setQuery(event.target.value); setProblem(null); }} />
        {query && <button className="icon-button" aria-label="Clear widget search" onClick={() => { setQuery(''); search.current?.focus(); }}><Icon name="close" size={16} /></button>}
      </div>
      <select aria-label="Filter widgets" value={filter} onChange={event => { setFilter(event.target.value as PickerFilter); setProblem(null); }}>
        <option value="all">All widgets</option><option value="not-added">Not added</option><option value="on-display">On display</option>
      </select>
    </div>
    <div className="picker-results"><span role="status">{resultCount} {resultCount === 1 ? 'widget' : 'widgets'}</span><span aria-hidden="true">Arrow keys browse</span></div>
    <p className="sr-only" id="picker-keyboard-help">Use arrow keys to browse widgets. Home and End go to the first and last result. Enter opens a preview. Tab moves between controls.</p>
    <div className="widget-catalog" ref={catalog} aria-label="Widget catalog" onKeyDown={event => {
      // Up/Down (and Left/Right, for the narrow three-column layout) move through the whole list
      // across groups and preview the focused widget; Home/End jump to the ends. The rail is one
      // roving tab stop (#348), so Tab goes on to the sizes and Add.
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.catalog-item')];
      const index = items.findIndex(item => item === document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)))]!;
      next.focus();
      const nextId = groups.flatMap(group => group.ids)[items.indexOf(next)]!;
      setSelected(nextId); setProblem(null);
    }}>
      {groups.map(({ category, ids }) => <div key={category} className="catalog-group" role="group" aria-labelledby={`catalog-group-${category}`}>
        <span className="catalog-group-label" id={`catalog-group-${category}`}>{WIDGET_CATEGORIES[category]}</span>
        {/* #348: one tab stop for the rail (the previewed widget); the arrow keys move it. */}
        {ids.map(id => <button key={id} className="catalog-item" tabIndex={selected === id ? 0 : -1} aria-describedby="picker-keyboard-help" aria-label={`Preview ${WIDGET_CATALOG[id].name}${settings.widgets[id] ? ', on your display' : ''}`} aria-pressed={selected === id} onClick={() => choose(id)}>
          <Icon name={WIDGET_CATALOG[id].icon} size={19} />
          <span>{WIDGET_CATALOG[id].name}</span>
          {settings.widgets[id] && <Icon name="check" size={12} className="catalog-added" />}
        </button>)}
      </div>)}
    </div></div>
    {visibleSelection === null ? <div className="picker-empty">
      <h3>{filter === 'not-added' && !query.trim() ? 'Every widget is on your display' : 'No matching widgets'}</h3>
      <p>{query.trim() ? 'Try a name, description or category, or change the filter.' : 'Change the filter to browse the catalog.'}</p>
      <button className="button" onClick={() => { setQuery(''); setFilter('all'); setProblem(null); search.current?.focus(); }}>Show all widgets</button>
    </div> :
    <section key={selected} className="picker-detail" aria-label={`${widget.name} preview`}>
      <div className="picker-detail-content" key={selected} ref={detail}>
      <div className="picker-detail-heading"><h3 ref={heading} tabIndex={-1}>{widget.name}</h3><p>{widget.description}</p></div>
      <WidgetSample key={`${selected}-${size}`} id={selected} size={size} appearance={settings.appearance} density={settings.widgetGrid.density} />
      </div>
      <div className="picker-choices">
      <div className="family-previews" aria-label={`${widget.name} size`}>
        {widgetSizes(selected).map(family => {
          const span = widgetSpan(selected, family, settings.widgetGrid.revision);
          return <button key={family} aria-label={`${widget.name} ${family}`} aria-describedby={`picker-footprint-${family}`} aria-pressed={size === family} onClick={() => { setSizes(previous => ({ ...previous, [selected]: family })); setProblem(null); }}>
            <span className="family-shape" aria-hidden="true"><i style={{ '--family-columns': span.columns, '--family-rows': span.rows } as CSSProperties} /></span>
            <span>{family[0].toUpperCase() + family.slice(1)}</span>
            <small aria-hidden="true">{span.columns} × {span.rows}</small>
          </button>;
        })}
      </div>
      {widgetSizes(selected).map(family => {
        const span = widgetSpan(selected, family, settings.widgetGrid.revision);
        return <span className="sr-only" key={family} id={`picker-footprint-${family}`}>{span.columns} columns by {span.rows} rows on the {board.columns} by {board.rows} grid.</span>;
      })}
      {caption && <p className="picker-free-size">{caption}</p>}
      {added && <p className="picker-added-note" id="picker-added-note"><Icon name="check" size={13} />{addedNote}</p>}
      {shown && <p className="sr-only" id="picker-room-help">Choose how to make room and add this widget to your draft.</p>}
      </div>
      <div className="picker-actions">
      {/* The visible text is the accessible name in both states (#241). */}
      <button className="button primary picker-add" hidden={!!shown && !added} disabled={added || !!shown} aria-describedby={added ? 'picker-added-note' : shown ? 'picker-room-help' : undefined} onClick={() => setProblem(onAdd(selected, size))}>
        <Icon name="plus" size={17} />
        Add {widget.name}
      </button>
      <RoomNotice problem={shown} onFix={(current, fix) => setProblem(onFix(current, fix))} />
      </div>
    </section>}
    </div>
    <p className="picker-footnote">Sample content · unsaved</p>
  </div></dialog>;
}
