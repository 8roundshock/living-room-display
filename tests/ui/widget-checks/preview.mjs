import assert from 'node:assert/strict';
import { photoFixture } from '../../../src/server/fixtures.ts';
import { GRID_DENSITIES, WIDGET_IDS, widgetSizes } from '../../../src/shared/widgets.ts';
import { intlPerTicks } from './clock.mjs';
import { assertImageHold } from './photo.mjs';

/** A synthetic 9:16 snapshot, as from a portrait primary display (#308). */
const PORTRAIT = (() => { const pixels = Buffer.alloc((90 * 4 + 1) * 160, 120); for (let row = 0; row < 160; row++) pixels[row * (90 * 4 + 1)] = 0; return photoFixture(90, 160, pixels); })();
const SMALL_TV = { width: 1280, height: 720 };

export const id = 'preview';
export const selectors = ['.preview-image'];
export function prepare(state, { now }) {
  state.preview = { available: true, capturedAt: new Date(now).toISOString(), width: 320, height: 200 };
}

async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }

/** Complete image geometry and the softened picture-only treatment. */
function anchoring(widget) {
  return widget.evaluate(async section => {
    const image = section.querySelector('.preview-image'); await image.decode();
    const box = image.getBoundingClientRect(), body = section.querySelector('.snapshot-body').getBoundingClientRect();
    const shell = getComputedStyle(section.querySelector('.preview-image-shell'));
    return {
      fit: new DOMMatrix(getComputedStyle(section.querySelector('.widget-content')).transform).a,
      objectFit: getComputedStyle(image).objectFit,
      fillsWidth: box.width >= body.width - 1, fillsHeight: box.height >= body.height - 1,
      inside: box.left >= body.left - 0.5 && box.right <= body.right + 0.5 && box.top >= body.top - 0.5 && box.bottom <= body.bottom + 1.5,
      radius: parseFloat(shell.borderTopLeftRadius), mask: shell.maskImage,
      caption: !!section.querySelector('.preview-caption'),
    };
  });
}
function assertAnchored(result, label) {
  assert.equal(result.objectFit, 'contain', `${label}: screen keeps its aspect without cropping`);
  assert.equal(result.fit, 1, `${label}: fits without zooming out`);
  assert.ok(result.fillsWidth || result.fillsHeight, `${label}: image fills the limiting dimension`);
  assert.ok(result.inside, `${label}: image stays inside its cell`);
  assert.ok(result.radius > 0 && result.mask !== 'none', `${label}: rounded and softly feathered edges`);
  assert.equal(result.caption, false, `${label}: no visible timestamp or caption`);
}

async function assertEditorCanvas(page, base, label) {
  await page.goto(`${base}/editor`);
  const widget = page.locator('.preview-screen [data-widget-id="preview"]');
  await widget.locator('.preview-image').waitFor(); await page.clock.runFor(300);
  const chrome = await widget.evaluate(section => {
    const frame = getComputedStyle(section.querySelector('.preview-image-shell').parentElement), caption = section.querySelector('.preview-image').getBoundingClientRect();
    const canvas = section.closest('.preview-frame')?.getBoundingClientRect();
    return {
      canvasFrames: document.querySelectorAll('.preview-frame').length, border: frame.borderTopWidth, radius: frame.borderTopLeftRadius, shadow: frame.boxShadow, overflow: frame.overflow,
      imageInCanvas: Boolean(canvas) && caption.width > 0 && caption.height > 0 && caption.left >= canvas.left && caption.right <= canvas.right && caption.top >= canvas.top && caption.bottom <= canvas.bottom,
    };
  });
  assert.deepEqual(chrome, { canvasFrames: 1, border: '0px', radius: '0px', shadow: 'none', overflow: 'visible', imageInCanvas: true }, `${label}: the snapshot frame takes none of the editor canvas frame's chrome and its image is visible`);
  assertAnchored(await anchoring(widget), label);
}

export async function family({ widget, size, density, viewport }) {
  assertAnchored(await anchoring(widget), `last screen ${size}/${density} ${viewport.width}`);
}

