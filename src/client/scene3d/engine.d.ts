// Hand-written types for the public surface of the 3D scene engine (engine.js and kit/*.js are
// plain JavaScript modules). three@0.128 ships no types, so three.js objects are typed loosely.
// README.md in this folder is the contract; keep it, kit/index.js and this file in step.

/** A three.js object (Object3D, Mesh, Group, Sprite, Points, Line). */
export type Object3D = any;
/** A three.js Vector3. */
export type Vector3 = any;
/** An sRGB colour: 0xrrggbb or a CSS string such as '#rrggbb'. */
export type Colour = number | string;
export type WeatherKind = 'rain' | 'snow' | 'storm' | 'fog' | 'wind';

/** What a scene module is told about this showing. Frozen; never write to it. */
export interface SceneContext {
  /** Registry id of the scene being shown, for a module that serves several scenes. */
  readonly id: string;
  /** How much to put in the scene, 0-1, after the tier and quiet rules. Turn it into counts. */
  readonly amount: number;
  /** Scale of objects (radius, length), after the tier rule. Do not scale positions with it. */
  readonly size: number;
  readonly tier: 'special' | 'everyday';
  /** Weather drawn over this scene in Combined mode, or null. Any of the five kinds can be over any scene (#655). The overlay draws it; a scene may adapt. */
  readonly weather: WeatherKind | null;
  /** A selected quiet date: frozen, reduced, nothing in the air. Particle helpers return nothing. */
  readonly quiet: boolean;
  /** The scene's three registry colours (tint, companion, accent) as CSS strings; neutral greys when quiet. */
  readonly palette: readonly [string, string, string];
  /** A stable whole number for this scene id, for the module's own deterministic variation. */
  readonly seed: number;
  /** The civil day as a whole number that grows by one at local midnight, for a scene that wants
   * a slightly different arrangement each day (`rnd(i, ctx.seed + ctx.day)`). The scene is rebuilt at midnight. */
  readonly day: number;
  /** Size of the view in CSS pixels. Use kit.view for world units. */
  readonly width: number;
  readonly height: number;
}

/** The visible world at z = 0: x in [-halfW, halfW], y in [-halfH, halfH]; the camera is `depth` in front.
 * Nearer or farther than z = 0 the visible half-extents are halfWAt(z) and halfHAt(z): stand an object on
 * the bottom edge with y = -view.halfHAt(z). */
export interface SceneView { readonly halfW: number; readonly halfH: number; readonly aspect: number; readonly depth: number; halfWAt(z: number): number; halfHAt(z: number): number }

export interface NeedleCollector { readonly count: number; add(position: Vector3, direction: Vector3, length: number, r: number, g: number, b: number): void; mesh(): Object3D }

