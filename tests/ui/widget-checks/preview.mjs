import assert from 'node:assert/strict';
import { GRID_DENSITIES, WIDGET_IDS, widgetSizes } from '../../../src/shared/widgets.ts';
import { intlPerTicks } from './clock.mjs';
import { assertImageHold } from './photo.mjs';

export const id = 'preview';
export const selectors = ['.preview-caption'];
export function prepare(state, { now }) {
  state.preview = { available: true, capturedAt: new Date(now).toISOString(), width: 320, height: 200 };
}

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

/** The drawn image (object-fit: contain) against its caption and the cell's content box (#225). */
function anchoring(widget) {
  return widget.evaluate(async section => {
    const image = section.querySelector('.preview-image'); await image.decode();
    const box = image.getBoundingClientRect(), shape = image.naturalWidth / image.naturalHeight;
    const width = Math.min(box.width, box.height * shape), height = width / shape;
    const drawn = { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
    const element = section.querySelector('.preview-caption'), caption = element.getBoundingClientRect(), body = section.querySelector('.snapshot-body').getBoundingClientRect();
    // The frame reserves 0.15em below the caption line for its text overflow, centred.
    const slack = parseFloat(getComputedStyle(element).fontSize) * 0.15 + 1.5;
    return {
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a, objectFit: getComputedStyle(image).objectFit,
      left: caption.left - drawn.left, gap: caption.top - (drawn.top + drawn.height),
      fillsWidth: drawn.width >= body.width - 1, fillsHeight: caption.bottom >= body.bottom - slack, inside: drawn.left >= body.left - 0.5 && drawn.left + drawn.width <= body.right + 0.5 && caption.bottom <= body.bottom + 1.5,
    };
  });
}

function assertAnchored(result, label) {
  assert.equal(result.objectFit, 'contain', `${label}: the complete screen, never cropped`);
  assert.equal(result.fit, 1, `${label}: fits without zooming out`);
  assert.ok(Math.abs(result.left) <= 1, `${label}: caption starts on the image's left edge (${result.left})`);
  assert.ok(result.gap >= 0 && result.gap <= 6, `${label}: caption ${result.gap} px below the image`);
  assert.ok(result.fillsWidth || result.fillsHeight, `${label}: the image takes the cell's limiting dimension`);
  assert.ok(result.inside, `${label}: image and caption stay inside the cell`);
}

export async function family({ widget, size, density, viewport }) {
  assertAnchored(await anchoring(widget), `last screen ${size}/${density} ${viewport.width}`);
}

export async function sweep({ page, viewport, state, now }) {
  if (viewport.width !== 1920) return;
  const only = (target, { size = 'medium', density = 'balanced', animation = 'off' } = {}) => {
    target.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'preview'])); target.settings.preview.enabled = true;
    target.settings.widgetGrid.density = density; target.settings.widgetGrid.placements.preview = { column: 0, row: 0, size };
    target.settings.appearance.animation = animation; target.settings.appearance.motionEnabled = false;
    target.preview = { available: true, capturedAt: new Date(now).toISOString(), width: 320, height: 200 };
  };
  // The family sweep covers 1080p and 4K; the owner's TV geometry (1280×720 CSS) is checked here.
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const density of Object.keys(GRID_DENSITIES)) for (const size of widgetSizes('preview')) {
    only(state, { size, density }); await reload(page);
    assertAnchored(await anchoring(page.locator('[data-widget-id="preview"]')), `last screen ${size}/${density} 1280`);
  }
  await page.setViewportSize(viewport);
  only(state); await reload(page);
  assert.equal(await intlPerTicks(page), 0, 'the caption builds no Intl formatter per tick');
  const levels = await assertImageHold(page, state, {
    widgetId: 'preview', shell: '.preview-image-shell',
    setup: (target, animation) => only(target, { animation }),
    swap(target) { const next = new Date(Date.parse(target.preview.capturedAt) + 60_000).toISOString(); target.preview = { ...target.preview, capturedAt: next }; return encodeURIComponent(next); },
  });
  return `Last screen caption on the drawn image's left edge (±1 px), ≤ 6 px below, image filling the limiting dimension, fit 1, in every family and density at 720p/1080p/4K; no per-tick caption formatter; a 1.5 s delayed new snapshot (${levels.join(', ')}) holds at 0 until loaded at Subtle/Lively and shows at once at Off/reduced motion`;
}
