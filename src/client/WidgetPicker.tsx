import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, freeSpanLimits, widgetSizes, type WidgetCategory, type WidgetSize } from '../shared/widgets';
import { same } from './draft';
import { RoomNotice } from './FreeSizeControls';
import { Icon } from './icons';
import { columnOutlook, listNames, type RoomFix, type RoomProblem } from './make-room';
import { WidgetSample } from './WidgetSample';
import './picker-groups.css';

/**
 * The picker's grouped order (#78, #154): WIDGET_CATEGORIES order, catalog order inside each group,
 * empty groups left out. The rail and the initial selection both use it, so they cannot diverge.
 */
export function pickerGroups(): { category: WidgetCategory; ids: WidgetId[] }[] {
  return (Object.keys(WIDGET_CATEGORIES) as WidgetCategory[])
    .map((category) => ({ category, ids: ACTIVE_WIDGET_IDS.filter((id) => WIDGET_CATALOG[id].category === category) }))
    .filter((group) => group.ids.length > 0);
}
/** The first widget not on the display, in the order the picker shows (else the first one). */
export function firstPickerSelection(widgets: Settings['widgets']): WidgetId {
  const order = pickerGroups().flatMap((group) => group.ids);
  return order.find((id) => !widgets[id]) ?? order[0]!;
}

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
  const [selected, setSelected] = useState<WidgetId>(() => initial ?? firstPickerSelection(settings.widgets));
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({});
  // The picker owns its "No room" message: one live region, gone when the picker closes (#238).
  const [problem, setProblem] = useState<RoomProblem | null>(null);
  const close = useRef<HTMLButtonElement>(null), catalog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    close.current?.focus();
    // Bring the initial selection into the rail's own scroll area without moving the page (#154).
    const rail = catalog.current, item = rail?.querySelector<HTMLElement>('.catalog-item[aria-pressed="true"]');
    if (rail && item && rail.scrollHeight > rail.clientHeight) {
      const top = item.offsetTop - rail.offsetTop, bottom = top + item.offsetHeight;
      if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = Math.max(0, top - (rail.clientHeight - item.offsetHeight) / 2);
    }
  }, []);
  const widget = WIDGET_CATALOG[selected];
  const size = sizes[selected] ?? widget.defaultSize;
  const added = settings.widgets[selected];
  const groups = pickerGroups();
  // A stale explanation (another widget, size or board) is never shown.
  const shown = problem && problem.request.id === selected && problem.request.kind === 'add' && problem.request.size === size
    && same(problem.grid, settings.widgetGrid) && same(problem.enabled, settings.widgets) ? problem : null;
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
  return <div className="widget-picker" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <div className="panel-heading">
      <h2>Add a widget</h2>
      <button className="icon-button" aria-label="Close widget picker" ref={close} onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
    <div className="picker-body"><div className="widget-catalog" ref={catalog} aria-label="Widget catalog" onKeyDown={event => {
      // Up/Down (and Left/Right, for the narrow three-column layout) move through the whole list
      // across groups and preview the focused widget; Home/End jump to the ends. The rail is one
      // roving tab stop (#348), so Tab goes on to the sizes and Add.
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.catalog-item')];
      const index = items.findIndex(item => item === document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)))]!;
      next.focus(); next.click();
    }}>
      {groups.map(({ category, ids }) => <div key={category} className="catalog-group" role="group" aria-labelledby={`catalog-group-${category}`}>
        <span className="catalog-group-label" id={`catalog-group-${category}`}>{WIDGET_CATEGORIES[category]}</span>
        {/* #348: one tab stop for the rail (the previewed widget); the arrow keys move it. */}
        {ids.map(id => <button key={id} className="catalog-item" tabIndex={selected === id ? 0 : -1} aria-label={`Preview ${WIDGET_CATALOG[id].name}${settings.widgets[id] ? ', on your display' : ''}`} aria-pressed={selected === id} onClick={() => { setSelected(id); setProblem(null); }}>
          <Icon name={WIDGET_CATALOG[id].icon} size={19} />
          <span>{WIDGET_CATALOG[id].name}</span>
          {settings.widgets[id] && <Icon name="check" size={12} className="catalog-added" />}
        </button>)}
      </div>)}
    </div>
    <section className="picker-detail" aria-label={`${widget.name} preview`}>
      <div className="picker-detail-heading"><h3>{widget.name}</h3><p>{widget.description}</p></div>
      <WidgetSample key={`${selected}-${size}`} id={selected} size={size} appearance={settings.appearance} density={settings.widgetGrid.density} />
      <div className="family-previews" aria-label={`${widget.name} size`}>
        {widgetSizes(selected).map(family => <button key={family} aria-label={`${widget.name} ${family}`} aria-pressed={size === family} onClick={() => { setSizes(previous => ({ ...previous, [selected]: family })); setProblem(null); }}>
          {family[0].toUpperCase() + family.slice(1)}
        </button>)}
      </div>
      {caption && <p className="picker-free-size">{caption}</p>}
      {added && <p className="picker-added-note" id="picker-added-note"><Icon name="check" size={13} />{addedNote}</p>}
      {/* The visible text is the accessible name in both states (#241). */}
      <button className="button primary picker-add" disabled={added} aria-describedby={added ? 'picker-added-note' : undefined} onClick={() => setProblem(onAdd(selected, size))}>
        <Icon name="plus" size={17} />
        Add {widget.name}
      </button>
      <RoomNotice problem={shown} onFix={(current, fix) => setProblem(onFix(current, fix))} />
    </section></div>
    <p className="picker-footnote">Sample content · changes stay in your draft</p>
  </div>;
}