/** Everything a scene module builds with. See README.md for each helper. */
export interface SceneKit {
  /** three.js r128, complete. Scene modules import nothing. */
  readonly T: any;
  readonly ctx: SceneContext;
  readonly view: SceneView;
  /** The scene's root: add objects here (or to a part()). */
  readonly stage: Object3D;
  V(x?: number, y?: number, z?: number): Vector3;
  /** sRGB to the linear colour lit materials expect. */
  C(colour: Colour): any;
  mix(a: Colour, b: Colour, amount: number): number;
  /** Turn a colour around the colour wheel (`hue` in turns) and adjust saturation and lightness (-1 to 1). */
  shift(colour: Colour, hue: number, saturation?: number, lightness?: number): number;
  /** Deterministic value in [0, 1) for an index and a salt. */
  rnd(index: number, salt: number): number;
  /** Register a resource to dispose with the scene (textures you create yourself). */
  own<Resource>(resource: Resource): Resource;
  /** Run once per rendered frame with the scene clock in seconds (slow: see OWNER_LOOK.timeScale). */
  tick(update: (time: number) => void): void;
  part(x?: number, y?: number, scale?: number, mirror?: boolean): Object3D;
  readonly tex: { glow(): any; disc(): any; flame(): any };
  canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, options?: { srgb?: boolean; repeat?: boolean; anisotropy?: number }): any;
  patternTex(base: string, accent: string, kind: 'dots' | 'stripes' | 'grid' | 'bands' | 'diamonds'): any;
  /** three.js material options with sRGB colours, plus `see` (0-1): the share of the see-through look this surface takes,
   * and `clear`: a really see-through surface (glass, ice, water, tea), blended over what is behind it. Every other surface
   * is solid (#683): thin and dim on black, but it hides what is behind it. */
  mat(options: Record<string, unknown>, env?: number, physical?: boolean): any;
  /** How solid to draw a body the scene makes see-through itself (an alpha map's grey, a uniform, `opacity`): `body` is
   * its solidity at the owner's picks, 0-1. Follows the Transparency setting (#670): 1 at 0%, `body` at the standard 50%,
   * thinner toward 100% but never zero. On a solid surface it is how dim the body is (#683). A scene never reads the
   * setting; it passes its own values through this. */
  solidity(body: number): number;
  /** Fade a kit.mat surface as a whole (0-1) over what is behind it; a solid one is blended only while it fades. */
  fade(material: any, amount: number): void;
  gold(): any;
  satin(colour: Colour): any;
  glow(colour: Colour, size: number, opacity: number, options?: { texture?: any; twinkle?: number }): Object3D;
  bulb(colour: Colour, radius?: number, halo?: number): Object3D;
  bokeh(colour: Colour, size: number, opacity: number, twinkle?: number): Object3D;
  readonly ballGeo: any;
  readonly sphereGeo: any;
  line(points: Vector3[], colour?: Colour, opacity?: number): Object3D;
  catenary(a: Vector3, b: Vector3, sag: number, segments?: number): Vector3[];
  ribbonGeo(points: Vector3[], width: number, side: Vector3 | ((along: number) => Vector3)): any;
  needles(): NeedleCollector;
  twig(needles: NeedleCollector, a: Vector3, b: Vector3, needleLength: number, snow: number, seed: number, clumps?: number[][] | null): void;
  bough(needles: NeedleCollector, base: Vector3, direction: Vector3, length: number, droop: number, side: Vector3, needleLength: number, snow: number, seed: number, clumps?: number[][] | null, density?: number): (along: number) => Vector3;
  ornament(options?: { color?: Colour; radius?: number; thread?: number; shape?: 'ball' | 'drop' | 'onion' | 'finial' | 'facet'; finish?: 'mirror' | 'satin' | 'pearl' | 'glitter' | 'banded'; accent?: Colour }): Object3D;
  bauble(colour: Colour, radius: number, thread: number, satinFinish?: boolean): Object3D;
  /** `drift(t)`: how far the wind has carried the fall sideways (parts/wind-underneath.js `carry`, #646). */
  snow(count: number, options?: { size?: number; opacity?: number; colour?: Colour; salt?: number; drift?: ((time: number) => number) | null }): Object3D;
  leaf(tint: Colour, scale: number, variant?: number): Object3D;
  readonly LEAF_TINTS: readonly number[];
  readonly MAPLE_OUTLINE: readonly (readonly [number, number])[];
  /** `wave` may be a function of the scene clock, read once a frame (#646). */
  flagCloth(texture: any, options?: { width?: number; height?: number; fly?: 1 | -1; wave?: number | ((time: number) => number); see?: number }): Object3D;
  fireworks(bursts: readonly (readonly [number, number, number, number])[], options?: { per?: number; size?: number; tints?: readonly (readonly [number, number])[]; flash?: readonly Colour[]; period?: number; life?: number }): Object3D;
  balloon(colour: Colour, radius: number, options?: { skin?: 'latex' | 'pearl' | 'foil'; shape?: 'round' | 'star'; pattern?: readonly [Colour, 'dots' | 'stripes' | 'grid' | 'bands' | 'diamonds'] }): Object3D;
  puffyBow(colour: Colour, scale: number): Object3D;
  gift(width: number, height: number, depth: number, base: string, accent: string, kind: 'dots' | 'stripes' | 'grid' | 'bands' | 'diamonds', ribbon: Colour): Object3D;
  cake(options?: { candles?: number; tiers?: readonly (readonly [number, number, Colour, Colour])[]; sprinkles?: readonly Colour[]; candleColours?: readonly string[] }): Object3D;
  /** `weather`: the scene's parts/wind-underneath.js weatherOver(), so the flags lean and flap in the wind (#646). */
  bunting(a: Vector3, b: Vector3, options?: { weather?: unknown; flags?: number; sag?: number; drop?: number; papers?: readonly (readonly [string, string, string])[]; start?: number }): Object3D;
  confetti(count: number, options?: { colours?: readonly Colour[]; size?: number }): Object3D;
  streamer(length: number, radius: number, colour: Colour, options?: { width?: number; phase?: number }): Object3D;
}

