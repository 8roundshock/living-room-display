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

export type { WidgetContentProps, WidgetModule, WidgetSettingsProps } from './types.ts';

/** Adding an id requires a module here (one line per id, catalog order); the catalog supplies the platform metadata. */
export const WIDGET_MODULES: Record<WidgetId, WidgetModule> = {
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
export const WIDGET_RENDERERS = Object.fromEntries(WIDGET_IDS.map(id => [id, WIDGET_MODULES[id].Renderer])) as Record<WidgetId, ComponentType<WidgetContentProps>>;
export function widgetVisible(id: WidgetId, props: WidgetContentProps): boolean {
  return isActiveWidget(id) && props.settings.widgets[id] && (WIDGET_MODULES[id].visible?.(props) ?? true);
}
export function widgetLabel(id: WidgetId): string { return WIDGET_CATALOG[id].name; }
