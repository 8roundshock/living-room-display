# Display and editor

Implemented in the first application slice, reviewed 2026-10-18. Actual TV
readability, brightness preference, and Windows helper acceptance are separate
from the browser checks below.

## Open and edit

- `/editor` and `/` open the local editor. `/display` opens the ambient view.
- The editor's **Open display** button opens a separate browser tab. In manual
  display mode, move the pointer or press Tab to reveal controls. Esc or E returns
  to the editor; **Fullscreen** requests browser fullscreen.
- Controls update the embedded 16:9 preview immediately. **Save changes** persists
  them through the local server. The save control remains available at the bottom
  of the viewport; an unsuccessful save keeps the draft visible for retry.
- Phone, Room, and Night are appearance starting points. Applying one resets
  widget transforms and snapshot appearance, while keeping the city, units,
  reminders, and named presets. Room defaults to 55% content brightness; Night
  uses 28%. Black backgrounds remain `#000` at every brightness.
- Under **Your saved presets**, save up to twelve named appearances, select,
  rename/update, or delete them. These changes also need **Save changes**.
- **Export backup** downloads the server's versioned settings/reminder JSON.
  Restore procedures and storage locations belong to [install.md](install.md).

The editor is intentionally more legible than the display. It has no external
fonts, audio, telemetry, or cloud account requirement. The development server and
application server bind to loopback; the UI does not enable LAN access.

## Composition and movement

The display uses three broad rows and four compositions. The clock, current
weather, rain outlook, reminders, forecast strip, and available last-screen
snapshot move as whole groups. Gentle drift runs continuously; the default
recomposition cadence is three minutes with a two-second fade out and in. The
weekly strip changes rows and the snapshot changes columns. **Next arrangement**
in the editor makes the placements reviewable without waiting.

Each widget measures its natural content and available region and scales down
to fit. This handles time widths, forecast/weather text, resized previews, and
larger text settings. Manual per-widget scale and X/Y offsets remain inside a
clipped region to avoid overlap with adjacent widgets; extreme manual settings
can crop that widget. The editor explains this and offers a per-widget reset.
Free drag-and-drop layout and arbitrary unbounded placement are not implemented.

Turn movement off for a static composition. The browser's reduced-motion
preference also pauses drift and automatic recomposition, including CSS fallback
behavior. Dimness and movement do not guarantee protection from image retention.

## Weather and reminders

The clock and reminders use the computer/browser's local timezone. Forecast
intervals use the selected weather city's timezone, with the city shown beside
current conditions. Metric/imperial values come from the API without a second
conversion in the client. Date-only forecast days are interpreted as calendar
dates. Today and Tomorrow compare the actual current civil date in the weather
city's timezone, so a retained stale list cannot relabel yesterday as today.

Rain presentation selects valid hourly intervals intersecting the upcoming
twelve hours. This can include thirteen full hour buckets when the first is
already in progress. The peak hourly chance is the maximum **precipitation**
probability among those available intervals, not
the probability of rain at any moment across the entire twelve-hour period.
Bars show the individual hourly probabilities. Estimated rain windows and rain
amounts use forecast rain plus showers, excluding snow; the amount is the total
over the displayed full intervals, with their actual start/end period printed
beside it. Amounts are not prorated within an hour. A rain window spans the first
through last interval with forecast rain and can contain breaks. Missing hours,
gaps, or incomplete upcoming coverage are labeled partial, and dry wording is
limited to the shown intervals. Expired intervals cannot supply a current amount.
These remain model estimates, not minute-perfect nowcasting. Missing amounts and
probabilities stay unknown; a partial known amount is labeled as such.

Current conditions show update age; retained stale forecasts are labeled on
current weather, the weekly strip, and the rain outlook. Missing weather does
not substitute demonstration values. The editor links to Open-Meteo attribution.

Reminders are one-time, dated or undated, and silent. Add/edit/complete/delete
operations save immediately, separately from appearance drafts. Pending dated
items are ordered by due time, then undated items; at most two appear in the
ambient view. Completed entries remain available in the editor until deleted.
Recurring and time-only repeating reminders are outside this first slice.

Under **On your display → Reminders**, **Hide reminders when empty** defaults to
on. With no pending items (including when every item is completed), the whole
reminder widget disappears and leaves black space. Turn the setting off to retain
the empty reminder message. Turning the Reminders widget off always hides it.
The behavior saves with appearance changes and built-in/named presets; built-in
starting points use the default, while named presets retain the chosen value.
Old settings, saved presets and imports missing this field default to on without
re-enabling a disabled widget.

Initial loading/failure does not create an empty reminder list. If a later refresh
fails, an empty cached list shows **Reminders unavailable** instead of disappearing
or claiming there are no reminders. Cached pending items stay visible and are
marked offline. These rules apply to both the display and editor preview.

The focused typography, spacing and transition choices follow the adaptations in
[design.md](design.md), with primary Apple HIG sources. True black, dim defaults,
whole-widget movement and the four compositions remain part of this design.

## Last screen

The UI reads capture metadata and an image from the local server. It does not
capture the desktop. An available image is labeled **Last screen** with its
capture time; the default image opacity is 8%, before overall content brightness.
Size, opacity, visibility, and widget transforms are editable. A missing or failed
image hides on the ambient view and shows an explanation in the editor preview.
No test image or simulated weather is included in production state.

The snapshot remains subject to the Windows helper's source/lifecycle checks and
the server's RAM-only lifetime. Saving appearance does not activate a Windows
screensaver or change Windows idle settings.

## Verification evidence

