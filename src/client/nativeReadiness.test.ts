import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NATIVE_READY_TITLE, NATIVE_STARTING_TITLE, prepareNativeDisplay } from './nativeReadiness.ts';

function fixture() {
  let resolveFonts!: () => void;
  const fontsReady = new Promise<void>(resolve => { resolveFonts = resolve; });
  const frames = new Map<number, () => void>();
  let id = 0, mounted = true, revealed = false, title = '';
  const stop = (hasState = true) => prepareNativeDisplay({
    fontsReady, requestFrame: callback => { frames.set(++id, callback); return id; },
    cancelFrame: value => { frames.delete(value); }, boardMounted: () => mounted,
    loading: () => { title = NATIVE_STARTING_TITLE; revealed = false; },
    reveal: () => { revealed = true; }, ready: () => { title = NATIVE_READY_TITLE; },
  }, hasState);
  const frame = () => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
  return { stop, frame, resolveFonts, unmount: () => { mounted = false; },
    get title() { return title; }, get revealed() { return revealed; }, get pending() { return frames.size; } };
}

test('native content marker waits for state, fonts and a paint opportunity after uncovering', async () => {
  const value = fixture(); value.stop();
  assert.equal(value.title, NATIVE_STARTING_TITLE); assert.equal(value.pending, 0);
  value.resolveFonts(); await Promise.resolve();
  value.frame(); assert.equal(value.title, NATIVE_STARTING_TITLE); assert.equal(value.revealed, false);
  value.frame(); assert.equal(value.revealed, true); assert.equal(value.title, NATIVE_STARTING_TITLE);
  value.frame(); assert.equal(value.title, NATIVE_READY_TITLE);
});

test('loading/error and absent board never grant readiness', async () => {
  const loading = fixture(); loading.stop(false); loading.resolveFonts(); await Promise.resolve();
  assert.equal(loading.pending, 0); assert.equal(loading.title, NATIVE_STARTING_TITLE);
  const missing = fixture(); missing.stop(); missing.unmount(); missing.resolveFonts(); await Promise.resolve(); missing.frame();
  assert.equal(missing.title, NATIVE_STARTING_TITLE); assert.equal(missing.revealed, false); assert.equal(missing.pending, 0);
});

test('cancelled font and frame callbacks cannot resurrect a ready title or visible board', async () => {
  const pending = fixture(); const cancelFonts = pending.stop(); cancelFonts(); pending.resolveFonts(); await Promise.resolve();
  assert.equal(pending.pending, 0); assert.equal(pending.title, NATIVE_STARTING_TITLE);
  const revealed = fixture(); const cancelFrame = revealed.stop(); revealed.resolveFonts(); await Promise.resolve();
  revealed.frame(); revealed.frame(); assert.equal(revealed.revealed, true);
  cancelFrame(); revealed.frame(); assert.equal(revealed.revealed, false); assert.equal(revealed.title, NATIVE_STARTING_TITLE);
});

test('native and page content-ready protocol literals agree', () => {
  const policy = readFileSync(new URL('../../windows/SurfacePolicy.cs', import.meta.url), 'utf8');
  assert.ok(policy.includes(`ContentTitle = "${NATIVE_READY_TITLE.replaceAll('·', '\\u00b7')}"`));
  assert.notEqual(NATIVE_READY_TITLE, 'Still · Display', 'the legacy loading title must not be a content marker');
});
