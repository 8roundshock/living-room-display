import type { ComponentType } from 'react';
import type { AppState, Settings, WidgetId } from '../../shared/contracts.ts';
import type { WidgetSize } from '../../shared/widgets.ts';

export interface WidgetContentProps { state: AppState; settings: Settings; size: WidgetSize; now: Date; embedded: boolean; disconnected: boolean; photoPreview?: string | null }

/** Props for a widget's own inspector panel, rendered under the shared Size controls. */
export interface WidgetSettingsProps {
  id: WidgetId;
  settings: Settings;
  onChange: (update: (settings: Settings) => Settings) => void;
  saving: boolean;
}

/** One widget's client implementation; the catalog supplies its platform metadata. */
export interface WidgetModule {
  Renderer: ComponentType<WidgetContentProps>;
  /** Extra visibility rule after the catalog status and the enabled flag; omitted means visible. */
  visible?: (props: WidgetContentProps) => boolean;
  /** Inspector panel for this widget's own settings. */
  Settings?: ComponentType<WidgetSettingsProps>;
  /** A reason the current draft cannot be saved, shown in the save bar; null when valid. */
  draftProblem?: (settings: Settings) => string | null;
  /** Adjusts the picker's synthetic sample; returns new objects and never uses private content. */
  sample?: (base: { state: AppState; settings: Settings }) => { state: AppState; settings: Settings };
  /** Free-size widgets (#73): one line under the custom size controls saying what a larger box shows. */
  sizeHint?: string;
}
