import assert from 'node:assert/strict';

export const id = 'weather';
export const selectors = ['.weather-context', '.weather-age', '.weather-credit', '.weather-hint', '.rain-timing', '.rain-detail', '.rain-confidence', '.rain-bars'];
export async function family({ widget, size, density }) {
  // The condition glyph is the shared WeatherGlyph, marked as the widget's hero symbol and sized by CSS (#128).
  assert.equal(await widget.locator('.weather-symbol[data-glyph-hero]').count(), 1, `${size}/${density} hero glyph`);
  assert.doesNotMatch(await widget.locator('.weather-symbol').getAttribute('style') ?? '', /width/, `${size}/${density} glyph has no inline size`);
  // The synthetic fixture rains every hour, so Weather is elevated with rain timing (#74).
  assert.equal(await widget.locator('.weather-body').getAttribute('data-weather-mode'), 'elevated', `${size}/${density} elevated`);
  assert.match(await widget.locator('.rain-timing').innerText(), /^Rain likely/);
  if (size !== 'small') assert.match(await widget.innerText(), /mm rain/);
  assert.equal(await widget.locator('.rain-bars').count(), size === 'large' ? 1 : 0);
  if (size === 'large') assert.ok((await widget.locator('.rain-bars').boundingBox()).height >= (await widget.boundingBox()).height * 0.1, 'the rain chart retains real height');
  // The chart's accessible name summarises its hours and peak (#166).
  if (size === 'large') assert.match(await widget.locator('.rain-bars[role=img]').getAttribute('aria-label'), /^Hourly precipitation chance, \d.* to \d.*: peak \d+% at \d/);
}
