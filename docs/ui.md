# Display studio

Reviewed 2026-10-18 for [#39](https://github.com/8roundshock/living-room-display/issues/39).
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
  options and saved styles. Edits made while saving remain unsaved afterward.
  Failed saves preserve the draft. Untouched fields refresh from server polling.
- **Cancel** restores the latest saved settings across every section, resets the
  city query/style form, and invalidates pending device callbacks. It does not
  undo saved reminders. Leaving with settings edits uses the browser's prompt.
- **Phone**, **Room** and **Night** reset visuals/transforms while preserving
  location, units, reminders and named styles. Room brightness is 55%; Night is
  28%. Up to twelve saved styles include visual/widget/empty-reminder settings.
- **Widgets** rows reveal their own controls and size/position disclosure.
  Large manual offsets/scales can crop content inside its region; inspect every
  arrangement. Free dragging and arbitrary overlapping placement are not built.
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
or undated and one-time; at most two pending items appear, dated items first.
**Widgets → Reminders → Hide when empty** defaults on. Confirmed empty/all-completed
lists hide the widget; failure cannot masquerade as an empty list. Disabling the
widget always hides it. Completed items remain editable until deleted.

Last screen is a dim optional pre-activation snapshot with capture time, size and
opacity controls. The UI does not capture. Native/server RAM lifecycle clears it
on dismissal; live preview/image history is not implemented. Export includes saved
settings/reminders only, excluding drafts, images and tokens.

## Movement and verification

Four arrangements relocate whole widget groups, with slow drift and configurable
fades (default three minutes/two seconds). Black remains `#000`; brightness affects
content only. Reduced motion stops drift/recomposition and UI/data reveal effects.
Motion/dimness do not guarantee protection from image retention. No audio, external
fonts, telemetry, cloud accounts or LAN exposure is added.

On 2026-10-18, 53 application tests and the production build pass. The reusable
[Edge harness](../tests/ui/studio-browser.mjs) owns an ephemeral loopback server,
temporary data and synthetic provider/device responses. It checks global Cancel,
city keyboard/debounce/races, failed/in-flight saves, polling rebase, saved styles,
reminders, device cancellation/rounding/manual protection, all four timed 1080p/4K
bounds, true black, silence, reduced motion and 390px/320px reflow. Regressions also
cover failed explicit-location fallback races and focused-field clearance at
390px/320px with 844px/480px heights. Images stay in RAM.

After `npm ci` and `npm run build`, use an existing Playwright/browser installation:

```powershell
node tests/ui/studio-browser.mjs --playwright '<Playwright module path>' --edge '<browser executable>'
node windows/tests/Test-CursorBrowser.mjs --base-url 'http://127.0.0.1:<isolated QA port>' --playwright '<Playwright module path>' --edge '<browser executable>'
```

The first owns its test server and never uses the installed app. Cursor checks
require a separate isolated production server and mock state without saved-data
changes. These are development tools, not runtime dependencies. Final source
visuals also require independent RAM inspection. Native cursor proof, fresh-account
installation, media/game inhibition and viewing-distance comfort remain separate.
