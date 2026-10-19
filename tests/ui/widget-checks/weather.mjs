import assert from 'node:assert/strict';

export const id = 'weather';
export const selectors = ['.weather-context', '.weather-age', '.weather-credit'];
export async function family({ widget, size, density }) {
  // The condition glyph is the shared WeatherGlyph, marked as the widget's hero symbol.
  assert.equal(await widget.locator('.weather-symbol[data-glyph-hero]').count(), 1, `${size}/${density} hero glyph`);
}
