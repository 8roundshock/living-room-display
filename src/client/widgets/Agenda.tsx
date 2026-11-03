import { useMemo } from 'react';
import { datedReminders } from '../collection.ts';
import { dateTimeFormat } from '../format.ts';
import { CollectionEmpty, CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './agenda.css';

function Agenda({ state, settings, now, size, disconnected }: WidgetContentProps) {
  const rows = useMemo(() => datedReminders(state.reminders), [state.reminders]), count = size === 'large' ? 4 : 2;
  return <CollectionFace name="Agenda" size={size} className="agenda-face">
    {!rows.length ? <CollectionEmpty>{disconnected ? 'Agenda unavailable · offline' : 'No dated reminders'}</CollectionEmpty> : <ul className="collection-list">{rows.slice(0, count).map(item => <li key={item.id}><p className="collection-detail">{Date.parse(item.dueAt!) < now.getTime() && <span className="status-caution">Overdue · </span>}{dateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: settings.clockFormat === '12h' }).format(new Date(item.dueAt!))}</p><p className="collection-title">{item.text}</p></li>)}</ul>}
    {rows.length > count && <p className="collection-detail">+{rows.length - count} more dated</p>}{disconnected && rows.length > 0 && <p className="status-caution collection-detail">Saved reminders · offline</p>}
  </CollectionFace>;
}
export const AgendaWidget: WidgetModule = { Renderer: Agenda, sample: collectionSample, Settings: () => <p className="hint">Shows pending reminders with a date, earliest first. Manage reminders on Home; undated reminders stay in Reminders.</p> };
