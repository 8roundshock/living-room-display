import type { Settings, WidgetId } from '../shared/contracts.ts';
import { ACTIVE_WIDGET_IDS, WIDGET_CATALOG, WIDGET_CATEGORIES, type WidgetCategory } from '../shared/widgets.ts';

export type PickerFilter = 'all' | 'not-added' | 'on-display';
export interface PickerGroup { category: WidgetCategory; ids: WidgetId[] }

/** One catalog order for the picker, its initial selection and the inspector's widget list. */
export function pickerGroups(): PickerGroup[] {
  return (Object.keys(WIDGET_CATEGORIES) as WidgetCategory[])
    .map(category => ({ category, ids: ACTIVE_WIDGET_IDS.filter(id => WIDGET_CATALOG[id].category === category) }))
    .filter(group => group.ids.length > 0);
}

export function firstPickerSelection(widgets: Settings['widgets']): WidgetId {
  const order = pickerGroups().flatMap(group => group.ids);
  return order.find(id => !widgets[id]) ?? order[0]!;
}

/** Search the shared catalog, never widget content or user data. All words must match. */
export function filteredPickerGroups(widgets: Settings['widgets'], query: string, filter: PickerFilter): PickerGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return pickerGroups().map(group => ({ ...group, ids: group.ids.filter(id => {
    if (filter === 'not-added' && widgets[id] || filter === 'on-display' && !widgets[id]) return false;
    const widget = WIDGET_CATALOG[id];
    const text = `${widget.name} ${widget.description} ${WIDGET_CATEGORIES[widget.category]}`.toLowerCase();
    return words.every(word => text.includes(word));
  }) })).filter(group => group.ids.length > 0);
}

/** A filtered-away item cannot leave a stale actionable preview or an unreachable rail tab stop. */
export function filteredPickerSelection(groups: PickerGroup[], preferred: WidgetId): WidgetId | null {
  const ids = groups.flatMap(group => group.ids);
  return ids.includes(preferred) ? preferred : ids[0] ?? null;
}
