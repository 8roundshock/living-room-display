import { useMemo } from 'react';
import { reminderWeek } from '../collection.ts';
import { todayCivil } from '../calendar.ts';
import { CollectionFace } from './CollectionParts.tsx';
import { collectionSample } from './collection-samples.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import './week-ahead.css';
function WeekAhead({ state, now, size, disconnected }: WidgetContentProps) {
  const today = todayCivil(now), week = useMemo(() => reminderWeek(state.reminders, now), [state.reminders, today]);
  const total = week.reduce((sum, day) => sum + day.items.length, 0);
  return <CollectionFace name="Week ahead" size={size} className="week-ahead-face"><div className="week-ahead-days">{week.map((day, index) => <div className="week-ahead-day" key={day.key}><span className="collection-detail">{index === 0 ? 'Today' : day.label}</span><span className="week-ahead-date">{day.day}</span><span className="week-ahead-count">{day.items.length || '—'}</span>{size === 'large' && day.items.length > 0 && <span className="week-ahead-title">{day.items[0]!.text}{day.items.length > 1 ? ` +${day.items.length - 1}` : ''}</span>}</div>)}</div><p className="collection-detail">{total} dated reminder{total === 1 ? '' : 's'} · next 7 days</p>{disconnected && <p className="status-caution collection-detail">Saved reminders · offline</p>}</CollectionFace>;
}
export const WeekAheadWidget: WidgetModule = { Renderer: WeekAhead, sample: collectionSample, Settings: () => <p className="hint">Counts pending dated reminders from today through the next six days on this computer. Manage them on Home.</p> };
