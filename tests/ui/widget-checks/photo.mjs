import assert from 'node:assert/strict';
import { WIDGET_IDS } from '../../../src/shared/widgets.ts';

export const id = 'photo';
export function prepare(state, { now }) {
  state.photo = { available: true, id: 'synthetic', width: 320, height: 200, updatedAt: new Date(now).toISOString() };
}
export async function family({ widget, size }) {
  assert.equal(await widget.locator('img').evaluate(el => getComputedStyle(el).objectFit), size === 'large' ? 'contain' : 'cover');
}

const IMAGE_DELAY_MS = 1500;
async function reload(page) { await page.reload(); await page.locator('.display-page').waitFor(); await page.clock.runFor(100); }
/** Polls from Node: page timers run on page.clock. */
async function until(page, predicate, argument, label) {
  for (let attempt = 0; attempt < 150; attempt++) { if (await page.evaluate(predicate, argument)) return; await page.waitForTimeout(40); }
  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * #173: a new Photo or Last screen image whose response is delayed by 1.5 s. At Subtle and Lively its
 * shell stays at opacity 0 (never above resting opacity) until the image has loaded and decoded, and
 * the opacity transition starts only after the load. Off and reduced motion show the image as soon
 * as it is ready, with no transition. `setup(state, animation)` shows the widget with its first
 * image; `swap(state)` makes the next poll carry a new image and returns a URL fragment unique to it.
 */
export async function assertImageHold(page, state, { widgetId, shell, setup, swap }) {
  const results = [];
  for (const [animation, reducedMotion] of [['subtle', 'no-preference'], ['lively', 'no-preference'], ['off', 'no-preference'], ['lively', 'reduce']]) {
    const label = `${widgetId} ${animation}${reducedMotion === 'reduce' ? ' (reduced motion)' : ''}`, still = animation === 'off' || reducedMotion === 'reduce';
    await page.emulateMedia({ reducedMotion });
    setup(state, animation); await reload(page);
    const section = `[data-widget-id="${widgetId}"]`;
    await page.locator(`${section} ${shell} img`).evaluate(image => image.decode());
    await page.clock.runFor(2_500);
    const first = await page.locator(`${section} ${shell}`).evaluate(element => ({ held: element.hasAttribute('data-image-loading'), opacity: getComputedStyle(element).opacity }));
    assert.deepEqual(first, { held: false, opacity: '1' }, `${label}: the image shown with the widget is never held`);
    const imageOpacity = await page.locator(`${section} ${shell} img`).evaluate(image => getComputedStyle(image).opacity);
    // Record the new shell's load and opacity-transition times, and sample its opacity every frame.
    await page.evaluate(({ section, shell }) => {
      const record = window.__hold = { load: null, transition: null, opacities: [], images: [] };
      const watch = () => {
        const element = document.querySelector(`${section} ${shell}`);
        if (!element || element.__watched || !element.hasAttribute('data-image-loading') && !record.started) return;
        element.__watched = true; record.started = true;
        element.addEventListener('transitionrun', event => { if (event.propertyName === 'opacity') record.transition ??= event.timeStamp; });
        element.querySelector('img').addEventListener('load', event => { record.load ??= event.timeStamp; });
        const sample = () => { if (!element.isConnected) return; record.opacities.push(Number(getComputedStyle(element).opacity)); record.images.push(getComputedStyle(element.querySelector('img')).opacity); if (record.opacities.length < 600) requestAnimationFrame(sample); };
        sample();
      };
      new MutationObserver(watch).observe(document.querySelector(section), { childList: true, subtree: true });
    }, { section, shell });
    const fragment = swap(state);
    const delayed = url => url.href.includes(fragment);
    let requested;
    const request = new Promise(resolve => { requested = resolve; });
    await page.route(delayed, async route => { requested(Date.now()); await new Promise(resolve => setTimeout(resolve, IMAGE_DELAY_MS)); await route.fallback(); });
    try {
      await page.clock.runFor(30_000); // the next state poll carries the new image
      await until(page, ({ section, fragment }) => [...document.querySelectorAll(`${section} img`)].some(image => image.src.includes(fragment)), { section, fragment }, `${label}: the new image`);
      const requestedAt = await request;
      const pending = await page.locator(`${section} ${shell}`).evaluate(element => ({ held: element.hasAttribute('data-image-loading'), opacity: getComputedStyle(element).opacity, complete: element.querySelector('img').complete }));
      assert.equal(pending.complete, false, `${label}: the image is still loading`);
      assert.equal(pending.held, true, `${label}: the new shell is held`);
      assert.equal(pending.opacity, still ? '1' : '0', `${label}: opacity while loading`);
      await page.waitForTimeout(Math.max(0, IMAGE_DELAY_MS - (Date.now() - requestedAt) - 300));
      assert.equal(await page.evaluate(() => window.__hold.transition), null, `${label}: no fade before the image arrives`);
      await until(page, ({ section, shell }) => { const element = document.querySelector(`${section} ${shell}`); return element && !element.hasAttribute('data-image-loading') && element.querySelector('img').complete; }, { section, shell }, `${label}: the hold to end`);
      await page.waitForTimeout(800);
      const record = await page.evaluate(() => window.__hold);
      assert.ok(record.load !== null, `${label}: the load was observed`);
      if (still) assert.equal(record.transition, null, `${label}: no transition`);
      else assert.ok(record.transition !== null && record.transition >= record.load, `${label}: the fade starts after the load (${record.transition} ≥ ${record.load})`);
      assert.ok(record.opacities.length > 0 && record.opacities.every(value => value <= 1), `${label}: never above resting opacity`);
      if (still) assert.ok(record.opacities.every(value => value === 1), `${label}: shown at once`);
      assert.ok(record.images.every(value => value === imageOpacity), `${label}: the image keeps its own dim opacity ${imageOpacity}`);
      assert.equal(await page.locator(`${section} ${shell}`).evaluate(element => getComputedStyle(element).opacity), '1', `${label}: rests at full shell opacity`);
      results.push(`${animation}${reducedMotion === 'reduce' ? '/reduced' : ''}`);
    } finally { await page.unroute(delayed); }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return results;
}

export async function sweep({ page, viewport, state, now }) {
  if (viewport.width !== 1920) return;
  const levels = await assertImageHold(page, state, {
    widgetId: 'photo', shell: '.photo-image-shell',
    setup(target, animation) {
      target.settings.widgets = Object.fromEntries(WIDGET_IDS.map(key => [key, key === 'photo']));
      target.settings.widgetGrid.placements.photo = { column: 0, row: 0, size: 'medium' };
      target.settings.appearance.animation = animation; target.settings.appearance.motionEnabled = false;
      target.photo = { available: true, id: 'synthetic', width: 320, height: 200, updatedAt: new Date(now).toISOString() };
    },
    swap(target) { const next = `delayed-${Math.random().toString(36).slice(2)}`; target.photo = { ...target.photo, id: next }; return `id=${next}`; },
  });
  return `Photo with a 1.5 s delayed new image (${levels.join(', ')}): Subtle/Lively hold the shell at 0 and fade only after the load, never above rest; Off and reduced motion show it at once`;
}
