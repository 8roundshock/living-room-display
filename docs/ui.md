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
  location, units, reminders and named styles. Room brightness is 55%; Night is
  28%. Up to twelve saved styles include visual/widget/empty-reminder settings.
- The authored canvas stays still by default. **Edit layout** reveals a faint
  editor-only grid and whole-widget drag targets. Clicking/focusing selects a
  widget and exposes its resize handle. Arrow keys move the focused widget;
  Tab reaches its handle, where arrows change family. Family buttons are another
  alternative. No technical Position coordinates or four-arrow inspector exists.
  Pointer feedback is continuous while neighbors reflow into legal cells. Escape
  or pointer cancellation abandons the entire drag; impossible drops/resizes keep
  the prior board. Density changes immediately fit every enabled module, reducing
  families only when necessary; a round trip restores exact explored positions
  and families until another widget edit. Cancel restores the saved arrangement.
- Density/family/position and visibility form one atomic local layout during a
  concurrent poll, preserving its validity while unrelated saved settings refresh.
  Adding a widget can seek nearby legal origins when its previous hidden origin
  cannot accommodate the board; it never silently removes existing content.
- **Widgets** selects inline size/position and per-widget controls. **Add widget**
  opens a compact category rail and one actual renderer with synthetic family
  content, size choices and a reachable Add action. Every module can be removed, including clock,
  weather and rain separately. Small/medium/large families adapt their content.
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
Each weather module keeps its actual place and relevant units visible when used
alone; weather and forecast show the unit beside the place (“Toronto · °C”), and
rain keeps its timing beside the chance. Compact forecasts abbreviate Tomorrow as
“Tom.” while retaining the full relative label and civil date for assistive text
and hover details. Ambient labels, age, attribution, units and secondary values
have a readability floor of 1.4% of the display height (1.65% for forecast
chance/temperatures, rain amount/period and reminder dates), multiplied by
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

Clock styles are Outline (default), Digital and Analog. Analog has hands without
a fixed face/tick ring. Photo starts disabled; choose a JPEG/PNG/WebP on this
device, then Save or Cancel with the rest of the draft. It is dimmed and moves
as one widget. It never uses the desktop snapshot or a remote feed. The private
recovery backup may retain an older selected image after replacement or clearing.

## Movement and verification

The edited layout is the first composition. Later collision-free compositions
vary legal widget origins and whole-plane offsets, with a fully black rest before
revealing each replacement (default three minutes/two-second fade). Black remains
`#000`; brightness affects content only. Reduced motion/Soft motion off removes
drift/travel and reveal effects while discrete relocation continues through black.
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
