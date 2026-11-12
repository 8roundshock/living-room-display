// The 3D scene engine (#600). Loaded lazily: nothing here, and no part of three.js, is in the
// dashboard bundle. One stage owns one canvas and one WebGL context, and gives both back on
// dispose. Read README.md in this folder before changing the kit or the contract.
import * as T from 'three';
import { createKit } from './kit/index.js';
import { CAMERA, floatOffset, renderSize, SCENE_FLOAT } from './settings.ts';
import { SCENE_TRACK, trackPosition } from '../../shared/float.ts';

/** Camera: 30 degree field of view looking at a world plane 9 units high at z = 0 (16 x 9 on a 16:9 screen). */
const FOV = CAMERA.fov, HALF_HEIGHT = CAMERA.halfHeight, DEPTH = HALF_HEIGHT / Math.tan(FOV / 2 * Math.PI / 180);
/** Rebuild the scene when the view's shape changes by more than this, so edges stay dressed. */
const ASPECT_TOLERANCE = .02;
/** A new Transparency (#670) is built this long after the last change, so dragging the slider
 * rebuilds once when it rests, in the same canvas and context, and not once per step. */
const RETUNE_DELAY_MS = 250;
/** A GPU that needs longer than this for a frame, this many frames in a row, is too weak for
 * these scenes: the stage gives up and the caller shows the flat renderer. */
const SLOW_FRAME_MS = 120, SLOW_FRAMES = 10;
/** A scene whose own clock is stopped (a quiet date) still floats (#675). It is checked this often and
 * drawn again only when the float has moved it by this many pixels of the canvas (or at a step). */
const FLOAT_CHECK_MS = 250, FLOAT_MIN_PIXELS = .5;
/** The float's clock: real seconds since the epoch, the same for every stage, so a scene that is
 * rebuilt or replaced carries on from where the float was instead of starting over. */
const floatClock = () => (performance.timeOrigin + performance.now()) / 1000;
/** The float's origin for each motion interval, shared by every stage on the page (the epoch until the
 * interval changes). setFloat sets the new interval's origin so the position stays where it is, and a
 * stage made after that (a rebuild at midnight, weather arriving, a quiet date beginning) reads the same
 * origin and carries on instead of jumping. Two stages at different intervals never disturb each other. */
