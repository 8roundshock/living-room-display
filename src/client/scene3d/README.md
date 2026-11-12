# 3D scenes

The living scenes behind the widgets, drawn as lit 3D objects in WebGL (#600, owner decision
2026-11-10). This folder is the engine, the kit that scenes are built from, and one file per
scene. The product rules are in [Ambient themes](../../../docs/ambient-themes.md#3d-scenes-600-owner-decision-2026-11-10);
this file is the contract for whoever adds or changes a scene.

A scene that has no file here yet, a browser without hardware WebGL and a stage that fails are
all drawn by the flat SVG renderer (`LivingTheme`), which stays until every scene is ported.

## Add a scene

1. Create `scenes/<id>.js`, named exactly after the scene's id in `src/shared/theme-registry.ts`.
   Nothing else has to change: the file is discovered at build time (`modules.ts`) and becomes
   its own lazily loaded chunk. A weather overlay is `weather/<kind>.js` in the same way.
   Two scenes are drawn by another scene's file until they have their own: `birthday-russian`
   and `birthday-korean` use `birthday.js` (`SCENE_MODULE_FALLBACK` in `resolve.ts`). A file
   named after the scene always wins, so adding `scenes/birthday-russian.js` takes over with
   no other edit; leave the fallback table alone.
2. Export one function. It builds the scene by adding objects to `kit.stage`; it returns nothing.

   ```js
   /** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
   export default function build(kit, ctx) {
     const { T, V, stage, view, tick } = kit, W = view.halfW, S = ctx.size, A = ctx.amount;
     const lamp = kit.bulb(0xffd9a0, .05 * S);
     lamp.position.set(W - 1, 3, 0);            // one unit in from the right edge
     stage.add(lamp);
     tick(t => { lamp.position.y = 3 + Math.sin(t) * .1; });
   }
   ```
3. Build, capture, look, delete (see [Look at it](#look-at-it)). Run
   `node --test "src/client/scene3d/*.test.ts"`: it checks every file in `scenes/` and
   `weather/` against this contract, the float's edge and crop rules included.
   When the scene looks right, write its content baseline in the same pull request:
   `node tests/scene3d/census.mjs --write <id>` creates `tests/scene3d/census/<id>.json` (what it
   draws, everyday and quiet). It is a file of its own, so no other pull request touches it.
   From then on `scene3d.test.ts` fails if a later edit makes the scene draw more than 5% less.
   Without the file the test only reports "no baseline yet". After a deliberate rework that draws
   less, write the file again in that rework's pull request.
4. One scene, one pull request, one independent code review. Do not edit `engine.js`, `kit/`,
   `settings.ts`, `resolve.ts` or another scene in a scene pull request. If the kit lacks
   something, build it inside your scene file from `kit.T`, or as a shared part (below).

A scene file imports nothing except shared parts from `../parts/`. three.js is `kit.T`.

## Shared parts (`parts/`)

Something the kit lacks and more than one scene could use (a lantern frame, a pine cone, a
paper fan) goes in `parts/`, never in `kit/`. Several agents add scenes at the same time, so
the rules are about not meeting in the same file:

- **One part per file, named after the scene that introduced it:**
  `parts/<scene id>-<part>.js`, for example `parts/seollal-kite.js` or
  `parts/new-year-tree-spire.js`. Your scene id is your prefix, so no two agents can choose
  the same file name, and a reader sees where a part came from. A weather overlay uses its
  kind (`parts/rain-streak.js`).
- **A part exports plain functions whose first argument is the kit** and that return an
  object for the caller to add: `export function kite(kit, { colour, size }) { ... }`. No
  state at module level, no import of three.js or app code, no `Math.random`. A part may
  import another part (`./seollal-kite.js`) and nothing else.
- **Use:** `import { kite } from '../parts/seollal-kite.js';` in the scene file.
- **You add a part in your own scene's pull request**: a new file touches nobody else. You
  may import a part that is already on `main`. Do not edit another scene's part in your pull
  request: if it does not fit, write your own under your prefix, or change the shared one in
  a separate pull request that re-captures every scene using it.
- **Promotion to the kit** (when several scenes use a part and its signature has settled) is
  a separate pull request that moves it into `kit/` and updates `engine.d.ts` and the kit
  table below together.

`node --test "src/client/scene3d/*.test.ts"` checks the file names and imports of `scenes/`,
`weather/` and `parts/`.

## Art rules (owner, 2026-11-10)

- **Few, and not repeated.** Vary size, colour, finish and pattern. No row of identical objects,
  no evenly spaced ring or line of the same thing.
- **Everything belongs somewhere.** Each object is attached, hung, standing on the bottom edge,
  or falling the way it really falls. Nothing floats without a reason.
- **Nothing generic.** A scene must be recognisably its own occasion, and scenes for different
  cultures must not share a stock lantern, star or tree. Read the scene's ticket and the
  cultural notes in the theme contract first.
- **Edges and corners.** Hero elements sit at the edges and in the corners. The middle of the
  screen, where the widgets are, is left to fade.
- **Calm.** A scene that stays for weeks is low-key; a one-day occasion may be a little
  bolder and bigger. That is `ctx.tier`, already applied to `ctx.amount` and `ctx.size`:
  do not add your own multiplier on top.
- **Quality over count.** Improve an element (a real vein pattern, a second finish, a shape that
  is not a sphere) before adding another copy of it.

## What a scene is given

`ctx` (frozen):

| Field | Meaning |
| --- | --- |
| `id` | Registry id being shown. `birthday.js` also serves `birthday-russian` and `birthday-korean` (see `resolve.ts`) and reads this. |
| `amount` | How much to put in the scene, 0-1. Owner default 0.3; about 0.24 for an everyday scene, 0.1 on a quiet date. Turn it into counts: `Math.round(3 + ctx.amount * 6)`. |
| `size` | Scale of objects (radius, length). Owner default 0.85. Never multiply positions by it. |
| `tier` | `'special'` or `'everyday'`. Already applied; read it only to choose between two designs. |
| `weather` | Weather drawn over this scene in Combined mode: `'rain'`, `'snow'`, `'storm'`, `'fog'`, `'wind'`, or `null`. In Combined the scene always stays and any of the five kinds can be over it (#655), including ones its season rarely sees: snow over Spring, rain over Winter, a storm over Christmas. The overlay draws the weather; the scene responds through `parts/wind-underneath.js` (#646, see "The weather over a scene" below), never by reading this itself. Always `null` in a weather scene of its own (Weather mode). |
| `quiet` | A selected quiet date. The stage is frozen and reduced; see below. |
| `palette` | The scene's three registry colours as CSS strings; neutral greys when quiet. |
| `seed` | A stable whole number for this scene id. Use it as the salt of `kit.rnd` for a layout that is yours. It does not change from day to day. |
| `day` | The civil day as a whole number that grows by one at local midnight. A scene that should look slightly different each day adds it to the salt (`kit.rnd(i, ctx.seed + ctx.day)`); the scene is rebuilt at midnight. Use it for small things (which leaf is larger), never for the composition. |
| `width`, `height` | View size in CSS pixels. Use `kit.view` for world units. |

The world: the camera has a 30° field of view and looks at the plane z = 0, which is 9 units
high. On a 16:9 screen it is 16 wide, but the app also runs at 21:9 and in small editor
previews, so never write `8`: the left and right edges are `-kit.view.halfW` and
`+kit.view.halfW`, top and bottom `±4.5` (`kit.view.halfH`). In front of the plane (z > 0)
less is visible, behind it more: `view.halfWAt(z)` and `view.halfHAt(z)` give the half-extents
at a depth, so an object stands on the bottom edge at `y = -view.halfHAt(z)`. Things beyond
about z = -9 fade into black fog. The scene is rebuilt when the view's shape changes.

The engine floats the whole picture like the widget board (#675): up to ±2% of the display
on each axis, on its own track and the board's motion interval, also on a quiet date. It draws
the picture 4.3% larger about the screen's centre: about 2% of each edge is cropped at the
centre position and up to 4% of the far side at an extreme. You do not need to do anything for
it, but keep to these rules:

- Anything that enters from a side edge must cross it: start cords, boughs and poles beyond
  the edge they come from (at their depth, `view.halfWAt(z)`). Ending exactly at the edge is
  not enough.
- Something whole near the bottom (a cake, a gift, an egg, a fallen leaf) stands on the
  visible bottom, about 2% of the height up: `y = -view.halfHAt(z) * .9588` (1 / 1.043), or
  about 0.19 units above the edge, then nudged until its lowest point is within 0.3% of the
  height of it (the check prints the gap). Standing exactly on the edge, it is cut at the
  centre position; floating higher, it fails the check. Or sink it past the edge, like a
  bouquet whose stems run off the bottom. Something resting on another thing (an egg on a
  napkin) only needs that thing under it.
- Keep anything else that must stay whole about 4% of the width (and height) in from an edge:
  the float takes the far side of the frame that far in at an extreme. Things attached to
  something that enters from the edge (cones on a bough, ornaments on a garland) may be cut
  with it.
- `node tests/scene3d/edge-check.mjs` prints, for every scene and overlay at 16:9 and 21:9,
  how far the elements anchored at each edge reach beyond it. `npm test` fails when one would
  show its end, or when a whole piece would be cut (the crop rule in
  [Ambient themes](../../../docs/ambient-themes.md#float-675-owner-direction-2026-11-12)).

Time: `tick(fn)` registers `fn(t)`, called once per drawn frame with the scene clock in
seconds. The clock runs at one eighth of real time (the owner's "motion 5%") and frames are
drawn about 20 times a second, so write motion as a function of `t` (`Math.sin(t * .4)`), never
as a per-frame increment. A still editor preview and a quiet date call every tick once, at
t = 14. A still preview draws that one frame; a quiet date's picture is redrawn only as the
float moves it. In the editor's movement preview (#678) `t` is the moment on its hour slider,
`12 + seconds / 8`, and the slider can go to any moment in any order, backwards too: never
keep state that assumes `t` only grows (a value cached for the current cycle of `t`, as
`parts/rain-beads.js` does, is fine). The wind's gust (`parts/wind-gust.js`, #646) is a
function of `t` as well, so the preview shows the lean and sway of that moment.

The weather over a scene (#646). In Combined mode any of the five weather kinds can be drawn
over your scene; the overlay draws the weather and your scene responds, calmly. Call
`const weather = weatherOver(kit, ctx)` from `parts/wind-underneath.js` first in `build()` (its
tick reads the gust once a frame before yours run) and use it:

- **Wind:** turn every attached thing with `weather.sway(calm, hold)`, where `calm` is the angle
  you would set without wind and `hold` says which way its free end lies from where it is held
  (1 above, -1 below, a share between, 0 for a whole bough that only sways). It is the calm
  angle one and a half times over (`SWAY`, 1.5: the plan's twice was too much on the display)
  plus a steady lean of 2 to 4 degrees toward the left that follows the gust the overlay's seeds
  ride on. Multiply any other swing in the plane of the screen by `weather.wind.sway`; leave a
  slow turn about a cord or stem as it is. Lean only the outermost thing (a leaf, not also its
  branch). The lean is at most 4 degrees, and a piece turns at most 7 degrees from its calm pose
  at any instant: its lean plus half its own calm swing (a test checks every scene). A falling
  piece adds `weather.drift(age)` to its x; an endless fall passes `weather.carry` to
  `kit.snow`. Give cloth and hanging parts the `weather` object when they own their motion.
- **Rain or a storm:** hide (`visible = weather.falls`) your own falling petals, leaves and
  embers, and multiply your backlight (halos and discs behind the scene) by `weather.backlight`.
- **Fog:** `weather.backlight` dims your backlight by 40%; hide glints you animate yourself
  (`visible = weather.glints`); pass far elements through `weather.farther(object)`. The kit
  stops every twinkle. Leave the hero as it is.
- **Snow, rain or a storm:** your own decorative snow is hidden (`visible = weather.ownSnow`).
- Hide, never leave out: a weather must not change what is built (the census of every scene
  under every weather is a test), and a quiet date takes no motion.
`weather-underneath.test.ts` checks every scene for these, and the edge and crop checks build
every scene in the wind with the gust held at its lull and its peak.

Quiet dates: `ctx.amount` is already reduced. `kit.snow`, `kit.bokeh`, `kit.confetti` and
`kit.fireworks` return an empty group, so `stage.add(kit.snow(40))` is always safe. Guard your
own things that are in the air with `if (!ctx.quiet)`. The layer is also dimmed and
desaturated by the app.

## The kit

Stable: additions are fine, changes to existing signatures are not. Typed in `engine.d.ts`.
Colours are sRGB (`0xrrggbb` or `'#rrggbb'`) unless stated. Factories return an object that
you add yourself; nothing is added for you except `part()`.

| Helper | What it gives |
| --- | --- |
| `T` | three.js r128, complete. |
| `stage`, `part(x, y, scale, mirror)` | The root group; a sub-stage already on it that can be placed, scaled or mirrored as one piece. |
| `view` | `halfW`, `halfH`, `aspect`, `depth`, `halfWAt(z)`, `halfHAt(z)`. |
| `V(x, y, z)`, `C(colour)`, `mix(a, b, k)`, `shift(colour, hue, sat, light)`, `rnd(i, salt)` | Vector; sRGB to linear colour; blend two colours; turn a colour around the wheel; a deterministic value in [0, 1). Never use `Math.random`. |
| `tick(fn)`, `own(resource)` | Per-frame update; register a texture or geometry you made for disposal with the scene. |
| `mat(options, env = 1, physical = true)` | The material factory: three.js material options with sRGB colours, glass-patched (a lit body thins out, its rim and highlights stay). `env` scales the studio reflections. Use it for every lit surface. The extra option `see` (0-1) is the share of the see-through look a surface takes, for the rare one that must stay solid (a national flag). The owner's Transparency setting scales that share for you. A surface is solid (#683): thin and dim on black, but it hides whatever is behind it. Pass `clear: true` only for something really see-through (glass, ice, water, tea, gauze); it is blended over what is behind it. Never pass `transparent: true`, and `depthWrite: false` only with `clear`. It draws in the illustrated look below: pass `own` (0-1) to set how much of its own colour a surface gives off (0 for one that brings its own glow), and `gloss: true` for a surface that really is glossy (glaze, lacquer, satin ribbon), which keeps the roughness and clearcoat it asks for. |
| `solidity(body)` | How solid to draw a body you make see-through yourself, under the owner's Transparency setting (#670): `body` is the solidity you chose (0-1) and the result is what to draw, `body` itself at the standard 50%, 1 at 0%, thinner toward 100% but never zero. Pass every such alpha through it: an alpha map's grey (`Math.round(kit.solidity(.7) * 255)`), a uniform, `opacity: kit.solidity(.6)`. On a solid surface it is how dim the body is; on a clear one, how much shows through. A cut-out outline (`alphaTest`), light and particles are not bodies. |
| `fade(material, amount)` | Fade a `mat()` surface as a whole (0-1) over what is behind it, for something that appears or goes. A solid surface is blended only while it fades. Do not set `material.opacity` on a solid surface: that dims it, it does not fade it. |
| `gold()`, `satin(colour)` | Polished gold; ribbon satin. |
| `glow(colour, size, opacity, { texture, twinkle })`, `bulb(colour, radius, halo)`, `bokeh(colour, size, opacity, twinkle)` | An additive halo; a small lit bulb with its halo; a soft out-of-focus light disc. Their strength follows the owner's glow setting. In fog nothing twinkles (#646). |
| `tex.glow()`, `tex.disc()`, `tex.flame()`, `canvasTexture(w, h, draw, opts)`, `patternTex(base, accent, kind)` | Shared soft textures; a texture drawn once on a 2D canvas; a repeating pattern (`dots`, `stripes`, `grid`, `bands`, `diamonds`). Blur a whole layer once, never per stroke. |
| `line(points, colour, opacity)`, `catenary(a, b, sag, n)`, `ribbonGeo(points, width, side)` | A thread or cord; points of a hanging cord; a flat band along points. |
| `ballGeo`, `sphereGeo` | Shared low and high detail unit spheres. |
| `needles()`, `twig(...)`, `bough(...)` | Fir: a needle collector (`.mesh()` once at the end), needles along a twig (with a share of them snow-white), a drooping bough that returns `pt(t)` for hanging things on it. |
| `ornament({ color, radius, thread, shape, finish, accent })`, `bauble(colour, radius, thread, satin)` | A hanging ornament: `ball`, `drop`, `onion`, `finial`, `facet` in `mirror`, `satin`, `pearl`, `glitter`, `banded`. The origin is the point it hangs from. |
| `snow(count, { size, opacity, colour, salt, drift })` | Slow snow points over the whole view. `drift(t)` is how far the wind has carried the fall sideways (`weather.carry`); the flakes wrap round. |
| `leaf(tint, scale, variant)`, `LEAF_TINTS`, `MAPLE_OUTLINE` | A curled, veined maple leaf (texture, alpha, bump); its tints; its outline for drawing. |
| `flagCloth(texture, { width, height, fly, wave, see })` | A cloth waving from its hoist edge, for any texture. It keeps only a third of the see-through look, so a flag never reads as faded. `wave` may be a function of the scene clock, read once a frame (a flag flying harder in the wind). |
| `fireworks(bursts, { per, size, tints, flash, period, life })` | Slow bursts of light points. |
| `balloon(colour, radius, { skin, shape, pattern })`, `puffyBow(colour, scale)`, `gift(w, h, d, base, accent, kind, ribbon)`, `cake(options)` | Party pieces. Balloons: `latex`, `pearl`, `foil`; `round` or `star`. |
| `bunting(a, b, options)`, `confetti(count, options)`, `streamer(length, radius, colour, options)` | Flags on a cord, tumbling foil, a curled paper streamer. Give `bunting` the scene's `weather` (`weatherOver`) and its flags lean and flap in the wind. |

**The illustrated look** (#691, owner 2026-11-12: "on average colours are too dull ... i like the vibrancy of the
autumn one", "the pumpkins are too shiny", Maslenitsa "too 3d from 2005"). What made Autumn vivid (#671) is in
`mat()` for every scene (`LOOK` in `kit/core.js`):

- A surface gives off a share of its own colour as light of its own (0.22 by default, half for a clear surface,
  less for a metal), a little more toward its silhouette, so its shadow side keeps its colour and its shape reads
  on black.
- The warm and white lights wrap round a curved surface, so there is no hard line between its lit and dark sides.
- The kit's own tone curve replaces the engine's filmic one on `mat()` surfaces: it keeps hue and saturation (a
  red stays red, an orange orange) and only softly compresses the brightest channel; bright near-whites go white.
- Less shine: a surface that is neither metal (metalness 0.5 or more) nor clear is matte or satin (roughness at
  least 0.5, a quarter of its clearcoat) unless it passes `gloss: true`. Polished metal keeps more reflection.
- Paint colours as the real thing is: sample a photo of the object (hue, saturation, value of its pixels) and match
  it on a `--full` capture. Use `gloss` only where the real material is glossy, never on fruit, bread, cloth,
  wood, paper, pumpkins or balloons.

The studio environment (four soft light panels), the key, rim and fill lights, the black fog,
tone mapping and the camera are set by the engine and are the same for every scene. Do not add
scene-wide lights; a small local `T.PointLight` (the cake's candles) is fine.

## The look is not yours to tune

`settings.ts` holds the owner's picks (see-through, glow, shine (lowered on 2026-11-12, #691), size, speed, fade to middle,
brightness share, amount) and the tier and quiet multipliers; `tier.ts` derives the tier from
the registry group and the holiday policy window. A scene module never reads or overrides
them. If a scene looks too strong or too weak at these settings, change the scene.

One of them the owner sets himself: **Transparency** in Style (#670, 0-100%, 50% standard).
It reaches a scene through the kit only. `mat()` applies it to the glass look, and
`kit.solidity(body)` applies it to any see-through body the scene draws itself; write your
body's solidity for the standard look and pass it through. Never read the setting, the look
or `settings.ts` from a scene. `transparency.test.ts` fails on a literal `opacity` below 1
in `mat()` and lists the parts that call `solidity`: add yours there. The curve
(`settings.ts` `thinned`) and what does and does not follow it are in
[Ambient themes](../../../docs/ambient-themes.md#transparency-670-owner-request-2026-11-11).

**Solid and clear** (#683, owner: "leafs behind leafs shouldnt be see through"). The background is
true black, so a surface blended over it at alpha a shows a times its colour. The kit draws every
`mat()` surface opaque at that colour times its alpha instead: it looks the same on black, thin
and dim, but hides what is behind it, whatever order things are drawn in. Every alpha a solid
surface has is how dim it is. An `alphaTest` outline is a shape: it becomes coverage, smoothed
across the pixel's samples, so outlines have no dark fringe. Mark `clear: true` only what is really
see-through; a clear surface is blended over what is behind it and drawn after every solid one, so
the order of two clear surfaces still follows their origins. An alpha map that is a soft shape
(a fade at an edge) belongs on a clear surface or behind an `alphaTest`: on a solid one it is a
dark band over what is behind. Weather particles, halos and the fog are not `mat()` surfaces and
are unchanged (the snow overlay's ice plates are, and are clear); a solid leaf hides a far flake and a near one still
shows. The origin offsets of #663 (Autumn, Winter, `parts/winter-order.js`) now only order clear
surfaces. `transparency.test.ts` lists the clear surfaces: add yours there, and to
[Ambient themes](../../../docs/ambient-themes.md#solid-and-clear-683-owner-direction-2026-11-12).

## Runtime behaviour (engine.js, Scene3D.tsx)

- Nothing 3D is in the dashboard bundle. The engine with three.js (about 620 kB, 160 kB
  gzipped) and each scene file are fetched only when a 3D scene is about to be shown.
- Theme Off, Animation Off and system reduced motion mount nothing. The editor's still
  preview draws one frame and runs no loop. A quiet date runs no frame loop: a timer redraws
  its frozen scene only when the float has moved it half a pixel (at most four times a
  second), or once per step without Float gently.
- The float is a change to the camera's projection (zoom 1.043 about the centre, then the
  offset): `stage.setFloat({ interval, gentle })` follows the board's settings without a
  rebuild, `stage.holdFloat(unit)` pins a position for tools, and `stats()` reports `float`
  (NDC), `zoom`, `floating` and `floatFrames`. It also reports `surfaces`: how many of the
  scene's `mat()` surfaces are solid and how many clear (#683).
- The editor's movement preview (#678): `stage.setPreview(seconds)` (and the `preview` option
  for a stage made during one) makes the float read the preview's time as its track time, the
  board's preview time, and a running scene clock `clock.start + seconds × timeScale`. A held
  preview draws nothing new; a quiet date's frozen clock stays and its float is redrawn at once.
  `setPreview(null)` returns the float to real time at once, and the scene clock carries on
  from the preview's. A still stage ignores it. `stats()` reports `preview`, and `floatSample`
  says whether its time was the preview's. `stageClock` (exported) is the clock both use, so it
  is tested without WebGL.
- The backing store is at most 2560 x 1440. Frames are drawn about 20 times a second, never
  while the document is hidden, and never before the GPU has finished the previous one.
- One stage owns one canvas and one WebGL context and releases both on unmount.
- `stage.retune({ seeScale })` (a new Transparency) builds the scene again 250 ms after the
  last call, in the same canvas and context, and draws it; a drag of the slider is one
  rebuild. Any rebuild (this one or after a resize) releases the old scene only after the new
  one has drawn, so shared shader programs are reused, and releases the environment map's
  render target with its scene. `stats()` reports `builds`, `seeScale` and `programs`.
- A software rasteriser is refused, and a GPU that needs more than 120 ms a frame ten frames
  running gives up; so does a lost context or a scene that throws. In each case the flat
  renderer takes over for that scene, and nothing is thrown to the page.
- `window.__lrdScene3d` is the set of live stages (`stats()`, `measure()`), for tests and
  tools. `window.__lrdScene3dAllowSoftware = true`, set before the page loads, lets a source
  check run the 3D path on a machine without a GPU; nothing in the app sets it.

## Look at it

```powershell
npm run build
$tools = "$env:TEMP\lrd-browser-tools\node_modules"   # Playwright, installed as in docs/development.md
node tests/ui/tools/scene-sheet.mjs --playwright "$tools\playwright" --edge "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --out "$env:TEMP\scene-look" --full my-scene christmas+snow
```

The tool opens the built app on an isolated synthetic server, on each scene's own date and
weather, and writes one 1920 x 1080 PNG per scene into the folder you name (outside the
checkout). `--full` shows the scene at full opacity, which is how to judge the art; without it
you see the real, much dimmer layer. `--empty` hides the widgets, `--measure` prints build,
frame and main-thread times, `--size 3840x2160` and `--size 2560x1080` check other shapes,
and `--transparency 0` or `--transparency 100` shows the scene at another Transparency.
Look at the images, fix what is wrong, and delete the folder: the project keeps no
screenshots. Check that nothing important sits in the middle, nothing is cut by an edge that
should stand on it, and no two neighbours are copies.

`node tests/ui/scene3d-browser.mjs --playwright <module> --edge <msedge.exe> [--gpu]` is the
browser suite for the 3D path; the `themes` suite runs without WebGL and covers the fallback.
