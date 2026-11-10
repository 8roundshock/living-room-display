/** Whether this browser can give the page a hardware WebGL context right now.
 *
 * A software rasteriser (no GPU, a blocked driver, some remote sessions) is refused: it would
 * draw these scenes on the processor at about a frame a second and starve the dashboard. Such
 * a machine gets the flat renderer. The probe context is released at once. A success is
 * remembered; a failure is asked again after a minute, because a display page runs for weeks
 * and a GPU can be unavailable only briefly. Never throws. */
const RETRY_MS = 60_000;
let available = false, failedAt = Number.NEGATIVE_INFINITY;

/** Source checks on a machine without a GPU (the CI runner) set this before the page loads, to
 * exercise the real 3D path on a software rasteriser. Nothing in the app sets it. */
export function softwareAllowed(): boolean {
  return (globalThis as { __lrdScene3dAllowSoftware?: boolean }).__lrdScene3dAllowSoftware === true;
}

/** Names browsers report for a processor-drawn WebGL: SwiftShader, Mesa llvmpipe/softpipe, Microsoft Basic Render Driver (WARP). */
export function softwareRendererName(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

export function webglAvailable(now = performance.now()): boolean {
  if (available) return true;
  if (now - failedAt < RETRY_MS) return false;
  try {
    const canvas = document.createElement('canvas'), software = softwareAllowed(), attributes: WebGLContextAttributes = { failIfMajorPerformanceCaveat: !software };
    const context: WebGL2RenderingContext | WebGLRenderingContext | null = canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes);
    const info = context?.getExtension('WEBGL_debug_renderer_info');
    // The browser's own caveat flag misses a rasteriser chosen on the command line, so the name is checked too.
    const name = context ? String(context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER) ?? '') : '';
    available = context !== null && (software || !softwareRendererName(name));
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { available = false; }
  if (!available) failedAt = now;
  return available;
}
