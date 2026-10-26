# Local API and data contracts

Source of truth: [shared types](../src/shared/contracts.ts) and
[validation](../src/server/validation.ts). The server binds only to `127.0.0.1`,
port 4318 by default (`LRD_PORT` may select another unprivileged port).

## Saved-style schedule (#514)

`GET /api/state` includes an API-only `schedule` snapshot: config, override expiry,
active selection/reason, missing style IDs, effective visual, schedule revision,
desktop timezone and storage warning. Its `settings` and settings ETag remain
the canonical manual values. The effective visual overlays only visual settings
for live display/Home and native host session; content, location, timers,
idle/security and saved styles are unaffected. Provider demand follows effective
widgets. The existing opaque four-part `/api/changes` marker advances for schedule
selection changes and override expiry without writing settings or sidecar files.

- `GET /api/schedule`: snapshot plus schedule ETag.
- `PUT /api/schedule`: complete `{ enabled, fallbackPresetId: string|null, rules }`.
  Each rule is `{ id: UUID, presetId: string, days: number[], start: 'HH:MM', end:
  'HH:MM' }`; days are unique 0=Sunday through 6=Saturday, at least one; at most
  24 rows, unique row IDs. Existing style IDs remain nonempty strings up to 80
  characters, including legacy non-UUID IDs. Unknown fields are rejected.
- `POST /api/schedule/override`: `{ manual: true }` selects saved manual visuals
  for one elapsed hour; `{ manual: false }` resumes immediately. Pausing an off
  schedule returns 409. Manual settings saves do not implicitly pause scheduling.
- `GET /api/schedule/export`: `{ version: 1, kind: 'still-schedule', config }`;
  contains style references, never visual snapshots or temporary overrides.
- `POST /api/schedule/import`: validates that backup before replacing the
  schedule and clearing its override. It never imports or edits styles.

Writes accept the separate strong schedule `If-Match`; stale requests return 409
without writing, and concurrent writes serialize. Successful writes return the
snapshot and current ETag. Ranges are local civil `[start,end)`; overnight days
name the start day, equal times end at that local time next day. First matching
row whose style exists wins; deleted styles are skipped, followed by fallback or
manual visuals. Each read recomputes selection for restart/wake catchup. DST
skipped minutes never occur; repeated clock minutes both match the same rows.

`schedule.json` is an optional private sidecar (`version`, `config`, `overrideUntil`).
Missing means off; opening/reading/automatic transitions never create it or write
an empty file. Explicit saves are atomic, preserve previous data in
`schedule.backup.json`, and never modify canonical state, its backup, or its export.
Invalid files are left untouched with scheduling off and a visible warning; a
deliberate replacement preserves the original under a unique `schedule.corrupt-*`
name. Ordinary saved-settings import and appearance/layout reset leave schedules
in place; missing referenced styles are skipped. To reset scheduling, disable it
or remove its rows and save. Full data-directory backups include all sidecars;
ordinary JSON backup does not, and the UI points to the separate schedule backup.
Install upgrades/uninstall-with-data-kept preserve it; explicit removal of the
whole private data directory removes it with the other user data. Older app
versions ignore this sidecar, so rollback-compatible settings/export formats stay
unchanged. Temporary-file cleanup recognizes only exact schedule atomic-save names.

## Browser API

