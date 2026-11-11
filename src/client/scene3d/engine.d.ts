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
  /** three.js material options with sRGB colours, plus `see` (0-1): the share of the see-through look this surface takes. */
  mat(options: Record<string, unknown>, env?: number, physical?: boolean): any;
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
  snow(count: number, options?: { size?: number; opacity?: number; colour?: Colour; salt?: number }): Object3D;
  leaf(tint: Colour, scale: number, variant?: number): Object3D;
  readonly LEAF_TINTS: readonly number[];
  readonly MAPLE_OUTLINE: readonly (readonly [number, number])[];
  flagCloth(texture: any, options?: { width?: number; height?: number; fly?: 1 | -1; wave?: number; see?: number }): Object3D;
  fireworks(bursts: readonly (readonly [number, number, number, number])[], options?: { per?: number; size?: number; tints?: readonly (readonly [number, number])[]; flash?: readonly Colour[]; period?: number; life?: number }): Object3D;
  balloon(colour: Colour, radius: number, options?: { skin?: 'latex' | 'pearl' | 'foil'; shape?: 'round' | 'star'; pattern?: readonly [Colour, 'dots' | 'stripes' | 'grid' | 'bands' | 'diamonds'] }): Object3D;
  puffyBow(colour: Colour, scale: number): Object3D;
  gift(width: number, height: number, depth: number, base: string, accent: string, kind: 'dots' | 'stripes' | 'grid' | 'bands' | 'diamonds', ribbon: Colour): Object3D;
  cake(options?: { candles?: number; tiers?: readonly (readonly [number, number, Colour, Colour])[]; sprinkles?: readonly Colour[]; candleColours?: readonly string[] }): Object3D;
  bunting(a: Vector3, b: Vector3, options?: { flags?: number; sag?: number; drop?: number; papers?: readonly (readonly [string, string, string])[]; start?: number }): Object3D;
  confetti(count: number, options?: { colours?: readonly Colour[]; size?: number }): Object3D;
  streamer(length: number, radius: number, colour: Colour, options?: { width?: number; phase?: number }): Object3D;
}

/** The default export of every file under scenes/ and weather/. */
export type SceneBuilder = (kit: SceneKit, ctx: SceneContext) => void;

export interface StageLook { glow: number; shine: number; seeThrough: number; timeScale: number }
export interface StageOptions {
  build: SceneBuilder;
  overlay?: SceneBuilder | null;
  ctx: Omit<SceneContext, 'width' | 'height'>;
  look: StageLook;
  /** One static frame and no loop (editor still previews). */
  still?: boolean;
  limits: { maxWidth: number; maxHeight: number; framesPerSecond: number };
  clock: { start: number; still: number };
  /** Source checks only: accept a software rasteriser and never give up for being slow. */
  allowSoftware?: boolean;
  /** Called once if the stage fails after it started (lost context, a throwing tick, a GPU that is too slow). */
  onFail?: (error: unknown) => void;
}
/** frameMs is main-thread time of the last frame; gpuMs is how long the GPU took to finish it (to the nearest animation frame). */
export interface StageStats { frames: number; running: boolean; frozen: boolean; disposed: boolean; time: number; buildMs: number; frameMs: number; gpuMs: number; backing: [number, number]; triangles: number; calls: number; geometries: number; textures: number }
export interface Stage {
  dispose(): void;
  stats(): StageStats;
  measure(count?: number): (StageStats & { script: number; finished: number }) | null;
}
/** Throws when WebGL or the scene module fails; the caller falls back to the flat renderer. */
export function createStage(host: HTMLElement, options: StageOptions): Stage;
export const liveStages: Set<Stage>;
