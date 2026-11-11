# Ambient themes

Work tracked in #584 (private annual birthdays), following #582 (richer colour/composition/motion), #579 and #575, with #452
hourly weather and #458 holiday cards. Themes default to Off; existing selections
are preserved. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Current rendering direction (#600, owner decision 2026-11-10)

Superseded on the same day by [3D scenes](#3d-scenes-600-owner-decision-2026-11-10) for
every scene that has a 3D module; it still describes the flat fallback renderer.

After seeing the #586 scenes on the display the owner asked for far less scenery,
drawn translucent and classy, never clipped by widgets. This section overrides any
older statement below that conflicts with it.

- **Light, not objects.** Each scene carries its palette as two large, faint colour
  washes in the bottom corners that drift and breathe. Quiet dates
  draw no wash and at most one unfilled patch.
- **Few authored forms.** Only the patches holding a scene's named principal forms
  are drawn (otherwise at most two), as translucent "glass": body fill at most 50%
  opacity under a thin light rim.
- **One low ground.** A single continuous ground band at about 60% of its former
  height, 62% opacity, fading to nothing at its top. No top band, pendants,
  bunting, icicles or cloud bank.
- **Soft particles.** About half the former count; each is a faint halo under a
  translucent body, in four depth layers. Snow is soft dots, not line asterisks.
- **No reading holes.** Nothing is cut out around widgets. Scenery passes behind
  text; legibility comes from low alpha, and authored forms are still placed away
  from reading areas. The old "art never touches ink" pixel proof no longer applies.
- **Second owner pass (2026-11-10): quieter still.** "A screensaver in the middle of
  my living room": two faint bottom-corner washes (peak 20%), no top wash; about nine slow
  particles (fourteen in snow); ground at 45%. The left and right edges carry one tall,
  thin flourish each, chosen per scene in `sideStyles` (`living-dressing.ts`): the side
  of a fir with a wound light string and a hanging string of lights for Christmas,
  blossom or leaf branches, frost twigs, ribbons, reeds. A flourish bows inward about as
  far as the free margin beside the widgets (a thin remainder may pass behind a widget
  that touches the edge), and sways by half a degree.
- **Third owner pass (2026-11-10): polish, same direction.** "Less like basic SVGs":
  filled forms use a diagonal light-to-transparent gradient of their tone (`sheen`),
  ground blades a vertical one; stems taper; leaves and reed heads carry a midrib;
  blossoms are five round petals around a glowing centre; the fir is fine needles on
  curved boughs; ribbons are bands that swell and close. Lights and frost beads are
  individual circles with a radial glow and a slow nine-second twinkle in two groups.
  Prefer these techniques over flat fills and uniform strokes in any new art.
- **Iteration.** Change the renderer, build, capture two or three scenes to a temp
  folder, look, delete the images. Do not run multi-round agent reviews for taste.

The top-band generator, the old mask description and the ink pixel-proof helper are
now unused; removing them is tracked in #590.

## 3D scenes (#600, owner decision 2026-11-10)

**This supersedes the flat rendering direction above** for every scene that has a 3D
module. The owner rejected each flat SVG version ("basic shapes") and approved lit 3D
objects in a scene style picker: partly see-through, slowly moving, fading out toward the
middle of the screen. The flat renderer described above and below remains only as the
fallback. The engine, the kit and the contract for adding a scene are in
[src/client/scene3d/README.md](../src/client/scene3d/README.md).

### The owner's picks

Chosen in the picker for its "All together" compositions, and held as named constants in
`src/client/scene3d/settings.ts`. They are picks, not defaults to tune.

| Setting | Pick | In the app |
| --- | --- | --- |
| Brightness | 45%, beside stand-in text of about the same luminance | Layer opacity is the saved brightness × 0.95 (× tier, clamped at 1): scene highlights about as bright as the text, never above the saved brightness. |
| How much | 30% (Canada Day 15%) | `ctx.amount`; a scene turns it into counts. |
| Size | 85% | `ctx.size`: object radius and length, not position. |
| Glow | 65% | Strength of halos and soft light discs. |
| Motion | 5% | The scene clock runs at 5/40 of the picker's default speed, one eighth of real time. |
| Shine | 80% | Strength of the studio reflections. |
| See-through | 100% | A lit body thins to glass; its rim and highlights stay. |
| Fade to middle | 60% | The picker's radial mask: full strength at the edges, 40% in the middle. |

His words on the direction: "something like this, just improve the elements, less
repeated, not as intense as all together, but overall the vibe is good"; "special occasion
one-day screensavers can be more intense, bigger, and the daily/seasonal ones that stay for
weeks or months need to be more low-key"; scenes for different cultures must be unique.

Brightness (coordinator decision, 2026-11-10, [#636](https://github.com/8roundshock/living-room-display/issues/636)):
the picker's 45% is not multiplied into the app's layer. In the picker it sat beside stand-in
text drawn at roughly the same luminance, so the look the owner approved has scene highlights
about as bright as the text, a ratio close to 1 and not 0.45. In the app the text is already
dimmed by the saved brightness, so the scene takes 0.95 of it. Scene pixels alone on an empty
1920×1080 board at a saved 36%: 8-10% lit, median luminance 21-43 and 99th percentile
48-63 of 255, against widget text at about 69. (With the first rule, saved brightness ×
0.45, the 99th percentile was 24-33.)

### Tier rule

`tier.ts` derives one of two tiers from the registry group and the holiday policy's
eligibility window (lead days, the holiday's own span, adjoining observances of the same
scene). It keeps no list of scenes.

- **special**: birthdays, and celebrations that can be on screen for at most seven
  consecutive days (Canada Day 3, Women's Day 3, Buddha's Birthday 4, New Year 6, Orthodox
  Christmas 7, Maslenitsa 7). Opacity ×1.15, which with the 0.95 share is clamped to the
  saved brightness itself; size ×1.1.
- **everyday**: seasons, weather, and celebrations with a longer window (Thanksgiving 8,
  Pascha 8, Easter 9, Seollal 9, Chuseok 9, New Year · Russia 13, Halloween 17, Christmas
  42). Opacity ×0.9 (0.855 of the saved brightness), amount ×0.8.

Weather over a scene (Combined) keeps that scene's tier. The one-week boundary is one
constant, `SPECIAL_MAX_WINDOW_DAYS`. Stepping a long-window holiday up to special on its
central day only is [#632](https://github.com/8roundshock/living-room-display/issues/632).

### Art rules

- Few, and not repeated: vary size, colour, finish and pattern; no row of identical objects.
- Every object is attached, hung, standing on the bottom edge, or falling naturally.
- Nothing generic: each scene is recognisably its own occasion, and scenes for different
  cultures share no stock form.
- Hero elements sit at the edges and in the corners; the middle is left to fade.
- A scene's quality comes from better elements, not more of them.

The three reference scenes follow their design plans:

- **Christmas** ([#609](https://github.com/8roundshock/living-room-display/issues/609)):
  a wreath with a red bow hung on a ribbon from a short fir swag in the top-left corner, a
  longer swag in the top-right corner with five ornaments that differ in shape, colour and
  finish, the edge of a lit tree in the bottom-right corner rising to a little over half the
  height with warm lights and a few ornaments that differ, one snow-dusted bough low on the
  left, soft warm lights far behind, a little snow. The tree is an edge only (coordinator
  decision on #609: the owner asked for the side of a tree); the whole decorated tree with
  its top stays with New Year · Russia, the star with Orthodox Christmas.
- **Canada Day** ([#606](https://github.com/8roundshock/living-room-display/issues/606)):
  the National Flag (2:1, the 11-point leaf, kept solid) flying from its pole in the
  top-right corner, leaves fallen at the pole's foot, a cord of five maple leaves in the
  top-left corner, a maple branch from the lower left with one large leaf on its stem,
  three leaves falling. No fireworks.
- **Birthday** ([#612](https://github.com/8roundshock/living-room-display/issues/612)):
  a candle-lit three-tier cake between two presents in the left corner, five balloons that
  all differ tied to a present in the right corner, a short swag of bunting in each top
  corner. Birthday · Russian accents and Birthday · Korean accents use the same module
  with their own colourway and wrapping-paper pattern until
  [#627](https://github.com/8roundshock/living-room-display/issues/627) and
  [#631](https://github.com/8roundshock/living-room-display/issues/631).

Canadian and shared Western occasions (their design plans; each plan's day-only extra waits
for [#632](https://github.com/8roundshock/living-room-display/issues/632), see
[#639](https://github.com/8roundshock/living-room-display/issues/639)):

- **Thanksgiving · Canada** ([#607](https://github.com/8roundshock/living-room-display/issues/607)):
  a woven horn of plenty lying on the bottom edge in the left corner, spilling two apples
  that differ, a pear, dark grapes and a few cranberries; a bound sheaf of bearded wheat
  standing in the right corner. No pumpkins, no leaves, nothing falls.
- **Halloween** ([#608](https://github.com/8roundshock/living-room-display/issues/608)):
  three glass pumpkins in the left corner that differ in shape, colour and size, the large
  amber one carved with a calm face and lit from inside by a glow that breathes and never
  flickers; a hair-fine cobweb with dew in the top-right corner. No spider.
- **New Year** ([#610](https://github.com/8roundshock/living-room-display/issues/610)):
  long-exposure fireworks held almost still on a two-minute cycle (a gold chrysanthemum
  top-left, a silver willow top-right, a small gold-and-rose palm far back), a few sinking
  embers, paper streamers of different finishes over the top edge. No flash, no numerals,
  no drinkware (coordinator decision on #610).
- **Easter · Canada** ([#611](https://github.com/8roundshock/living-room-display/issues/611)):
  a potted white Easter lily in the left corner with four trumpets at different stages and
  three buds; a twig nest with four plain eggs of different finishes in the fork of a
  budding branch that grows in from the right edge. No red or patterned eggs, no blossom.

Measured as above on 2026-11-10 at 1920×1080: 1,300 to 87,000 triangles, 18 to 44 draw
calls, build 56 to 350 ms, 25 to 30 ms/s of main-thread time, frame script under 1 ms.

The four seasons (their design plans) are the quietest scenes: on screen for weeks or
months, so each is one well-made hero at an edge and very little else, and lights about a
quarter of the pixels Christmas does. Each is one fixed picture for its whole run
(coordinator decision, 2026-11-10: no month-by-month change); on a quiet date the hero is
drawn alone.

- **Spring** ([#613](https://github.com/8roundshock/living-room-display/issues/613)):
  a magnolia bough from the top-left corner with six blooms at four openings (pink
  outside, pale inside) and velvet buds, a spray of young leaves low on the right, now and
  then one petal falling down the left edge.
- **Summer** ([#614](https://github.com/8roundshock/living-room-display/issues/614)):
  a morning-glory vine hanging down the right edge (two wound stems, heart leaves, three
  periwinkle flowers, furled buds, tendrils), a short runner low on the left, and a few
  fireflies that are lights only.
- **Autumn** ([#615](https://github.com/8roundshock/living-room-display/issues/615);
  a ginkgo until [#664](https://github.com/8roundshock/living-room-display/issues/664),
  from the owner's verdict on the TV: "more canadian, with like a maple tree ... orange and
  yellow", "less transparent", a leaf every "1.5-2 minutes"): a sugar-maple branch rising
  along the left edge, branching in opposite pairs, with thirty-two leaves in sprays at the
  shoot tips, clear yellow and gold inside, fire orange and red-orange on the outer shoots,
  and a few bare twig ends; a few fallen leaves in the bottom-left corner. Low on the right
  edge, as a lighter and smaller companion, a paper-birch twig: white bark with dark
  lenticels and two peeling curls, fine dark side twigs, nine small yellow leaves, some
  already gone. Leaves are thin coloured glass, their bodies 0.7 as solid as their veins
  and rims (0.55 for the ginkgo of
  [#653](https://github.com/8roundshock/living-room-display/issues/653)). One maple leaf at
  a time lets go and rocks down the left edge (about two to two and a half minutes); then
  the air is empty for one and a half to two minutes. Orange and yellow only: the pure red
  leaf is Canada Day's. The middle of the screen and of the bottom edge stay black.
- **Winter** ([#616](https://github.com/8roundshock/living-room-display/issues/616)):
  frost ferns growing in from the bottom-left corner and a bare twig glazed in clear ice in
  the top-right corner. Still air (coordinator decision on #616): the 3D Winter scene draws
  no snowfall of its own, so falling snow over it always means the forecast says snow.

Measured as above on 2026-11-10 at 1920×1080: 30,000 to 75,000 triangles (Winter's frost
is about 5,000 crystals in one instanced mesh), 43 to 76 draw calls, build 62 to 115 ms,
23 to 38 ms/s of main-thread time and frame script of about 1 ms or less, on a PC that was
busy with other captures (Christmas measured 39 to 48 ms/s in the same runs). At full
opacity on an empty board a season lights 2.2 to 3.4% of the pixels; Christmas lights 11.7%.
Autumn after #664 (the maple): 28,000 triangles, 74 draw calls (75 while a leaf is in the
air), build about 105 ms, 25 ms/s, 3.4% of the pixels lit, with Christmas at 30 ms/s in the
same run.

#### Weather scenes and overlays

The weather family ([#617](https://github.com/8roundshock/living-room-display/issues/617)
to [#621](https://github.com/8roundshock/living-room-display/issues/621)). Each kind is a
standalone scene (`scenes/<kind>.js`: Weather mode only) and an overlay (`weather/<kind>.js`:
Combined, over whichever season, holiday or birthday scene is showing; see
[Combined](#combined-the-weather-is-always-drawn-over-the-scene-655-owner-direction-2026-11-10)).
Nothing of it is drawn unless the resolver returns that weather from fresh
forecast data. One quiet density per kind: it follows the amount setting, never a light or
heavy weather code. Rain leans one way and wind blows right to left as art choices; the
resolver passes no direction. Particles are weighted to the sides, each kind has a far, a
middle and an out-of-focus near depth, and on a quiet date nothing falls or sails.

- **Rain** scene: slanted threads of light at three depths, glass beads of water in the
  top-left corner with one that runs down now and then, rings on a small pool in the
  bottom-right corner.
- **Rain** overlay: the far and middle threads only, half the count at 70% strength, 35% of
  a holiday's or birthday's colour; no near band, beads or pool.
- **Snow** scene: small sharp flakes far away, soft ones in focus, a few large soft discs
  near the glass, a few clear hexagonal plates, two low rim-lit drifts in the bottom corners.
- **Snow** overlay: the far and middle flakes at half the count and two near discs; no
  drifts, and plates only over a plain season. The scene underneath leaves out its own snow.
- **Storms** scene: a dark cloud mass in the top-left corner thinning along the top edge,
  lit from inside by a slow, soft glow; driven rain leaning 16° at three depths, with a wider
  sheet of heavier rain crossing now and then.
- **Storms** overlay: five cloud volumes in the top-left corner (behind whatever a scene
  has there), the glow at 60% with no echo, driven rain at 60% of the count; no sheets and
  no near band.
- **Fog** scene: four birch trunks at three depths (three on the left, one far on the right)
  and bands of fog that slide between them, thin across the middle; nothing falls.
- **Fog** overlay: three bands (far, middle, one low near band held to 0.04) at 60%
  strength; no trunks. It stays, still, on a quiet date.
- **Wind** scene: a branch in the top-right corner bowed over by the wind with slim leaves
  streaming, downy seeds sailing along the top and bottom at three depths, a leaf or two
  tumbling low; one gust drives all of it.
- **Wind** overlay: half the seeds, far and middle depths, always behind the scene's own
  objects; no branch, loose leaves or backlight. The scene underneath shows the rest.

#### Combined: the weather is always drawn over the scene (#655, owner direction 2026-11-10)

The owner, after seeing Autumn on the TV: "winter should also have snow falling (synced to
if its snow falling/rain/weather pattterns, but same thing not overbearing). the weather sync
should be always". Until then a scene kept its place only under the two or three kinds of
weather its flat art had been drawn for; any other kind replaced it with the standalone
weather scene (snow in November replaced Autumn, rain in a thaw replaced Winter, a storm
replaced everything but Summer).

- **Rule.** In Combined mode the season, holiday or birthday scene always stays, and the
  weather the resolver reports (rain, snow, storm, fog or wind) is drawn over it: 105
  pairings, none excluded. A weather scene on its own is Weather mode only. Off and
  Seasonal & holidays are unchanged, and so is when weather counts as present (current, or
  forecast within three hours).
- **In the data.** `resolveTheme` returns the weather kind as `motif` and the scene that
  stays as `habitat`. The per-scene list of kinds in the flat art data, which used to gate
  this, had no other reader and is removed.
- **Colours.** Unchanged: over a holiday or birthday the weather takes that scene's
  palette, so the day keeps its colours; over a plain season it brings its own; on a
  selected quiet date everything is the quiet grey. In 3D the season scenes paint their own
  objects and ignore the palette, so there this only tints the overlay (a holiday's rain is
  35% that holiday's colour). In the flat fallback the palette colours the whole scene, so
  a season under weather is drawn in the weather's colours, as it already was for the
  kinds it listed.
- **Quiet dates and tier.** A selected quiet date keeps its rule: the quiet season stays
  under the weather, grey. In 3D the frame is frozen with nothing falling. The flat
  fallback is not the same: under rain or a storm it still draws one moving streak group
  with its ripples, and under fog two drifting blobs, as it did before #655 (#659). Weather
  over a scene keeps that scene's tier.
- **Flat fallback.** The flat renderer never had per-pairing art: it draws the scene's own
  patches and one generic treatment per kind (rain or storm streaks with ripples, 14 flakes
  and a snow drift, gust streaks with the scene's own particles blown sideways, five fog
  blobs). That now applies to every pairing. All 126 combinations of 21 scenes alone and
  under each kind stay inside the animation budget (busiest: rain or a storm over Summer,
  36 of 48).
- **Low-key.** The overlays were already reduced versions of the weather scenes (half the
  particles, no near band, no drifts, pool or trunks). Captures of snow over Autumn, snow
  and rain over Winter, a storm over Christmas, snow over Spring and rain over a birthday
  were looked at for this change: the weather reads as light and the scene is not hidden.
- **Not covered here.** A scene changing its own objects for the weather over it is
  [#646](https://github.com/8roundshock/living-room-display/issues/646). Two cases are now
  reachable that were not before: Christmas and Orthodox Christmas keep their own
  decorative snowfall under rain or a storm (they leave it out only under real snow).
- **The current-scene line** in Style names both: "Snow now · Autumn", "Rain now ·
  Christmas", "Storms expected soon · Birthday".

The Storms glow (coordinator decision on #619) is not lightning and not a flash: no bolt
is drawn; the glow takes 1.6 s to rise, holds 0.4 s and fades over 5 s, 48 to 128 s apart;
it is drawn only through the cloud's own density, so nothing outside the cloud brightens;
overlapping volumes take the lighter value instead of adding up; and its peak stays below
widget text (0.68 of white on the canvas, drawn at 0.855 of the saved brightness).

Thread, flake and band strengths are higher than the figures in the design plans, which were
chosen beside the picker's brighter stand-in layer: in the app the layer is drawn at about a
third, and the planned values could not be seen there. Scene pixels alone at a saved 36%
(1920×1080, empty board): brightest pixel 49-60 of 255 in all five scenes, against widget
text at about 69.

Measured on 2026-11-10 like the table under Runtime (1920×1080 and 3840×2160, default
board, three runs): Rain 13,400 triangles and 8 draw calls, Snow 4,700 and 13, Storms 300
and 5, Fog 4,400 and 12, Wind 5,500 and 52; a frame costs 0.03-0.7 ms of script and 0.4-3 ms
with the GPU; the page's main thread spends 20-41 ms per second on a running scene, and
building one takes 50-410 ms. Rain, snow and storm particles move in the vertex shader (one
uniform a frame). An overlay adds 2 to 6 draw calls to the scene underneath; its
main-thread cost could not be told apart from the run-to-run variation (the PC was busy
with other work when this was measured, so the main-thread figures are the noisy ones).

**Russian family** (six scenes with their own modules; six heroes, none shared; shared
pieces are `parts/new-year-tree-*`, `orthodox-christmas-*`, `maslenitsa-*`, `pascha-*`,
`mimosa-*` and `birthday-russian-*`):

- **New Year · Russia** ([#622](https://github.com/8roundshock/living-room-display/issues/622)), everyday:
  the top of a sparse spruce in the bottom-left corner with a glass spire, seven glass pieces
  that all differ (two twisted icicles, two cones, a pyramid drop, one "reflector" ball, a
  clip-on bird), a bead thread and three wisps of foil rain; four tangerines, one half
  peeled, in the bottom-right corner. No wreath, swag, lights or snow.
- **Orthodox Christmas** ([#623](https://github.com/8roundshock/living-room-display/issues/623)), special:
  a carollers' eight-rayed paper star on a pole at the right edge, its drum lit from inside,
  ribbons under it, planted in a snow drift; one steady first star in the top-left corner; a
  thin fall of snow.
- **Maslenitsa · Russia** ([#624](https://github.com/8roundshock/living-room-display/issues/624)), special but kept calm all week:
  a stack of thin lacy blini on a plate in the bottom-right corner with melting butter and
  honey, a folded blin, red caviar in cut glass and soured cream in a clay bowl with a wooden
  spoon; low sun as light only in the bottom-left corner.
- **Orthodox Easter** ([#625](https://github.com/8roundshock/living-room-display/issues/625)), everyday:
  a tall kulich under dripping white glaze on a plate and linen napkin with five plain red
  and maroon eggs in the bottom-left corner; pussy willow in an unglazed clay jug at the
  right edge.
- **Women’s Day · Russia** ([#626](https://github.com/8roundshock/living-room-display/issues/626)), special:
  a spray of mimosa in a clear glass vase rising up the left side, a few shed blossom balls;
  five tulips (coral, pink, cream; bud to open) tied with a lilac ribbon along the bottom
  right.
- **Birthday · Russian accents** ([#627](https://github.com/8roundshock/living-room-display/issues/627)), special:
  its own module, so it no longer borrows Birthday's. A candle-lit honey layer cake with a
  cut wedge on a low-footed plate, a linen runner with a red diamond band, tea in a glass
  holder and the cut slice in the bottom-right corner; three balloons tied to a
  paper-wrapped bunch of seven flowers in the bottom-left.

Not built yet, waiting for the day-of lift ([#632](https://github.com/8roundshock/living-room-display/issues/632)): the sparkler of 31 December and
1 January, and the brighter Pascha Sunday. Measured as the reference scenes were on
2026-11-10 (1920×1080, same PC): 12,000 to 170,000 triangles, 17 to 79 draw calls, build 70
to 165 ms after the first scene of a session, frame 1.0 to 3.7 ms with GPU; a scene chunk
with its parts is 7 to 17 kB (3 to 7 kB gzipped).

Korean family (added 2026-11-10; one hero each, in four different corners, and no object
shared between two of the four; sources in [holiday calendar](holiday-calendar.md#cultural-art-references)):

- **Seollal · Korea** ([#628](https://github.com/8roundshock/living-room-display/issues/628)):
  one hanji shield kite (bangpae-yeon: round hole, five bamboo spars, indigo skirt, no tail)
  on a taut line in the top-left corner, a round and an eared silk lucky pouch on one hook
  in the top-right corner, four yut sticks as they fell at the bottom right.
- **Chuseok · Korea** ([#629](https://github.com/8roundshock/living-room-display/issues/629)):
  five half-moon songpyeon on pine needles on a woven tray in the bottom-left corner with an
  opened chestnut burr and jujubes beside it, a dim warm full moon in the top-right corner
  crossed by a leafy persimmon branch with three fruits still turning orange.
- **Buddha's Birthday · Korea** ([#630](https://github.com/8roundshock/living-room-display/issues/630)):
  one large pink lotus lantern with its blank tag in the top-right corner, and a white
  lotus, an eight-sided palmo-deung and a pale-yellow lotus on one cord across the top
  left; lanterns only, nothing on the ground.
- **Birthday · Korean accents** ([#631](https://github.com/8roundshock/living-room-display/issues/631)),
  now its own module instead of the shared Birthday one: a candle-lit cake and a brass bowl
  of seaweed soup on a low lacquered soban in the bottom-right corner with three balloons
  tied to the table, two gifts in knotted silk bojagi at the bottom left, a sheer jogakbo
  patchwork cloth hanging in the top-left corner.

Seollal and Chuseok are everyday-tier scenes (nine-day windows). Each has one more element
for its three holiday days (a far ray kite; ripening rice), drawn only when the engine
gives the scene the special tier, which waits for
[#632](https://github.com/8roundshock/living-room-display/issues/632). Measured like the
table below (2026-11-10, 1920×1080): 26,000 to 60,000 triangles, 49 to 84 draw calls,
build 60 to 140 ms, frame script 0.7 to 1.5 ms and 2.6 to 4.1 ms with the GPU. As the first
scene of a session, which also compiles the shaders, Seollal built in 0.37 to 0.81 s over
nine runs (median 0.49 s) on a machine busy with other work; Christmas took 0.39 s the
same way.

### Which renderer draws a scene

`AmbientTheme.tsx` chooses once per scene. The layer's root carries
`data-scene-renderer="3d"` or `"flat"` beside the existing motif, habitat, source, quiet and
still attributes.

- **3D** when `src/client/scene3d/scenes/<id>.js` exists (found at build time, so adding a
  scene edits no list), the browser gives the page hardware WebGL, and, with weather over
  the scene in Combined, `weather/<kind>.js` exists too. All five kinds have one.
- **Flat** otherwise: a scene without a module yet, weather over a 3D scene whose overlay
  does not exist yet (the flat renderer still draws that weather), no WebGL, a software
  rasteriser, a GPU that needs more than 120 ms a frame, a lost context, or a scene module
  that throws. Nothing is thrown to the page.

Unchanged rules: Theme Off, Animation Off and system reduced motion mount nothing (and
download nothing 3D); the editor's still preview draws one static frame and runs no loop;
a selected quiet date draws a frozen, desaturated frame with nothing in the air, amount
×0.4 and opacity ×0.38; saved brightness is never raised; true black; no audio and no
flashes (the Storms scene's slow glow inside its cloud is described under
[Weather scenes and overlays](#weather-scenes-and-overlays)). The opt-in foreground passage is untouched, and because it starts from the flat
renderer's patches it does not start over a 3D scene
([#589](https://github.com/8roundshock/living-room-display/issues/589),
[#634](https://github.com/8roundshock/living-room-display/issues/634)).

### Runtime

- Nothing 3D is in the dashboard bundle. The engine with three.js is one lazily loaded
  chunk of 622 kB (161 kB gzipped); a scene module is 2-4 kB. The dashboard bundle grew by
  6.6 kB (815.6 to 822.2 kB) for the loader, the settings and the tier rule.
- three.js is pinned at 0.128.0, the release the approved look was rendered with
  ([#633](https://github.com/8roundshock/living-room-display/issues/633) upgrades it;
  [#635](https://github.com/8roundshock/living-room-display/issues/635) keeps its 24 MB
  package out of the installed payload).
- The backing store is at most 2560×1440. About 20 frames a second, none while the
  document is hidden, and never a frame queued behind one the GPU has not finished.
- One stage owns one canvas and one WebGL context and releases both on unmount.
- The whole scene drifts on a slow closed path (about 17 px sideways and 7 px up and down
  at 1080p, over seven and five minutes) so standing objects do not light the same pixels
  for weeks. This reduces fixed patterns; it is not a burn-in guarantee.

Measured on 2026-11-10, source build, headless Edge on the development PC's GeForce GTX
1080 Ti, default board:

| Scene | Triangles | Draw calls | Build, once | Main thread, running | Frame: script | Frame: with GPU |
| --- | --- | --- | --- | --- | --- | --- |
| Christmas, 1920×1080 | 282,000 | 104 | 391 ms | 36 ms/s | 0.7 ms | 1.8 ms |
| Canada Day, 1920×1080 | 32,000 | 30 | 56 ms | 40 ms/s | 1.1 ms | 3.6 ms |
| Birthday, 1920×1080 | 98,000 | 82 | 59 ms | 42 ms/s | 0.9 ms | 3.7 ms |
| Christmas, 3840×2160 | 282,000 | 104 | 372 ms | 34 ms/s | 0.6 ms | 1.9 ms |
| Canada Day, 3840×2160 | 32,000 | 30 | 50 ms | 42 ms/s | 1.3 ms | 2.5 ms |
| Birthday, 3840×2160 | 98,000 | 82 | 50 ms | 32 ms/s | 0.8 ms | 2.1 ms |

"Build" is the one-time main-thread cost when a scene starts (the first of a session
includes compiling its shaders). "Main thread, running" is the page's task time per
second at the real 20 frames a second. At 3840×2160 the backing store is 2560×1440. On a
software rasteriser the same scenes take 0.2 to 1 s a frame at 1920×1080, which is why
one is refused. Run-to-run variation of the main-thread figure is about 10 ms/s. Total GPU and energy cost stays with #364.

### Iteration loop

Edit the scene file; `npm run build`; capture two or three scenes to a temporary folder
with `tests/ui/tools/scene-sheet.mjs` (`--full` to judge the art, without it to see the
real layer); look; fix; delete the folder. One independent code review per pull request. No
multi-round agent reviews for taste: the owner judges taste on the display.

### Verification and limits

`node --test "src/client/scene3d/*.test.ts"` covers the picks, the tier rule, scene
resolution and the module-file contract. The `scene3d` browser suite runs with WebGL
(software-rendered on the CI runner, `--gpu` for a real GPU) and covers the 3D path; the
`themes` suite runs without WebGL and covers the flat fallback for all 26 scenes. See
[development](development.md).

Not verified: the installed app, the native screensaver host (whether its browser gives the
page hardware WebGL has not been observed), physical-TV viewing, a 3D scene on a quiet date
(no reference scene falls on one; the engine's frozen, particle-free frame is checked
directly), and long-run behaviour over days.

## Layered living scenes (#586)

Implemented in source on draft [PR #588](https://github.com/8roundshock/living-room-display/pull/588),
following the [layered scene plan](layered-scene-plan.md). **This section is the
contract of the flat fallback renderer** (see [3D scenes](#3d-scenes-600-owner-decision-2026-11-10)). The sections after it are kept for the decisions
that still hold (modes, calendars, weather resolution, Try a scene, birthdays);
each one says where it describes the earlier floating-mark renderer, which no
longer runs.

Owner direction, 2026-11-09, after an independent visual review judged the first
all-scene candidate a corner vignette that was too small, too muted and nearly
still: scenery runs along the whole bottom edge, a second edge is always
dressed, hero forms are large, colour is saturated, motion is plainly visible,
particles are always in flight and renewal never leaves an area empty. Those
words supersede the plan's first numeric starting points (5-12% habitats, 80%
exact black, 32 animations); the values below are the current ones.

### What is drawn

Everything is one SVG behind the widgets under one luminance mask cut from the
measured reading areas and their near-future movement, on true black.

1. **Ground band** (`groundBand` in `living-dressing.ts`): continuous grass,
   snow drift, leaf bed, cloth or water along 100% of the bottom edge. Under a
   reading area it keeps only the strip between that area and the edge (about
   40-60px on the default board); in free columns it rises to 10-19% of the
   short side. A slope limit turns steps into ramps. A rear layer sits behind
   the authored drawings and a front layer over their bases.
2. **Top band** (`topBand`): leaf or blossom canopy, fir garland with ornaments,
   bunting, streamers, icicles, a lantern string or storm cloud along the top
   edge; a thin fringe above widgets, deep in free columns, with pendants that
   swing as pendulums only where a column is free. Fog has no top band.
3. **Authored habitat patches** (`living-scene-art.ts`, `living-celebration-art.ts`):
   the principal drawing and counterweights of each of the 26 scenes, drawn
   1.45x their authored size (`SCENE_SCALE`), capped at 94% of the width and 60%
   of the short side. The dim far bottom silhouettes of the first compositions
   are no longer drawn; the ground band replaces them.
4. **Particles** (`particleLayers`): 31-64 depth-scaled forms (8-30px) always in
   flight as four layers: snow at several sizes, petals, leaves, confetti,
   sparkles or firefly motes. Fresh rain and storms draw 72 streaks in two
   depths with splashes instead; fog draws five soft radial blobs (three low,
   two as a top haze) under a blurred copy of the mask so it never outlines
   widgets; fresh snow lays a deeper drift and icicles on any scene with 96 flakes; wind adds gust streaks
   in open lanes and blows the leaf layers sideways.

Bands, pendants and particles are generated in a 1080-short-side space and drawn
scaled to the viewport, so their proportions and path counts are the same at 4K
as at 1080p. Three masks are cut from the same reading areas: patches, bands,
rain and gust streaks use the hard mask; fog uses a wide feathered copy (holes
grown 4.5% of the short side, blurred 2.2%) so it never outlines widgets;
particles use their own tight feathered copy (grown 1.5%, blurred 1%), fading
over about 25-30px beside text instead of being clipped into half-shapes. The
wide feather was first shared with particles and hid 40-85% of them on
populated boards, which is why they have their own. Pendants are spaced at 8-12%
of the short side and capped at 12, because each is its own animation.

`src/shared/living-scene-dressing.ts` names each scene's ground, top and
particle kind (and fixed ground or canopy colours where the scene palette's
first role is not ground-coloured). These are art choices, not weather or
cultural claims: in this flat renderer Christmas, New Year (Russia), Orthodox
Christmas and Winter show authored snowfall whatever the weather is. That no
longer holds for Winter in 3D (coordinator decision on
[#616](https://github.com/8roundshock/living-room-display/issues/616),
2026-11-10): its air is still, and snow falls over it only when the forecast
says snow. The flat Winter keeps its snowfall only as the fallback.

Palettes in the registry are saturated (true reds, bright yellow, orange, mid
green). Authored fills follow a low-light curve (`fill^0.45`) with a lighter rim
of the same hue. Saved brightness still scales the whole layer and is never
raised.

### Fitting order for authored patches

1. The authored root, when every group is whole.
2. The same complete patch at another root on its own edge: six sizes (100%,
   86%, 74%, 62%, 52%, 44%) by 25 positions, scored by retained drawn area so
   the principal form dominates. The largest habitat is placed first; a later
   patch pays for the share of itself that would cover an earlier one. A top
   drawing whose whole top edge is reading space may enter lower from its own
   side or, reflected, from the opposite side (13 positions per size; accepted
   by the coordinator on 2026-11-09). Group relationships inside a patch never
   change. A patch may crop a larger drawing (`origin`), which is how the
   birthday cake with gifts and the balloon bunch became separate patches.
3. A group's authored compact drawing, then uniform shortening to no less than 65%.
4. Omission of that group. The mask is a safety net, never a way to show a
   sheared drawing.

`src/client/living-scene-principals.ts` names the principal silhouette of every
scene. Unit and browser checks require those groups to stay visible and complete
on the default board, and visible on a dense board. Do not replace this with a
path or placement count.

### Motion and renewal

- Rooted groups sway on one shared 12-second phrase: grass 7.5 degrees, hanging
  forms 8.5, branches 4, drifts 2.4 (more in wind, rain and storms); the birthday
  balloons float, bobbing about 10-20px on their tethers. The sweep
  is part of the fitted bounds. Rear grass sways in five segments with a
  travelling phase; pendants swing 7-12 degrees on 6, 9 or 12-second periods.
- A root is chosen once per 36-second local generation and for each still
  editor layout. Renewal **cross-fades** to the next generation's root, shifted
  by up to 2% of the short side, over 3.2 seconds; patches renew 12 seconds
  apart and none is ever absent. A root is chosen again mid-generation only when
  reading-space changes cost that patch more than 40% of its retained
  silhouette, or it has none yet.
- Each edge band shifts 12px each way over 36 seconds. Together with sway,
  particles and the renewal shift, lit pixels keep changing; the low front band
  itself changes shape only when reading areas change. This reduces fixed
  patterns and is not a burn-in guarantee.
- Every animation is finite and touches only transform or opacity. Periods
  divide the 36-second scene life, so layers rejoin their own phase when they
  are renewed. No frame-by-frame script.

Quiet dates draw at most two unfilled habitat patches at 38% of brightness and
no bands, pendants, particles or passage. Off, Animation Off and system reduced
motion mount nothing.

### Foreground moments

One opt-in checkbox in the Style inspector's scene options, default off and
omitted from saved data when off (an enabled value is an older-reader rollback
exception, see [install](install.md#additive-data-and-rollback-compatibility-84)
and [API](api.md#ambient-themes-and-holiday-sources-575-458)). It stays opt-in:
making it the default would need a stored "off" value, which changes what an
untouched installation saves and what an older reader accepts; that is a
separate persistence decision, recorded on
[#589](https://github.com/8roundshock/living-room-display/issues/589).

`scene-passage.ts` plans one actor at a time, at most one start per 60 seconds
across the display and 180 seconds per target:

- A *near* passage is a cluster of four forms about 80px across at `0.9 x`
  brightness that leaves a visible habitat and arcs up to 44% of the short side
  through widget whitespace for 6 seconds. Its whole path must clear every
  reading rectangle and movement envelope, and it is cancelled if reading space
  reaches it. Text, digits and graphics (including `aria-hidden` weather glyphs)
  are readings.
- An *incursion* may graze only a large current-temperature value: at most 1.2
  seconds of contact and 5% of that reading area, at `0.22 x` brightness.

What already overlaps widgets without the option: the ground and top bands run
through widget cells' empty margins on every scene. What still does not happen:
a passage visibly crossing text or glyphs. That is deliberate.

### Measured on 2026-11-10

Isolated synthetic source server, headless Edge, default board, 1920x1080, 26%
brightness, scene-only pixels:

- Fog (2026-11-10, third round) is five soft radial blobs under the wide feathered
  mask; particles have their own tight feathered mask (fourth round).
- Lit pixels 5.6-12.2% (median 8.6%); bottom-edge columns lit 100% in all 26
  scenes and both Combined samples; top-edge columns lit 100% except Fog (40%).
- Scene luminance: median 21-52 and 99th percentile 47-58 of 255, against
  widget text at about 36-42.
- 4.2-second samples: 56-139ms main-thread task time, 25-65 style/layout
  updates, 19-32 layers, 9-23 running animations, 14-87 paths; no layer paints
  reported. Motion off: 6ms, nothing mounted. After viewport scaling (third
  round) Summer and Wind measured 87-92ms and 33 layers at both 1920x1080 and
  3840x2160.
- Upper bound of running animations on an empty board, by unit test, at
  1920x1080, 3840x2160 and 3440x1440: 16 (Snow) to 39 (Wind) of 48 for scenes on
  their own; Combined pairings reach 41 (wind on Summer).
- Structural caps (`LIVING_SCENE_BUDGET`): 4 patches, 420 paths, 48 animations.
  The plan's first caps (240 paths, 32 animations, 40 layers, 150ms) were set
  for sparse scenery; the path and animation caps were raised with these
  measurements, and the 150ms and 40-layer ceilings still hold at 1080p.

Animated SVG is main-thread work, not compositor-only; total GPU and energy
cost stays with #364. Before viewport scaling, headless 4K capture of the Wind
scene sometimes rastered its first frames late; real-display behaviour is unverified.

Not verified here: the installed app, native/idle display, physical-TV viewing,
a long-run temporal coverage heatmap and 45-second human review of every scene.
Known weak points are listed on #586.

## Design decision (2026-11-04)

History for the composition parts: the mode selector, calendars and Combined
rule below are current; the paragraphs about anchors, companion marks, slots and
a 13%-opacity fill pass describe the removed floating-mark renderer.

Independent coordinator concept critique chose one native Theme selector in the
Style inspector over scene cards (too tall) or an automatic-only switch (hides
the requested modes). The choices are Off, Weather, Seasonal & holidays and
Combined. Seasonal/Combined reveal Canada, Korea and Russia checkboxes. Dynamic's
opt-in Holidays source exposes the same choices directly, including with themes
Off. Empty calendars still keep seasons. Combined first meant “Seasonal until noteworthy weather
is near”: weather a scene did not list replaced it. Since #655 the scene always stays and
the weather is drawn over it (see
[Combined](#combined-the-weather-is-always-drawn-over-the-scene-655-owner-direction-2026-11-10)).
The resolved scene distinguishes current conditions from forecasts.

History (#579, removed renderer): cultural research and concept critique compared
enlarged repeated icons, a fixed botanical vignette and migrating contour
compositions, and chose a recognizable original anchor with simpler companion
marks placed one by one in measured negative space. That mark renderer no longer
runs. What survives from it is the motif vocabulary: three distinct winter
festivities (fir and ornaments, New Year arcs or the Russian tree, an Orthodox
Christmas star), an open-centred rectangular Seollal kite, a separated full
Chuseok moon with harvest forms, and lotus lanterns for Buddha's Birthday.

History (#582, removed renderer): owner direction on 2026-11-04 asked for noticeably
more colour, more visible forms and richer characteristic movement across the
then 23 scenes. That pass
uses three prominent palette roles and multi-scale contours with small local
13%-opacity fills, instead of a particle-count-only change or broad filled
vignettes. Global brightness stays authoritative; compare at 26% and 36% rather
than raising saved settings. A feature form recurs every third seasonal birth,
with distinct smaller companions between it. Winter crystals, summer flowers,
Maslenitsa pancake stacks and geometric Pascha eggs improve silhouette identity.
The first visual pass found weather still disproportionately faint; the second
uses a broader feature every third birth, smaller companions and stronger coloured
strokes. Rain has droplets/ripples and streaks, snow readable crystal groups,
storms curled cloud/rain, fog three separated ribbons and wind leaves/currents.

Still current: one bounded layer sits behind widgets on true black, without
full-screen fills, flashes, drawn lightning bolts or audio. The only storm light is the 3D
Storms scene's glow inside its cloud: slow (1.6 s to rise, 5 s to fade, about once a minute
or two), soft, never brighter than widget text, and nothing outside the cloud brightens
([Weather scenes and overlays](#weather-scenes-and-overlays), #619). Weather chooses the geometry; a seasonal or celebratory tint can remain.
Exact selected quiet dates use neutral seasonal/weather contours. Off does
not mount the layer; reduced motion and Animation Off remove it entirely. This
does not promise OLED burn-in prevention or substitute for weather alerts.

Primary guidance checked 2026-11-04: [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
informs optional, purposeful, restrained movement; [Apple reduced-motion criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
informs stopping decorative motion when the system requests it. Existing native
select/checkbox controls preserve platform keyboard behavior. This is an original
web adaptation, not Apple certification. Recheck on changes to motion, theme
selection, accessibility preferences or new render platforms.

## Compatibility

The default theme is omitted from saved data and exports, including saved styles.
Selecting a theme or custom calendar selection writes an additive appearance
field older strict readers cannot understand; turn it Off and restore all three
calendars before rolling back, or restore the pre-update backup. The new Dynamic
holiday source is opt-in and omitted when false. Enabling it is likewise an
explicit older-reader rollback exception. No historical compatibility fixture is
modified to make a new feature pass.

## Resolution and motion

Weather uses fresh, connected readings for the selected location. Current codes
must be at most 90 minutes old; forecast conditions look ahead three hours.
Hourly codes are instants, while gusts describe the preceding hour. Only a wholly
upcoming gust interval produces “expected soon.” Wind and gust thresholds are
shared with Dynamic. Stale, disconnected or unknown weather falls back to seasons
and holidays in Combined; Weather alone becomes quiet. This is decoration, not an
official warning. Enabling Weather or Combined requests the existing forecast
even if all weather widgets are hidden; it adds no provider or faster polling.

Seasons follow the configured location's hemisphere. Holiday dates follow the
computer's civil date, with selectable curated calendars documented in
[Holiday calendar](holiday-calendar.md). Major holidays have bounded lead windows;
commemorations take precedence over festive anticipation. Unsupported Korean
lunar-date runtimes show a brief limitation; fixed dates and seasons remain.

Motion is described in [Layered living scenes](#layered-living-scenes-586).
The normal editor immediately shows a representative still scene when a theme is
enabled and motion is allowed; Preview movement runs the same finite animation.
Animation Off and system reduced motion remove both and explain why in Style.
(The earlier renderer's 12-second marks, slot counts and eight registry motion
profiles are no longer used.)

Try a scene occupies the existing canvas caption and opens a compact native
grouped select. Its Preview/display-unchanged label stays visible until Automatic
is restored. It can demonstrate a scene with Theme Off, without changing the
saved mode, dates, weather or display. This is local editor state, cleared by
Cancel, mode/calendar/style changes, layout editing and leaving. It never makes
the draft dirty or adds a persistence field. The collapsed control keeps the
default Style inspector's 720px height budget.
On narrow/short windows the expanded chooser follows document flow, so the sticky
style toolbar cannot cover its label/select. The native popup retains the app's
explicit dark option/optgroup contrast.

## Extension authority

The repository-local [theme skill](../.agents/skills/living-room-theme/SKILL.md)
routes future changes. `src/shared/theme-registry.ts` is the actual shared source
for scene identity, palette and explicit holiday eligibility/windows/priorities;
the picker derives its options from it. Authored compositions live in
`living-scene-art.ts` and `living-celebration-art.ts`. `holidays.ts` owns factual
calendar rules. `ambient-theme.ts` resolves current weather/season/holiday and
creates explicitly labelled illustrations. `src/client/scene3d/` owns the 3D renderer: one file per scene under `scenes/`, weather
overlays under `weather/`, the owner's look in `settings.ts`, the tier rule in `tier.ts`
and the contract in its README; `AmbientTheme.tsx` chooses between it and the flat
renderer. `LivingTheme.tsx` and `living-scene.ts`
own the flat renderer's whole-patch fitting and finite choreography, `SceneForeground.tsx` and
`scene-passage.ts` the optional passage; `Display.tsx` supplies reading-area
exclusions/brightness. The registry's older per-mark `art`, slot and motion-profile
fields are no longer rendered; their removal is tracked in
[#590](https://github.com/8roundshock/living-room-display/issues/590).
Add one scene and explicit policy, source its cultural meaning in the calendar
doc, and exercise date boundaries, weather priority, scene demonstration isolation,
ordinary preview, motion resumption and compact controls. Do not duplicate a
second list in UI, infer eligibility from a new public holiday, or rewrite date
facts just to change a decorative lead window.

## Source verification

The `scene3d` browser suite (#600) covers the 3D renderer with WebGL enabled (and one
pairing that used to replace its scene, a storm over Canada Day, #655): the three
reference scenes' canvas, data attributes, drawn pixels and brightness bound, the 20
frames-a-second loop and its pause while hidden, fallback to the flat scene on a lost or
refused context, the still preview's single frame, release of every context on unmount,
and that Off, Animation Off and reduced motion download no 3D chunk.

The dedicated `themes` browser suite uses an ephemeral source server and synthetic
dates/weather, in a browser launched without WebGL so that every scene is drawn by the
flat renderer. It verifies Save/Cancel, shared calendar controls, the foreground
option's draft/omission, 44px keyboard targets, 320/390px and short editors, and
all 26 living scenes at 26%/1080p and 36%/4K: named principal forms visible and
complete on the default board, structural budgets, true black and a pixel proof
that no art touches reading ink (the scene is recoloured pure green in one RAM
screenshot; controls show a masked full-screen wash passes and an unmasked one
fails). It also covers Combined rain/snow, including pairings that replaced the scene
before #655 (snow over Autumn, a storm over Christmas), Weather-only isolation, quiet dates,
typography growth, 30-second step/glide swaps, Off/Animation Off/reduced motion,
finite transform/opacity animation, local patch renewal, foreground cadence and
opacity with glyph protection, bottom-edge coverage, the second edge, particles,
cross-faded renewal, minute-boundary continuity, a theme change during Preview
movement, and real browser Dangi. Its optional images are returned in RAM, never
saved. Bounded CDP samples compare an active scene with motion off: under 150ms
task time, at most 110 style and layout updates (measured 58; a per-frame
loop is about 250), five paints, 40 layers, and five style updates when idle.
A deliberate per-frame style invalidation must fail the idle allowance. The
general performance budget remains #364.
Calendar and weather units exercise lunar dates, lead-window expiry, stale data,
hourly hazards, DST and gust intervals. Persistence checks retain the frozen reader.
Canvas preview control changes also run the existing `workspace` browser suite
for alert clearance, dirty-state and scroll interactions alongside `themes`.

The original foundation's review/CI evidence belongs to [PR #576](https://github.com/8roundshock/living-room-display/pull/576).
The cultural refinement's review and CI belong to [PR #581](https://github.com/8roundshock/living-room-display/pull/581).
The richer styling pass's all-scene comparisons, focused regressions and current-head
review/CI belong to [PR #583](https://github.com/8roundshock/living-room-display/pull/583).
These are source checks; the theme suite establishes no installation or
native/physical-TV acceptance.

## Optional annual birthdays (#584)

Birthdays are global private content in Settings, independent of saved and
scheduled styles. The collapsed section edits up to 24 named month/day entries
with Classic, Russian accents or Korean accents, through ordinary Save/Cancel.
No birth year or age is requested. Invalid month/day pairs stay editable and
block Save. February 29 appears only in leap years, with conditional help.

Seasonal and Combined use the exact civil day only. A birthday takes precedence
over public festive windows and seasons; selected exact quiet dates retain
neutral subdued geometry. Weather mode stays weather. In Combined the birthday scene
stays and noteworthy weather is drawn over it in the birthday colours (#655). Same-day birthdays share their
treatment when identical; mixed treatments use Classic, independent of list order.
No personal label enters scene metadata or generic Try a scene options.

The birthday-first original cake, balloons and gift vocabulary uses three tones;
each treatment has its own colourway, with bunting along the top edge. The candle is a static contour in a
moving mark, never a flicker. The accents are textile-inspired product art, not
claims about a birthday ritual or a culture's canonical colours:

- [Russian Ethnographic Museum, REM2740-26](https://collection.ethnomuseum.ru/entity/OBJECT/378562)
  describes red embroidery bands and rows of diamonds on a nineteenth-century
  Vologda linen towel. The artwork uses an original small diamond ribbon on the
  cake/gift, without copying the object or its symbolic figures.
- [V&A, Jogakbo](https://www.vam.ac.uk/articles/jogakbo-traditional-korean-patchwork)
  describes irregular squares/rectangles and flat seams. Original offset panels
  sit inside a cake band or gift; there is no full-screen grid.

Primary museum sources reviewed 2026-11-04 by the independent cultural/UX critic.
Recheck on changes to cultural motifs or descriptions. Compared style-local dates,
a new content widget and global Settings; the latter preserves dates across style
switches and avoids adding a display surface or crowding the Style inspector.

The central registry owns all three birthday scenes and treatment-to-scene mapping;
`shared/birthdays.ts` owns date validation and same-day treatment resolution.
Top-level `settings.birthdays` is private local content included in explicit
exports/backups. Empty entries are omitted at rest; nonempty entries are an
explicit strict older-reader rollback exception. Remove them and save, then make
and save another intended settings change to rotate the old populated backup;
alternatively restore the complete pre-update copy before rolling back. Frozen compatibility readers
remain unchanged. Settings, themes and Workspace browser checks cover the new
controls and previews; source checks do not establish installed/native acceptance.
The birthday revision's visual/source review and CI belong to
[PR #585](https://github.com/8roundshock/living-room-display/pull/585). Its display
regression adds and removes a birthday within one minute while deliberately
retaining weather/theme identities; it fails the first checkpoint's missing memo
dependency and passes the correction. Compact validation keeps a short global
cue and field-associated reasons, with cancellable and concurrent-edit checks.