const floatOrigins = new Map();
const originOf = interval => floatOrigins.get(interval) ?? 0;

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
export function createStage(host, { build, overlay = null, ctx: given, look: initialLook, still = false, float: initialFloat = null, limits, clock, allowSoftware = false, onFail = () => {} }) {
  const canvas = document.createElement('canvas'); canvas.className = 'scene3d-canvas'; canvas.setAttribute('aria-hidden', 'true');
  let look = { seeScale: 1, ...initialLook };
  const frozen = still || !(look.timeScale > 0), interval = 1000 / limits.framesPerSecond;
  // The float (#675): `float` is { interval, gentle } (the motion interval in seconds, and Float gently
  // on with motion allowed), or null for a still preview, which stays at the centre. `held` pins a
  // position for tools.
  let float = still ? null : initialFloat, held = null, shown = { x: 0, y: 0 }, floatTimer = 0, floatFrames = 0, floatSample = null;
  const zoomMatrix = new T.Matrix4();
  let renderer = null, gl = null, made = null, scene = null, camera = null, observer = null, pending = null, retired = null;
  let disposed = false, raf = 0, rebuildTimer = 0, retuneTimer = 0, frames = 0, builds = 0, time = frozen ? clock.still : clock.start, lastRender = 0, builtAspect = 0, buildMs = 0, frameMs = 0, gpuMs = 0, slowRun = 0;
  const stage = { dispose, stats, measure, retune, setFloat, holdFloat };

  function release(old) { if (old.scene) disposeObjects(old.scene); old.made?.dispose(); }
  function clear() { if (retired) release(retired); retired = null; release({ scene, made }); scene = null; made = null; }
  /** Builds the scene afresh. The scene it replaces is released only after the new one has been drawn
   * once (draw()), so the shader programs both use stay compiled instead of being dropped and rebuilt. */
  function compose() {
    const started = performance.now();
    if (retired) release(retired);
    retired = scene || made ? { scene, made } : null; scene = null; made = null;
    const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
    const view = Object.freeze({ halfW: HALF_HEIGHT * aspect, halfH: HALF_HEIGHT, aspect, depth: DEPTH,
      halfWAt: z => HALF_HEIGHT * aspect * (1 - z / DEPTH), halfHAt: z => HALF_HEIGHT * (1 - z / DEPTH) });
    const ctx = Object.freeze({ ...given, palette: Object.freeze([...given.palette]), width, height });
    made = createKit(T, renderer, ctx, look, view);
    scene = new T.Scene(); scene.background = new T.Color(0); scene.environment = made.environment; scene.fog = new T.FogExp2(0, .028);
    made.lights(scene); scene.add(made.kit.stage);
    build(made.kit, ctx);
    if (overlay) overlay(made.kit, ctx);
    builtAspect = aspect; buildMs = performance.now() - started; builds += 1;
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
  /** Where the float puts the picture now, in normalised device coordinates, and the clocks it was read at. */
  function floatTarget() {
    if (held) return { offset: floatOffset(held), sample: null };
    if (!float) return { offset: { x: 0, y: 0 }, sample: null };
    const real = floatClock(), seconds = real - originOf(float.interval);
    return { offset: floatOffset(trackPosition(seconds, float.interval, float.gentle, SCENE_TRACK)), sample: { real, seconds } };
  }
  /** The camera's projection, then the float: the picture is zoomed about the screen's centre and moved,
   * every pixel alike, as the board is (a projection change, so depth and parallax are untouched). */
  function frame({ offset, sample }) {
    camera.updateProjectionMatrix();
    zoomMatrix.set(SCENE_FLOAT.zoom, 0, 0, offset.x, 0, SCENE_FLOAT.zoom, 0, offset.y, 0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.premultiply(zoomMatrix); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    shown = offset; floatSample = sample;
  }
  function draw() {
    const started = performance.now();
    made.animate(time); frame(floatTarget());
    renderer.render(scene, camera);
    if (retired) { release(retired); retired = null; }
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
  /** A scene with its clock stopped (a quiet date) is drawn again only when the float has moved it:
   * at most four checks a second while it eases, one wake at each step without Float gently. */
  function floatLoop() {
    floatTimer = 0;
    if (disposed || document.hidden || !frozen || !(float || held)) return;
    const next = floatTarget().offset, size = renderer.getSize(new T.Vector2());
    if (Math.abs(next.x - shown.x) * size.x / 2 >= FLOAT_MIN_PIXELS || Math.abs(next.y - shown.y) * size.y / 2 >= FLOAT_MIN_PIXELS) { guarded(draw); floatFrames += 1; }
    if (disposed || !float || held) return;
    const seconds = floatClock() - originOf(float.interval), boundary = (Math.floor(seconds / float.interval + SCENE_TRACK.phase) + 1 - SCENE_TRACK.phase) * float.interval;
    floatTimer = setTimeout(floatLoop, float.gentle ? FLOAT_CHECK_MS : Math.max(FLOAT_CHECK_MS, (boundary - seconds) * 1000 + 5));
  }
  function start() {
    if (disposed || document.hidden) return;
    if (frozen) { if (!floatTimer && float) floatTimer = setTimeout(floatLoop, FLOAT_CHECK_MS); return; }
    if (raf) return; lastRender = performance.now(); raf = requestAnimationFrame(loop);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; clearTimeout(floatTimer); floatTimer = 0; }
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
  /** A new look for the same scene (#670: `seeScale`, the Transparency setting). The scene is built
   * again RETUNE_DELAY_MS after the last call, in this canvas and context, and drawn at once; a still
   * or frozen stage shows the new frame, a running one carries on from the same scene clock. */
  function retune(changes) {
    if (disposed) return;
    const next = { ...look, ...changes };
    if (Object.keys(changes).every(key => Object.is(next[key], look[key]))) return;
    look = next; clearTimeout(retuneTimer);
    retuneTimer = setTimeout(() => guarded(() => { if (disposed) return; compose(); draw(); }), RETUNE_DELAY_MS);
  }
  /** New float settings (#675): the motion interval and whether to ease (Float gently on, motion allowed)
   * or step. A still stage ignores them. A new interval keeps the current position. */
  function setFloat(next) {
    if (disposed || still || !next) return;
    if (float && next.interval === float.interval && next.gentle === float.gentle) return;
    if (float && next.interval !== float.interval) { const now = floatClock(); floatOrigins.set(next.interval, now - (now - originOf(float.interval)) * next.interval / float.interval); }
    float = { interval: next.interval, gentle: next.gentle };
    if (frozen) { stop(); start(); }
  }
  /** For tools and tests: pin the float at a track position in [-1, 1]² (null resumes it) and draw. */
  function holdFloat(unit) {
    if (disposed) return;
    held = unit ? { x: Math.max(-1, Math.min(1, unit.x)), y: Math.max(-1, Math.min(1, unit.y)) } : null;
    guarded(draw); if (frozen) { stop(); start(); }
  }

  function dispose() {
    if (disposed) return; disposed = true;
    stop(); clearTimeout(rebuildTimer); clearTimeout(retuneTimer); clearTimeout(floatTimer); observer?.disconnect(); document.removeEventListener('visibilitychange', onVisibility); canvas.removeEventListener('webglcontextlost', onLost);
    try { clear(); } catch { /* releasing must not throw */ }
    // Give the context back at once: browsers keep only a few alive per page.
    try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* already lost */ }
    canvas.remove(); delete host.dataset.sceneFrames; delete host.dataset.sceneState; liveStages.delete(stage);
  }
  function stats() {
    const size = renderer && !disposed ? renderer.getSize(new T.Vector2()) : { x: 0, y: 0 }, info = renderer?.info;
    return { frames, builds, running: raf !== 0, frozen, disposed, time, buildMs, frameMs, gpuMs, seeScale: look.seeScale,
      floating: !disposed && (raf !== 0 || floatTimer !== 0), float: { ...shown }, floatSample, zoom: SCENE_FLOAT.zoom, floatFrames, surfaces: made?.surfaces() ?? { solid: 0, clear: 0 }, backing: [size.x, size.y], triangles: info?.render.triangles ?? 0, calls: info?.render.calls ?? 0, geometries: info?.memory.geometries ?? 0, textures: info?.memory.textures ?? 0, programs: info?.programs?.length ?? 0 };
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
