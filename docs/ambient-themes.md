# Ambient themes

Work tracked in #584 (private annual birthdays), following #582 (richer colour/composition/motion), #579 and #575, with #452
hourly weather and #458 holiday cards. Themes default to Off; existing selections
are preserved. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Current rendering direction (#600, owner decision 2026-11-10)

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
  my living room": two faint bottom-corner washes (peak 20%), no top wash; eight slow
  particles (fourteen in snow); ground at 45%. The left and right edges carry one tall,
  thin flourish each, chosen per scene in `sideStyles` (`living-dressing.ts`): the side
  of a fir with a wound light string and a hanging string of lights for Christmas,
  blossom or leaf branches, frost twigs, ribbons, reeds. A flourish bows inward only as
  far as the free margin beside the widgets, and sways by half a degree.
- **Iteration.** Change the renderer, build, capture two or three scenes to a temp
  folder, look, delete the images. Do not run multi-round agent reviews for taste.

The top-band generator, the old mask description and the ink pixel-proof helper are
now unused; removing them is tracked in #590.

## Layered living scenes (#586)

Implemented in source on draft [PR #588](https://github.com/8roundshock/living-room-display/pull/588),
following the [layered scene plan](layered-scene-plan.md). **This section is the
current renderer contract.** The sections after it are kept for the decisions
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
cultural claims: Christmas, New Year (Russia), Orthodox Christmas and Winter
show authored snowfall whatever the weather is.

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
Off. Empty calendars still keep seasons. Combined means “Seasonal until noteworthy weather
is near.” The resolved scene distinguishes current conditions from forecasts.

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
full-screen fills, lightning flashes or audio. Weather chooses the geometry; a seasonal or celebratory tint can remain.
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
creates explicitly labelled illustrations. `LivingTheme.tsx` and `living-scene.ts`
own whole-patch fitting and finite choreography, `SceneForeground.tsx` and
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

The dedicated `themes` browser suite uses an ephemeral source server and synthetic
dates/weather. It verifies Save/Cancel, shared calendar controls, the foreground
option's draft/omission, 44px keyboard targets, 320/390px and short editors, and
all 26 living scenes at 26%/1080p and 36%/4K: named principal forms visible and
complete on the default board, structural budgets, true black and a pixel proof
that no art touches reading ink (the scene is recoloured pure green in one RAM
screenshot; controls show a masked full-screen wash passes and an unmasked one
fails). It also covers Combined rain/snow, Weather-only isolation, quiet dates,
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
neutral subdued geometry. Weather mode stays weather. In Combined, noteworthy
weather keeps its geometry with birthday colours. Same-day birthdays share their
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
