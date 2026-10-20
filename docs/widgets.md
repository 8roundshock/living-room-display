# Widget contract

Reviewed 2026-10-18 against the owner's grid/widget requirements and the primary
Apple sources below. Recheck when the catalog, family geometry, rendering or
relocation changes, and when upstream guidance changes. This contract applies to
every ambient widget, including clocks, photos and last-desktop previews.

## Source map

| Authority | Responsibility |
| --- | --- |
| [`src/shared/widgets.ts`](../src/shared/widgets.ts) | The catalog (category, tone, status), supported families, grid definitions, placement and layout helpers. |
| [`src/shared/palette.ts`](../src/shared/palette.ts) | Accent modes and the palette roles a catalog entry declares as its `tone`. |
| [`src/shared/motion.ts`](../src/shared/motion.ts) | Animation levels and their labels. |
| [`src/shared/contracts.ts`](../src/shared/contracts.ts) and [`defaults.ts`](../src/shared/defaults.ts) | Persisted types, `widgetData` and catalog-derived initial settings. |
| [`src/server/validation.ts`](../src/server/validation.ts) and [`store.ts`](../src/server/store.ts) | Boundary validation, compatible legacy migration and atomic storage. |
| [`src/server/persistence.ts`](../src/server/persistence.ts) | The previous release and the additive defaults omitted at rest so it can still read files and exports. |
| [`src/server/compat/previous-reader.ts`](../src/server/compat/previous-reader.ts) | Test-only frozen reader of the previous release and its assertion helpers ([rollback compatibility](development.md#rollback-compatibility-check)). |
| [`src/server/photo.ts`](../src/server/photo.ts) | Strict normalized PNG ingestion and private selected-image validation. |
| [`src/server/air.ts`](../src/server/air.ts) | Keyless CAMS air quality via Open-Meteo: request, normalization, 30-minute cache and the `off` state; [`src/client/airHourly.ts`](../src/client/airHourly.ts) rebuilds the widget's upcoming-hour bars and UV peak each minute and decides whether saved current values still stand (3 hours, #188); [`src/client/astronomy.ts`](../src/client/astronomy.ts) holds the local sun, moon and time-zone calculations. |
| [`src/client/widgets/types.ts`](../src/client/widgets/types.ts) | `WidgetContentProps`, `WidgetSettingsProps` and the `WidgetModule` interface. |
| [`src/client/widgets/registry.tsx`](../src/client/widgets/registry.tsx) | `WIDGET_MODULES` (one line per id, catalog order), renderers, `widgetVisible` and labels. |
| [`src/client/weather-outlook.ts`](../src/client/weather-outlook.ts) | The adaptive Weather rain outlook (#74): `rainOutlook` kinds, spells and confidence, and `rainOutlookCopy` wording ([API semantics](api.md#adaptive-weather-outlook)). |
| [`src/client/widgets/`](../src/client/widgets/) `<Name>.tsx` | One module per catalog id: `Clock`, `Weather`, `Rain` (retired, renders nothing), `Forecast`, `Reminders`, `Preview` (Last screen, drawn by `SnapshotImage`) and `Photo`, then the #78 widgets `WorldClocks`, `Calendar`, `Countdown`, `Note`, `AirQuality` and `SunMoon` (#157, #171), which each import their own CSS file. No id is planned, so there are no stubs. Also shared weather pieces in `common.tsx`, the `WeatherGlyph` and `TransitionText` primitives, and `measure.ts`, the layout-box measurement shared by the Reminders and large Countdown lists and the Note size (#216). [`src/client/calendar.ts`](../src/client/calendar.ts) holds the civil-date, week-start and countdown helpers that Calendar and Countdown share (#157). |
| [`src/client/Display.tsx`](../src/client/Display.tsx) | Ambient state and the shared movement/composition boundary. |
| [`src/client/Editor.tsx`](../src/client/Editor.tsx) | Picker, grid interactions and settings draft integration. |

Read those files rather than copying type, size or default tables into another
module. A catalog entry must reach the picker and renderer through this shared
contract. The repo-local
[`living-room-widget` skill](../.agents/skills/living-room-widget/SKILL.md) is the
entrypoint for agents adding or changing a widget; it requires no global install.

## Catalog contract

Each `WIDGET_CATALOG` entry sits on one line, so parallel changes touch different
lines. Besides its families and defaults, an entry declares:

- `category`: `time`, `weather`, `personal` or `pictures` (labels in
  `WIDGET_CATEGORIES`).
- `tone`: one existing palette role from `palette.ts` (`time`, `sky`, `water`,
  `sun`, `personal`, `stone`). Native accent colours (#75) use it; sections carry
  `tone-<role>` and the ambient root `data-accent-mode`.
- `status`: omitted means active. `planned` reserves an id whose renderer has not
  shipped; `retired` keeps an id only so the previous release can read data, with
  `mergedInto` naming the active id that absorbs an enabled retired placement (the
  retiring change owns that migration). Planned and retired entries are hidden from
  the picker and inspector and never rendered. Planned ids always read as disabled
  and a PATCH enabling one returns 400. No entry is planned now: #157 and #171
  activated all six #78 ids. Rain is retired and merged into Weather
  (#74, `absorbRetiredWidgets`); removing its id is tracked in #103.

`WIDGET_IDS` keeps every id, because schemas and geometry need them all.
`ACTIVE_WIDGET_IDS` is the load-time list of shipped ids for UI lists and test
iteration; `isActiveWidget(id)` reads the catalog live for validation and rendering.
New entries are appended, which keeps the packing and composition of existing ids
identical. To ship a planned widget, delete its `status`, replace its stub module and
add its check module; nothing else in the shared code needs to change.

Each widget implements a `WidgetModule` in its own file under `src/client/widgets/`:
`Renderer`, optional `visible(props)` (after the catalog status and enabled flag),
optional `Settings` panel rendered in the inspector under the shared Size control,
optional `draftProblem(settings)` that disables Save and shows its reason, and
optional `sample({ state, settings })` that adjusts the picker's synthetic sample
with new objects, and, for free-size widgets, an optional one-line `sizeHint`.
Use `WeatherGlyph` for weather symbols and `TransitionText` for values that
change. Browser QA loads one check module per widget from
[`tests/ui/widget-checks/`](../tests/ui/widget-checks/): `id`, optional
`prepare(state, { now })`, extra clipping `selectors` and `family(...)` assertions.
An optional `sweep({ page, viewport, state, base, now })` runs once per viewport
after the family sweep for checks beyond the families; a module whose `id` is not
a widget id (such as `reminders-span`, the free-size span check) contributes only
its sweep.

Start with `WIDGET_CATALOG`, `GRID_DENSITIES` and `widgetSpan`; use
`reflowWidget`/`fitGridDensity` rather than implementing a second collision or
packing rule. `composeWidgetGrid` and `motionOffset` own ambient placement variation.
Schema/default changes belong at these authorities with their tests.
Legacy settings/presets without a grid receive the safe catalog default grid.
Their visibility/location choices survive; old offsets/scale and
`appearance.layout` are retained data, not converted or applied to the grid.
Grid revision 2 gives the large clock real height. Revision 1 is validated against
its original geometry before migration; enabled widgets remain present, with
family reduction only when needed to fit. Current invalid layouts are rejected.

## Families and editing

Use discrete supported families, with one focused piece of information in the
smallest useful family and additional relevant detail in larger families. A
larger family changes composition and information density; it is not merely a
scaled small widget. A widget need not support every family. Keep text real,
scalable and readable, with meaningful labels instead of relying on color.
Small labels, age, attribution, units and secondary values use the shared floors in
[`widgets.css`](../src/client/widgets.css): `var(--min-text)`/`var(--min-data)`,
inherited from `--ambient-min-text` (1.4% of the display or editor canvas height)
and `--ambient-min-data` (1.65%), times Text size. Wrap related values onto shared
rows before letting the fit scale shrink a family. Only a family that truly cannot
fit caps the floors by its own content height: small forecast uses 7.25% (text)
and 8.5% (data), which binds only when that height is under about 19.4% of the
display (about 1.07%/1.26% in the fine grid; Balanced sits at the threshold). Its high
and low share a row when they fit, and its “Saved forecast”/“Offline” prefix takes its
own short line, so fresh, stale and offline small forecasts render at fit 1 at Text
100% in every density at 720p, 1080p and 4K, with “5 hr ago” kept together (#221).
Overfull content is laid out proportionally wider before the fit scale shrinks it,
so a larger Text size never renders text-size-scaled labels or values smaller.
Icons and the fixed unavailable dash do not follow Text size and can still shrink
with the fit. The picker sample has no floor. Ambient glyphs pass `size={null}` so
these container-query sizes apply rather than the Icon's default 20 px (#128).

The renderer families have deliberate visual roles:

| Widget | Small | Medium | Large |
| --- | --- | --- | --- |
| Clock | Compact time and calendar; analog puts the hands, sized to the cell height, beside the date | Time beside a calendar column; analog sizes its hands to the cell height | Centered monumental time with a quiet calendar line; outline, digital and hand-only analog styles share this composition |
| Weather (adaptive, #74) | Temperature and glyph, then one line: the condition when calm, otherwise the compact rain outlook (“Rain likely now”); confidence only when partial | Calm: conditions and feels-like; hint: the outlook line replaces feels-like; elevated (rain now or within six hours): rain timing and “Peak 60% · 4 mm rain”, with “Forecast estimate” beside the age | Calm: adds wind and daily high/low; hint as medium; elevated: condition and high/low, then timing, detail and twelve hourly chance bars (spell hours brighter, unknown hours dotted) |
| Forecast | Three days from the city's today; high and low share a row when they fit | Five days | Seven days; compact weekday labels preserve room for temperatures and chance. Every family starts at Today and names later days by weekday (tomorrow too, #256), with “Tomorrow, <date>” in assistive text; past days never show (#243), and the heading counts the days shown (“Next 4 days”) |
| Reminders | As many pending reminders as fit the actual box (measured from layout boxes, #216), soonest first (overdue or due within a week, then undated newest first, then later dates), with an honest “+N more” | The same measured list; never a partially visible row | The same measured list; titles scale with width but stay capped near 3.2% of the display height. In any free size, when every pending reminder fits, cut-off titles may use up to four lines and whole titles grow toward the cap (#254) |
| Photo | Center crop in a compact area | Wider landscape crop | Complete image fitted in the larger area |
| Last screen | Complete, faint captured desktop with its "Last screen · 8:40 AM" caption on the image's left edge just below it (every family) | Wider complete desktop | Larger complete desktop; no crop hides screen context |
| World clocks | First city's label, time in regular-weight numerals, relation ("Tomorrow · +13 h"), day/night icon and a dim "+N" | Two cities side by side | Up to four rows, label and relation left, time right; hidden on the display with no cities |
| Calendar | Month name over this week's strip (weekday initials and dates) | Weekday, large date and month beside a compact month grid | Month and year, a weekday header row and a generous month grid; every grid has only the 4–6 weeks the month needs |
| Countdown | The next date as a large count (“12” over “days”, or Today/Tomorrow), its title and a short date | The next date on the left; the following two as compact rows | As many rows as fit the box (title, date, days right-aligned), measured like Reminders, then an exact “+N more” (#221) |
| Note | The text at the largest size that fits the box (measured from its lines and wrapping, #194), up to a family cap | The same, wider | The same, generous; only a note that cannot fit at the text floor zooms out through the shared fit |
| Air quality | AQI and category word with place and scale; one footer row with the age ("Model est. · 12 min ago" with a reading) and "CAMS · Open-Meteo"; values over 3 hours old read "Saved estimate" or "Last known · 9 AM" | Adds the main pollutant and UV with its WHO category (both hidden once the values are over 3 hours old, UV then from the saved estimate) | Adds AQI bars for the current and up to 23 following hours (unknown hours dotted) and today's UV peak, both from upcoming hours only; "Hourly estimate unavailable" when fewer than two remain |
| Sun & moon | Next sunrise or sunset, its time and the place | Sunrise, sunset, daylight length and change from yesterday, moon glyph and phase | Dim dotted day arc with the sun's position, times, daylight, phase with illumination and the next full (or new) moon |

The large clock requires actual vertical room in the central catalog; do not
recreate a giant option by scaling within the previous short large family.
All families use the same renderer in ambient view, authored editor canvas and
synthetic picker preview. Picker fixtures never become user data.
The editor canvas renders inside `.studio`, so renderer class names must not reuse
a studio class name (such as `preview-frame` or `hint`; prefer `ambient-…` names):
`tests/ui/canvas-scope-browser.mjs` fails when a canvas element matches a
`.studio`-scoped rule (#313).

The selected grid controls snapping and capacity. Dragging and resize handles
snap to allowed cells and supported families through the shared helpers. Moving
or enlarging a widget gently reflows neighbors into valid space; the active
widget stays under the pointer. Reject an impossible placement with a clear
local response instead of covering another widget or discarding one. Density
changes fit every enabled module, reducing families only as necessary and
restoring the exact prior layout when switched back before another widget edit.
A visible grid, handles,
selection borders, labels and picker chrome belong to the editor only.

A free-size widget declares the optional catalog `freeSize` rule instead of its own
geometry (#73; currently Reminders). Besides its families it accepts any whole-cell
`span` from `min` (2 × 2) up to the full grid height and `maxColumnsFraction` (two
thirds) of the width, so even a full-height column leaves at least a third of the
board for relocation. `size` stays the largest family inside the span, which keeps
family-based renderers working and guarantees that deleting the span leaves a
collision-free board. Every helper reads cells through `placementSpan`, so the
editor, validation, density fitting and ambient composition share one collision
rule. A density change scales the span before its origin: full height stays full
height and an axis at its minimum stays at the minimum, so a Column (2 × full
height) stays a Column in every grid (#152); other extents scale with the grid and
clamp to the new limits. When the board still cannot fit, the span falls back to a
family and the editor names what it dropped (“Reminders 2 × 8 → small to fit”).
A free-size widget's module may add a one-line `sizeHint` under the custom size
controls; Reminders reads “Shows as many reminders as fit · soonest first”, which
its measured list delivers in any span.

Every widget is optional. The picker describes available widgets and sizes;
adding/removing/resizing/repositioning changes the settings draft. Provide direct
family controls usable by keyboard/touch as an alternative to handle resizing.
The focused canvas widget supports arrow-key movement and its selected/focused
resize handle supports arrow-key family changes; do not expose technical
coordinates/four-arrow Position controls in the primary inspector.
Cancel restores the saved configuration, including grid, styles and selected
images. Show Save/Cancel only while there are actual unsaved changes, preserving
the existing async race and concurrent-draft behavior. Reminder records retain
their documented independent immediate-save behavior.
The authored editor canvas stays still. Ambient relocation runs only in the
display or an explicitly requested movement preview, so layout editing never
competes with the ambient scheduler.

Legacy backfill uses revision-one catalog origins before strict validation and
central migration. An absent additive module is different from an explicitly
invalid overlapping placement; the latter still rejects. Current saves use
geometry revision 2. Follow the [pre-upgrade data backup and rollback](install.md#widget-geometry-revision-2-update-and-rollback)
procedure; the previous app does not understand revision 2 even though the outer
settings version remains 1.

### Catalog decisions (#78)

Reviewed 2026-10-18 for [#78](https://github.com/8roundshock/living-room-display/issues/78).
The catalog has twelve active widgets now that Weather has absorbed Rain (#74), grouped
in the picker by `WIDGET_CATEGORIES`: **Time** (Clock, World clocks, Calendar),
**Weather & sky** (Weather, Forecast, Air quality, Sun & moon), **Personal**
(Reminders, Countdown, Note) and **Pictures** (Photo, Last screen). Every new widget
is optional, off by default and appended after `photo`, so existing packing and
composition stay identical.

- **Kept as is:** Clock, Forecast, Last screen and Photo. Weather and Rain belong to
  #74 and Reminders to #73.
- **Changed:** the picker is a grouped list with keyboard navigation; Forecast uses
  its own `forecast` glyph because Calendar now owns the calendar glyph.
- **Added here (PR #157):** Calendar (local date, week start Automatic/Sunday/Monday; no data
  dependency), Countdown (up to 12 dated events, optionally yearly; whole civil days
  with UTC-noon arithmetic so DST cannot shift a count; February 29 falls on
  February 28 in common years) and Note (up to 200 characters and 4 lines). An empty
  Countdown or Note is hidden on the display and shows a placeholder in the editor.
  World clocks, Sun & moon and Air quality shipped in the parallel unit of the same
  ticket (PR #171).
  The three use fixed families and sit beside a free-size Reminders span; fuller
  boards keep relocating through the #93 reflection fallback described below.
- **Rejected, with reasons:** timers and alarms (they need audio and on-screen
  interaction); news, stocks and sports (noise, feeds and keys); commute (keys and
  personal addresses); account calendars, fitness and cloud smart home (accounts and
  privacy); quotes (licensing and novelty clutter); PC battery and stats (not useful
  ambiently); pollen (Open-Meteo coverage is Europe only); ticking seconds (OLED
  wear and constant motion).
- **Deferred, with tickets:** events from a local
  calendar file or subscription (#94), rotating local photos (#95), Now Playing
  (#96), several instances of one widget (#97), reminder dots on the calendar (#98)
  and per-second re-fit cost (#99).

## Ambient appearance and recurring exposure

Unused pixels remain true black. Reuse ambient brightness and type tokens; keep
fills small and dim. Avoid persistent card backgrounds, borders, dials, divider
lines, corner marks, logos and repeated decorative labels. All visible content,
including attribution and stale-state labels, belongs inside its movable group.
The editor may be brighter and show controls; those styles must not leak into the
ambient view or its error/loading states.

Colour follows one rule in both accent modes (#75). Primary content always uses
the text colour: time digits, temperatures, condition text, reminder titles and
forecast highs. Accent content uses `--ambient-accent`: labels, place and units,
secondary metrics, weather glyphs, chart bars, dots, captions, age and attribution.
In `color` mode that is the single accent; in `native` mode `src/client/palette.css`
redirects it to the section's catalog `tone`, so both modes colour exactly the same
elements and Native never lights more of the panel. Inside a widget, an icon marked
`data-glyph` (weather glyphs, World clocks' day/night icons, Sun & moon's sun dot,
label icon and moon) paints with its own sub-tone (`WEATHER_GLYPH_TONE`), a subtree
marked `tone-<role>` takes that role (Sun & moon's moon is `tone-time`), and
Weather's rain visuals use the `--weather-rain` hook (Sea glass). A widget whose
face is only primary text (a Note, a "Today" countdown) has nothing to tint. Status
cues never change: stale and offline labels and the Overdue word use the one amber
status tone, `--ambient-caution` (there is no separate offline colour, #223, #133).
Never hard-code a hue in widget CSS (Air
quality has no category colours), fill or frame anything new for colour, or tint
images; a new widget declares an existing palette role and uses `--ambient-accent`.
The [palette harness](../tests/ui/palette-browser.mjs) fails for a widget with no
accent element unless it is listed as text-only, and for any painted colour other
than the element's accent, the text colour or a status tone.
See [native palette](design.md#native-palette).

Large clock numerals should offer a tasteful outline treatment with sparse lit
area and sufficient stroke weight at real viewing distance. Other clock styles
remain subject to the same dimness and movement contract. Do not add a fixed
analog bezel, tick ring or always-lit colon merely because the hands or digits
change. Outlines still reuse pixels and must move with their group.

Readable strokes at couch distance (#222) are tied to the display height through the
shared text floor (`--min-text`, 1.4% of the height), so they scale from the owner's
1280×720 CSS TV to 1080p and 4K alike. The outline never thins below 1.2 px at 720p
(otherwise `0.35cqw`). Analog hands are two rounded bars in the text colour: the hour
hand reaches 30% of the drawn square and the minute hand 45%, with strokes of 2.4% and
1.6% of the square but never under 3 px and 2 px at 720p. The only other mark is a dim
accent pivot dot over the junction; it covers pixels the hands always light, so it adds
no new static area. A 12 o'clock mark was considered and rejected because it would be a
new always-lit point. Small and medium size the square to the cell height (90%) with the
date beside it; the square gives way when the date needs the width. Each hand is an
HTML bar on a full-square wrapper that turns with `rotate` around the centre, so the
minute ease runs on the compositor (#161), and the square clips so a turned wrapper
never adds overflow to the widget fit. At rest the geometry is the same at every
Animation level. The owner's couch check remains the acceptance gate for #222.

Move the complete layout through substantially different valid locations, with
varying offsets or routes over time instead of forever repeating identical
anchors. Small jitter inside fixed widget bounds is insufficient. Keep module
rectangles disjoint at each visible phase; fade the old composition fully to
black before revealing a new one, so crossfades cannot overlay bright layouts.
Include a black rest interval and avoid flashes or synchronized bright accents.
Use the centralized scheduler/wrapper, not a new per-widget motion loop.

Dense boards keep relocating (#93). The bounded composition search may fail to
find a board where every widget moves; it then reflects the previous composition
horizontally, vertically or both (`displayPlacement`, span-aware), choosing a
reflection that moves the most widgets. Whenever another reflection also moves
widgets, consecutive fallbacks apply different reflections (#182): reflections that
tie rotate with the cycle, and a unique best one (usually both at once, when a widget
is centred on one axis) alternates on odd cycles with the best of the others, however
many fewer widgets it moves. A reflection leaves the same widgets in place in every
reflected arrangement of a board, so this ranking holds from one fallback to the next.
Reflections commute, so a board with a third reflected arrangement visits three or
four arrangements instead of returning to the one from two cycles earlier. On 36
generated dense boards over 200 cycles, consecutive fallbacks that applied the same
reflection fell from 3,902 of 3,902 pairs to none of 3,868; over 24 cycles,
compositions that repeat the one from two cycles earlier fell from 470 to 10 of 828.
Each remaining repeat involves a search step; the search does not look two cycles
back (#317). Only a board with a single moving reflection, or two that reach the
same arrangement, still alternates between two arrangements. A reflection is always
in bounds and collision-free. Only a board that every reflection maps onto itself
falls through to the search that allows widgets to stay. A full-height span can only travel
sideways; any span relocates as one whole group through the black rest. Its
content therefore also alternates vertically: a full-height Reminders column
(`data-full-height`) anchors its list to the top on even compositions (the authored
layout included) and to the bottom on odd ones (`composition-1`/`composition-3`).
Only fitted rows take layout and measurement always runs top-anchored, so the
bottom-anchored group never clips the label or a row and “+N more” stays exact.

Reduced motion removes travel, zoom and decorative animation while preserving
periodic spatial relocation through a black interval and an instant reveal (or a
brief opacity transition when permitted). It must not freeze the ambient display
at one permanent position. Missing or hidden widgets must not leave a fixed frame.

Motion inside widgets follows the Animation level (#76; Off, Subtle or Lively, see
[motion levels](design.md#motion-levels)), which `motionPlan()` in
[`src/shared/motion.ts`](../src/shared/motion.ts) turns into what may move on each
surface; a screen that prefers reduced motion is always Off, and picker samples and
Edit layout stay still. Renderers add no animation code of their own: use
`TransitionText` for a changing value (the new value fades in; numbers are never
tweened), `WeatherGlyph` with `hero` for a widget's main condition and `still` for
stale, offline or unavailable data, and stable React keys (by id or source) so a new
item or image is a new element. A new photo or snapshot holds its shell at opacity 0
until the image has loaded and decoded (or a 4 s fallback), so its fade never runs on an
empty box (#173). The shared CSS (`motion*.css`) then animates only
transform and opacity, never above resting opacity, with offsets from above or the
left that stay inside the widget rectangle and never change the fit scale. Content
first shown with its widget never animates; later insertions may transition in.
Reveal choreography uses `widgetRevealOrder()` and `--reveal-order`; only the hero
glyph loops, at Lively, and loops pause on black.

The merged renderers follow this through the same pieces (#162). Weather's rain
timing, detail, hint and hour labels, Forecast's values, Air quality's AQI and
category, Calendar's date, Countdown's count, Note's text, and the times in Sun &
moon and World clocks are `TransitionText` (Clock keeps its per-character digits). Chart bars inserted later (Weather's
`.rain-bar`, Air quality's `.air-bar`) fade in to their resting opacity, and existing
bars ease to new heights. A list that measures its own rows must keep that geometry
exact. Reminders marks only reminders that were not pending at the previous update
with `data-new`, and fades them by opacity alone. A re-sorted row, which React moves
with `insertBefore` and Chromium would otherwise restart from `@starting-style`
(#172), and a row that stops overflowing stay still. Lively reminder rows also fade
without moving. That is a design choice, no longer a constraint: the list (like the large
Countdown) measures layout boxes, which ignore transforms, so a row caught mid-transition
cannot change the count (#216). Its measuring pass hides the visible “+N more” with `visibility`
and `position: absolute`, never `display: none`, because a box that disappears and
returns replays its entrance and crossfade.

These are design requirements to reduce recurring exposure, not a measured
safety threshold. Finite screens and recurring content inevitably reuse pixels;
do not promise zero overlap over time or prevention of OLED burn-in. Browser
previews do not establish physical-TV brightness or long-term panel behavior.

## Data and image boundaries

Render content according to available space without changing its meaning. Keep
forecast estimates, age, stale/unknown states, place and units honest. For a
hide-when-empty option, distinguish confirmed empty from unavailable or failed.
Keep management available in the editor when the ambient widget is hidden.

Saved weather keeps no age limit on the server, so the renderers judge its age (#243).
A forecast strip starts at the weather city's civil today and drops earlier saved days;
with none left it says “Forecast unavailable”, and Weather looks up today's high/low
by date, not list position. A saved current reading more than **3 hours** old while
the forecast is stale or the display is offline is no longer presented as current:
Weather shows “Last known · 9 AM” (with the weekday when not today, “Last known ·
Thu 9 AM”) in the status tone in place of the condition line (above the rain timing
where the family shows timing instead), and keeps the glyph still and the age line.
Three hours matches the hourly model: after that the saved temperature describes a
different part of the day. Air quality's hours-old current values are decided in #188 with the same
threshold.

A photo widget uses a user-selected local image, remains optional, and follows
the shared size/brightness/motion rules. Retain its image only in the documented
local user-data path and treat it as private user content; no external feed,
remote URL fetch, cloud upload, Git asset or diagnostics attachment is implied.
Validate supported image data and size limits at the ingestion boundary, handle
decode failure, and avoid preserving private source filenames or metadata unless
needed. The renderer cannot brighten the image beyond the ambient controls.
The editor checks declared dimensions before browser decode, downsamples and
re-encodes supported local rasters as PNG. The API validates the normalized PNG
again; see [limits and storage](api.md#local-photo). Replacing or clearing a photo
does not securely erase older bytes from the previous-state recovery backup.

This deliberate photo selection is separate from the last-desktop widget. A
desktop snapshot is captured only by the authorized native flow, stays in RAM,
expires on exit/session lock, and is never persisted, exported or reused as a
photo. Tests use synthetic images. Do not request GPS, screen capture or access
to personal photo folders merely to implement a widget.

## Verification for a widget change

- Check every supported family on every supported grid, smallest bounds and long
  content, all relocation phases and black intervals. Inspect actual images for
  density, clipping, collisions and stale/error/empty states using synthetic data.
- Exercise add/remove, drag/drop, resize, keyboard alternatives, invalid placement,
  grid changes, Save/Cancel, clean/dirty save-bar visibility, persistence,
  presets and legacy import/migration. Retain edits made while Save is pending.
- Check reduced motion still relocates, whole-group bounds remain valid, and
  pointer hiding stays limited to explicit native presentation. Browser display
  and browser fullscreen retain their pointer; unmodified F toggles fullscreen
  outside editable controls. Keep captures in
  RAM and test data outside the user's installed state.

Run the relevant commands in [development](development.md). Independent final
PR review must inspect rendering as well as code; record the exact reviewed SHA
and real checks. Physical-display acceptance and unobserved long-duration behavior
remain explicit limits, not implied passes. Update [UI contracts](ui.md),
[status](../STATUS.md) and the linked ticket with the actual resulting behavior.

## Apple inspiration and project adaptations

Live Markdown was read from Apple on 2026-10-18; the normal pages below are the
stable human-facing links. This is an original web implementation without Apple
assets, fonts, frameworks, platform integration or certification.

| Primary source | Applied principle and boundary |
| --- | --- |
| [HIG Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) | Focused glanceable content, family-specific detail and restrained color. StandBy enlarges widgets for distant use; this app has its own grid and does not copy iOS point sizes. |
| [WidgetFamily](https://developer.apple.com/documentation/widgetkit/widgetfamily) | Declare supported size/shape families and adapt content flexibly. WidgetKit APIs are inspiration, not app dependencies. |
| [HIG Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Dim secondary content and reduce visual noise. Apple's preference for stable layouts differs from this app's required periodic relocation on a TV. |
| [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System type, clear size/weight hierarchy and viewing-distance checks. Small supporting text uses regular/medium weight; enlarged outlined time remains a deliberate sparse treatment. |
| [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Purposeful, brief editor feedback; fade before relocation when travel conveys no useful information. Reduced motion removes effects while the ambient relocation contract still applies. No audio or haptic feedback is introduced. |
| [Designing your app for the Always On state](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state) | The watchOS example replaces large numeral fills with outlines/dim interiors. It supports the clock treatment, not a claim that this TV inherits Apple luminance or panel controls. |
