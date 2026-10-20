import type { ComponentType } from 'react';
import type { WidgetId } from '../../shared/contracts.ts';
import { WIDGET_CATALOG, WIDGET_IDS, isActiveWidget } from '../../shared/widgets.ts';
import type { WidgetContentProps, WidgetModule } from './types.ts';
import { ClockWidget } from './Clock.tsx';
import { WeatherWidget } from './Weather.tsx';
import { RainWidget } from './Rain.tsx';
import { ForecastWidget } from './Forecast.tsx';
import { RemindersWidget } from './Reminders.tsx';
import { PreviewWidget } from './Preview.tsx';
import { PhotoWidget } from './Photo.tsx';
import { WorldClocksWidget } from './WorldClocks.tsx';
import { CalendarWidget } from './Calendar.tsx';
import { CountdownWidget } from './Countdown.tsx';
import { NoteWidget } from './Note.tsx';
import { AirQualityWidget } from './AirQuality.tsx';
import { SunMoonWidget } from './SunMoon.tsx';
import { DynamicWidget } from './Dynamic.tsx';
import { guardedRenderer, reportWidgetError } from './WidgetBoundary.tsx';

export type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';

/** Adding an id requires a module here (one line per id, catalog order); the catalog supplies the platform metadata. */
const MODULES: Record<WidgetId, WidgetModule> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  rain: RainWidget,
  forecast: ForecastWidget,
  reminders: RemindersWidget,
  preview: PreviewWidget,
  photo: PhotoWidget,
  worldClocks: WorldClocksWidget,
  calendar: CalendarWidget,
  countdown: CountdownWidget,
  note: NoteWidget,
  airQuality: AirQualityWidget,
  sunMoon: SunMoonWidget,
  dynamic: DynamicWidget,
};
/**
 * The modules every surface uses. Each renderer runs inside its own error boundary (#318), so the ambient
 * display, the editor canvas and the picker samples all contain one widget's failure to that widget, which
 * shows "<Widget> unavailable" in its own footprint. A throwing `sample` falls back to the shared sample.
 */
export const WIDGET_MODULES = Object.fromEntries(WIDGET_IDS.map(id => {
  const module = MODULES[id], sample = module.sample;
  return [id, { ...module, Renderer: guardedRenderer(id, module.Renderer), ...(sample ? { sample: (base: Parameters<typeof sample>[0]) => { try { return sample(base); } catch (error) { reportWidgetError(id, error); return base; } } } : {}) }];
})) as Record<WidgetId, WidgetModule>;
export const WIDGET_RENDERERS = Object.fromEntries(WIDGET_IDS.map(id => [id, WIDGET_MODULES[id].Renderer])) as Record<WidgetId, ComponentType<WidgetContentProps>>;
/** A widget whose own visibility rule throws stays visible, so its boundary can show it as unavailable (#318). */
export function widgetVisible(id: WidgetId, props: WidgetContentProps): boolean {
  if (!isActiveWidget(id) || !props.settings.widgets[id]) return false;
  try { return MODULES[id].visible?.(props) ?? true; } catch (error) { reportWidgetError(id, error); return true; }
}
export function widgetLabel(id: WidgetId): string { return WIDGET_CATALOG[id].name; }
