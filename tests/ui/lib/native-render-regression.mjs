import assert from 'node:assert/strict';
import { waitForNativeRender } from './native-render.mjs';

/** Deliberately hold native observer delivery while virtual frames advance. */
export async function verifyNativeRenderBarrier(browser, wait = waitForNativeRender) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let pending;
  try {
    await page.clock.install();
    await page.setContent('<button style="position:fixed;top:40px;height:40px">Done</button><div id="alert" style="position:fixed;top:40px;height:40px">Synthetic alert</div>');
    await page.evaluate(() => {
      const NativeObserver = ResizeObserver;
      window.__nativeRenderReady = new Promise(resolve => { window.__resolveRenderReady = resolve; });
      window.ResizeObserver = class {
        constructor(callback) { this.observer = new NativeObserver(entries => {
          window.__releaseRender = () => { document.querySelector('#alert').style.top = '100px'; callback(entries, this); };
          window.__resolveRenderReady();
        }); }
        observe(element) { this.observer.observe(element); }
        disconnect() { this.observer.disconnect(); }
      };
    });
    let settled = false;
    pending = wait(page).then(() => { settled = true; });
    await page.clock.runFor(32);
    assert.equal(settled, false, 'virtual frames cannot finish a native rendering barrier before held delivery');
    await page.evaluate(() => window.__nativeRenderReady);
    await page.evaluate(() => window.__releaseRender());
    await pending;
    const geometry = await page.evaluate(() => ({ control: document.querySelector('button').getBoundingClientRect().bottom, alert: document.querySelector('#alert').getBoundingClientRect().top }));
    assert.ok(geometry.control <= geometry.alert, 'the strict geometry assertion reads the delivered layout');
  } finally {
    await page.evaluate(() => window.__releaseRender?.()).catch(() => {});
    await context.close();
    await pending?.catch(() => {});
  }
}
