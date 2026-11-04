import assert from 'node:assert/strict';
import { waitForDisclosureReady } from './disclosure-readiness.mjs';
import { waitForNativeRender } from './native-render.mjs';

/** A held pseudo-element clipping boundary must not be mistaken for a stable child's box. */
export async function verifyDisclosureBarrier(browser, wait = waitForDisclosureReady) {
  const context = await browser.newContext(); const page = await context.newPage(); let pending;
  try {
    await page.clock.install();
    await page.setContent('<!doctype html><style>details{interpolate-size:allow-keywords}details::details-content{height:0;overflow:clip;transition:height .2s linear,content-visibility .2s allow-discrete}details[open]::details-content{height:auto}details.held::details-content{height:0!important}.body{height:300px}</style><details class="held"><summary>Motion</summary><div class="body"><button>Swap places</button></div></details>');
    await waitForNativeRender(page);
    await page.evaluate(() => {
      const detail=document.querySelector('details');detail.open=true;
      window.releaseDisclosure=()=>detail.classList.remove('held');
    });
    let settled=false; pending=wait(page,page.locator('details')).then(()=>{settled=true;});
    await page.clock.runFor(500);
    assert.equal(settled,false,'stable child geometry and virtual frames cannot complete a held disclosure clipping boundary');
    await page.evaluate(()=>window.releaseDisclosure()); await pending;
    assert.ok(await page.locator('details').evaluate(element=>element.getBoundingClientRect().bottom>=element.querySelector('.body').getBoundingClientRect().bottom-.5));
  } finally {
    await page.evaluate(()=>window.releaseDisclosure?.()).catch(()=>{});
    await pending?.catch(()=>{}); await context.close();
  }
}
