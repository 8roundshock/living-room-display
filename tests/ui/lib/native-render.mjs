import { randomUUID } from 'node:crypto';

/** Fake-clock frames do not deliver native scroll/render work. A fresh ResizeObserver
 * gets its initial delivery on a browser rendering turn, including with a paused clock. */
export async function waitForNativeRender(page) {
  const key = `__lrdNativeRender_${randomUUID()}`;
  let timer;
  try {
    await Promise.race([
      page.evaluate(key => new Promise(resolve => {
        const observer = new ResizeObserver(() => { observer.disconnect(); resolve(); });
        window[key] = () => { observer.disconnect(); resolve(); };
        observer.observe(document.documentElement);
      }), key),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native rendering turn was not delivered within 30000 ms')), 30_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await page.evaluate(key => { window[key]?.(); delete window[key]; }, key).catch(() => {});
  }
}
