# Display studio

Reviewed 2026-10-18 for [#43](https://github.com/8roundshock/living-room-display/issues/43).
Browser checks establish source behavior; installation and native pointer/idle
acceptance are recorded separately in [STATUS](../STATUS.md).

## Editing

`/editor` (also `/`) opens a large live appearance preview and a focused inspector.
Style, Widgets, Weather and Reminders share one settings draft. Desktop keeps the
preview beside the inspector; small windows stack it above a normally scrolling
inspector. The mobile preview is not sticky, leaving room for the keyboard.
Focus scrolling reserves the measured Save bar height so fields and labels remain
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
- **Edit layout** reveals a faint editor-only grid, draggable widgets and visible
  resize handles. Arrow keys move the focused widget; size buttons/position
  arrows are an alternative. Escape or pointer cancellation abandons a drag.
  Invalid drops/resizes retain the prior layout. Density changes repack all active
  widgets without shrinking or dropping them, or report insufficient room.
- **Widgets** selects inline size/position and per-widget controls. **Add widget**
  shows synthetic family previews. Every module can be removed, including clock,
  weather and rain separately. Small/medium/large families adapt their content.
- Numbered preview buttons select arrangements; **Automatic** resumes movement.
  **Open display** opens a separate tab. Manual display controls appear on pointer
  movement or Tab; Esc or E returns to the editor.

Standalone cursor CSS covers loading, failure and controls. Editor/embedded
previews keep normal pointers. This does not change Windows cursor settings or
establish native cursor acceptance. Appearance saves do not enable Windows idle.

## Weather and location

Typing two characters starts debounced city search. Up/Down explores, Enter
selects, and Escape dismisses; focus stays in the input. Typing, blur or the first
result never selects. Region/country distinguishes namesakes. Older requests
cannot replace newer options. Selected location is separate from search text.

New installs use Toronto until an area/city is saved. An editor with already-granted
browser permission attempts one automatic lookup; otherwise **Use device location**
is the explicit permission action. All results remain drafts until Save. Cancel
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

## Reminders and last screen

Reminder Add/Edit/Complete/Delete actions save immediately with separate short
feedback. Reminder form Cancel abandons that form only. Items are silent, dated
or undated and one-time; families show one, two or four pending items, dated first.
**Widgets → Reminders → Hide when empty** defaults on. Confirmed empty/all-completed
lists hide the widget; failure cannot masquerade as an empty list. Disabling the
widget always hides it. Completed items remain editable until deleted.

Last screen is a dim optional pre-activation snapshot with capture time, size and
opacity controls. The UI does not capture. Native/server RAM lifecycle clears it
on dismissal; live preview/image history is not implemented. Export includes saved
settings/reminders only, excluding drafts, images and tokens.

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
density rejection, optional modules/styles, local canvas PNG/Cancel/atomic save
and pairwise rendered bounds. Images stay in RAM. Current verified counts and
review/installation limits are recorded in [STATUS](../STATUS.md).

After `npm ci` and `npm run build`, use an existing Playwright/browser installation:

```powershell
node tests/ui/studio-browser.mjs --playwright '<Playwright module path>' --edge '<browser executable>'
node tests/ui/grid-browser.mjs --playwright '<Playwright module path>' --edge '<browser executable>'
node windows/tests/Test-CursorBrowser.mjs --base-url 'http://127.0.0.1:<isolated QA port>' --playwright '<Playwright module path>' --edge '<browser executable>'
```

Both UI harnesses own their test servers and never use the installed app. Cursor checks
require a separate isolated production server and mock state without saved-data
changes. These are development tools, not runtime dependencies. Final source
visuals also require independent RAM inspection. Native cursor proof, fresh-account
installation, media/game inhibition and viewing-distance comfort remain separate.
