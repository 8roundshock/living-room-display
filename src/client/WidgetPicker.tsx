import { useEffect, useRef, useState } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, widgetSizes, type WidgetCategory, type WidgetSize } from '../shared/widgets';
import { Icon } from './icons';
import { WidgetSample } from './WidgetSample';
import './picker-groups.css';

export function WidgetPicker({ settings, onAdd, onClose, message }: {
  settings: Settings;
  onAdd: (id: WidgetId, size: WidgetSize) => void;
  onClose: () => void;
  message: string;
}) {
  const [selected, setSelected] = useState<WidgetId>(() => ACTIVE_WIDGET_IDS.find(id => !settings.widgets[id]) ?? ACTIVE_WIDGET_IDS[0]!);
  const [sizes, setSizes] = useState<Partial<Record<WidgetId, WidgetSize>>>({});
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  const widget = WIDGET_CATALOG[selected];
  const size = sizes[selected] ?? widget.defaultSize;
  return <div className="widget-picker" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <div className="panel-heading">
      <h2>Add a widget</h2>
      <button className="icon-button" aria-label="Close widget picker" ref={close} onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
    <div className="picker-body"><div className="widget-catalog" aria-label="Widget catalog" onKeyDown={event => {
      // Up/Down/Home/End move through the whole list (across groups) and preview the focused widget.
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.catalog-item')];
      const index = items.findIndex(item => item === document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]!;
      next.focus(); next.click();
    }}>
      {(Object.keys(WIDGET_CATEGORIES) as WidgetCategory[]).map(category => ({ category, ids: ACTIVE_WIDGET_IDS.filter(id => WIDGET_CATALOG[id].category === category) })).filter(group => group.ids.length > 0).map(({ category, ids }) => <div key={category} className="catalog-group" role="group" aria-labelledby={`catalog-group-${category}`}>
        <span className="catalog-group-label" id={`catalog-group-${category}`}>{WIDGET_CATEGORIES[category]}</span>
        {ids.map(id => <button key={id} className="catalog-item" aria-label={`Preview ${WIDGET_CATALOG[id].name}`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
          <Icon name={WIDGET_CATALOG[id].icon} size={19} />
          <span>{WIDGET_CATALOG[id].name}</span>
          {settings.widgets[id] && <Icon name="check" size={12} className="catalog-added" />}
        </button>)}
      </div>)}
    </div>
    <section className="picker-detail" aria-label={`${widget.name} preview`}>
      <div className="picker-detail-heading"><h3>{widget.name}</h3><p>{widget.description}</p></div>
      <WidgetSample id={selected} size={size} />
      <div className="family-previews" aria-label={`${widget.name} size`}>
        {widgetSizes(selected).map(family => <button key={family} aria-label={`${widget.name} ${family}`} aria-pressed={size === family} onClick={() => setSizes(previous => ({ ...previous, [selected]: family }))}>
          {family[0].toUpperCase() + family.slice(1)}
        </button>)}
      </div>
      <button className="button primary picker-add" disabled={settings.widgets[selected]} aria-label={`Add ${widget.name}`} onClick={() => onAdd(selected, size)}>
        <Icon name={settings.widgets[selected] ? 'check' : 'plus'} size={17} />
        {settings.widgets[selected] ? 'Already on your display' : 'Add widget'}
      </button>
    </section></div>
    {message && <p className="inline-message" role="status">{message}</p>}
    <p className="picker-footnote">Sample content · changes stay in your draft</p>
  </div>;
}
