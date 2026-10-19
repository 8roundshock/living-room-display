# Display studio

Reviewed 2026-10-18 for [#56](https://github.com/8roundshock/living-room-display/issues/56)
and scoped [#58](https://github.com/8roundshock/living-room-display/issues/58),
[#59](https://github.com/8roundshock/living-room-display/issues/59),
[#60](https://github.com/8roundshock/living-room-display/issues/60),
[#61](https://github.com/8roundshock/living-room-display/issues/61) and
[#62](https://github.com/8roundshock/living-room-display/issues/62).
Browser checks establish source behavior; installation and native pointer/idle
acceptance are recorded separately in [STATUS](../STATUS.md).

## Editing

`/editor` (also `/`) opens a large live appearance preview and a focused inspector.
Style, Widgets, Weather and Reminders share one settings draft. Desktop keeps the
preview beside a height-bounded inspector with fixed tabs and contained scrolling
above 700 CSS pixels. Canvas actions remain visible at compact desktop heights;
the 16:9 preview fits the height. Narrow windows stack a normally scrolling
inspector below a nonsticky preview, leaving room for the keyboard.
Above 1050 CSS pixels the Save bar centers under the canvas, so the inspector uses
the full height unless an alert row is shown; at 1280×720 each tab's default,
collapsed contents fit without scrolling. Whenever settings
remain below, the inspector's bottom edge fades (scroll-linked, kept with reduced
motion). Focus scrolling reserves the measured Save bar height so fields and labels remain
visible above it, including narrow screens and compact keyboard-height windows.

- **Save changes** atomically persists settings, appearance, location, widget
  options, selected local photo and saved styles. The bar exists only while
  effective saved values differ; reverting all edits hides it. Edits made while saving remain unsaved afterward.
  Failed saves preserve the draft. Untouched fields refresh from server polling.
- **Cancel** restores the latest saved settings across every section, resets the
  city query/style form, and invalidates pending device/photo callbacks. It does not
  undo saved reminders. Leaving with settings edits uses the browser's prompt.
- **Phone**, **Room** and **Night** reset visuals/transforms while preserving
  location, units, reminders, named styles and the Animation level (Soft motion
  and clock style still reset until #110). Room brightness is 55%; Night is
  28%. All three, Reset appearance and new installs use **Native** colours; their
  miniatures show Lilac, Mist and Rose bars. Up to twelve saved styles include
  visual/widget/empty-reminder settings, the accent mode and the Animation level.
- The **Accent** row offers Native (a ring of palette tones named "Native colours":
  each widget uses its own colour, see [native palette](design.md#native-palette)),
  five colour swatches and a custom colour. The heading line names the current
  choice (Native, the swatch name or Custom). A swatch or custom colour selects one
  accent for every widget; Native keeps the last colour, so switching back restores
  it. The live canvas, movement preview and picker samples show the draft's mode.
  The row stays one line at desktop widths and wraps without horizontal overflow at 320px.
  The [palette harness](../tests/ui/palette-browser.mjs) covers these flows.
- The Style tab's **Motion** disclosure (its summary shows the level) starts with
  **Animation**: Off, Subtle or Lively as pressed buttons, then Soft motion, New
  arrangement and Fade duration. Choosing a level is an ordinary draft change (the
  Save bar appears only while it differs from the saved level), does not mark the
  style Custom, and replays the canvas entrance once. When the editor's own screen
  prefers reduced motion, a hint explains that animation stays off there while the
  control still edits the saved value. Editor polish (tab indicator, disclosures,
  picker, drag settle, new-widget drop-in, Save bar entrance) follows the editor's
  effective level and stays within 240 ms; Off keeps the existing transitions.
- The authored canvas never relocates; outside Edit layout it shows value and glyph
  motion for the draft Animation level, and during Edit layout widgets stay still. **Edit layout** reveals a faint
  editor-only grid and whole-widget drag targets. Clicking/focusing selects a
  widget and exposes its resize handle. Arrow keys move the focused widget;
  Tab reaches its handle, where arrows change family. Family buttons are another
  alternative. No technical Position coordinates or four-arrow inspector exists.
  Pointer feedback is continuous while neighbors reflow into legal cells. Escape
  or pointer cancellation abandons the entire drag; impossible drops/resizes keep
  the prior board. Density changes immediately fit every enabled module, reducing
  families only when necessary; a round trip restores exact explored positions
  and families until another widget edit. Cancel restores the saved arrangement.
- **Free-size Reminders** (#73): its handle snaps to whole cells from 2 × 2 up to
  the full grid height and two-thirds of the width; neighbours reflow live, and an
  impossible size keeps the board with “No room for that size”. The default board's
  large Clock, Weather (#74) and Forecast leave no room for a Column until one of
  them is made smaller; naming what blocks a size is #183. On the focused
  handle Right/Left change width and Down/Up change height by one cell, announced
  as “Reminders resized to 2 × 6”. The inspector offers Small, Medium, Large and
  Column (2 × full height) presets plus Width and Height steppers that stop at
  their limits; the list subtitle reads the family, Column or `C × R`, and a hint
  reads “Shows as many reminders as fit · soonest first”. Sizes join the draft
  (resizing back to the saved shape is clean). Density changes scale the span with
  full height and minimum width kept, so a Column stays a Column; a span dropped
  to fit is named (“Reminders 2 × 8 → small to fit. Switch back to restore.”). The
  picker still adds a family with a caption noting free resizing. On the display a
  full-height Reminders column alternates top and bottom anchoring between
  arrangements while it relocates sideways.
- Density/family/position and visibility form one atomic local layout during a
  concurrent poll, preserving its validity while unrelated saved settings refresh.
  Adding a widget can seek nearby legal origins when its previous hidden origin
  cannot accommodate the board; it never silently removes existing content.
- **Widgets** selects inline size/position and per-widget controls. **Add widget**
  opens a compact category rail and one actual renderer with synthetic family
  content, size choices and a reachable Add action. Every module can be removed, including clock
  and weather separately. Small/medium/large families adapt their content.
- **Preview movement** explicitly reveals numbered arrangements and **Automatic**
  ambient preview. Editing returns to authored placement. **Open display** opens
  a browser tab; its pointer remains visible, including fullscreen. Unmodified
  **F** toggles fullscreen without stealing typing, modifier shortcuts or repeats.
  Manual display controls appear on pointer movement or Tab and hide after
  3.5 seconds without another supported interaction. Focused controls stay visible.
  Esc or E returns to the editor.

Only explicit `native=1` presentation hides the document cursor and omits browser
controls. Browser loading/failure/display and editor/embedded previews retain
normal pointers. The host URL flag selects that presentation; held native cursor
surface/lifecycle changes remain in draft PR #51 and require combined-source
acceptance. Appearance saves do not enable Windows idle.

## Calendar, Countdown and Note

**Add widget** groups the catalog by category in this order: **Time**, **Weather &
sky**, **Personal** and **Pictures**; groups without an available widget are not shown.
Desktop shows a narrow scrolling rail with each group label above its buttons;
narrow screens show three buttons per row under each label. Up/Down move through the
whole list (across groups) and preview the focused widget (Left/Right do the same, matching
the narrow three-column layout); Home/End jump to the first or last; Tab keeps its normal
order. Samples are the actual renderers with synthetic
content (the sample clock, “Weekend trip”, “Birthday” and “Holiday”, “Dinner at seven”).

- **Calendar** (Time, default medium) follows the computer's local date like the Clock
  and rolls over at midnight. **Week starts on** offers Automatic (labelled with the
  resolved day, for example “Automatic · Sunday”, from the browser locale with a Monday
  fallback), Sunday or Monday. It has no data dependency, so it is always shown when
  enabled.
- **Countdown** (Personal, default small) holds up to 12 rows: a title (1–60
  characters), a date, an **Every year** toggle and Remove. **Add date** adds a row
  dated one week ahead and focuses its title. An empty title shows an inline error and
  the Save bar reads “Countdown needs a title” until it is fixed; the server remains the
  authority; a year outside 1900–2200 shows “Use a date between 1900 and 2200”. Closing
  the panel (removing or collapsing the widget, or changing tab) gives an edited row back
  the last complete title or date it had (as saved, or as loaded by the editor's refresh)
  and drops a row that was never complete there, so Save is never blocked by a field that
  is not on screen and closing never deletes a saved date. Rows are read-only while a Save
  is running.
  Each row shows its count (“In 12 days · Fri, Oct 30”) or **Passed** for a
  past one-time date, which the display ignores until it is removed. Counts are whole
  days on this computer's calendar. The display shows the widget only while a date is
  upcoming; the editor canvas shows “Add a date to count down to” otherwise.
- **Note** (Personal, default small) is a textarea limited to 200 characters and 4
  lines with a live “37/200” counter and **Clear**. Line breaks are kept. The display
  hides an empty note; the editor canvas shows “Write a note”.

All three panels join the shared settings draft: Save/Cancel appear only for effective
changes (trailing spaces trimmed on blur do not count), Cancel restores the saved values,
and built-in or saved styles never change the week start, countdowns or note (styles
do reset which widgets are shown). Countdowns and the note are private content stored
on this device and included in exports. `tests/ui/catalog-time-browser.mjs` checks the
picker groups and keyboard (Weather listed, no Rain; the free-size caption only for
Reminders), each panel, Save/Cancel, reload, styles, display hiding, a dense board where
the three sit beside a full-height Reminders column and keep relocating, 320/390 px
reflow, Save-bar clearance and the compact picker viewports.

## Weather and location

Typing two characters starts debounced city search. Up/Down explores, Enter
selects, and Escape dismisses; focus stays in the input. Typing, blur or the first
result never selects. Region/country distinguishes namesakes. Older requests
cannot replace newer options. Selected location is separate from search text.
Long city names and region/country text wrap within each result. The focused
[#52](https://github.com/8roundshock/living-room-display/issues/52) regression
checks actual text bounds, normal short results, keyboard selection and Cancel
at 320px, 390px and desktop widths; synthetic visuals were inspected in RAM.

New installs use Toronto, labeled **Default location**, until an area/city is
saved. An editor with already-granted browser permission attempts one automatic
lookup; otherwise **Use device location** is the explicit permission action. All
results remain drafts until Save. Cancel
invalidates late callbacks. Only 0.1-degree coordinates leave the adapter; no raw
fix, accuracy, altitude or timestamp is stored. Failed lookup preserves a manual
city; automatic drafts cannot overwrite a manual city saved in another editor.
No background watch or IP lookup exists. `/display` never queries location or
permission, and its Permissions-Policy disables geolocation.

Preview weather retains its actual city/units while a selection is unsaved or
refreshing. Forecast dates/intervals use the weather city's timezone; the clock
and reminder input use the computer timezone. Current conditions show age;
retained stale data is marked throughout. Missing values stay unavailable.
Hourly chance covers precipitation including snow; rain estimates use rain plus
showers and label incomplete/gapped coverage. See [API semantics](api.md#weather-semantics).
Rain timing lives inside Weather (#74): it stays calm when the next 12 hours are
complete and dry, adds a hint line when rain is later, precipitation is possible or
the outlook is unknown, and leads with rain timing (large adds hourly chance bars)
when rain is current or starts within six hours. Wording says “likely” or
“possible”, never that it is raining; times use the weather city's timezone and the
12/24-hour setting, and “Forecast estimate”/“Partial forecast” labels stay visible.
The footprint never changes, and the separate Rain widget is gone from the picker,
list and canvas; an enabled Rain from older data is merged into Weather
([upgrade](install.md#additive-data-and-rollback-compatibility-84)). There is no opt-out of
rain detail yet (#102). The [weather harness](../tests/ui/weather-browser.mjs) checks
every family × mode × density at 1280/1920/3840 widths, CSS glyph boxes (#128) and the
upgrade of a pre-#74 data folder.
Each weather module keeps its actual place and relevant units visible when used
alone; weather and forecast show the unit beside the place (“Toronto · °C”), and
elevated Weather keeps the rain amount unit (“0.16 in rain”). Compact forecasts abbreviate Tomorrow as
“Tom.” while retaining the full relative label and civil date for assistive text
and hover details. Ambient labels, age, attribution, units and secondary values
have a readability floor of 1.4% of the display height (1.65% for forecast
chance/temperatures, the Weather rain detail and reminder dates), multiplied by
**Text size**; very short compact widgets cap it by their own height. A larger
Text size never renders scaled ambient labels or values smaller: an overfull
widget zooms out as a whole (icons and the unavailable dash may still shrink). See the [widget contract](widgets.md#families-and-editing).

## Reminders and last screen

Reminder actions (add, edit, check off, restore, delete, clear history) save
immediately with a short status line and never join the settings draft. Reminder
form Cancel abandons that form only. Items are silent, dated or undated and one-time.
The Reminders tab has an **Up next (N)** / **History (M)** switch (`aria-pressed`).
Up next uses the display's order: overdue or due within seven days (soonest first),
then undated (newest first), then later dates. Each row has a 44 px check circle,
the title, a due line (`Overdue · Yesterday · 3:00 PM`, `Today · 6:00 PM` or
`Anytime`) and Edit/Delete. One tap fills the circle and dims the title at once while
the completion saves; after about 0.9 s the row collapses out of Up next (reduced
motion keeps the delay without the collapse). The status line offers **Undo** for
about 8 s; Undo, or tapping the circle again during the settle, restores the item
(it shows unchecked at once and stays in Up next while the restore saves). Focus
moves to the next circle (else the previous one, else Add), so keyboard users can
tick off several in a row; after Undo, focus moves to the restored reminder's circle.
A failed save reverts the row: “Could not complete reminder. It is still in Up
next.” Deleting from Up next reads “Reminder deleted”, also while a row settles.
History groups completed reminders under TODAY, YESTERDAY, `Mon, Oct 12` or
`Oct 12, 2025` by completion time in the computer timezone, newest first, 50 at a
time. A row shows `Completed 3:42 PM` (plus ` · was due …` when it was dated), and
offers Restore (the check or the undo icon, back to its sorted place in Up next) and
Delete. Completed reminders cannot be edited; an edit saved for a reminder completed
in another tab reports “This reminder was completed elsewhere. Restore it to edit.”
**Clear history…** asks inline before deleting every completed reminder. The
computer keeps the latest 500 completed reminders. Every reminder time follows the
12/24-hour setting; like the canvas preview, the editor list follows an unsaved
change to it, while the display keeps the saved setting until Save.
The ambient widget shows as many pending reminders as fit its box, soonest first,
never a partially visible row, then an exact “+N more”. Titles use up to two lines
(four when only one reminder is pending) and scale with the widget width, capped
near 3.2% of the display height. If even one row overflows, that row stays and the
widget zooms out as a whole; any resize remeasures against the widget's fixed box, so
the count and that state never flip on a remeasure. Dated rows add `Today · 6:00 PM`, `Tomorrow ·
9:00 AM`, `Oct 24 · 3:00 PM` or `Overdue · Yesterday · 3:00 PM` (the word Overdue in
the dim caution tone). Completed reminders never appear; the display reflects a
check-off within its 30 s refresh.
**Widgets → Reminders → Hide when empty** defaults on. A confirmed list with no
pending reminders (history only) hides the widget, or shows “All clear” when the
option is off; a missing list or a disconnected display with nothing saved shows
“Reminders unavailable”, and saved items stay listed with “Saved reminders ·
offline”. Disabling the widget always hides it.
An unchanged due-date input is omitted from an edit, preserving its exact saved
instant (including repeated daylight-saving hours and imported seconds/offsets)
and any concurrent date update. Explicitly changing or clearing the date still
saves that selection in the computer's local timezone.

Last screen is a dim optional pre-activation snapshot with capture time, size and
opacity controls. The UI does not capture. Native/server RAM lifecycle clears it
on dismissal; live preview/image history is not implemented. Export includes saved
settings/reminders only, excluding drafts, images and tokens.
New defaults use 24% snapshot opacity, multiplied by the ambient brightness cap.
Saved custom values, including the former 8% default, are preserved. A presentation
filter lifts midtones while preserving exact black/white endpoints; it changes
neither the RAM PNG nor its alpha. Grid families determine the usable image size;
the retained legacy `preview.widthPercent` field no longer shrinks that region.
The image takes the snapshot's own shape at the largest size that fits above one
caption line, centred in the cell, and "Last screen · 8:40 AM" starts on the image's
left edge a few pixels below it in every family and density (#225; under 6 px even at
4K). A newer snapshot that arrives while the display is shown stays hidden until it has
loaded and decoded, then fades in at Subtle and Lively; Off and reduced motion show it
as soon as it is ready (#173). The caption's time is formatted once per capture, not on
every one-second tick (#99).

Clock styles are Outline (default), Digital and Analog. Analog has hands without
a fixed face/tick ring (#222): two rounded text-colour hands (the hour hand at 30% of
the drawn square, the minute hand at 45%, never thinner than 3 px and 2 px at 720p,
scaled with the display) and a small dim pivot dot. Small and medium size the hands
to the cell height with the weekday and date beside them; large keeps the centred
hands over a quiet calendar line. The Outline stroke never thins below 1.2 px at 720p.
The clock's labels are built once per minute (#99), and the analog minute ease runs on
the compositor (#161). Photo starts disabled; choose a JPEG/PNG/WebP on this
device, then Save or Cancel with the rest of the draft. It is dimmed and moves
as one widget; a newly chosen photo fades in only after it has loaded (#173). It never uses the desktop snapshot or a remote feed. The private
recovery backup may retain an older selected image after replacement or clearing.

## World clocks, Sun & moon and Air quality

All three start disabled and are added from the picker; their panels sit under the
Size control and join the normal draft (Save/Cancel, no autosave).

- **World clocks:** up to four cities added with the same keyboard city search as
  the Weather tab (debounced combobox, `GET /api/locations`). Each row has an
  editable label (1–40 characters, defaulting to the city name), the region (the
  search result's region in this session, otherwise the time-zone name), the
  city's current time, and Move up, Move down and Remove buttons; focus stays with
  the moved city. The add field is disabled at four cities. An empty label blocks
  Save with "Each world clock needs a label". Hint: "Times follow each city's time
  zone and daylight saving." Coordinates are used only for the day/night icon. With
  no cities the widget is hidden on the display and shows "Add a city" on the canvas.
- **Sun & moon:** no settings. Hint: "Uses your weather location ({name}); times are
  calculated on this computer." Times use the weather location's resolved timezone,
  or this computer's while it is still `auto`.
- **Air quality:** scale US AQI (default) or European AQI. Hint: "Model estimate from
  Copernicus CAMS via Open-Meteo for your weather location. Canada's AQHI and local
  sensors are not available." While the draft enables the widget or changes its
  scale and the saved state has no reading for it, the canvas previews
  `GET /api/air-quality` (refreshed every 5 minutes). Cancel drops the preview at
  once; after Save it is kept until the next state poll carries the saved reading.

On the display: World clocks shows the first city (small), two side by side
(medium) or four rows (large) in regular-weight numerals, with "Tomorrow · +13 h",
"Today · −1 h" or "Same time", a sun or moon icon for daylight there, and "+N" for
cities that do not fit. Sun & moon shows the next sunrise or sunset (small), adds
both times, daylight length, its change from yesterday and the moon phase (medium),
and a dim dotted day arc with the sun's position, illumination and the next full
(or new) moon (large); polar days read "Sun up all day" / "Sun stays down today".
Air quality shows the AQI and its category word (no category colours), adds the
main pollutant and UV (medium), and up to 24 hourly bars with unknown hours dotted
and the UV peak (large). Bars, hour labels and the peak use only the current and
later hours, so a saved reading never shows a past hour or a peak that has already
happened; with fewer than two upcoming hours the line reads "Hourly estimate
unavailable". The chart is named for screen readers ("US AQI estimate for the next
24 hours: 40 to 45"). One footer row (#221) always shows the age and the short credit
"CAMS · Open-Meteo": "Model est. · 12 min ago" with a reading, "Saved reading · 2 hr
ago" in the caution tone when stale, and "Offline · …" first while the display cannot
reach the computer. Phrases never break inside, so "12 min ago", "12 µg/m³" and
"Open-Meteo" stay whole, and small and medium keep fit 1 at Text 100% in every density,
fresh, stale or offline, at 720p, 1080p and 4K. Saved current values stand for 3 hours
after the update, like Weather's temperature (#243). After that (#188) the reading
shows the saved hourly estimate for the current hour, labelled "Saved estimate" in the
caution tone, with its UV; without an estimate for this hour the old AQI reads "Last
known · 9 AM" ("Sat 9 AM" when not today) and UV is hidden. The fetch-time main
pollutant is hidden in both cases. Age and credit always stay. A failure reads "Air
quality unavailable" (age only, caution tone), never clean air. Calculations are cached
per minute (no `Intl` formatter is built while the minute holds, #185); values change on
the shared one-second tick without their own animation.
Browser suite: `tests/ui/catalog-sky-browser.mjs`.

## Movement and verification

The edited layout is the first composition. Later collision-free compositions
vary legal widget origins and whole-plane offsets, with a fully black rest before
revealing each replacement (default three minutes/two-second fade). Black remains
`#000`; brightness affects content only. Reduced motion/Soft motion off removes
drift/travel and reveal effects while discrete relocation continues through black.
The separate **Animation** setting (Off, Subtle by default, Lively) governs motion
inside widgets: Subtle animates only changes and the reveal after each black rest,
Lively adds reveal choreography and slow loops on the current-weather glyph only
(see [motion levels](design.md#motion-levels)). Each screen shows its effective
level as `data-animation` on the ambient root: Off whenever that screen prefers
reduced motion, so turning off Windows Settings → Accessibility → Visual effects →
Animation effects makes the TV show Off. Relocation through black continues either
way. The [motion harness](../tests/ui/motion-browser.mjs) checks levels, reduced
motion, the reveal sequence, entrance geometry (every family of every active widget,
a full-height free-size Reminders span, the default board and a full board of every
widget at 1080p and 4K), loop inventory, adaptive Weather (real-size hero glyph,
calm → elevated fades and Lively bar growth), the measured Reminders list (only a
newly pending row fades; re-sorts, completions and remeasurements replay nothing and
the measured rows match at every level), value crossfades in the #78 widgets, editor
flows and a CDP performance budget for the default and full boards at 1280×720; TV
smoothness and comfort remain owner acceptance (#111).
Motion/dimness do not guarantee protection from image retention. No audio, external
fonts, telemetry, cloud accounts or LAN exposure is added.

The reusable
[Edge harness](../tests/ui/studio-browser.mjs) owns an ephemeral loopback server,
temporary data and synthetic provider/device responses. It checks global Cancel,
city keyboard/debounce/races, failed/in-flight saves, polling rebase, saved styles,
reminders, device cancellation/rounding/manual protection, all four timed 1080p/4K
bounds, true black, silence, reduced motion and 390px/320px reflow. Regressions also
cover failed explicit-location fallback races and focused-field clearance at
390px/320px with 844px/480px heights. The [grid harness](../tests/ui/grid-browser.mjs)
adds actual pointer/touch/keyboard moves/resizes, effective dirty-bar reverts,
density fitting/round-trip restoration, optional modules/styles, local canvas PNG/Cancel/atomic save
and pairwise rendered bounds. Images stay in RAM. Current verified counts and
review/installation limits are recorded in [STATUS](../STATUS.md).

The [workspace harness](../tests/ui/workspace-browser.mjs) checks bounded desktop
tabs/canvas/actions, unchanged canvas bounds when Save appears, selected/focused
resize handles, every active family picker action, Escape/focus return, private-data
separation, successful large Photo Add, explicit icon dimensions and focus clear
of Save. Verified logical viewports are 1280×720, 1280×600, 1024×600, 760×600,
390×700, 390×480 and 640×300 (the CSS viewport equivalent of 1280×600 at 200% zoom).
The actual browser-chrome zoom setting was not changed. Final-source compact
picker screenshots were inspected in RAM at 1280×600, 760×600 and 390×480.
The [widget harness](../tests/ui/widgets-browser.mjs) checks every active family at
three densities and 1080p/4K, meaningful descendant bounds, readable fitting,
unknown/partial/stale/image failures, browser F/cursor behavior and native-only
document styling. Physical TV brightness/comfort remains a separate gate.
The [palette harness](../tests/ui/palette-browser.mjs) renders every active widget in
every family, the default composition and a full board of all active widgets at
1280×720, 1080p and 4K in Native and colour modes. Each section must resolve its
catalog tone (or the one accent), tint its accent element and paint nothing but that
accent, the text colour or a status tone. It also checks the sub-tones inside the
merged renderers (Weather's rain hook, Sun & moon's moon, World clocks' day/night
icons, Air quality bars), picker samples in every family and the editor canvas.

After `npm ci` and `npm run build`, use an existing Playwright/browser installation
and run every `tests/ui/*-browser.mjs` suite as
`node tests/ui/<name>-browser.mjs --playwright '<Playwright module path>' --edge '<browser executable>'`;
the preview suite also takes `--sharp '<Sharp module path>'`. The cursor check runs
separately against an isolated production server:

```powershell
node windows/tests/Test-CursorBrowser.mjs --base-url 'http://127.0.0.1:<isolated QA port>' --playwright '<Playwright module path>' --edge '<browser executable>'
```

The UI harnesses own their test servers and never use the installed app. The
preview harness uses an existing Sharp module to measure RAM screenshot pixels;
it checks exact black, capped highlights, lifted midtones, all families/densities,
saved-opacity preservation and byte-for-byte raw snapshot/privacy behavior.
These checks do not establish recognizable content in an actual native capture.
Cursor checks
require a separate isolated production server and mock state without saved-data
changes. These are development tools, not runtime dependencies. Final source
visuals also require independent RAM inspection. Native cursor proof, fresh-account
installation, media/game inhibition and viewing-distance comfort remain separate.
