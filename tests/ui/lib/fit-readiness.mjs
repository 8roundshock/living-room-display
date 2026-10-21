import { randomUUID } from 'node:crypto';

/**
 * #431: fake-clock ticks do not deliver ResizeObserver or React's subsequent fit update.
 * Wait for fonts and three matching layout samples on real rendering turns, without
 * asking for a particular fit: a stable but incorrect scale must still fail its assertion.
 * A newly observed element gets a native ResizeObserver delivery even with a paused page
 * clock. Re-observe from a MessageChannel task so each sample gets another rendering turn.
 */
export async function waitForWidgetFit(page, selector, { label = selector, timeout = 90_000 } = {}) {
  const widget = page.locator(selector);
  await widget.waitFor({ timeout });
  const key = `__lrdFitReadiness_${randomUUID()}`;
  let timer;
  try {
    await Promise.race([
      widget.evaluate(async (element, key) => {
        let observer, channel, finish;
        const state = { last: null, cancelled: false, cancel: () => { state.cancelled = true; finish?.(); } };
        window[key] = state;
        await document.fonts.ready;
        if (state.cancelled) return;
        return new Promise((resolve, reject) => {
          let previous = '', stable = 0;
          finish = error => {
            observer?.disconnect();
            channel?.port1.close(); channel?.port2.close();
            if (error) reject(error); else resolve();
          };
          const sample = () => {
            const content = element.querySelector('.widget-content');
            if (!element.isConnected || !content) { state.last = { connected: element.isConnected, content: Boolean(content) }; finish(new Error('Widget disappeared before its fit settled')); return; }
            const note = element.querySelector('.note-face');
            const text = element.querySelector('.note-text');
            const facts = {
              box: [element.clientWidth, element.clientHeight],
              content: [content.offsetWidth, content.offsetHeight, content.scrollWidth, content.scrollHeight],
              width: content.style.width,
              transform: getComputedStyle(content).transform,
              noteSize: note?.style.getPropertyValue('--note-size') ?? null,
              noteText: text ? [text.offsetWidth, text.offsetHeight, getComputedStyle(text).fontSize] : null,
            };
            state.last = facts;
            const signature = JSON.stringify(facts);
            // Note must have applied its measured font size, not merely mounted at its CSS cap.
            const measured = !note || Boolean(facts.noteSize);
            stable = measured && signature === previous ? stable + 1 : 0;
            previous = signature;
            observer.disconnect();
            if (stable >= 2) { finish(); return; }
            channel = new MessageChannel();
            channel.port1.onmessage = () => {
              channel.port1.close(); channel.port2.close(); channel = null;
              observer.observe(element);
            };
            channel.port2.postMessage(null);
          };
          observer = new ResizeObserver(sample);
          observer.observe(element);
        });
      }, key),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: widget fit did not settle within ${timeout} ms`)), timeout); }),
    ]);
  } catch (error) {
    const last = await page.evaluate(key => window[key]?.last ?? null, key).catch(() => null);
    throw new Error(`${error.message}; last layout: ${JSON.stringify(last)}`, { cause: error });
  } finally {
    clearTimeout(timer);
    await page.evaluate(key => { window[key]?.cancel(); delete window[key]; }, key).catch(() => {});
  }
}
