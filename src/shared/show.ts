import type { Settings, WidgetId, WidgetPlacement } from './contracts.ts';
import { WIDGET_CATALOG, WIDGET_SIZES, firstPlacement, placementFits, widgetSizes } from './widgets.ts';

/**
 * "Show on my display" from Home (#438). Home never rearranges the board: it may turn on the widgets its
 * quick actions feed, in free cells only, and links to Edit display to make room otherwise.
 */
export const HOME_SHOWABLE_WIDGETS: readonly WidgetId[] = ['clock', 'worldClocks', 'countdown', 'note', 'reminders', 'calendar'];

/**
 * Where a widget would go without moving any other: its saved placement (with a free-size widget's custom
 * size) when those cells are still free, else the first free cells for its default family, then for each
 * smaller family. Null when no family fits anywhere. The server decides inside its serialized write; Home
 * uses the same rule to offer the switch or the Edit display link.
 */
export function showPlacement(settings: Pick<Settings, 'widgets' | 'widgetGrid'>, id: WidgetId): WidgetPlacement | null {
  const grid = settings.widgetGrid, enabled = settings.widgets;
  const saved = grid.placements[id];
  if (placementFits(grid, id, saved, enabled)) return structuredClone(saved);
  const families = WIDGET_SIZES.slice(0, WIDGET_SIZES.indexOf(WIDGET_CATALOG[id].defaultSize) + 1).reverse().filter(size => widgetSizes(id).includes(size));
  for (const size of families) {
    const placement = firstPlacement(grid, id, size, enabled);
    if (placement) return placement;
  }
  return null;
}