The client has twenty-five Node tests covering reminder visibility/unknown state,
device permission/position behavior,
provider-unit formatting, missing values,
forecast timezone/DST and calendar-day handling, reminder datetime round trips
and ordering, precipitation versus rain semantics, composition cycling, and
preset isolation. Run them with the repository's `npm test`; `npm run build`
also checks and bundles the frontend.

Actual headless Edge browser checks on 2026-10-18 used a separate temporary
browser profile and isolated backend QA data:

- Visually inspected the editor at 1440×1100, the full display at 1920×1080 with
  real fresh Toronto Open-Meteo data, and the editor at a 390×844 phone viewport.
- Exercised reminder dated add/edit/complete/delete, local datetime round trips,
  browser-reload persistence, Night/named preset save/reload, backup export, and
  real city search/selection. Restored QA settings and removed the test reminder.
- Advanced actual recomposition timers through all four compositions at
  1920×1080 and 3840×2160. Checked every widget/content rectangle stays inside its
  region and the viewport with default transforms. Computed background was
  `rgb(0, 0, 0)` and no audio/video elements or browser exceptions appeared.
- With explicitly simulated state delivered only through browser request mocks,
  checked stale/missing/unknown weather, snapshot timestamp/opacity/toggle/failed
  image handling, initial server-failure retry, reduced motion, labeled controls,
  and absence of horizontal overflow on phone and desktop.
- Served the production build from a separate isolated local data directory;
  verified both routes, same-origin API/CSP behavior, and Esc navigation with no
  browser console or page errors. The initial missing favicon request is tracked
  in [issue #18](https://github.com/8roundshock/living-room-display/issues/18) and
  fixed with the declared local SVG asset.
- Reproduced and fixed the two P2 findings from independent review: a stale
  2026-10-17 daily entry at fixed 2026-10-18 09:00 Toronto now renders Sat, followed
  by Today and Tomorrow. Two dry 09:00–11:00 intervals render that amount period
  and Partial forecast, with no twelve-hour dry claim. Browser regressions also
  checked a city timezone differing from the browser, city midnight, gapped and
  expired intervals, complete coverage with an in-progress first bucket, 1080p/4K
  bounds, phone overflow, and zero production CSP/console errors. These fixes are
  tracked in [#23](https://github.com/8roundshock/living-room-display/issues/23)
  and [#24](https://github.com/8roundshock/living-room-display/issues/24).

Initial development clipping of default clock/weather content is tracked in
[issue #13](https://github.com/8roundshock/living-room-display/issues/13); automatic
fitting resolved the observed clipping and passed the rectangle checks above.
Screenshots were inspected in memory; no screenshot files were saved. Simulated
1080p/4K browser viewports are not evidence of the TV's actual active resolution,
viewing-distance readability, or subjective brightness preference.

## Device weather location

New installs use Toronto as a fallback. In the editor, an already-granted browser
location permission permits one automatic lookup when that editor opens. Otherwise
**Use device location** is an explicit user action; the browser may ask permission.
The ambient `/display` route never queries permission or requests a position and
its production Permissions-Policy disables geolocation. There is no continuous
watch or IP-location lookup.

This uses browser device-location services, not a promise of hardware GPS. For
device lookups, only latitude/longitude rounded to one decimal place leave the location adapter or
enter local settings, backups, exports, and weather-provider requests. Accuracy,
altitude, timestamps and raw browser position objects are discarded. The server
also rounds device coordinates and always labels them **Device area**; no city
name is inferred. The browser/OS chooses its location service. The app makes no
additional IP lookup. See the [browser position API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

Source labels distinguish **Approximate device area**, **Manual city**, and
**Toronto fallback**. Denial, invalid/unavailable positions, or an unanswered
lookup fall back unobtrusively to Toronto unless a manual city is already selected.
The manual city search overrides automatic use; an explicit successful device
button can replace it. Device actions save only the location immediately and keep
any unrelated appearance draft. The server prevents a late automatic result from
replacing a manual city selected in another editor.

Existing version-one settings/exports missing `locationSource` migrate to manual,
including a previously selected Toronto. This preserves existing choices rather
than guessing whether an old city was intentional. Users can choose the device
button to switch. New default settings use `fallback`. The setting is local; the
server has no access to browser permission state.

For device areas, the forecast requests `timezone=auto` and validates the
provider's returned IANA timezone before displaying data. Today/Tomorrow and
weather intervals use that resolved weather-area timezone, independently of the
computer's clock timezone. Unresolved timezone data stays unavailable. See
[Open-Meteo timezone documentation](https://open-meteo.com/en/docs).

Device-location verification for #31 used synthetic position/permission mocks
only. All 42 integrated tests and the production build passed. Actual isolated
Edge production checks covered prompt-without-auto-request, explicit rounded
success, already-granted one-shot use, denied/unavailable/invalid fallback,
manual search/reload and denial preservation, late-result protection, provider
timezone/civil dates, no geolocation calls from `/display`, and phone layout.
The weather card was inspected in RAM, with no console errors or screenshot files.
No real location permission was granted and no real device position was obtained.

For #34, all 47 integrated tests and the production build passed. Isolated
production Edge checks with synthetic data covered empty/all-completed/active
lists, the empty override, disabled widgets, failed-refresh unavailability and
retained offline reminders, checkbox save/reload and named preset restoration.
All four timed compositions passed region/content bounds at 1920×1080 and
3840×2160; reduced motion disabled drift/recomposition and reveal/control motion.
The 390px editor had no horizontal overflow and kept reminder management available.
Final fade states at both display sizes and the phone controls were visually
inspected in RAM. There were no page exceptions or unexpected console errors;
two deliberate 503 responses exercised offline behavior. No screenshot files,
real geolocation requests, or changes to the installed server were involved.
