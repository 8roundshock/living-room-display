# Layered living scenes — design and implementation plan

Primary work: [#586 — Create layered living scenes for every atmosphere theme](https://github.com/8roundshock/living-room-display/issues/586).
Plan written 2026-11-04. It remains the design record and gate list. Source
implementation status as of 2026-11-10 is in [Phase status](#phase-status-2026-11-10);
the current renderer contract is in [Ambient themes](ambient-themes.md#layered-living-scenes-586).
Budgets below are the plan's starting values, not measurements, unless the
status section says so. The feature issue stays open until the gates are met.

The owner wants the display to feel like a coherent, high-quality living scene.
The present atmosphere reads as separate floating stickers, despite its colour
and motion improvements. Summer grass along the bottom, seasonal edge scenery,
partial framing and occasional infrequent widget overlap are explicitly within
the requested direction. This supersedes the earlier assumption that every
decorative object must be a small isolated mark in an empty rectangle.

## What should change

Compose the entire screen before drawing individual objects. Each theme gets an
asymmetric edge habitat, a quieter counterweight on another edge, and a shared
environment that explains its motion. The centre remains mostly black and useful.
The result should still look intentional when animation is paused for inspection:
shape rhythm, clustered detail, restrained local shading and clear depth must do
more of the work than particles. Moving a larger icon is not this change.

Summer is the first proof: irregular rooted grass occupies a designed lower
silhouette, with uneven clumps, overlapping blades, a few taller seed heads and
open gaps. A gust travels across the clumps; neighbouring blades respond together
with slight phase differences. A seed may detach from that habitat and cross the
scene. Grass does not float as disconnected tufts or form a bright straight lawn.
Winter uses uneven edge drifts and differently scaled flakes; spring uses
branch/blossom arcs; autumn uses a leaf bed with an occasional coherent gust.

Three coordinated depths replace the current independent-square-slot model:

| Depth | Composition and motion | Relationship to information |
| --- | --- | --- |
| Far environment | Dark local silhouettes, an open horizon/branch arc or restrained atmospheric contour. Slowest movement, least detail. | Behind all widgets. No full-screen tinted plane. |
| Edge habitat and middle detail | One connected lower/side habitat, a counterbalancing fragment, attached detail and a few detached forms. Shared wind/gravity/choreography, varied scale and stroke/fill hierarchy. | Behind widgets; adapt contours and gaps to actual reading areas. Do not force the whole habitat into separate square gaps. |
| Near passage | One small leaf, petal, seed, snow cluster or celebratory ribbon/confetti passage, originating from the scene. Short, rare and finite. | May briefly pass across a widget under the explicit policy below; never a permanent overlay. |

An edge frame is a **partial organic composition**, such as two separated boughs,
an uneven grass edge, snow shoulders or one ribbon arc. No uninterrupted luminous
rectangle, four-corner ornament template or fixed bright border. The edge is not
a reserved strip that shrinks the user's widget layout.

Use original handcrafted SVG paths, restrained local fills and small static
gradients where they add form. Keep three main colour roles, with derived dark
tones for depth. Avoid uniform stroke weight, identical repeated silhouettes,
random emblem scattering, stock clip art, full-screen blur and flashing lights.
Do not present colour schemes or invented decorative details as cultural facts.

## Rendering options and proposed decision

| Option | Benefit | Cost and decision |
| --- | --- | --- |
| Authored SVG scene fragments with CSS/Web Animations transforms | Crisp at editor/1080p/4K sizes, original paths remain reviewable, deterministic envelopes and existing still previews are reusable. | Requires careful path grouping and finite choreography; many independently promoted fragments can still cost GPU memory. **Start here.** |
| Canvas scene with cached drawing layers | Useful if genuinely continuous vegetation/precipitation needs exceed a reasonable vector graph. | Adds redraw cadence, resolution/DPR handling, different mask/hit-test instrumentation and likely a changed paint budget. Not the default shortcut to quality. |
| SVG habitat plus a small Canvas atmosphere layer | Keeps authored silhouettes while supporting a limited dense effect. | Two render pipelines and new lifecycle/budget risks. Consider only after a measured SVG limitation in the first prototype; document the comparison on #586 and #364. |

The first implementation should have one scene controller and a small number of
authored fragments, not one React component/animation per blade. Grass clumps can
share base-pivot transforms with a travelling phase; falling forms follow the
same gust. Scene-level timing defines calm, breeze, passage and recovery phases.
Use finite segments with quiet handoffs; no synchronized fade of the whole screen.
The old every-third-feature/12-second birth rhythm is not an art requirement for
the new habitat. Keep finite retirement and bounded work, but author durations
that fit the scene rather than visibly respawning the landscape every 12 seconds.

The controller supplies background/middle and foreground siblings around the
widget plane, so depth does not require raising an entire background above text.
All decorative surfaces are non-interactive and hidden from accessibility trees.
One logical scene owns their palette, weather response, deterministic seed and
timeline. Incoming/outgoing transition fragments count against the same budgets.

Keep `src/shared/theme-registry.ts` authoritative for scene identity, composition
parameters, palette, motion envelopes and date/priority policy. A pure composition
planner may select wide/tall/dense variants and bounded edge anchors. The scene
renderer consumes that plan; it must not duplicate calendar logic or maintain a
second independent picker list. Geometry and actual animation share their path,
rotation, stroke and timing data. Measure reading areas at existing meaningful
layout/content boundaries, never once per animation frame.

## Complete scene inventory

The current source inventory has 4 seasons, 14 celebrations, 5 weather scenes
and 3 generic birthday treatments: **26** in total. The birthday feature
[#584 / PR #585](https://github.com/8roundshock/living-room-display/pull/585)
merged after independent review and CI; this plan integrates that reviewed source
base. It makes no installation or private-configuration claim. Do not copy any
actual person's names/dates into this work. Verify inventory against the registry
during implementation. The same composition grammar does not mean the same
silhouettes with different colours.

| Scene | Connected habitat / framing | Characteristic detail and motion |
| --- | --- | --- |
| Spring | Uneven flowering branch arcs entering from a lower side, open dark space between buds. | Attached blossoms respond to one breeze; a rare petal releases along it. No generic shower of flowers. |
| Summer | Rooted lower grass silhouette, varied clumps/seed heights and one smaller side counterweight. | Wind propagates across blades; occasional seed/pollen passage, not twinkling dots. |
| Autumn | Broken leaf bed and a low branch/grass silhouette, copper/plum/gold depth. | A gust lifts a small group from the bed, then settles; no constant diagonal icon stream. |
| Winter | Uneven edge snow shoulders, a sparse crystalline/twig counterweight. | Soft, varied-depth snowfall; drifting edge profiles change gently without a permanent white shelf. |
| Christmas | Asymmetric fir bough/garland fragments with attached ornaments and open gaps. | Bough and ornament motion share a sway; local warm detail, no blinking string-light border. |
| New Year · CA/KR | Broad open ribbon arcs and a low celebratory cluster. | A restrained, finite ribbon/confetti flourish; no fireworks or flashes. Distinct from fir and Maslenitsa. |
| New Year · Russia | Designed evergreen silhouette partly entering from one side, layered needles and attached ornaments. | Coherent tree/ornament sway, small celebratory release. Keep the existing Russian New Year distinction. |
| Orthodox Christmas | Quiet winter bough/celestial composition with an original star counterweight. | Slow restrained drift; no generic New Year confetti, copied sacred icon or flashing star. |
| Halloween | Low clustered pumpkins, curling vine and separated leaf silhouettes. | Vine/leaf motion and a few lifted leaves; pumpkins belong to the ground rather than floating stamps. |
| Thanksgiving · Canada | Low harvest arrangement of grain and leaves with an open side arc. | Stems move together; rare husk/leaf passage. Avoid borrowed Indigenous patterns or generic US imagery. |
| Canada Day | Original maple branch/leaf composition and a broad open ribbon. | Leaves respond to a breeze; restrained celebratory motion without a flag border. |
| Easter · Canada | Spring branches and a small grounded decorated-egg grouping. | Blossom drift and soft branch movement. Broad floral/curved egg detail distinct from Pascha. |
| Seollal · Korea | A deliberately placed open-centred rectangular kite/tail arc, with a small fabric/pouch counterweight. | Wind follows kite, tail and nearby elements coherently. Preserve the readable central opening. |
| Chuseok · Korea | Off-axis full-moon composition balanced by a lower grain/harvest silhouette. | Slow moon/air depth and linked grain sway; occasional husk. No generic crescent substitution. |
| Buddha's Birthday · Korea | Lotus-lantern grouping attached to an open garland arc with distinct petal structure. | Related suspended forms sway/rise gently; no generic lanterns or disembodied religious symbols. |
| Maslenitsa · Russia | Low pancake/table-textile arrangement, a restrained open cloth/ribbon counterweight. | Cloth and ribbon movement; warm layered form. Avoid a generic ring, copied ritual figure or assumed fire spectacle. |
| Orthodox Easter / Pascha | Spring twig arrangement and a small geometric decorated-egg grouping. | Restrained branch/cloth motion; egg pattern language and composition differ from Canadian Easter. |
| Women's Day · Russia | An asymmetric connected mimosa spray with distinct gold blossom clusters and green foliage. | Stems sway together; the blossoms remain visibly coloured at low brightness. |
| Birthday · Classic | Edge-anchored balloon/ribbon cluster and a lower cake/gift arrangement. | Buoyant balloon tension, related ribbon motion and rare confetti; birthday silhouette comes first. |
| Birthday · Russian accents | The same birthday vocabulary with a small original diamond-band textile accent inside wrapping/ribbon/cake detail. | Cranberry/gold/cool colour roles are art choices; no costume, flags or assumed ritual. |
| Birthday · Korean accents | Birthday grouping with a few asymmetric patchwork panels inside wrapping/cake detail. | Jade/coral/gold roles and restrained fabric motion; no full-screen patchwork grid or generic lantern replacement. |
| Rain | A neutral dark vegetation/ripple edge in Weather mode, or the current scene in Combined (every scene since #655; this plan first said only a compatible seasonal habitat), with directional rainfall in depth. | Rain direction, droplets, ground ripples and bending vegetation share one event; no uniform full-screen veil. |
| Snow | Drifts and a small twig/evergreen fragment, with separated flake scales/depths. | Falling/swaying crystals and slow drift changes; no opaque snow curtain. |
| Storms | Dark cloud/branch-edge grouping and stronger directional rain. | Coordinated wind/rain with calm intervals; no lightning, flashes or screen shake. |
| Fog | Sparse edge reeds/branch silhouettes and separated local contour ribbons. | Slow horizontal layers; black gaps stay open. No blurred full-screen grey wash. |
| Wind | Bent edge grass/branch forms, a few seed/leaf trajectories. | Coherent directional gust and recovery, not unrelated swirls. |

The cultural references already reviewed in [the calendar contract](holiday-calendar.md#cultural-art-references)
remain the starting authority for motifs. Change composition without rewriting
Dangi, Julian/Gregorian arithmetic, selected calendars, quiet dates, anticipation
windows or card-only eligibility. New motifs require primary-source review before
they are drawn; all vectors remain original, not traced museum assets.

## Combined mode, birthdays and quiet days

Separate the **resolved occasion**, **environmental condition** and **authored
composition**, while preserving existing user-facing modes and weather freshness.
Resolve only one primary occasion/season. Fresh noteworthy weather remains
perceptually dominant in Combined: it modifies that scene's wind, precipitation,
ground edge and palette instead of mounting a second unrelated set of icons.

Examples: rain bends the summer grass and creates sparse edge ripples; snow rests
on the winter/Christmas bough composition; a windy birthday scene changes balloon
tension and ribbon direction. A storm reduces celebratory detail rather than
adding a simultaneous party layer.

**Current rule (#655, owner direction 2026-11-10).** Combined always keeps the
season, holiday or birthday scene and draws the current or approaching weather
over it, for every weather kind. No scene lists the weather it supports any more,
and a weather scene on its own is Weather mode only; see
[Ambient themes](ambient-themes.md#combined-the-weather-is-always-drawn-over-the-scene-655-owner-direction-2026-11-10).

History, superseded by #655 and no longer followed: "Each primary scene declares
supported weather adaptations; an unsupported pair uses the standalone weather
composition with the existing contextual tint. Do not invent new combinations by
stacking layers."

Weather-only mode never displays holiday/birthday emblems. Stale/disconnected
weather follows the existing honest fallback, with no extra provider requests.
Use factual wind direction only when supported by the selected fresh forecast
data; otherwise the visual direction is authored motion, not a compass or weather
claim. No decorative animation should imply a more precise forecast than exists.

Keep the accepted #584 birthday policy: global private entries,
exact annual day, February 29 only in leap years, mixed same-day treatments use
Classic, birthday beats ordinary festive/seasonal scenery. Selected exact quiet
dates still take precedence. Quiet scenes are neutral/subdued seasonal or factual
weather habitats, with no festive geometry, foreground passages or party motion.
Do not use mourning symbols as decoration. No dates/names/age/greeting become art
assets, diagnostics, public fixtures or source control.

## Occasional foreground overlap

The owner explicitly permits infrequent widget overlap. Do not translate that
into permission for continuous occlusion, or retain the old blanket exclusion of
entire widget rectangles. Ordinary habitat remains behind information and avoids
reading ink; widget-container whitespace is usable composition space.

Propose one per-style **Foreground moments** toggle in the existing advanced
theme disclosure, default off for migrated/new styles and omitted at rest. The
owner-requested prototype demonstrates it on; the richer edge scene is the normal
improvement even when it is off. This is a targeted readability control, not a new
theme mode or density slider. Apply existing Save/Cancel and saved/scheduled-style
contracts, with strict validation, default omission and older-reader tests if the
field is retained after the first prototype. No separate always-on overlay.

Initial, deliberately conservative prototype limits:

- One designated foreground actor/cluster at a time; at most one passage per
  60 seconds across the whole display, with at least 180 seconds before reusing
  the same widget. Calm periods are part of the composition.
- Actual intersection with ordinary reading space lasts at most 1.2 seconds;
  its footprint is at most 5% of that reading-area rectangle. Intersecting
  opacity is at most `0.22 × effective brightness`, with no filled wash.
- Protect alerts, errors, focused/hovered controls, small secondary labels and
  critical clock/timer digits. Prefer broad whitespace. A permitted crossing
  must not obscure an entire numeral or word; a subtle partial crossing of
  noncritical larger content must pass actual reading inspection.
- Predict the swept path against moving widgets, pending swaps and growing
  text. An event that cannot meet these limits stays behind the widgets or is
  omitted. Endpoints alone are not proof. Cancel/fade a newly unsafe event
  without resetting unrelated habitat motion.
- No foreground passages in quiet scenes, layout editing, Animation Off or
  system reduced motion. The ordinary editor remains a still representative
  composition; Preview movement can demonstrate the finite passage locally.

These are product starting budgets, not a medical/accessibility or OLED safety
guarantee. Phase 1 must prove that they produce a worthwhile visible passage and
readable information at 26%/36%; revise with concrete evidence on #586 before
expanding the inventory. Do not weaken overlap tests merely to satisfy an image.

## Black, low light and motion composition

Respect saved fixed/daylight brightness across every depth. Do not compensate
for faint art by secretly raising brightness. Use visible silhouette and local
colour separation at 26%, then validate 36% and the supported brightness extremes.
Avoid full-screen tint/blur, luminous fixed baselines, pulsing global opacity,
screen flashes, audio and a dense bright rectangular frame.

Start with lower habitats roughly 5–12% of screen height, with isolated peaks up
to 18% and smaller side/top fragments. Adapt topology to available space, rather
than uniformly shrinking the composition until it disappears. The central reading field stays
open. A dense board can simplify/split the habitat and omit passages, while
retaining a recognizable edge silhouette where feasible. An empty board must
look composed, not like randomly enlarged copies of the populated-board marks.

Every visibly lit edge fragment must change its actual occupied pixels over time
through movement, local shape grouping or staggered replacement. A patch may
appear rooted while its base position/shape changes gently. Prototype a maximum
45-second unchanged-fragment dwell. Stagger local patch retreats fully to true
black while neighbouring habitat remains; never blank/fade the information board
or the whole display. Inspect a long-run temporal occupancy/coverage heatmap over
multiple complete cycles; a moving tip alone does not justify a permanently lit
root/border. This reduces fixed decorative patterns;
it does not promise burn-in prevention or replace physical viewing acceptance.

Off, Animation Off and system reduced motion keep the current no-atmosphere
behavior. No decorative per-frame React updates or layout reads. Plain SVG does
not guarantee compositor-only rendering: measure actual paint and layer costs,
especially for masks, gradients and transformed groups.

## Phases, ownership and stop gates

| Phase | Deliverable and proposed owned paths | Exit gate |
| --- | --- | --- |
| 0 — plan | This document and discovery links; coordinator + independent concept/final-head review. | Plan reviewed; #586 remains open. No renderer edits in the plan PR. |
| 1 — vertical slice | Art/UX owner: Summer habitat, integrated rain and one optional foreground passage. Renderer owner: `theme-registry.ts`, a proposed pure scene-composition module, `AmbientTheme.tsx`/CSS and `Display.tsx` depth/reading-space integration. One integrator owns Git. | Actual baseline/candidate whole-screen RAM comparison, 45-second motion review, low-light/default/dense proof and measured cost. Stop/revise if it still reads as floating stickers or only looks good on an empty board. |
| 2 — prove reuse | Winter+snow and one generic birthday textile treatment, then the other two birthday variants. Data owner only if the optional toggle needs contracts/defaults/validation/persistence. | Distinct topology works without a separate renderer per scene; quiet/reduced, weather priority, style drafts and birthday privacy remain intact. |
| 3 — complete inventory | Art/UX owner migrates all 26 scene definitions with current cultural references; planner/renderer stays shared. | Complete contact sheets and populated whole-scene motion review, no placeholder old icon groups left behind. |
| 4 — refine and integrate | Existing theme/Workspace/Settings tests, focused composition/bounds units, docs/skill/STATUS updated to actual final authority. | Two independent visual passes with corrections, exact pushed-head independent source review, applicable CI; every remaining acceptance item tracked. |
| 5 — delivery | Coordinator-owned supported update/release after approval; private settings configured locally if needed. | Separately authorized delivery evidence. No native/desktop/physical-TV acceptance inferred from source tests. |

Proposed runtime paths are an ownership map, not a second executable schema.
Agree the actual shared type and disjoint file ownership before delegation.
Keep one canonical registry and retire the old slot-specific implementation only
after the new controller has meaningful passing regressions. Do not broaden this
work into a widget-layout, motion-engine, provider, installer or calendar rewrite.
If the SVG prototype cannot meet the target, bring a measured Canvas comparison
back to the coordinator; do not silently replace the architecture mid-rollout.

The birthday PR is an independently delivered source feature, integrated into
this plan's base by merging current main. Do not reimplement its settings or
include birthday runtime changes in this plan PR's diff. Public planning uses
generic treatment names only. Follow the normal non-force-push integration/review
workflow.

## Phase status (2026-11-10)

Source state on draft PR #588. "Verified" means checked in this worktree with an
isolated synthetic server and headless Edge; nothing here is an installed,
native or physical-TV result.

| Phase | Status |
| --- | --- |
| 0 — plan | Done (PR #587). |
| 1 — vertical slice | Summer habitat, integrated rain and the optional passage are implemented and were inspected at low light and in real time. Open: 45-second human motion review and a temporal coverage heatmap. |
| 2 — prove reuse | Winter/snow and the three birthday treatments use the shared renderer. Quiet, reduced-motion, weather priority, style drafts and birthday privacy checks pass. |
| 3 — complete inventory | All 26 compositions render through one renderer with full-edge dressing. Every scene's named principal form is retained on the default and dense boards. The unused per-mark registry art still exists in source (#590). |
| 4 — refine and integrate | A first independent visual pass (2026-11-09) rejected the candidate; the second-round changes below answer it. Open: a second independent visual pass and independent review of the final pushed head. |
| 5 — delivery | Not started; needs separate authorization. |

### Starting values superseded by owner direction (2026-11-09)

The numbers earlier in this plan were first prototypes' starting points. The
owner's later words win where they conflict; the current values and their
measurements are in [Ambient themes](ambient-themes.md#layered-living-scenes-586).

| Plan starting value | Current value | Why |
| --- | --- | --- |
| Lower habitats 5-12% of height, peaks to 18% | Ground band 5-19% of the short side across the whole bottom edge; habitat drawings 1.45x, principal forms about 14-25% | The 18% peaks read as small corner stickers on a populated 1080p board. |
| At least 80% exact black, 40% of the perimeter unlit | 5.6-12.2% lit pixels; bottom edge 100% lit, top edge 100% lit except Fog | He asked for grass along the bottom or a border; text stays protected by the mask. |
| No persistent border | Continuous top and bottom bands that sway, shift 12px each way and cross-fade at renewal | Same request. Still no luminous rectangle, no side borders, no burn-in claim. |
| Patches retreat to true black one at a time | Cross-fade to the next generation's shifted root | The blink was the most noticeable event on screen. |
| 240 paths, 32 animations | 420 paths, 48 animations (measured at most 87 and 23) | Continuous particles and bands. 150ms and 40 layers still hold at 1080p. |
| Sway of a few degrees | Grass 7.5, hanging 8.5, branch 4 degrees; pendulum pendants | Motion was nearly imperceptible. |
| Foreground: one small actor, 0.22 x brightness | Near passage is a four-form cluster about 80px at 0.9 x that never touches readings; incursion caps unchanged | A 14px actor at 6% opacity was invisible. |

Unchanged: true-black background, the reading mask, Off / Animation Off /
reduced-motion behaviour, finite transform/opacity animation, one scene at a
time, quiet-date restraint, weather honesty and birthday privacy.

## Acceptance evidence and test strategy

Numerical budgets below are initial release gates to test, not evidence that the
unbuilt design already meets them. Record failures and before/after corrections.

| Area | Proposed proof / threshold |
| --- | --- |
| Whole-scene quality | Author, independent visual critic and coordinator inspect actual rendered default/dense/empty scenes at 26%/36%, 1080p/4K, beside the current baseline at identical settings. Recognizable grounded habitat, related motion and depth must be clear in the whole screen; enlarged crops/DOM counts alone do not pass. |
| Complete coverage | Registry-derived inventory equals the 4+14+5 baseline plus the 3 landed birthday variants. Contact sheets cover every scene; full views cover each family and each cultural treatment. Distinct silhouette/composition, not only palette changes. |
| Motion | Inspect at least 45 seconds for representative Summer/rain, Winter/snow, celebration and birthday scenes, plus deterministic sampled phases across every profile. Accelerated scheduler tests cover several full renewal/cooldown cycles, quiet transitions, pause/resume and scene changes without reset flashes. |
| Negative space | In scene-only synthetic renders, target at least 80% exact-black pixels during steady phases and at least 70% in the worst permitted passage/transition; at least 40% of the perimeter remains unlit at every sampled phase. Report thresholds, antialiasing and scene-only masks; occupied bounds are not lit-pixel area. These targets cannot substitute for judging legibility or attractive composition. |
| Reading / incursions | Background and middle pass current measured reading-ink clearance at float/step/swap boundaries, including 30-second motion and pending dim swap. Foreground tests assert swept intersection duration/area/opacity/cooldowns, protected zones and overflow handling. A deliberately oversized/long/opaque crossing must fail. Inspect actual glyph readability at worst permitted phase. |
| Edge persistence | Temporal heatmaps over multiple full cycles identify fixed bright roots, border segments and repeated occupancy. No fragment remains visually unchanged beyond the proposed 45-second dwell; independently review any residual fixed pattern. |
| Initial resource cap | At most 3 depth planes, 4 habitat patches, 6 middle detail groups and 1 foreground actor; at most 240 SVG path elements and 32 simultaneous decorative transform/opacity animations. Includes incoming/outgoing fragments. These cap structure, not quality. |
| Active/idle cost | Reuse fixed 4.2-second production-browser samples and the existing task (<150ms), paint (≤5) and total-layer (≤40) ceilings on the established synthetic fixture. Report mount separately. Track actual scheduled renewals and layout/style work; do not import the old per-slot formula into a different topology without measurement. Off leaves no scene observer/timer/animation work. Keep the continuous-work negative control. |
| UI and data | Existing Theme/Try a scene, labelled local previews, Automatic return, global Save/Cancel, concurrent changes, default 720px Style fit, 44px controls, 320px phone and short-window scroll/alert checks. A retained foreground field gets strict schema, saved-style/schedule, omission and frozen-reader tests; no birthdays duplicated into style data. |
| Semantics | Unit/browser checks retain current civil-date/Dangi/Julian rules, mode/calendar selection, exact quiet days, birthday collisions/leap day, fresh/near/stale/disconnected weather and unchanged provider demand. Combined adapters need explicit priority/fallback tests (#655 removed the unsupported-pair fallback to the standalone weather scene, so that fallback has no test any more). |

Use the existing isolated production source harness, mocked Windows status and
wake locks, loopback ephemeral ports and synthetic data. Images/clips and pixel
analysis remain in RAM; do not add screenshot files or upload private captures.
Do not use Playwright `recordVideo` or another recorder that writes video files by
default. Review motion live or assemble only in-memory frame sequences; retain
textual findings and source/asset provenance instead of accumulating image/video
artifacts.
Run focused tests during iteration, then the relevant themes, Workspace and
Settings suites once stable; full applicable CI remains the final gate. Preserve
the exact source SHA and served asset hashes for each visual pass. No current
installed app, desktop capture, real fullscreen activation, idle/native host or
TV test belongs to this source plan.

## Sources, dependencies and review triggers

Reviewed 2026-11-04. These sources inform choices; they do not certify this app
or prove the proposed art/performance outcome.

- [web.dev animation guidance](https://web.dev/articles/animations-guide): prefer
  transform/opacity where possible, measure layout/paint and avoid indiscriminate
  layer promotion. The proposed shared finite choreography is a project choice.
- [MDN Canvas optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas):
  cached primitives, layered redraw and resolution handling inform the comparison;
  Canvas is not assumed faster merely because it uses fewer DOM nodes.
- [W3C Pause, Stop, Hide guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html):
  moving content beside information needs user control. Preserve the current
  Off/Animation Off/reduced-motion behavior and verify the optional passage toggle.
- [ALBERTINA, The Great Piece of Turf](https://sammlungenonline.albertina.at/de/objects/39098/das-groe-rasenstuck)
  and [The Met, Autumn Grasses](https://www.metmuseum.org/art/collection/search/45744)
  inform observed plant variation, grouped silhouettes and depth. Study the
  composition rather than reproduce the art; do not transplant Japanese motifs
  into Korean or Russian cultural labels.
- [Existing cultural sources](holiday-calendar.md#cultural-art-references) support
  the celebration identities; current date policy remains authoritative.
- Birthday accent references from the separately reviewed #584 work:
  [Russian Ethnographic Museum REM2740-26](https://collection.ethnomuseum.ru/entity/OBJECT/378562)
  for restrained diamond embroidery-band vocabulary, and
  [V&A Jogakbo](https://www.vam.ac.uk/articles/jogakbo-traditional-korean-patchwork)
  for offset patchwork seams. Neither is evidence of a birthday ritual. Use
  original small accents, not copied museum images or symbolic compositions.

Recheck primary cultural sources when adding motifs; recheck motion/rendering
guidance when changing pipeline, layer promotion, masking or accessibility
behavior. Update this plan into the canonical theme contract as implementation
lands, and keep proposed values visibly separate from verified current behavior.

Related work stays in its existing ticket: [#364](https://github.com/8roundshock/living-room-display/issues/364)
for broader ongoing-animation/GPU measurement, [#156](https://github.com/8roundshock/living-room-display/issues/156)
for across-room readability/motion acceptance, [#558](https://github.com/8roundshock/living-room-display/issues/558)
for CI duration and [#578](https://github.com/8roundshock/living-room-display/issues/578)
for regional calendar expansion. They are not silently completed by this plan.
New concrete findings must be recorded on #586 or a matching existing issue,
never left only in a review chat or source comment.