/** Portrait and landscape snapshots keep the same full-image geometry. */
async function portraitCaption(page, state, now, views) {
  const setup = (size, density, fontScale, portrait) => {
    state.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'preview'])); state.settings.preview.enabled = true;
    state.settings.widgetGrid.density = density; state.settings.widgetGrid.placements.preview = { column: 0, row: 0, size };
    Object.assign(state.settings.appearance, { animation: 'off', motionEnabled: false, fontScale });
    state.preview = { available: true, capturedAt: new Date(now).toISOString(), width: portrait ? 360 : 320, height: portrait ? 640 : 200 };
  };
  let cases = 0;
  try {
    for (const view of views) {
      await page.setViewportSize(view);
      await page.route('**/api/preview/image?*', route => route.fulfill({ contentType: 'image/png', body: PORTRAIT }));
      for (const density of Object.keys(GRID_DENSITIES)) for (const size of widgetSizes('preview')) {
        setup(size, density, 1, true); await reload(page);
        const widget = page.locator('[data-widget-id="preview"]'), label = `last screen 9:16 ${size}/${density} ${view.width}`;
        assertAnchored(await anchoring(widget), label);
        cases++;
      }
      // The narrowest family (Fine small) at every Text size, portrait and landscape: text size cannot shrink the picture.
      for (const portrait of [true, false]) {
        if (!portrait) await page.unroute('**/api/preview/image?*');
        for (const fontScale of [1, 1.25, 1.5]) {
          setup('small', 'fine', fontScale, portrait); await reload(page);
          assertAnchored(await anchoring(page.locator('[data-widget-id="preview"]')), `Fine small ${portrait ? '9:16' : '16:10'} Text ${fontScale * 100}% ${view.width}`);
          cases++;
        }
      }
    }
  } finally { await page.unroute('**/api/preview/image?*'); state.settings.appearance.fontScale = 1; }
  return cases;
}

export async function sweep({ page, viewport, state, base, now }) {
  const portraitCases = await portraitCaption(page, state, now, viewport.width === 1920 ? [SMALL_TV, viewport] : [viewport]);
  await page.setViewportSize(viewport);
  const portraitSummary = `Picture-only portrait/landscape snapshots retain rounded feathered edges, fit 1 and full-cell bounds in ${portraitCases} cases at ${viewport.width}px, with Text 100�150%.`;
  if (viewport.width !== 1920) return portraitSummary;
  const authored = structuredClone(state);
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
  // The editor canvas with a snapshot at the owner's TV (1280×720) and a phone width: the authored board
  // and every family alone.
  for (const editorViewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(editorViewport);
    for (const size of ['board', ...widgetSizes('preview')]) {
      if (size === 'board') {
        Object.assign(state, structuredClone(authored)); state.settings.widgets.preview = true; state.settings.preview.enabled = true; state.settings.appearance.motionEnabled = false;
        state.preview = { available: true, capturedAt: new Date(now).toISOString(), width: 320, height: 200 };
      } else only(state, { size });
      await assertEditorCanvas(page, base, `editor canvas last screen ${size} ${editorViewport.width}`);
    }
  }
  // #276: the editor's placeholder (no snapshot yet) uses the widget's width instead of the pre-grid 23cqw clamp
  // that wrapped it one word per line.
  const placeholder = [];
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const density of Object.keys(GRID_DENSITIES)) for (const size of widgetSizes('preview')) {
    only(state, { size, density }); state.preview = { available: false, capturedAt: null, width: null, height: null };
    await page.goto(`${base}/editor`);
    const widget = page.locator('.preview-screen [data-widget-id="preview"]'); await widget.locator('.ambient-description').waitFor(); await page.clock.runFor(300);
    const share = await widget.evaluate(section => {
      const style = getComputedStyle(section), scale = section.getBoundingClientRect().width / section.offsetWidth;
      const content = (section.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * scale;
      const description = section.querySelector('.ambient-description'), range = document.createRange(); range.selectNodeContents(description);
      return { text: description.textContent, share: description.getBoundingClientRect().width / content, lines: new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size };
    });
    // A sentence that fits on one line (a wide medium cell) needs less than the width.
    assert.ok(share.share >= 0.6 || share.lines === 1, `last screen placeholder ${size}/${density}: "${share.text}" uses ${(share.share * 100).toFixed(0)}% of the content width on ${share.lines} lines`);
    placeholder.push(share);
  }
  await page.goto(`${base}/display`); await page.locator('.display-page').waitFor();
  await page.setViewportSize(viewport);
  only(state); await reload(page);
  assert.equal(await intlPerTicks(page), 0, 'the caption builds no Intl formatter per tick');
  const levels = await assertImageHold(page, state, {
    widgetId: 'preview', shell: '.preview-image-shell',
    setup: (target, animation) => only(target, { animation }),
    swap(target) { const next = new Date(Date.parse(target.preview.capturedAt) + 60_000).toISOString(); target.preview = { ...target.preview, capturedAt: next }; return encodeURIComponent(next); },
  });
  return `Picture-only Last screen fits every family and density at 720p/1080p/4K and editor 1280/390px; rounded mask, no caption, no canvas chrome; placeholder width retained; no per-tick formatter; delayed image hold checked at ${levels.join(', ')}. ${portraitSummary}`;
}
