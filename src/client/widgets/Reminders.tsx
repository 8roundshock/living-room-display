import { widgetContentLimits } from '../../shared/widgets.ts';
import { reminderDate } from '../format.ts';
import { reminderPresentation, sortReminders } from '../model.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';

function Reminders({ state, settings, now, disconnected, size }: WidgetContentProps) {
  const status = reminderPresentation(settings, state.reminders, disconnected); const all = sortReminders(state.reminders ?? []).filter(reminder => !reminder.completed); const reminders = all.slice(0, widgetContentLimits(size).reminders);
  return <div className="widget-body reminders-body"><div className="ambient-label">Up next</div>{reminders.length ? <ul className="ambient-reminder-list">{reminders.map(reminder => <li key={reminder.id}><span className="ambient-reminder-dot" /><div><p className="ambient-reminder-title">{reminder.text}</p>{reminder.dueAt && <p className="ambient-reminder-date">{reminderDate(reminder.dueAt, now)}</p>}</div></li>)}</ul> : status === 'unavailable' ? <div className="ambient-title">Reminders unavailable</div> : <div className="ambient-title">All clear</div>}{all.length > reminders.length && <div className="ambient-description">+{all.length - reminders.length} more</div>}{disconnected && reminders.length > 0 && <div className="ambient-description">Saved reminders · offline</div>}</div>;
}

export const RemindersWidget: WidgetModule = {
  Renderer: Reminders,
  visible: props => reminderPresentation(props.settings, props.state.reminders, props.disconnected) !== 'hidden',
};
