import { useEffect, useRef, useState } from 'react';
import type { Settings, WidgetId } from '../shared/contracts';
import { WIDGET_CATALOG, WIDGET_IDS, widgetSizes, type WidgetSize } from '../shared/widgets';
import { Icon } from './icons';
import { WidgetSample } from './WidgetSample';

export function WidgetPicker({ settings, onAdd, onClose, message }: {
  settings: Settings;
  onAdd: (id: WidgetId, size: WidgetSize) => void;
  onClose: () => void;
  message: string;
}) {
  const [selected, setSelected] = useState<WidgetId>(() => WIDGET_IDS.find(id => !settings.widgets[id]) ?? WIDGET_IDS[0]!);
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
    <div className="picker-body"><div className="widget-catalog" aria-label="Widget catalog">
      {WIDGET_IDS.map(id => <button key={id} className="catalog-item" aria-label={`Preview ${WIDGET_CATALOG[id].name}`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
        <Icon name={WIDGET_CATALOG[id].icon} size={19} />
        <span>{WIDGET_CATALOG[id].name}</span>
        {settings.widgets[id] && <Icon name="check" size={12} className="catalog-added" />}
      </button>)}
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
