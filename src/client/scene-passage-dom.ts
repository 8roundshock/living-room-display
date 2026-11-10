import type { PassageRect, PassageTarget, PassageOrigin } from './scene-passage';

export interface PassageGeometry { width: number; height: number; targets: PassageTarget[]; protectedRects: PassageRect[]; origins: PassageOrigin[] }
const union = (rects: readonly PassageRect[]): PassageRect => ({ left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)), right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) });

/** Read only at a passage attempt or existing ink/layout invalidation. The widget
 * owner supplies its same future movement envelopes, including pending swaps. */
export function passageGeometry(root: HTMLElement, sections: readonly { element: HTMLElement; swept: PassageRect }[]): PassageGeometry {
  const bounds = root.getBoundingClientRect(), targets: PassageTarget[] = [], protectedRects: PassageRect[] = [];
  const local = (r: DOMRect): PassageRect => ({ left: r.left - bounds.left, top: r.top - bounds.top, right: r.right - bounds.left, bottom: r.bottom - bounds.top });
  const range = document.createRange();
  for (const { element, swept } of sections) {
    // Only a large current temperature may be grazed. Clock/timer numerals,
    // labels, warnings and all other widgets retain complete protection.
    const candidate = element.querySelector<HTMLElement>('.current-temperature:not(.weather-placeholder)');
    const eligible = candidate && !element.matches(':hover') && !element.contains(document.activeElement)
      && parseFloat(getComputedStyle(candidate).fontSize) >= Math.max(48, Math.min(bounds.width, bounds.height) * .045)
      && !element.querySelector('[role="alert"], [data-weather-mode="elevated"], [data-last-known]');
    if (!eligible) { protectedRects.push(swept); continue; }
    const readings: { rect: PassageRect; target: boolean }[] = [];
    const walk = (node: Node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          range.selectNodeContents(child);
          for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) readings.push({ rect: local(rect), target: candidate.contains(child) });
        } else if (child instanceof Element) {
          if (child.matches('.sr-only,[aria-hidden="true"]')) continue;
          if (child.matches('svg,img,canvas,picture,video,[role="img"]')) {
            const rect = child.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) readings.push({ rect: local(rect), target: false });
          } else walk(child);
        }
      }
    };
    walk(element);
    const targetRects = readings.filter(r => r.target).map(r => r.rect);
    if (!targetRects.length) { protectedRects.push(swept); continue; }
    const ink = union(readings.map(r => r.rect));
    const expand = (r: PassageRect): PassageRect => ({ left: r.left - Math.max(0, ink.left - swept.left), right: r.right + Math.max(0, swept.right - ink.right), top: r.top - Math.max(0, ink.top - swept.top), bottom: r.bottom + Math.max(0, swept.bottom - ink.bottom) });
    const rect = union(targetRects);
    targets.push({ id: `${element.dataset.widgetId}:temperature`, rect, swept: expand(rect) });
    protectedRects.push(...readings.filter(r => !r.target).map(r => expand(r.rect)));
  }
  const origins: PassageOrigin[] = [], pad = Math.min(bounds.width, bounds.height) * .035;
  for (const group of root.querySelectorAll<SVGGElement>('[data-scene-fit]:not([data-scene-omitted])')) {
    const patch = group.closest<SVGElement>('[data-scene-patch]'), life = group.closest('.living-patch-life');
    if (!patch || !life || Number(getComputedStyle(life).opacity) < .2 || patch.dataset.sceneDepth === 'far') continue;
    const r = group.getBoundingClientRect(), edge = patch.dataset.sceneEdge?.split('-')[0] as PassageOrigin['edge'];
    if (!['top', 'bottom', 'left', 'right'].includes(edge)) continue;
    origins.push({ id: group.dataset.sceneFit!, edge, x: Math.max(pad, Math.min(bounds.width - pad, (r.left + r.right) / 2 - bounds.left)),
      y: Math.max(pad, Math.min(bounds.height - pad, edge === 'bottom' ? r.bottom - bounds.top : edge === 'top' ? r.top - bounds.top : (r.top + r.bottom) / 2 - bounds.top)) });
  }
  return { width: bounds.width, height: bounds.height, targets, protectedRects, origins };
}
