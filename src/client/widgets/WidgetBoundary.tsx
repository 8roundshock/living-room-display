import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { WidgetId } from '../../shared/contracts.ts';
import { WIDGET_CATALOG } from '../../shared/widgets.ts';
import type { WidgetContentProps } from './types.ts';

/** Failures already written to the console, one entry per widget and message (#318). */
const reported = new Set<string>();

/** Writes a widget's failure to the console once, however often it recurs. */
export function reportWidgetError(id: WidgetId, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (reported.has(`${id}:${message}`)) return;
  reported.add(`${id}:${message}`);
  console.error(`${WIDGET_CATALOG[id].name} unavailable:`, error);
}

/**
 * React's `onCaughtError` for the root (main.tsx): a widget boundary reports its own errors once, so
 * React's default logging, which repeats on every retry, applies only to any other boundary.
 */
export function reportCaughtError(error: unknown, info: { errorBoundary?: unknown }): void {
  if (info.errorBoundary instanceof WidgetBoundary) return;
  console.error(error);
}

interface BoundaryProps { id: WidgetId; resetKeys: readonly unknown[]; children: ReactNode }
interface BoundaryState { failed: boolean; keys: readonly unknown[] }
const changed = (a: readonly unknown[], b: readonly unknown[]) => a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));

/**
 * #318: one widget's render error stays inside that widget. Its section keeps its footprint and keeps
 * relocating with the board, and shows "<Widget> unavailable" in the dim status tone instead of
 * unmounting the display or the editor. The boundary tries the widget again when any reset key changes
 * (new state or settings from the server or the draft, another family or a new minute).
 */
export class WidgetBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, keys: this.props.resetKeys };
  static getDerivedStateFromError(): Partial<BoundaryState> { return { failed: true }; }
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return changed(props.resetKeys, state.keys) ? { failed: false, keys: props.resetKeys } : null;
  }
  componentDidCatch(error: unknown, _info: ErrorInfo): void { reportWidgetError(this.props.id, error); }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <div className="widget-body widget-unavailable" data-widget-error=""><div className="ambient-description status-caution">{WIDGET_CATALOG[this.props.id].name} unavailable</div></div>;
  }
}

/**
 * Test hook (#318): while `window.__lrdWidgetFault` names a widget id, that widget's renderer throws.
 * The browser suite uses it to prove containment; nothing in the app sets it.
 */
function InjectedFault({ id }: { id: WidgetId }): null {
  if ((globalThis as { __lrdWidgetFault?: unknown }).__lrdWidgetFault === id) throw new Error(`Synthetic ${id} fault`);
  return null;
}

/** A renderer wrapped in its own boundary; the registry hands this to the display, the editor canvas and the picker. */
export function guardedRenderer(id: WidgetId, Renderer: ComponentType<WidgetContentProps>): ComponentType<WidgetContentProps> {
  function GuardedWidget(props: WidgetContentProps) {
    const minute = Math.floor(props.now.getTime() / 60_000);
    return <WidgetBoundary id={id} resetKeys={[props.state, props.settings, props.size, minute, props.embedded, props.disconnected, props.photoPreview]}>
      <InjectedFault id={id} /><Renderer {...props} />
    </WidgetBoundary>;
  }
  GuardedWidget.displayName = `Guarded(${Renderer.displayName ?? Renderer.name ?? id})`;
  return GuardedWidget;
}
