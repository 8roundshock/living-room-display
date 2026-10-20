// Retired style hooks stay retired: no client stylesheet, including the per-widget sheets in
// src/client/widgets/, styles a class or token that no component renders any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
/** Every .css file under src/client, recursively. */
function stylesheets(directory = root): { name: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? stylesheets(join(directory, entry.name))
    : entry.name.endsWith('.css') ? [{ name: join(directory, entry.name).slice(root.length), text: readFileSync(join(directory, entry.name), 'utf8') }] : []);
}

test('the client stylesheets include the per-widget sheets', () => {
  const names = stylesheets().map(sheet => sheet.name.replaceAll('\\', '/'));
  assert.ok(names.includes('styles.css') && names.includes('widgets/calendar.css'), names.join(', '));
});

test('no retired layout, preview or offline style remains in any client stylesheet (#276, #133)', () => {
  // The pre-grid layouts (#43) left `appearance.layout` as retained data only; nothing renders a layout-* class.
  // The pre-grid Last screen description rule clamped the grid placeholder to one word per line (#276).
  for (const { name, text } of stylesheets()) {
    assert.doesNotMatch(text, /layout-minimal|layout-weather-first/, `${name}: legacy layout rule`);
    assert.doesNotMatch(text, /\.ambient-preview\s+\.ambient-description/, `${name}: pre-grid Last screen description rule`);
    assert.doesNotMatch(text, /--ambient-offline|display-disconnected/, `${name}: unused offline status style`);
  }
});

test('Classic numerals stay lining wherever a rule sets its own figures (#363)', () => {
  // font-variant-numeric replaces the inherited value, so a rule that sets only tabular-nums would bring
  // Georgia's old-style figures back under .font-serif. Editor chrome never uses the Classic typeface.
  const editorOnly = new Set(['freesize.css', 'grid-editor.css']);
  let checked = 0;
  for (const { name, text } of stylesheets()) {
    if (editorOnly.has(name.replaceAll('\\', '/'))) continue;
    for (const [, selector, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const value = body.match(/font-variant-numeric:\s*([^;]+)/)?.[1];
      // Studio controls and World clocks' settings list (.world-clock-now) are editor chrome too.
      if (!value || /\.studio|world-clock-now/.test(selector!)) continue;
      checked++;
      assert.match(value, /lining-nums/, `${name}: ${selector!.trim()} { font-variant-numeric: ${value} }`);
    }
  }
  assert.ok(checked >= 8, `${checked} ambient rules set their own figures`);
});
