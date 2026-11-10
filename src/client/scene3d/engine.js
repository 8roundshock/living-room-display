// The 3D scene engine (#600). Loaded lazily: nothing here, and no part of three.js, is in the
// dashboard bundle. One stage owns one canvas and one WebGL context, and gives both back on
// dispose. Read README.md in this folder before changing the kit or the contract.
import * as T from 'three';
import { createKit } from './kit/index.js';
import { renderSize } from './settings.ts';

/** Camera: 30 degree field of view looking at a world plane 9 units high at z = 0 (16 x 9 on a 16:9 screen). */
const FOV = 30, HALF_HEIGHT = 4.5, DEPTH = HALF_HEIGHT / Math.tan(FOV / 2 * Math.PI / 180);
/** Rebuild the scene when the view's shape changes by more than this, so edges stay dressed. */
const ASPECT_TOLERANCE = .02;
/** A GPU that needs longer than this for a frame, this many frames in a row, is too weak for
 * these scenes: the stage gives up and the caller shows the flat renderer. */
const SLOW_FRAME_MS = 120, SLOW_FRAMES = 10;
/** The whole scene drifts on a slow closed path, so standing objects (a wreath, a cake, a pole)
 * do not light the same pixels for weeks: world units and scene-clock seconds, about 17 and 7
 * pixels each way at 1080p over seven and five minutes. This reduces fixed patterns on an OLED
 * panel; it is not a burn-in guarantee. A frozen scene (still preview, quiet date) does not drift. */
const DRIFT = { x: .14, y: .06, periodX: 53, periodY: 37 };

/** Live stages, for tests and tools: each has stats() and measure(). Also at window.__lrdScene3d. */
export const liveStages = new Set();
if (typeof window !== 'undefined') window.__lrdScene3d = liveStages;

