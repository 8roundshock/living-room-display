import assert from 'node:assert/strict';

export const id = 'forecast';
export const selectors = ['.forecast-strip'];
export async function family({ widget, size }) {
  assert.equal(await widget.locator('.forecast-day').count(), size === 'small' ? 3 : size === 'medium' ? 5 : 7);
  assert.equal(await widget.locator('.forecast-day > .weather-glyph[data-glyph]').count(), size === 'small' ? 3 : size === 'medium' ? 5 : 7, 'day glyphs use WeatherGlyph');
}