/** The default export of every file under scenes/ and weather/. */
export type SceneBuilder = (kit: SceneKit, ctx: SceneContext) => void;

/** `seeScale` is the Transparency setting as a multiplier (settings.ts seeScale): 0 solid, 1 the owner's picks
 * (the default when it is left out), 2 the most see-through. */
export interface StageLook { glow: number; shine: number; seeThrough: number; timeScale: number; seeScale?: number }
export interface StageOptions {
  build: SceneBuilder;
  overlay?: SceneBuilder | null;
  ctx: Omit<SceneContext, 'width' | 'height'>;
  look: StageLook;
  /** One static frame and no loop (editor still previews). A still stage does not float. */
  still?: boolean;
  /** The float (#675): the board's motion interval in seconds, and whether the picture eases between
   * waypoints (Float gently on, motion allowed) or steps once per interval. Null or absent: no float. */
  float?: { interval: number; gentle: boolean } | null;
  /** The editor's movement-preview time in seconds when the stage is made while one is shown (#678); null or absent: real time. */
  preview?: number | null;
  limits: { maxWidth: number; maxHeight: number; framesPerSecond: number };
  clock: { start: number; still: number };
  /** Source checks only: accept a software rasteriser and never give up for being slow. */
  allowSoftware?: boolean;
  /** Called once if the stage fails after it started (lost context, a throwing tick, a GPU that is too slow). */
  onFail?: (error: unknown) => void;
}
/** frameMs is main-thread time of the last frame; gpuMs is how long the GPU took to finish it (to the nearest animation frame).
 * builds counts how often the scene was built (once at start, again after a resize or a retune); seeScale is the look's
 * current one; geometries, textures and programs are what the renderer holds on the GPU. `frozen`: the scene's own clock
 * is stopped (a still preview or a quiet date); `floating`: the frame loop or the float's low-rate timer is live; `float`
 * is the last drawn offset in normalised device coordinates (the frame is -1 to 1), `zoom` the overscan, and
 * `floatFrames` how many frames the float alone has drawn on a frozen stage. `floatSample` is the real clock (seconds since
 * the epoch) and the track's time at the last floated frame, and whether that time was the movement preview's (#678), null
 * before one (for tests and tools). `preview` is the movement-preview time the stage follows, null on real time; `time` is
 * the scene clock. `surfaces` counts the scene's kit.mat surfaces that are solid and clear (#683). */
export interface StageStats { frames: number; builds: number; running: boolean; frozen: boolean; floating: boolean; disposed: boolean; time: number; preview: number | null; buildMs: number; frameMs: number; gpuMs: number; seeScale: number; float: { x: number; y: number }; floatSample: { real: number; seconds: number; preview: boolean } | null; zoom: number; floatFrames: number; surfaces: { solid: number; clear: number }; backing: [number, number]; triangles: number; calls: number; geometries: number; textures: number; programs: number }
export interface Stage {
  dispose(): void;
  stats(): StageStats;
  measure(count?: number): (StageStats & { script: number; finished: number }) | null;
  /** A new look for the same scene (the Transparency setting, #670). The scene is built again 250 ms after the
   * last call, in the same canvas and WebGL context, and drawn at once. A call that changes nothing does nothing. */
  retune(changes: Pick<StageLook, 'seeScale'>): void;
  /** New float settings (#675); a new interval keeps the current position. A still stage ignores them. */
  setFloat(float: { interval: number; gentle: boolean }): void;
  /** The editor's movement-preview time in seconds (#678), or null to return to real time. The float reads it as its track
   * time and a running scene clock as `clock.start + seconds × timeScale`; a held time draws nothing new. On return the float
   * reads real time at once and the scene clock carries on from the preview's. A still stage ignores it; nothing is rebuilt. */
  setPreview(seconds: number | null): void;
  /** For tools and tests: pin the float at a track position in [-1, 1]² (null resumes the float) and draw. */
  holdFloat(unit: { x: number; y: number } | null): void;
}
/** Throws when WebGL or the scene module fails; the caller falls back to the flat renderer. */
export function createStage(host: HTMLElement, options: StageOptions): Stage;
/** A stage's scene clock and float track time, and how the movement preview drives them (#678). Exported for tests. */
export interface StageClock { readonly time: number; readonly preview: number | null; advance(seconds: number): void; follow(seconds: number | null | undefined): void; track(real: number, origin: number): number }
export function stageClock(options: { frozen: boolean; start: number; still: number; timeScale: number }): StageClock;
export const liveStages: Set<Stage>;
