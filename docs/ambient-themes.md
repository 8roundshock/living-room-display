# Ambient themes

Work tracked in #584 (private annual birthdays), following #582 (richer colour/composition/motion), #579 and #575, with #452
hourly weather and #458 holiday cards. Themes default to Off; existing selections
are preserved. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Layered living scenes (#586)

Implemented in source on draft [PR #588](https://github.com/8roundshock/living-room-display/pull/588),
following the [layered scene plan](layered-scene-plan.md). This section is the
current renderer contract. Older sections below describe decisions that still
hold (modes, calendars, resolution, birthdays); where they mention independent
marks, slots or a 12-second birth rhythm they are history, replaced by this one.

Every one of the 26 registered scenes has one authored composition
(`src/shared/living-scene-art.ts`, `living-celebration-art.ts`): up to four edge
patches (a dim far silhouette, the principal habitat, counterweights), each a
complete drawing of rooted groups that sway on one shared phrase. `LivingTheme.tsx`
draws them in a single SVG behind the widgets, under one luminance mask cut from
the measured reading areas and their near-future movement.

Fitting order, most preferred first:

1. The authored root, when every group is whole.
2. The same complete patch at another root on its own edge: four sizes (100%,
   86%, 74%, 62%) by 25 positions, scored by retained drawn area so the principal
   form dominates. The largest habitat is placed first and later patches keep out
   of its gap. A top drawing whose whole top edge is reading space may enter
   lower from its own side or, reflected, from the opposite side (13 positions,
   three sizes). Group relationships inside a patch never change.
3. A group's authored compact drawing, then uniform shortening to no less than 65%.
4. Omission of that group. The mask is a safety net, never a way to show a
   sheared drawing.

A root is chosen once per 36-second local generation and for each still editor
layout. It is chosen again mid-generation only when reading-space changes cost
that patch more than 40% of its retained silhouette; the patch then fades in at
its new root. Patches retire to true black one at a time, 12 seconds apart, for
about one second plus fades; the information board never blanks.

Living air: seasons, celebrations, birthdays and the Wind scene release five
small detached forms from the scene's own passage art (seed, petal, leaf, husk
or ribbon curl), each one finite drift replaced at its own boundary while
invisible. Winter, Christmas, New Year (Russia) and Orthodox Christmas use an
authored snowfall instead; this is seasonal art, not a weather claim. Fresh
noteworthy weather replaces the drift with its one precipitation or fog field.
Fog ribbons take open space or are omitted. Thin authored fills follow a
low-light curve (`fill^0.62`) so they stay visible at 26%; saved brightness still
scales the whole layer and is never raised.

`src/client/living-scene-principals.ts` names the principal silhouette of every
scene (for example the birthday cake/gifts and balloons, the Christmas bough,
the Seollal kite, the lotus-lantern arc). Unit and browser checks require those
named groups to stay visible and complete on the default board, and visible on
a dense board. Do not replace this with a path or placement count.

### Foreground moments

One opt-in checkbox in the Style inspector's scene options, default off and
omitted from saved data when off (an enabled value is an older-reader rollback
exception, see [install](install.md#additive-data-and-rollback-compatibility-84)).
`scene-passage.ts` plans one small actor at a time, at most one start per 60
seconds across the display and 180 seconds per target, lasting 4.8 seconds:

- An *incursion* may graze only a large current-temperature value: at most 1.2
  seconds of contact and 5% of that reading area, at `0.22 x` brightness, bound
  to a visible habitat within 30% of the short side. Clock/timer digits, labels,
  alerts, hovered or focused widgets and all other readings are protected.
- Otherwise a *near* passage stays wholly in whitespace beside its habitat, at
  `0.8 x` brightness, and is cancelled if reading space reaches it.

Quiet dates, layout editing, the still editor preview, Animation Off, system
reduced motion and Theme Off never run a passage. Verified limit, 2026-11-09: on
the default synthetic board only near passages occurred; the incursion actor is
at most 13% of the target's width (about 14px beside a 108px value), so the
permitted overlap is technically present but barely perceptible. Making it a
worthwhile visible event within the same caps is tracked in
[#589](https://github.com/8roundshock/living-room-display/issues/589).

### Measured cost and known limits

Bounded 4.2-second production-browser samples at 1920x1080 on 2026-11-09
(synthetic data, headless Edge): 43-88ms main-thread task time, 23-55
style/layout updates, no layer paints reported, 15-20 layers, 9-14 running
animations and 20-47 scene paths, against the plan's 150ms, 40-layer,
32-animation and 240-path ceilings. Motion off measured zero scene work.
Animated SVG groups are main-thread work, not compositor-only; total GPU and
energy cost stays with #364. The structural caps are tested for all 26 scenes.

Not verified here: the installed app, native/idle display, physical-TV viewing,
a long-run temporal coverage heatmap, and 45-second human motion review of every
scene. Fog and the two weather-only precipitation scenes are the plainest
compositions; the principal habitat is fully dark for about a second of every
36 by design.

## Design decision (2026-11-04)

Independent coordinator concept critique chose one native Theme selector in the
Style inspector over scene cards (too tall) or an automatic-only switch (hides
the requested modes). The choices are Off, Weather, Seasonal & holidays and
Combined. Seasonal/Combined reveal Canada, Korea and Russia checkboxes. Dynamic's
opt-in Holidays source exposes the same choices directly, including with themes
Off. Empty calendars still keep seasons. Combined means “Seasonal until noteworthy weather
is near.” The resolved scene distinguishes current conditions from forecasts.

Independent cultural research and concept critique for #579 compared enlarged
repeated icons, a fixed botanical vignette and migrating contour compositions.
The chosen composition has a recognizable original anchor plus simpler companion
marks. The renderer measures widget reading areas and searches bounded negative
space; a crowded board can omit a mark. It reserves only the finite mark lifetime,
using the existing float/step waypoints and upcoming swap destination, including
the pending dim-before-step window. Typography/content measurement invalidates
still placement; an existing animated mark that becomes unsafe fades smoothly
without restarting other slots. This conservative retirement can precede its
natural expiry. There are no per-frame layout reads. Three distinct winter festivities use
fir/ornaments, broad New Year arcs or the Russian tree, and an Orthodox Christmas
star. Seollal uses an open-centred rectangular kite, Chuseok a separated full-moon
circle and harvest forms, and Buddha's Birthday lotus lanterns.

Owner direction, 2026-11-04 (#582), asks for noticeably more colour, more visible
forms and richer characteristic movement across all 23 scenes. The chosen pass
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

One bounded layer sits behind widgets. Its larger contours stay dim against true
black, without full-screen fills, blur, persistent borders, lightning flashes or
audio. Weather chooses the geometry; a seasonal or celebratory tint can remain.
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

Each mark uses one finite 12-second transform/opacity animation. Twelve weather
slots renew one at a time every 1.2 seconds, nine seasonal/holiday slots every
1.6 seconds, or eight fog slots every two seconds. Exact quiet dates keep four
slots at four-second intervals, neutral colour, no fills and reduced travel.
A slot lives 14.4–16 seconds,
so it becomes invisible before replacement. Initial marks fade in individually;
motif changes, quiet-day transitions and motion resumption start a fresh sequence.
Several forms stay visible at once. This provides continuous atmosphere without a per-frame
JavaScript loop; it does not claim zero continuous GPU work or unchanged energy use.
The normal editor immediately shows a representative still scene when enabled
and motion is allowed; Preview movement runs the same finite sequence. Animation
Off and system reduced motion remove both and explain why in Style.
Eight registry motion profiles provide five actual waypoints each: sway, flutter,
rise, drift, rain, snow, mist and wind. The renderer passes these to finite CSS
transforms; placement derives its bounds from the same waypoints, maximum
interpolated rotation and stroke extent. Per-mark scale/direction variation stays
inside those bounds. No frame-by-frame script, paint animation or flashing.

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
opacity, and real browser Dangi. Its optional images are returned in RAM, never
saved. Bounded CDP samples compare an active scene with motion off: under 150ms
task time, at most 150 style and layout updates (measured 27-55; a per-frame
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

The birthday-first original cake, balloons and gift vocabulary uses three tones
and the existing finite, bounded placement. The candle is a static contour in a
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