| Method/path                    | Request                                                                | Response                                                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/health`              | None                                                                   | Status, version (read once at startup from the shipped `package.json`), storage recovery warning. |
| `GET /api/state`               | None                                                                   | Settings, reminders, weather (refreshed only while a saved widget needs it), air quality (`off` unless a saved widget shows it), [official weather alerts](#official-weather-alerts) (`off` unless Dynamic shows them), preview metadata, storage warning, timers and timersWarning; the [settings revision](#settings-revision) as `ETag`. |
| `PATCH /api/settings`          | Validated nested partial settings; optional `If-Match`                 | Full saved settings with the new revision as `ETag`; 409 with the current settings when `If-Match` is stale. |
| `POST /api/location`           | Device/fallback source, rounded coordinates for device, automatic flag | Saved settings; preserves manual overrides against automatic/failed results. |
| `GET /api/reminders`           | None                                                                   | Reminder array.                                                              |
| `POST /api/reminders`          | `text`, optional ISO `dueAt` or null, optional past `createdAt`        | Created reminder (201).                                                      |
| `PATCH /api/reminders/:id`     | Partial `text`, `completed`, `dueAt`                                   | Updated reminder.                                                            |
| `DELETE /api/reminders/:id`    | None                                                                   | Empty 204.                                                                   |
| `DELETE /api/reminders/completed` | None                                                                | `{ "deleted": n }`; removes only completed reminders, atomically.            |
| `GET /api/weather`             | None                                                                   | Normalized forecast for the saved location, refreshed when due (Settings or an unsaved editor visual preview). |
| `GET /api/air-quality`         | Optional `scale=us\|european` (defaults to the saved scale)            | Editor preview of [air quality](#air-quality) for the saved location, `no-store`. |
| `GET /api/locations?q=Toronto` | City query, 2–100 characters                                           | Up to eight city results with coordinates/timezone.                          |
| `GET /api/export`              | None                                                                   | Downloadable settings/reminders JSON backup.                                 |
| `POST /api/import`             | A validated export                                                     | Atomic replacement of settings/reminders.                                    |
| `GET /api/preview`             | None                                                                   | Availability, capture timestamp, dimensions.                                 |
| `GET`/`HEAD /api/preview/image` | None                                                                  | RAM-only PNG, `no-store`, or 404; HEAD answers the same without a body.      |
| `GET /api/photo/image?id=hash` | Current photo hash                                                     | Selected local PNG, `no-store`, or 404.                                      |
| `GET /api/windows/status`      | None                                                                   | Actual screensaver registry state and power plan timeouts (read-only).       |
| `GET /api/changes`             | None                                                                   | `{ "change": "<boot>.<store>.<timers>.<preview>" }`, `no-store` ([change marker](#change-marker), #438). |
| `GET /api/timers`              | None                                                                   | `{ timers, warning }` ([timers](#timers), #438).                             |
| `POST /api/timers`             | `durationMs`, optional `label`; Undo adds `endsAt` or `remainingMs`     | Created timer (201).                                                         |
| `PATCH /api/timers/:id`        | Exactly one of `paused`, `addMs`, `restart: true`                      | Updated timer.                                                               |
| `DELETE /api/timers/:id`       | None                                                                   | Empty 204, or 404.                                                           |
| `DELETE /api/timers/finished`  | None                                                                   | `{ "deleted": n }`.                                                          |
| `POST /api/countdowns`         | `title`, `date`, optional `repeatsYearly`; Undo adds `id` and `index`  | Saved settings (201) ([Home items](#home-item-endpoints), #438).             |
| `DELETE /api/countdowns/:id`   | None                                                                   | Saved settings, or 404.                                                      |
| `POST /api/world-clocks`       | `label`, `timezone`, `latitude`, `longitude`; Undo adds `id`, `index`  | Saved settings (201).                                                        |
| `DELETE /api/world-clocks/:id` | None                                                                   | Saved settings, or 404.                                                      |
| `POST /api/widgets/:id/show`   | None                                                                   | Saved settings; 409 when no free cells ([Show on my display](#show-on-my-display)). |

Mutating JSON requests require `Content-Type: application/json`. Errors use
`{ "error": "message" }` and appropriate 4xx/5xx codes. Unknown settings fields
are rejected. Text/reminder limits, visual ranges, and preset limits are validated
on the server. Saved presets contain only nonrecursive visual snapshots.

`PATCH /api/settings` also accepts request-only `automaticLocation: boolean`.
When true, the serialized write preserves a saved manual city rather than applying
the request's location/source; other valid changes save atomically. The flag is
consumed, never stored or exported. The studio sends only changed fields, so an
unrelated appearance save does not resubmit an old location. Explicit successful
device selection uses validated PATCH without the automatic guard; validation
rounds device points. Invalid settings reject the entire draft, including location.
The studio also sets this guard for every failed-lookup fallback, including a
failed explicit device action; only an explicit successful device selection may
replace a manual city without this guard.
`/api/location` remains compatible for existing callers; the studio no longer uses
its immediate-save behavior.

### Settings revision

`GET /api/state` and every `PATCH /api/settings` reply carry the settings revision as a
strong `ETag` (#287), for example `"3f9c2a1b7d4e-12"`: a random id of the server process
and a counter that every write changing the settings advances (a Save, a location result
or an import; reminder writes do not). It exists only in memory: it is never written to
`state.json`, the backup or exports, and it starts again after a restart, so the files the
previous release reads are unchanged. A `PATCH /api/settings` whose `If-Match` names the
revision its changes were computed from applies only while that revision is current; the
check runs inside the serialized write, so two patches from one revision cannot both pass.
Otherwise nothing is written and the reply is 409 with the current `ETag` and
`{ "error": "Settings changed in another window. Review and save again.", "settings": <current settings>, "revision": "<current revision>" }`.
Without `If-Match`, or with `*`, a patch applies as before; a tag that is not quoted names
no revision and is refused. The editor sends `If-Match`. On a 409 it merges the current
settings into its draft as a poll would (the [list and widget merges](ui.md#editing)) and
sends the result once more by itself when the merge keeps every change the other window
saved and nothing blocks Save; otherwise it keeps the merged draft and shows the message.

Visual settings include `widgetBehavior.reminders.hideWhenEmpty` (boolean,
default `true`). It controls hiding a confirmed list with no pending reminders;
`widgets.reminders: false` always disables the widget. PATCH accepts a nested
partial such as `{ "widgetBehavior": { "reminders": { "hideWhenEmpty": false } } }`.
Empty nested patches preserve the current value. Saved presets include this
behavior, and version-one settings/presets/imports missing it acquire the default
without changing widget visibility or reminder contents. No data version bump
or storage-directory migration is needed. Unknown widget behavior keys and
nonboolean values are rejected. Connection failures are a client availability
state, not a replacement reminder list.

All dates representing instants are ISO timestamps with an offset or `Z`.
Reminder `dueAt` is one-time, nullable, and displayed in the editor's explicit
local time context. Recurrence is not implemented. Daily forecast dates are civil
`YYYY-MM-DD` labels; they are not instants to reinterpret in the server timezone.

Reminder history (#73) adds no field: while `completed` is true, `updatedAt` is the
completion time, and history is the completed subset of `reminders[]`. A completed
reminder is immutable except restore (`completed: false`, optionally with `text`
and/or `dueAt` in the same patch) and delete: a PATCH that changes its `text` or
`dueAt` without `completed: false` returns 409 “Restore this reminder before editing
it.” A PATCH whose every supplied field equals the stored value returns 200 with the
stored reminder and writes nothing, so a retried or double-tapped completion keeps its
original time. Completing a reminder keeps the newest 500 completed reminders and
removes older completed ones in the same atomic write; pending reminders are never
removed. The store still holds at most 1000 reminders in total (the previous release
rejects more): at the limit, `POST /api/reminders` removes the oldest completed
reminder in the same write, or returns 409 “Reminder limit reached” when all are
pending. Exports and imports carry history in `reminders[]` unchanged; an import with
more than 500 completed reminders is accepted as is and pruned at the next completion.

`POST /api/reminders` also accepts an optional `createdAt` (#237), which the editor's
Undo after a single delete sends with the deleted reminder's `text` and exact `dueAt`
string, so the re-created reminder (with a new `id`) returns to its sorted place. It
uses the persisted UTC format (`2026-10-18T13:00:00.000Z`, the same rule as stored
`createdAt`) and must not be later than the server's current time; an offset, a date
without a time or a future time returns 400 and writes nothing. `updatedAt` is the
re-create time. PATCH never accepts `createdAt`. The persisted reminder shape is
unchanged, so the previous release reads re-created reminders.

Settings `idle.enabled` is a preference, not proof Windows idle activation is
installed. Only the Windows host's explicit activation command changes that
configuration. `/api/windows/status` reads existing settings without changing them:
`available`, `selectedScreenSaver`, `active`, `timeoutSeconds`, `secure`,
`isLivingRoomDisplay` and `error?` from `reg query HKCU\Control Panel\Desktop`, and
(#436, additive) `power: { available, scheme, displayOffSeconds, sleepSeconds, error? }`.
`displayOffSeconds` and `sleepSeconds` are `{ ac, dc }` in seconds (0 means Never) or
null when Windows would not report them, read with `powercfg.exe /query SCHEME_CURRENT
SUB_VIDEO VIDEOIDLE` and `... SUB_SLEEP STANDBYIDLE` (no administrator rights, 2 s
timeout, hidden window). Parsing is locale-independent: the last two `0x…` values are
the current AC and DC indexes. `scheme` is the active plan's name from `powercfg
/getactivescheme` (translated by Windows). Off Windows, `power.available` is false.
Nothing here ever changes a power setting; the editor shows the AC values.

`settings.screen` (#436) is `{ keepAwake: boolean }`, default `{ keepAwake: true }`:
**Keep the screen on while the display shows**. While it is true, the display holds a
Screen Wake Lock (`navigator.wakeLock.request('screen')`) only while it is visible and
either the native screensaver page (`native=1`) or full screen; a windowed tab never
holds one, because Edge's request also blocks the Windows screensaver and display-off.
The display reports `data-wake-lock` (`held`, `unsupported`, `denied` or `off`) on
`.grid-ambient` and shows nothing. `screen` is not part of saved styles (`visualShape`);
PATCH accepts `screen.keepAwake`, and `screen` is omitted at rest while it equals the
default, like the default `widgetData` sections. Turning it off is a
[rollback exception](install.md#additive-data-and-rollback-compatibility-84) for 3446400.

## Grid and widget contracts

The [catalog](../src/shared/widgets.ts) supplies supported families, default
visibility/placements and all grid dimensions. `widgetGrid` contains `density`
(`spacious` 8×6, `balanced` 12×8 default, `fine` 16×10) and a placement for every
catalog ID: `{column,row,size}` with zero-based cells and a supported family.
`widgets[id]` is the enabled authority. The native desktop capture gate also
requires `preview.enabled`; the editor keeps both flags coherent when adding or
removing Last screen. Enabled placements may not intersect or leave the grid.
PATCH accepts nested placement updates; import/presets validate the same rules.
A free-size widget (the catalog `freeSize` rule; currently Reminders, #73) may add
`span: {columns, rows}`: whole cells from its minimum (2×2) up to the full grid
height and two-thirds of the width (Spacious 5×6, Balanced 8×8, Fine 10×10), in
revision 2 only. `size` is always the largest family inside the span, and a span
equal to that family's span is dropped, so spans are stored only when they differ.
Other widgets reject a span (`<Name> does not support custom sizes`); too-small or
too-wide spans return 400 with a clear message. In a placement PATCH, `span: null`
clears a custom size, and so does a `size` without `span` (a family choice); a
move keeps it. The editor sends a changed placement whole, with `span: null` when
it has none. The previous installed release (`d66832b`) and the earlier releases back
to `3fee844` read a saved span; `bedca44` does not, so a downgrade that far needs the
[strip procedure](install.md#removing-custom-reminders-sizes-before-a-downgrade).
Legacy version-one settings acquire the safe catalog default grid while preserving old
widget visibility and manual location. That backfill never uses the default board
that new installs and Reset layout start with ([#435](widgets.md#default-board-435)),
and a widget id missing from saved data reads as its catalog default (Calendar off). Legacy `widgetOverrides` offsets/scale
and `appearance.layout` remain parseable data but no longer affect rendering;
old manual visual positions are not converted to cells. The same applies to
legacy presets/imports. `appearance.clockStyle` is `outline` (default), `digital` or `analog`.

`appearance.accentMode` is `color` or `native`. New installs, the built-in Phone,
Room and Night styles and Reset appearance use `native` (#75); legacy settings,
saved styles and imports without the key read as `color`, so existing data looks
unchanged until Native is chosen. `color` tints every widget's accent elements with
`accentColor`; `native` uses each widget's catalog palette tone (see
[native palette](design.md#native-palette)). `accentColor` is kept in both modes.
A stored retired swatch value (Sand `#b8a17a`, retuned in #224) renders as that
swatch's current value and is never rewritten.
At rest `color` is omitted and `native` is written. The previous installed release
(`d66832b`) and the earlier releases back to `3fee844` read `native`
([rollback compatibility](install.md#additive-data-and-rollback-compatibility-84));
it is a rollback exception only for [`bedca44`](install.md#earlier-rollback-target-bedca44).

`appearance.animation` is `off`, `subtle` or `lively`; data without it reads as
`subtle`, and `subtle` is omitted at rest. It governs motion inside widgets and the
editor (#76): Off keeps widgets still, Subtle animates changes and the first-load
entrance, and Lively adds entrance choreography and the current-weather glyph's
slow loops. Each screen shows Off while it prefers reduced motion, whatever is
saved. Moving the board is separate (#436): `motionEnabled` (**Float gently**) floats
the board and each widget's content, or, when false or under reduced motion, steps
once per `motionIntervalSeconds` (30–1800, unchanged); the screen never goes dark.
`appearance.rearrange` (**Swap places**) is a boolean, default `false`, omitted at rest
while false; data without it reads as false. When true, widgets also trade cells every
interval, gliding for `clamp(fadeSeconds × 1.5, 1.2, 6)` s; `fadeSeconds` (0–10,
unchanged in schema) now only times that glide. Built-in styles keep `rearrange`, like
the other motion choices (#268); saved styles store it; Reset appearance returns it to
false. Swap places on is a [rollback exception](install.md#additive-data-and-rollback-compatibility-84)
for 3446400. The Style tab's Motion → Animation control edits
it as an ordinary draft field; built-in styles keep it and saved styles store it.
Built-in styles are looks (#153, #110, #226): they write only `brightness`,
`accentMode`, `accentColor`, `textColor`, `fontFamily`, `layout` and `preset`.
`appearance.preset` (`phone`, `room`, `night` or `custom`) is a label that follows the
look (#277): every appearance edit in the editor, applying a saved style and Reset
appearance write the built-in style whose look is showing (`matchingBuiltinPreset()`
in `src/client/model.ts`; the legacy `layout` does not count), else `custom`. It is not
part of the effective settings, so the label alone never makes a draft dirty and is never
sent by itself; data saved before #277 may still carry a stale label until the next
appearance edit. Rendering must not depend on it: use `matchingBuiltinPreset()` (#150).
The four values are the ones the previous release requires, so no stored shape changes.

`appearance.daylightBrightness` is the brightness mode (#439). `null`, the default
and what data without the key reads as, is **Fixed**: the display shows `brightness`,
exactly as before. `{ "dimmest": 0.2, "brightest": 0.8 }` is **Follow daylight**:
both values in `brightness`'s 0.1–1 range, with `dimmest` ≤ `brightest` (equal is a
flat line). A PATCH sends the whole range or `null`; a partial range, Dimmest above
Brightest, a value out of range or an unknown key returns 400. `brightness` stays
the Fixed level in both modes, so returning to Fixed restores it. The browser computes
the value; the API and the server never do. For the start of each minute it takes the
sun's elevation at the saved `location` (with [astronomy.ts](../src/client/astronomy.ts),
no network) and shows
`dimmest + (brightest − dimmest) · max(0, sin(elevation)) / sin(elevation at solar noon)`,
using the solar noon of the current solar day and a noon elevation of at least 5°.
So it is Dimmest from sunset to sunrise and through a polar night, Brightest at local
solar noon, above Dimmest all through a polar day, and a minute never changes it by
more than about 1% of the range; around midwinter beyond about 61° latitude, where the
noon sun stays under 5°, it peaks lower ([src/client/daylight.ts](../src/client/daylight.ts)).
The ambient page glides to each new value over 10 seconds; editor canvases follow the
draft at once. Night, Native colours and per-element opacity all scale from that one
value through the same `--ambient-brightness` cap. Built-in styles keep the mode (they
set only the Fixed level), Reset appearance returns to Fixed, and saved styles store
it. At rest `null` is omitted; the previous installed release (`d66832b`) does not know
the key, so a saved range is a [rollback exception](install.md#additive-data-and-rollback-compatibility-84).

Appearance PATCHes contain exactly the supplied keys: an omitted `clockStyle`,
`accentMode`, `animation` `daylightBrightness` or `rearrange` keeps its saved value (#83). Only
the persisted reader fills defaults.

Planned catalog ids (entries with `status: 'planned'` in `src/shared/widgets.ts`;
none since #157 and #171 activated all six #78 ids) appear in `widgets`, `widgetOverrides` and `widgetGrid.placements` but
always read as disabled. A PATCH that enables one returns 400 (`<Name> is not
available yet`).

## Widget data

`settings.widgetData` holds content for the #78 widgets: `worldClocks` (≤4 cities:
uuid `id`, `label` 1–40 characters, IANA `timezone` other than `auto`, `latitude`,
`longitude`), `calendar.weekStart` (`locale` default, `sunday`, `monday`),
`countdowns` (≤12: uuid `id`, `title` 1–60 characters, civil `date` `YYYY-MM-DD`
in 1900–2200, `repeatsYearly`), `note.text` (≤200 characters and ≤4 lines, trimmed,
CRLF stored as LF), `airQuality.scale` (`us` default or `european`) and, for Dynamic
(#437), `dynamic`: five booleans `weather`, `alerts`, `air`, `sky` and `personal`, each
`true` when missing, with at least one on (all off is a 400 "Dynamic needs at least one
source"). IDs within a list are unique and unknown keys are rejected. Missing sections
read as defaults. PATCH merges `calendar`, `note`, `airQuality` and `dynamic` and
replaces either list whole.
`widgetData` is not part of saved styles, so applying a style or built-in preset
leaves it unchanged. It is included in exports and imports like reminders. Note
text, countdown titles and world-clock labels are private user content: never put
them in Git, diagnostics or picker samples.

## Local photo

`PATCH /api/settings` accepts request-only `photoChange`: absent preserves the
local photo, `null` clears it, `{pngBase64}` replaces it atomically with settings.
The editor accepts ≤10 MiB JPEG/PNG/WebP, checks declared dimensions ≤40 megapixels
before browser decode, then downsamples to a longest side of 1280 and re-encodes
PNG without source metadata. The server independently verifies normalized PNG
signature/chunks/CRC/inflated scanlines, RGB/RGBA8 noninterlaced, ≤2 MiB binary,
≤2048 per side and ≤4 megapixels. The JSON body limit is 4 MiB for base64/settings.
Invalid image/settings reject the entire mutation.

`GET /api/state` adds metadata-only `photo` availability/hash/dimensions/update
time. Image bytes are served only for the current hash through the local image
endpoint and are absent from settings, exports and diagnostics. Polls and the other
routes read a metadata-only view of the store and never copy the photo bytes; the image
endpoint decodes the current photo once and serves that buffer until the photo changes
(#353). Imports leave the existing local photo unchanged. The private atomic store contains selected
photo bytes; its previous-state recovery backup may retain an older photo after
Replace/Clear. This is not secure deletion. Desktop snapshots remain separate,
RAM-only and never become a photo or part of that backup.

## Weather semantics

### Device and manual location

Settings add `locationSource: device | manual | fallback`. New installs use
`fallback`, with the existing Toronto city coordinates/timezone from shared
defaults. Old version-one state or exports without the field parse as `manual`
and keep their city. Explicit location edits through PATCH without a source are
also treated as manual for existing API callers. No storage directory changes.

`POST /api/location` accepts either `{source:"device", latitude, longitude,
automatic}` or `{source:"fallback", automatic}`. It returns saved Settings.
The existing Host/Origin, JSON/size and coordinate validation apply. Device points
are rounded to 0.1 degrees on both client and server; stored name/timezone are
`Device area`/`auto`. No position accuracy, raw fix, altitude or timestamp is
accepted or logged. Fallback always uses shared Toronto defaults. A serialized
write checks the current source: automatic results and failed-look-up fallbacks
cannot overwrite a manual city, including a city saved while a lookup was pending.
An explicit successful device action can replace a manual selection.

The editor performs only one automatic lookup per open, only for nonmanual
settings and already-granted permission. Otherwise the user must press the device
button. No permission/position request occurs in `/display` or on Home: every response
carries `Permissions-Policy: geolocation=()` except those for `/editor` paths, which permit
only self (#438).
There is no background watch or IP geolocation service.
Device/fallback results remain local drafts until Save. Cancel invalidates pending
callbacks; choosing a city invalidates earlier device work. The request-only
automatic guard protects a manual city saved by another editor while a draft is
pending. Neither path submits a raw browser position.

For device points, Open-Meteo receives only the rounded coordinates and
`timezone=auto`. The returned timezone must be a valid IANA identifier and is
used in WeatherState, so forecast dates/times never use the browser's potentially
different zone. A missing/invalid resolved timezone makes that forecast
unavailable. Settings retain `auto` to resolve again for a changed area.

### Adaptive Weather outlook

The Weather widget (#74) classifies the saved hourly intervals in the browser with
`rainOutlook` in [`weather-outlook.ts`](../src/client/weather-outlook.ts); the API
and persisted data are unchanged. The window is the 12 hours after now (intervals
overlapping it; expired intervals are ignored, so a retained stale forecast is still
classified from what remains). A **spell** is contiguous hours whose `rainAmount`
(rain plus showers) is at least 0.1 mm (0.004 in); a dry or unknown hour or a
coverage gap ends it. In precedence order:

| Kind | When | Weather mode | Example |
| --- | --- | --- | --- |
| `unknown` | No future intervals | hint | “Rain outlook unavailable” |
| `now` | A spell includes now | elevated | “Rain likely until 6 PM”; open end “Rain likely beyond 1 AM”; later spells too “on and off until 4 PM” (small: “Rain likely now” for an open end or later spells; “Rain possible now, likely later” when only a later spell is likely) |
| `soon` | A spell starts within 6 hours (inclusive) | elevated | “Rain likely 3–6 PM”; open end or several spells “from 3 PM” (medium/large: “on and off from 3 PM”; small: “Rain possible from 3 PM, likely later” when only a later spell is likely) |
| `later` | A spell starts in 6–12 hours | hint | “Rain likely from 9 PM” (medium/large add the day when it differs: “from Tomorrow 7 AM”); “Rain possible from 9 PM, likely later” when only a later spell is likely |
| `unknown` | No spell, but some rain amounts are missing | hint | “Rain timing unavailable” |
| `possible` | Some hour has at least 30% chance, or precipitation without rain (for example snow) | hint | “Precipitation possible · 40%” |
| `unknown` | Partial, gapped or null coverage | hint | “Rain outlook partial” |
| `calm` | Otherwise: the 12-hour forecast is complete and dry | calm | nothing about rain |

The detail's peak and the amount cover every spell in the window (#167), and so does
the qualifier of a headline that covers them all: “Likely” means the highest known peak
hourly chance of those spells is at least 60%; otherwise, or when no chance is known,
“possible”. So a 40% spell followed by an 80% one reads “Rain likely on and off from
10 AM” beside “Peak 80%”. A headline that names only the first spell (small's “now” and
“from 10 AM”, and every `later` headline) takes that spell's own qualifier instead, and
adds “, likely later” when a later spell is likely and the first is not: “Rain possible
now, likely later” (#319). So “likely” never describes a spell that peaks below 60%.
A headline names an end only when no spell follows it (“until 11 AM”);
with later spells it reads “on and off until 2 PM” (medium/large) or names no end
(small). Probability covers all precipitation, so the wording never says it is or
will be raining. The elevated detail reads “Peak 60% · 4 mm rain” (imperial “0.16 in
rain”), “Known rain 4 mm” when some rain amounts are missing, and “Chance unavailable”
without a chance. The confidence label is “Forecast estimate”, “Partial forecast”
(coverage under 12 hours) or “Partial data” (missing values), plus “ · coverage
gaps”. Times use the weather city's timezone and the 12/24-hour setting; compact
12-hour times drop “:00” and share AM/PM (“3–6 PM”, “11 AM–2 PM”, “15:00–18:00”),
keeping non-zero minutes in half-hour zones. A no-break space joins each time to its
AM/PM and a word joiner follows the range dash, so a line never starts with AM/PM
or the second end of a range; “Precipitation possible · 40%” keeps “· 40%” with its
words (#197). Hours are real instants, so a DST change shows wall-clock times.
The large family's hourly chance bars are one image whose accessible name summarises
them: “Hourly precipitation chance, 9 AM to 9 PM: peak 60% at 10 AM, 1 hour unknown”
(#166). There is a bar for each interval overlapping the window: 12 on the hour, 13 when
the window starts mid-hour. Its axis reads “Now” under the bar covering now and the
window's end at the right edge, in compact hours (“9 PM”, “21:00”); Air quality's chart
shares the same `chartAxisLabels` helper (#261). The window and thresholds are defined
once, in `weather-outlook.ts` (#147).

### Forecast normalization and caching

The server requests Open-Meteo epoch timestamps and the configured timezone.
It normalizes seven daily forecasts and the hourly intervals from the current hour,
the earlier of the provider's current time and this computer's, through 24 hours past
this computer's clock. A fast clock at arrival therefore never discards hours that are
actually upcoming, and a slow one never shortens the window (#244); the browser ignores
expired intervals again when it renders. Hourly
precipitation amount and probability apply to the **preceding hour**; each result
therefore includes both `intervalStart` and `intervalEnd`. Probability covers all
precipitation, including snow. `rainAmount` separately sums rain and showers;
do not label an all-precipitation probability as rain-specific certainty.

Values are already in the requested metric/imperial units; use the returned unit
labels without converting twice. Daily date labels follow the provider's fixed
offset boundaries; hourly epoch instants retain unambiguous timing across DST.
[Open-Meteo parameter definitions](https://open-meteo.com/en/docs).

`GET /api/state` normally refreshes the forecast only while an effective manual/scheduled widget needs it
(#352): Weather, Forecast or Dynamic (#437), or Sun & moon or Air quality while the saved
location's timezone is still `auto`, which only the forecast resolves. Otherwise it returns the
cached forecast for the saved location and units, or the empty `unavailable` state with
no error, and contacts no provider. `GET /api/weather` refreshes it whenever it is due; the
Settings requests it while open, and the editor requests it for an unsaved visual widget
that needs it before Save. Edit display adds the read-only header `X-LRD-View: editor`
to state requests: these include canonical manual Weather/Air/Alerts demand as well as
the effective scheduled board, because its canvas previews the manual layout. Other
header values are ignored. The hint does not change settings, schedule, same-origin
or loopback checks; ordinary Home/display/native requests remain effective-only.

A request waits for a due refresh at most about one second (#351). After that it answers
with the cached state, while the refresh carries on and a later request sees its result.
While a refresh is in flight the state carries the API-only `refreshing: true`, which is
never stored or exported; during the first fetch for a location there is no data and no
error text yet, rather than a failure. The browser asks again 2 seconds later while
anything is refreshing, at most five times in a row, then keeps its 30-second poll.

Successful forecasts are cached for 15 minutes in memory. Failed refreshes retain
the last successful timestamp/data and mark them stale; without prior data the
state is unavailable. Failed requests retry no more often than once per minute.
These intervals count by whichever of the monotonic and wall clocks says more time
has passed (#244): a clock set back (for example a fast hardware clock corrected
after boot) neither stalls a retry nor keeps old data fresh, and a sleep still ages
it. A saved `updatedAt` more than 2 minutes in the future is refreshed at once, and
the display calls such a time “Update time unknown” rather than “just now”. The
retained data has no age limit; the display drops past days and qualifies an
hours-old reading ([widget contract](widgets.md#data-and-image-boundaries)).
Switching location/units never reuses a mismatched forecast. City search uses the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with an
hour-long in-memory query cache. Each result is checked on its own (#246): one
without a valid IANA timezone (the same check as saved settings), with out-of-range
coordinates or without a name is left out rather than failing the search, and names
are trimmed to the 100-character settings limit, so every offered city can be saved.
No IP/address auto-location is used.

## Air quality

`AppState.airQuality` (`AirQualityState` in `src/shared/contracts.ts`) comes from
the keyless [Open-Meteo air-quality API](https://open-meteo.com/en/docs/air-quality-api),
which serves the Copernicus Atmosphere Monitoring Service (CAMS) model. The server
requests it only while a saved widget shows it (`GET /api/state`, in parallel with the
forecast): the Air quality widget, or Dynamic with its Air & UV source (#437,
`needsAirQuality` in `src/shared/widgets.ts`); or while the editor previews an unsaved
change that shows it, or a scale change (`GET /api/air-quality`). Otherwise the state is `off` and no request
is made. The browser never contacts the provider (`connect-src 'self'`).

The request uses the saved weather location's `latitude`, `longitude` and
`timezone` (or `auto`, whose resolved zone is kept), `timeformat=unixtime`,
`forecast_hours=24`, `current=<scale>_aqi`, its sub-indices (`_pm2_5`, `_pm10`,
`_ozone`, `_nitrogen_dioxide`, `_sulphur_dioxide`, plus `_carbon_monoxide` for US),
`pm2_5`, `pm10`, `uv_index`, and `hourly=<scale>_aqi,uv_index`. No key, an 8-second
timeout and `redirect: 'error'`.

Normalization keeps the current AQI, the dominant pollutant (the highest known
sub-index, or null), PM2.5/PM10 in µg/m³ and the UV index. Hourly values are
instantaneous readings stored as instants (`time`): from the current hour (the earlier of
the provider's and this computer's, as for the forecast) through 23 hours past this
computer's current hour.
A missing, non-numeric or misaligned value stays `null` or makes the reading
`unavailable`; nothing is filled in. The widget applies the same
current-hour rule again at render time (instants after now − 1 hour, recomputed each
minute), because a cached or `stale` reading keeps the series it was fetched with.

Readings are cached in memory for 30 minutes, keyed by location and scale (at most
8 entries). A failed refresh keeps the last good reading as `stale`; without one the
state is `unavailable`. Failures retry no more often than every 2 minutes. Both
intervals use the forecast's monotonic-and-wall timing, and a future `updatedAt` is
refreshed at once (#244). Both routes wait for a due refresh at most about one second
and say `refreshing` meanwhile, as the forecast does (#351).

The widget labels every value as a model estimate with its age, and credits
"CAMS · Open-Meteo" (the inspector hint names Copernicus CAMS in full). It is not a
local sensor reading or an official index such as Canada's AQHI. Saved current values
stand for 3 hours after `updatedAt` (#188, the same rule as Weather's temperature in
#243); older ones are replaced by the saved hourly estimate for the current hour
("Saved estimate"), or the AQI is qualified "Last known · <hour>" with UV hidden. The
server keeps serving a `stale` reading's series unchanged: the widget already drops
past hours at render time each minute, which a display that has lost the computer
needs anyway, so trimming on the server would add nothing. Official alerts come only
through Dynamic ([official weather alerts](#official-weather-alerts), #437).
Open-Meteo's free API is for non-commercial use; see
[architecture](architecture.md#current-decisions).

## Official weather alerts

`AppState.alerts` (`AlertsState` in `src/shared/contracts.ts`, `src/server/alerts.ts`) lists
the official alerts in effect for the saved weather location (#437, adopting #106 for
Canada and the US). It is requested only while Dynamic and its alerts source are saved on
(`needsAlerts`); otherwise it is `off` and no request is made. It is API-only: never
written to `state.json`, its backup or an export, and never logged. There is no separate
endpoint: an unsaved change is checked after Save (an editor preview is #455).

**Providers.** Canada: Environment and Climate Change Canada through MSC GeoMet
(`api.weather.gc.ca`, "Data Source: Environment and Climate Change Canada"; the licence
forbids altering content or intent, so names keep their wording and only their first
letter is capitalised). The United States: the National Weather Service
(`api.weather.gov`, US government data). Both are keyless; the NWS may require a key one
day (#457). Europe (MeteoAlarm) is #451.

**Location and privacy.** The key is the saved location rounded to 0.01°, the only
precision that leaves this computer, and only to the provider whose box contains it. The
browser contacts no provider (`connect-src 'self'` is unchanged). At most 8 places are
kept in memory.

**Coverage** (cached 24 hours per place; a failed lookup is retried after 5 minutes):

1. Inside the Canada box (latitude 41.6–83.2, longitude −141.1 to −52.5):
   `GET https://api.weather.gc.ca/collections/public-standard-forecast-zones/items?f=json&skipGeometry=true&limit=10&bbox=<point ± 0.005°>`.
   One or more zones make ECCC the provider; the area is the first zone's `NAME` and the
   zone set their `FEATURE_ID`s.
2. Otherwise, inside the US box (latitude 17.5–71.6, longitude −180 to −64.5): the NWS.
   Its first answer confirms it: 200 is covered, 400 "out of bounds" is `unsupported` for
   24 hours, any other failure is a failure.
3. Anywhere else: `unsupported`, with no request. The display then says nothing about
   alerts (never "no alerts"); the editor explains the coverage.

**ECCC alerts:** `GET https://api.weather.gc.ca/collections/weather-alerts/items?f=json&lang=en&skipGeometry=true&limit=100&bbox=<same>`.
Only features whose `feature_id` is in the zone set count, so a neighbouring zone's
alert that the small box also touches is left out. `status_en` matching ended or
cancelled, and anything whose expiration or event end has passed, is dropped; one alert
covering several of the place's zones (`<alert id>_<zone id>`) counts once. `level` is
`alert_type`, `name` is `alert_name_en` (only its first letter capitalised), `area` is
`feature_name_en`, `issuedAt` is `publication_datetime`, `startsAt` is
`validity_datetime` (when the alert's weather is expected to begin; publication without
it), `endsAt` is `event_end_datetime` and `expiresAt` is `expiration_datetime`.
`risk_colour_en` is ignored: no colour coding.

**NWS alerts:** `GET https://api.weather.gov/alerts/active?point=LAT,LON&status=actual&message_type=alert,update`
with `Accept: application/geo+json`. Status other than Actual, the event "Test Message",
urgency Past, messageType Cancel and expired alerts are dropped. The level comes from the
event's last word (Warning, Watch or Advisory; anything else is a statement), `name` is
`event` verbatim, `area` is the first segment of `areaDesc`, `startsAt` is
`onset ?? effective` and `endsAt` is `ends ?? expires`.

**Requests** send `User-Agent: LivingRoomDisplay/<version> (local ambient display)`, use an
8-second timeout and `redirect: 'error'`, enforce a 1 MiB body limit and send no no-cache
header. The same limit applies to HTTP 400 error text before checking for "out of bounds";
oversized errors fail the check rather than establishing unsupported coverage. Other
error bodies are released unread. Retry-After on 429 or 503 pauses that provider (up to an
hour), and each provider gets at most 12 requests an hour whatever the number of places. Each feature is checked on
its own (#246): a malformed one is skipped, not the list. At most 10 alerts are kept,
warnings first.

**Cadence and states.** A success is repeated after 5 minutes and a failure retried after
2, by the forecast's monotonic-and-wall timing (#244); a request waits for a due check at
most about one second and says `refreshing` meanwhile (#351). `fresh` until the last
success is 15 minutes old, then `stale`: the retained alerts stay, each until its own end.
`unavailable` when there has never been a success, or none for 2 hours with nothing still
in effect. `unsupported` as above; `off` when not requested.

## Dynamic signals

Dynamic (#437) ranks what the display already knows; [`src/client/dynamic.ts`](../src/client/dynamic.ts)
is the single home of every constant below and is exported for Home (#438). The browser
computes it from `/api/state` once per minute and data change; nothing is stored. Every
threshold is a product default, not an official criterion, and no forecast, model or
personal card uses the words warning, alert, watch or advisory (a unit test checks).

| Threshold | Metric | Imperial |
| --- | --- | --- |
| Hot today (until 18:00 in the weather city) / tomorrow: daily high | 32 °C | 90 °F |
| Feels very cold now | −27 °C | −17 °F |
| Very cold tomorrow: daily low | −20 °C | −4 °F |
| Strong wind / windy now | 50 / 39 km/h | 31 / 24 mph |
| AQI focus / notable | US 151 / 101; European 81 / 61 | |
| UV among today's upcoming readings | 6 | |
| Reminder due soon / recently overdue | 60 / 120 min (at most 3 reminder cards) | |
| Sunrise or sunset soon / full moon "tonight" from | 60 min / 180 min before sunset | |

A rest of today is wet when a remaining hourly interval of the weather city's civil today
has a 30% chance or a measurable amount (0.1 mm or 0.004 in). Hazard families by WMO code:
hail 96/99, storm 95, freezing 56/57/66/67, heavy snow 75/86, heavy rain 65/82.

| Tier | Score: card |
| --- | --- |
| Alert | 1100: an official warning (several take turns, one per minute, "1 of 2") |
| Focus (the top one stays) | 1010 official watch; 1000 hail now; 990 thunderstorms now; 985 freezing rain or drizzle now; 980 heavy snow now; 970 / 960 / 955 / 950 hail, storms, freezing, heavy snow in today's forecast (wet rest of today, no "now" card of that family); 945 official advisory; 940 rain likely now; 930 rain likely within 6 hours; 925 heavy rain today (no rain now or soon card); 920 unhealthy air; 915 strong wind; 910 feels very cold; 905 hot today; 900 a reminder due within the hour or overdue by up to two |
| Notable (rotates first) | 885 official statement; 880 rain possible now or soon; 870 rain later (6–12 hours); 865 today's hazard without hourly timing ("Timing unavailable"); 860 severe weather tomorrow; 850 air unhealthy for sensitive groups; 840 high UV; 830 windy; 825 hot or very cold tomorrow; 820 / 815 a countdown today / tomorrow; 810 a reminder later today; 805 a reminder overdue by more than two hours; 800 sunrise or sunset within the hour; 790 full moon tonight; 780 precipitation possible |
| Calm (fixed order) | conditions; today's high and low; dry for 12 hours (fresh, connected and complete only); the next sunrise or sunset (or the polar day or night); the next full or new moon; the next countdown at least 2 days away; good or moderate air. Each is skipped while the widget that already shows it is on the board (Weather; Weather or Forecast; Weather; Sun & moon; Sun & moon; Countdown; Air quality), unless that would leave nothing |

Ties go to the earlier start, then the id. Card ids stay stable (`alert:<id>`,
`weather:hazard`, `weather:rain`, `reminder:<id>`, `countdown:<id>`, `sky:sun`, …), so a swap
follows the thing, not its wording.

**Selection** (`chooseDynamic`). Warnings first; otherwise the top focus card stays put with
"+N more" counting the other focus and notable cards; otherwise notable then calm cards
rotate on wall-clock slots of `DYNAMIC_ROTATE_MS` (60 s; a setting is #454): slot
`floor(now / 60 s)`, card `slot mod n`, and a card shown earlier in the same slot stays
(the latch), so data arriving mid-minute never jumps the rotation. A new warning or focus
card takes the lead at once. The editor canvas and picker samples hold slot 0. With no
card at all Dynamic is `unavailable` when a source is degraded (shown, saying which) and
`empty` otherwise (hidden on the display, a placeholder in the editor).

**Honest states.**

| Situation | What Dynamic shows |
| --- | --- |
| Forecast stale | Weather cards with "Saved forecast · Updated 2 hr ago" in the status tone; current-based cards only while the reading is up to 3 hours old (the shared last-known rule), with "As of 9 AM", never "Now"; no Dry card |
| Display offline | "Offline · …"; reminder and countdown cards say "Saved reminders · offline" (or "Saved dates"); alerts are kept until their own end; glyphs are still |
| Forecast unavailable | No weather cards; "Weather unavailable" in the status tone |
| Alerts off / unsupported | Nothing from alerts; never "no alerts" (the editor explains coverage) |
| Alerts fresh, none in effect | Small and medium say nothing; large: "No alerts · checked 9:41 PM" |
| Alerts stale | Retained alerts until their end, and "Saved alerts · checked 9:10 PM" in the status tone; no "No alerts" claim |
| Alerts unavailable | "Weather alerts unavailable" in the status tone |
| Air on, not loaded / unavailable / saved | No air cards and "Air quality not loaded yet" (medium and large) / "Air quality unavailable" / an air card aged "Saved reading · …", "Saved estimate" over 3 hours, or no air card and "Saved air reading" when only the last-known value is left |
| Reminders not readable | "Reminders unavailable" |
| Location timezone `auto` | This computer's zone, as Sun & moon |

When no usable card remains but a source has saved data that cannot be refreshed, Dynamic
stays visible with that saved-source status instead of hiding as empty (#511). This includes
an exhausted forecast, stale empty alerts and a last-known air reading. A successful empty
alert list may still hide, and usable cards from other sources continue to render.

Status phrases sit in the footer and leave out the lead card's own source; the small family
shows one, in this order: Offline, Weather alerts unavailable, Weather unavailable, Saved
forecast, Air quality unavailable, Reminders unavailable. Forecast cards say "Forecast
estimate" (rain cards their confidence) with the forecast's age; air cards their age and
"CAMS · Open-Meteo"; sun and moon cards the place; official cards the provider's name in
full (the small family may say "Environment Canada") and when they were checked. Dynamic
carries the "Forecast by Open-Meteo" credit only while Forecast and Weather are both off.

## Home (#438)

These endpoints keep the Host/Origin and Fetch Metadata checks, the JSON content type (415),
the 4 MiB body limit (413) and the `{ "error": "message" }` shape; unknown fields return 400.

### Timers

Silent timers live in their own sidecar, `timers.json` in the data folder:
`{ "version": 1, "timers": Timer[] }`, validated strictly (at most 6, unique ids). A `Timer`
(`src/shared/contracts.ts`) is `{ id, label, durationMs, endsAt, remainingMs, createdAt,
updatedAt }`: `label` is 0–40 characters (empty shows "5 min timer"), `durationMs` the length
it was started with (whole milliseconds, 1 s to 24 h), and exactly one of `endsAt` (an ISO
UTC instant while running, and once it has passed, done) and `remainingMs` (paused). Done is
derived from `endsAt` and never written. `src/shared/timers.ts` holds the phases, the order
and the windows: the display shows a finished timer for 10 minutes and Home lists it for 60.

- `POST /api/timers` `{ label?, durationMs }` returns 201 with the timer, 409 "Up to 6 timers at
  once. Dismiss or cancel one first." or 400 "Choose a time between 1 second and 24 hours.".
  Undo re-creates a cancelled timer with its `endsAt` (from an hour ago up to 24 hours ahead) or
  its `remainingMs` (1 ms to 24 hours), never both. Added time can take a paused remainder
  beyond its original `durationMs`; Undo keeps both that remainder and the starting length
  used by Restart (#487).
- `PATCH /api/timers/:id` takes exactly one of `paused` (true keeps what is left; false resumes
  with `endsAt = now + remaining`), `addMs` (1 s to 1 hour; on a finished timer it runs again
  for that long) or `restart: true` (`endsAt = now + durationMs`). A request that changes
  nothing returns 200 and writes nothing. Pausing or resuming a finished timer returns 409 "This
  timer has finished. Restart it instead."; a total over 24 hours returns 400; an unknown id 404
  "Timer not found".
- `DELETE /api/timers/:id` returns 204 or 404; `DELETE /api/timers/finished` dismisses every
  finished timer and returns `{ deleted }`.
- `GET /api/timers` and `GET /api/state` (`timers`, `timersWarning`) list the timers Home
  shows, pruned in memory: a read never writes.

`TimerStore` (`src/server/timers.ts`) serializes its writes on its own queue, so a slow
settings save never delays a timer tap, and writes through the store's `atomicWrite` (mode
0600) with no backup copy: timer churn never rotates `state.backup.json`. Startup removes stale
`timers.json.<uuid>.tmp` files with the state's, prunes finished timers older than an hour
(writing only when that removed something) and, if the file cannot be read, moves it to
`timers.corrupt.json`, starts empty and reports `timersWarning` "Timers couldn't be read after
the app restarted, so they were cleared." until the next timer write. `state.json` is never
touched. Labels are private user content: never logged or put in diagnostics.

Timers are never in `state.json`, `state.backup.json` or exports, and an import leaves them
alone. The frozen previous-release reader (`d66832b`) never opens `timers.json`, so timers need no
rollback exception; its reader rejects every in-file shape (a top-level `timers` key,
`widgetData.timers`, a `timer` widget id), which `src/server/rollback.test.ts` proves along with
a "Home day-to-day use" scenario whose state files and export it accepts. Setup's copy of the
data folder may include `timers.json`; that release ignores it.

### Home item endpoints

Countdowns and world clocks change one item at a time inside the serialized store write, so two
pages never drop each other's items (#287). `POST /api/countdowns` takes the countdown fields
(`title` 1–60, a civil `date` in 1900–2200, `repeatsYearly` default false) and appends one with a
server uuid: 201 with the saved settings, or 409 "Up to 12 countdowns. Remove one to add
another.". `POST /api/world-clocks` takes `label` (1–40), an IANA `timezone` (not `auto`),
`latitude` and `longitude`: 201, or 409 "Up to 4 cities. Remove one to add another.". Undo after
a removal sends the removed `id` and its `index`, which put the item back in its place; a
repeated Undo of an id that is already there returns 200 and writes nothing. `DELETE
/api/countdowns/:id` and `DELETE /api/world-clocks/:id` return the saved settings, or 404. The
note keeps using `PATCH /api/settings` with `{ "widgetData": { "note": { "text": … } } }`. Item and show
writes, like any settings write, move the [settings revision](#settings-revision): an Edit display
draft computed from earlier settings gets 409 with the current ones and rebases, so nothing Home
added is lost. Timer writes change no settings and leave the revision alone.

### Show on my display

`POST /api/widgets/:id/show` turns on Clock, World clocks, Calendar, Reminders, Countdown or Note
(other, planned, retired and unknown ids return 400). Home never rearranges the board: inside the
serialized write the widget keeps its saved placement (with a free-size custom size) when those
cells are free, else takes the first free cells for its default family, then for each smaller
family, with no custom size; no other widget moves. With no room it returns 409 "No room for
{Name} on your display." and writes nothing; an enabled widget returns 200 and writes nothing.
There is no hide endpoint, and Home has no control that turns a widget off. Edit display does that:
its save is a `PATCH /api/settings` whose `widgets` map has `"<id>": false`, which keeps the
widget's placement. `showPlacement` in `src/shared/show.ts` is the rule both sides use.

### Change marker

`GET /api/changes` returns `{ "change": "<boot>.<store>.<timers>.<preview>" }` with
`Cache-Control: no-store`: a random id for this server process, then counts of successful
settings/reminder writes, timer writes, and snapshot uploads or clears. It moves after every
saved change (and on a restart) and never on a read, so Home and the display ask for it every
5 s while visible and reload `/api/state` only when it moved. Nothing about it is persisted.

## Native snapshot handoff

The Windows host calls `GET /api/host/session` with `X-LRD-Native: 1`, no `Origin`,
and no browser Fetch Metadata headers. The response contains a random native-session
token, current settings, display URL, and an optional scalar preparation-pipe
name. The pipe name is not its child capability. Host/Origin checks and no CORS access
prevent a website from obtaining this handshake. It is not an account system;
other processes running as the local user remain trusted.

Each authorized handshake replaces the native-preview token and clears the earlier
active image (#532). A previous helper's delayed DELETE is refused with 403 rather
than erasing a replacement frame. POST rechecks that session at body completion,
so an older in-flight upload cannot publish either. Refused browser/untrusted
handshakes do not replace the current session. This does not rotate the preparer's
independent capability or invalidate its private pending frame; an automatic `/s`
can still claim the frame prepared before its own handshake.

The native host makes one serialized handshake and enables its forced-exit
deadline only after that call returns. Token rotation rejects stale mutations;
it does not identify process-start order or order an older aborted GET that
arrives late. That separate handshake-availability limit remains tracked in #534.

Manual `--display`/`--test-display` captures before its own overlay and posts PNG bytes to
`POST /api/preview` with `X-LRD-Token`, `X-Captured-At` (recent ISO timestamp),
and `Content-Type: image/png`. Maximum: 4 MiB, 4096 pixels per side, 4 megapixels.
The host clears it with `DELETE /api/preview` and the same token on exit.
Disabling the preview, importing data, server shutdown, or a 12-hour expiry also
removes availability. `HEAD /api/preview/image` answers with the same status and headers
as `GET` and no body (#124); `GET /api/preview` (`available`) is the simpler clearance
check. Every clear invalidates earlier unfinished uploads, which return 409 instead of
restoring pixels; re-enabling preview does not revive them.
No snapshot, token, capture log, or image cache is written
by the server. Actual Windows capture is owned and tested by the Windows host.

Automatic `/s` claims the producer's latest earlier successful frame (#538), never
a screenshot of its startup surface. The installed backend supervises a distinct
native producer with a child-only capability on redirected stdin. The
`/api/preview/preparation` GET/POST/DELETE and private claim POST require that
capability plus existing Host/Origin/Fetch Metadata restrictions. The ordinary
UI, state/export/image endpoints and polls never receive pending pixels or the
producer capability. Source/test servers cannot start the producer.

The private GET supplies `captureIntervalMs:300000`, `observationLeaseMs:10000`,
`maxAgeMs:null`, configuration/generation and optional scalar `frame` metadata.
`X-Preparation-Safe:1` with the current `X-Session-Id` renews the producer's safe
observation lease; absent/unsafe context clears pixels. This lease is not image
age: healthy observations retain the last success across missed/failed refreshes.
Producer loss, unknown/locked/disconnected context or configuration/disable clears
it. Public reads cannot renew the lease. Uploads still have a separate ten-second
fresh-body bound and at most one 640 by 360 PNG/4 MiB RAM slot.

Before attesting an OS-pinned automatic client, the producer sends
`X-Preparation-Freeze:1` on private GET. Freeze atomically preserves the current
bytes and returns their authoritative metadata under a new fenced generation.
Older in-flight POST bodies return409; they cannot replace or erase this frame.
The exact `completedMonotonicMs` identity, frozen generation/configuration,
session and captured input tag accompany the attestation. Current input stability
is rechecked separately during the native claim. Normal input after an earlier
capture is allowed. UTC/monotonic consistency and completion before the actual
client process was created remain strict. A stale frame-ID/generation attestation
is refused without consuming a newer authoritative image.

A committed POST with a lost acknowledgement cannot strand a native metadata
copy: the backend is the sole authority and claim fetches it again. An eligible
ordinary desktop heartbeat (`X-Preparation-Capture-Eligible:1`) resumes a previously
frozen cache under another fenced generation. Normal input uses the child-secret
DELETE `X-Invalidate-Active-Only:1` to clear visible active pixels without erasing
the pending latest-success cache; other DELETE keeps its full invalidation role.
All frame bytes are zeroed on replacement/clear. No pixel log, file or history is
created. Active-session pixels retain the separate existing twelve-hour limit.

Preparation uses effective scheduled visibility and a composite configuration;
intervening off intervals, schedule edits and unreconstructable clock changes
invalidate pending/in-flight images. A resident child survives scheduled off
intervals but remains capture-disabled; explicit idle disable stops it and revokes
its capability. `preview.enabled` and the preview widget are saved visual fields;
schedules do not change global idle enablement or Windows selection. See
[the native contract](windows.md#periodic-automatic-snapshot-538) and
[early sign-in setup](install.md#start-with-windows-and-the-snapshot-cache-540).

## Persistence and recovery

Snapshot presentation uses the grid family rather than legacy
`preview.widthPercent` (retained for compatible parsing/export). New settings use
`preview.opacity:0.24`; existing saved values/presets/imports are preserved, with
no automatic migration from 0.08. Browser-only midtone correction keeps black
pixels black and normalized white bounded before ordinary opacity/ambient
brightness. It never rewrites or persists the raw RAM snapshot bytes.

Windows data defaults to `%LOCALAPPDATA%\LivingRoomDisplay\data`; `LRD_DATA_DIR`
can select an isolated test location. Other systems use their per-user application
data folder. No creator path/account is required. Writes are serialized, validated,
flushed to a temporary file, and renamed into `state.json`. The previous valid
state is atomically retained as `state.backup.json`, written first. While another
process (a backup or scanning tool) holds a file, the rename is retried for about a
second on `EPERM`, `EACCES` or `EBUSY` before the request fails with 500 and nothing new
saved. A save that fails leaves `state.json` holding the last successful save, so nothing
that was saved is lost. The backup depends on which file was held (#325): when it was
`state.json`, the backup already holds that same save; when it was `state.backup.json`,
that write is the one that failed, `state.json` is not attempted and the backup keeps the
save before. A failed write deletes its temporary copy of the private state. Startup
removes `state.json.*.tmp` and `state.backup.json.*.tmp` left by an interrupted save once
their modification time is at least a minute from the current time (#247, #320); a newer
one may be a save in progress by another server on the same folder, and a later start
removes it. Two
servers on one data folder remain unsupported: each keeps its own copy in memory. The
selected photo is inspected when it changes (upload, startup and recovery); ordinary
saves keep the already checked photo and parse only its shape,
so a reminder save with a 2 MB photo costs about the time of writing both files
rather than a fresh inflate, CRC and hash of the image (#245).

An invalid/missing primary recovers a valid backup with a visible health/state
warning. An unreadable primary is preserved as `state.corrupt.json`. If neither
copy is valid, startup fails without resetting user data. Preserve the folder and
restore a known-good export. Export/import includes settings and reminders only;
weather, snapshot pixels, and native tokens are excluded. Store backups privately.

At rest, `state.json`, `state.backup.json` and exports omit additive values while
they equal the current read default: `appearance.accentMode` `color`,
`appearance.animation` `subtle`, `appearance.daylightBrightness` `null` (Fixed,
#439), default `widgetData` sections, and disabled widget ids the previous installed
release does not know. The previous release (`d66832b`) reads `accentMode`, `animation`
and pre-Dynamic `widgetData`, so omitting those values is optional (#272). It does
not know `daylightBrightness`: omitting `null` keeps Fixed brightness readable, while
a saved range is a rollback exception. It also lacks Dynamic (#437): while off, its
visibility and hidden placement are omitted, as are its default sources (all on).
Under the #135 rule no transform is ever written for an unknown id, whatever its
value; transforms no longer render, so dropping one loses nothing. An enabled
Dynamic, sources other than all on, or a saved style made while it was on are a
[rollback exception](install.md#additive-data-and-rollback-compatibility-84) until
the next reader bump (#130). API
responses (`/api/state`, the `PATCH /api/settings` response and the native session)
always include every key. See [rollback compatibility](install.md#additive-data-and-rollback-compatibility-84).