function disposeObjects(root) {
  root.traverse(object => {
    object.geometry?.dispose();
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

/**
 * Draw a scene into `host`. Throws if WebGL or the scene module fails; the caller falls back
 * to the flat renderer. After a successful start, a later failure calls `onFail` once.
 */
export function createStage(host, { build, overlay = null, ctx: given, look, still = false, limits, clock, allowSoftware = false, onFail = () => {} }) {
  const canvas = document.createElement('canvas'); canvas.className = 'scene3d-canvas'; canvas.setAttribute('aria-hidden', 'true');
  const frozen = still || !(look.timeScale > 0), interval = 1000 / limits.framesPerSecond;
  let renderer = null, gl = null, made = null, scene = null, camera = null, observer = null, pending = null;
  let disposed = false, raf = 0, rebuildTimer = 0, frames = 0, time = frozen ? clock.still : clock.start, lastRender = 0, builtAspect = 0, buildMs = 0, frameMs = 0, gpuMs = 0, slowRun = 0;
  const stage = { dispose, stats, measure };

  function clear() { if (scene) disposeObjects(scene); made?.dispose(); scene = null; made = null; }
  function compose() {
    const started = performance.now(); clear();
    const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
    const view = Object.freeze({ halfW: HALF_HEIGHT * aspect, halfH: HALF_HEIGHT, aspect, depth: DEPTH,
      halfWAt: z => HALF_HEIGHT * aspect * (1 - z / DEPTH), halfHAt: z => HALF_HEIGHT * (1 - z / DEPTH) });
    const ctx = Object.freeze({ ...given, palette: Object.freeze([...given.palette]), width, height });
    made = createKit(T, renderer, ctx, look, view);
    scene = new T.Scene(); scene.background = new T.Color(0); scene.environment = made.environment; scene.fog = new T.FogExp2(0, .028);
    made.lights(scene); scene.add(made.kit.stage);
    build(made.kit, ctx);
    if (overlay) overlay(made.kit, ctx);
    builtAspect = aspect; buildMs = performance.now() - started;
  }
  function fit() {
    const size = renderSize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1, limits);
    if (!size.width) return false;
    const current = renderer.getSize(new T.Vector2());
    if (current.x === size.width && current.y === size.height) return false;
    renderer.setPixelRatio(1); renderer.setSize(size.width, size.height, false);
    camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
    return true;
  }
  function draw() {
    const started = performance.now();
    made.animate(time);
    if (!frozen) made.kit.stage.position.set(Math.sin(time * 2 * Math.PI / DRIFT.periodX) * DRIFT.x, Math.sin(time * 2 * Math.PI / DRIFT.periodY) * DRIFT.y, 0);
    renderer.render(scene, camera);
    frameMs = performance.now() - started; frames += 1;
    if (frames === 1 || frames % 40 === 0) host.dataset.sceneFrames = String(frames);
  }
  function fail(error) { if (disposed) return; dispose(); try { onFail(error); } catch { /* the caller's fallback must not throw here */ } }
  function guarded(work) { try { work(); } catch (error) { fail(error); } }
  /** True when the GPU has finished the last frame. A new frame is never queued behind an unfinished one. */
  function gpuReady() {
    if (!pending) return true;
    if (gl.getSyncParameter(pending.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gpuMs = performance.now() - pending.at; gl.deleteSync(pending.sync); pending = null;
    slowRun = gpuMs > SLOW_FRAME_MS ? slowRun + 1 : 0;
    return true;
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!gpuReady()) return;
    if (slowRun >= SLOW_FRAMES && !allowSoftware) { fail(new Error('The GPU is too slow for the 3D scene')); return; }
    const elapsed = now - lastRender; if (elapsed < interval - 4) return;
    lastRender = now; time += Math.min(.1, elapsed / 1000) * look.timeScale;
    guarded(() => { draw(); if (gl.fenceSync) { pending = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), at: performance.now() }; gl.flush(); } });
  }
  function start() { if (frozen || disposed || raf || document.hidden) return; lastRender = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function onVisibility() { if (document.hidden) stop(); else start(); }
  function onResize() {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    guarded(() => {
      const resized = fit(), aspect = host.clientWidth / host.clientHeight;
      if (Math.abs(aspect - builtAspect) / builtAspect > ASPECT_TOLERANCE) {
        clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => guarded(() => { if (disposed) return; compose(); draw(); }), 200);
      }
      if (resized) draw();
    });
  }
  function onLost(event) { event.preventDefault(); fail(new Error('WebGL context lost')); }

  function dispose() {
    if (disposed) return; disposed = true;
    stop(); clearTimeout(rebuildTimer); observer?.disconnect(); document.removeEventListener('visibilitychange', onVisibility); canvas.removeEventListener('webglcontextlost', onLost);
    try { clear(); } catch { /* releasing must not throw */ }
    // Give the context back at once: browsers keep only a few alive per page.
    try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* already lost */ }
    canvas.remove(); delete host.dataset.sceneFrames; delete host.dataset.sceneState; liveStages.delete(stage);
  }
  function stats() {
    const size = renderer && !disposed ? renderer.getSize(new T.Vector2()) : { x: 0, y: 0 }, info = renderer?.info;
    return { frames, running: raf !== 0, frozen, disposed, time, buildMs, frameMs, gpuMs, backing: [size.x, size.y], triangles: info?.render.triangles ?? 0, calls: info?.render.calls ?? 0, geometries: info?.memory.geometries ?? 0, textures: info?.memory.textures ?? 0 };
  }
  /** Developer measurement: draw `count` frames back to back. `script` is the main-thread time per
   * frame (ticks and draw submission); `finished` adds waiting for the GPU to complete the frame. */
  function measure(count = 30) {
    if (disposed) return null;
    const pixel = new Uint8Array(4); let script = 0, finished = 0;
    for (let i = 0; i < count; i++) {
      const started = performance.now(); time += look.timeScale / limits.framesPerSecond; made.animate(time); renderer.render(scene, camera);
      const submitted = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      script += submitted - started; finished += performance.now() - started;
    }
    return { ...stats(), script: script / count, finished: finished / count };
  }

  try {
    if (!host.clientWidth || !host.clientHeight) throw new Error('The scene host has no size');
    // A software rasteriser is refused (see webgl.ts) unless a source check asked for it.
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default', failIfMajorPerformanceCaveat: !allowSoftware });
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    gl = renderer.getContext();
    camera = new T.PerspectiveCamera(FOV, 16 / 9, .1, 120); camera.position.set(0, 0, DEPTH);
    fit(); compose();
    // Attached before the first draw so the browser presents that frame; a still scene draws no other.
    host.append(canvas); draw();
  } catch (error) { dispose(); throw error; }

  host.dataset.sceneState = 'ready'; liveStages.add(stage);
  canvas.addEventListener('webglcontextlost', onLost);
  observer = new ResizeObserver(onResize); observer.observe(host);
  document.addEventListener('visibilitychange', onVisibility);
  start();
  return stage;
}
