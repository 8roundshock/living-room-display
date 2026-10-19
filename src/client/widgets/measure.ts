import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

/*
 * Layout-box geometry for widgets that measure their own content (#216): the Reminders list, the
 * large Countdown list and the Note size. offsetTop and offsetHeight ignore CSS transforms, so the
 * shared fit's zoom-out, a widget entrance or a row that is mid-transition (translated or scaled)
 * can never change what is counted. All values are in the measured body's own CSS pixels; offsets
 * are whole pixels, so a fitted row can overrun its box by less than one pixel.
 */

/** Top of `element` inside `body`'s padding box, from layout offsets (the body should be positioned). */
export function layoutTop(element: HTMLElement, body: HTMLElement): number {
  const parent = element.offsetParent;
  if (parent === body) return element.offsetTop;
  if (parent instanceof HTMLElement && body.contains(parent)) return element.offsetTop + layoutTop(parent, body);
  // The body is not an offset parent: both offsets are relative to the same ancestor.
  let bodyTop = 0;
  for (let node: Element | null = body; node && node !== parent; node = (node as HTMLElement).offsetParent) bodyTop += (node as HTMLElement).offsetTop;
  return element.offsetTop - bodyTop;
}

/** Height plus top margin of an optional footer line, in layout pixels. */
export function layoutExtent(element: Element | null): number {
  return element instanceof HTMLElement ? element.offsetHeight + parseFloat(getComputedStyle(element).marginTop) : 0;
}

/** The body's own box height (fractional, before any transform). */
export function boxHeight(body: HTMLElement): number {
  return parseFloat(getComputedStyle(body).height) || body.clientHeight;
}

/**
 * How many leading `items` fit inside `body`: the last fitted item's bottom plus `footer(count)`
 * stays within the box. Returns 0 when even the first item overflows.
 */
export function fittingCount(body: HTMLElement, items: readonly HTMLElement[], footer: (count: number) => number): number {
  const limit = boxHeight(body) + 0.5;
  for (let count = items.length; count >= 1; count--) {
    const item = items[count - 1]!;
    if (layoutTop(item, body) + item.offsetHeight + footer(count) <= limit) return count;
  }
  return 0;
}

/**
 * Measures before paint whenever `key` changes, and again when the widget's own box resizes or fonts
 * finish loading. `measure` returns null when there is nothing to measure. The state changes only when
 * the result does, so a remeasure that finds the same layout renders nothing.
 */
export function useMeasured<T>(body: RefObject<HTMLElement | null>, key: string, measure: (body: HTMLElement) => T | null, initial: T, same: (a: T, b: T) => boolean = Object.is): T {
  const [value, setValue] = useState(initial);
  const latest = useRef({ measure, same });
  latest.current = { measure, same };
  const apply = (element: HTMLElement, sync: boolean) => {
    const next = latest.current.measure(element);
    if (next === null) return;
    const update = () => setValue(previous => latest.current.same(previous, next) ? previous : next);
    if (sync) flushSync(update); else update();
  };
  useLayoutEffect(() => { if (body.current) apply(body.current, false); }, [key]);
  useLayoutEffect(() => {
    const element = body.current;
    const container = element?.closest('.ambient-widget');
    if (!element || !container) return;
    let active = true;
    const remeasure = () => { if (active && body.current) apply(body.current, true); };
    // Observe the widget's own box: the shared fit only widens the content, never this box.
    const observer = new ResizeObserver(remeasure);
    observer.observe(container);
    void document.fonts?.ready.then(remeasure);
    return () => { active = false; observer.disconnect(); };
  }, []);
  return value;
}

/** Measures at the content's natural width, never the widened width of an earlier zoom-out. */
export function atNaturalWidth<T>(body: HTMLElement, run: () => T): T {
  const content = body.parentElement;
  const width = content?.style.width ?? '';
  if (content) content.style.width = '100%';
  try { return run(); } finally { if (content) content.style.width = width; }
}
