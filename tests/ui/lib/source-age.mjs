// Owner decision, 2026-11-22 (#715): on the display, the editor canvas and the picker samples, a widget shows
// neither the name of a data provider nor, while its data is fresh, when that data was updated. Data that is not
// fresh keeps its status-tone label (Saved forecast, Saved reading, Offline, Last known, unavailable) with the age
// only there. The provider credit lives in Settings and in the widget settings hints, which these checks never read.
import assert from 'node:assert/strict';

/** Names a widget must never print: the forecast, air-quality and alert providers, and the old issuer placeholder. */
export const PROVIDER_NAME = /Open-Meteo|CAMS|Copernicus|Environment (and Climate Change )?Canada|National Weather Service|Canada and US coverage|Official weather alerts/;
/** An update age or check time, in every form `ageLabel` and the alert check time take. */
export const UPDATE_AGE = /\b\d+ (min|hr|days?) ago\b|\bjust now\b|\bUpdated\b|Not updated yet|Update time unknown|\b[Cc]hecked \d/;
/**
 * Widgets whose own content counts time: a finished timer reads "Done · 2 min ago" in Timers and in the Clock's
 * date line. That is the timer's time, not a data age, so the age check skips them; the provider check does not.
 */
export const COUNTS_TIME = new Set(['clock', 'timers']);

/** The element's text as read (no-break spaces as spaces), and every age-like text node outside a `.status-caution` element. */
export function sourceAndAge(locator) {
  return locator.evaluate((element, pattern) => {
    const age = new RegExp(pattern), plain = text => text.replace(/[  ]/g, ' ').replace(/⁠/g, '');
    const outside = [], inside = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = plain(node.textContent);
      if (!age.test(text) || !node.parentElement.checkVisibility({ visibilityProperty: true })) continue;
      (node.parentElement.closest('.status-caution') ? inside : outside).push(text.trim());
    }
    return { text: plain(element.innerText), agesOutsideStatus: outside, agesInStatus: inside };
  }, UPDATE_AGE.source);
}

/**
 * Asserts the rule for one rendered widget (or sample). `fresh: true` allows no age at all; otherwise an age may
 * appear only inside a `.status-caution` element. Returns what it read, for further assertions.
 */
export async function assertNoSourceOrFreshAge(locator, label, { fresh = true, id = null } = {}) {
  const read = await sourceAndAge(locator);
  assert.doesNotMatch(read.text, PROVIDER_NAME, `${label}: no data provider is named on the display (#715)`);
  if (id && COUNTS_TIME.has(id)) return read;
  assert.deepEqual(read.agesOutsideStatus, [], `${label}: an update age appears only with a status label, in the status tone (#715)`);
  if (fresh) assert.deepEqual(read.agesInStatus, [], `${label}: fresh data shows no update age (#715)`);
  return read;
}
