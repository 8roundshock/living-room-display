import assert from 'node:assert/strict';

// #436 translates transparent widget sections to float their ink within the authored cells.
// Compare cells without that translation, and independently measure conservative text/atomic content bounds.
export async function boardGeometry(page, selector) {
  return page.locator(selector).evaluateAll(elements => elements.map(element => {
    const raw = element.getBoundingClientRect(), style = getComputedStyle(element);
    const sx = raw.width / parseFloat(style.width), sy = raw.height / parseFloat(style.height);
    const [x = 0, y = 0] = style.translate.split(' ').map(value => parseFloat(value) || 0);
    const cell = { left: raw.left - x * sx, top: raw.top - y * sy, right: raw.right - x * sx, bottom: raw.bottom - y * sy };
    const padded = { left: cell.left + parseFloat(style.paddingLeft) * sx, top: cell.top + parseFloat(style.paddingTop) * sy, right: cell.right - parseFloat(style.paddingRight) * sx, bottom: cell.bottom - parseFloat(style.paddingBottom) * sy };
    const content = element.querySelector('.widget-content');
    const range = document.createRange(), parts = [];
    const add = rect => { if (rect.width > 0 && rect.height > 0) parts.push(rect); };
    const walk = node => { for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        range.selectNodeContents(child);
        // Keep the complete text range: glyphs can extend beyond a short CSS line box.
        for (const rect of range.getClientRects()) add(rect);
      } else if (child instanceof Element && !child.classList.contains('sr-only') && child.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
        if (child.matches('svg, img, canvas, picture, video, [role="img"]') || (!child.firstElementChild && !child.textContent.trim())) add(child.getBoundingClientRect());
        else walk(child);
      }
    } };
    walk(content);
    const ink = { left: Math.min(...parts.map(r => r.left)), top: Math.min(...parts.map(r => r.top)), right: Math.max(...parts.map(r => r.right)), bottom: Math.max(...parts.map(r => r.bottom)) };
    return { id: element.dataset.widgetId, cell, padded, ink };
  }));
}

export function assertBoardGeometry(widgets, count, label) {
  assert.equal(widgets.length, count, `${label}: every enabled widget renders`);
  for (const { id, cell, padded, ink } of widgets) {
    assert.ok(Object.values(ink).every(Number.isFinite), `${label}: ${id} has visible content bounds`);
    assert.ok(ink.left >= cell.left - 1 && ink.top >= cell.top - 1 && ink.right <= cell.right + 1 && ink.bottom <= cell.bottom + 1,
      `${label}: ${id} content bounds stay inside its authored cell ${JSON.stringify({ cell, padded, ink })}`);
  }
  const disjoint = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
  for (const a of widgets) for (const b of widgets) if (a.id < b.id) {
    assert.ok(disjoint(a.cell, b.cell), `${label}: ${a.id} and ${b.id} cells are disjoint`);
    assert.ok(disjoint(a.ink, b.ink), `${label}: ${a.id} and ${b.id} content bounds are disjoint`);
  }
}
