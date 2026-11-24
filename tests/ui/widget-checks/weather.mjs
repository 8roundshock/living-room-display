import assert from 'node:assert/strict';

export const id = 'weather';
export const selectors = ['.weather-context', '.weather-age', '.weather-hint', '.rain-timing', '.rain-detail', '.rain-confidence', '.rain-bars'];
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
  // The axis Air quality's chart shares (#261): “Now” under the bar covering now.
  if (size === 'large') assert.equal(await widget.locator('.rain-hours .value-transition').first().innerText(), 'Now');
  // #715: fresh weather has no age line and no credit; rain keeps its confidence wording (small only when it is not the plain estimate).
  assert.equal(await widget.locator('.weather-age, .weather-credit').count(), 0, `${size}/${density} fresh: no age and no credit`);
  if (size === 'small') assert.equal(await widget.locator('.weather-footer').count(), 0, 'small fresh: no footer at all');
  else assert.equal((await widget.locator('.weather-footer').innerText()).trim(), 'Forecast estimate', `${size}/${density} fresh: the footer is the rain confidence alone`);
}
