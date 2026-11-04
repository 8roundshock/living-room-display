import { waitForNativeRender } from './native-render.mjs';
import { randomUUID } from 'node:crypto';

/** A details child has its final box before its animated clipping boundary reaches it.
 * Chromium does not expose ::details-content's transition through getAnimations.
 * Observe its actual clipping boundary, then native rendering, before clicking children. */
export async function waitForDisclosureReady(page, disclosure) {
  let timer; const key=`__lrdDisclosure_${randomUUID()}`;
  try {
    await Promise.race([
      disclosure.evaluate((element,key) => new Promise((resolve,reject) => {
        if (!element.open) throw new Error('Disclosure is not open');
        const content=[...element.children].filter(child=>child.tagName!=='SUMMARY');
        const observer=new ResizeObserver(()=>{
          if (!element.isConnected||!element.open) {observer.disconnect();reject(new Error('Disclosure changed while opening'));return;}
          const boundary=element.getBoundingClientRect().bottom;
          if(content.every(child=>child.getBoundingClientRect().bottom<=boundary+.5)){observer.disconnect();resolve();}
        });
        window[key]=()=>{observer.disconnect();resolve();};
        observer.observe(element);content.forEach(child=>observer.observe(child));
      }),key),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Disclosure did not finish opening within 5 seconds')), 5000); }),
    ]);
    await waitForNativeRender(page);
  } finally { clearTimeout(timer); await page.evaluate(key=>{window[key]?.();delete window[key];},key).catch(()=>{}); }
}
