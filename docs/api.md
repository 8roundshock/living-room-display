# Local API and data contracts

Source of truth: [shared types](../src/shared/contracts.ts) and
[validation](../src/server/validation.ts). The server binds only to `127.0.0.1`,
port 4318 by default (`LRD_PORT` may select another unprivileged port).

## Browser API

| Method/path                    | Request                                                                | Response                                                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/health`              | None                                                                   | Status, version (read once at startup from the shipped `package.json`), storage recovery warning. |
| `GET /api/state`               | None                                                                   | Settings, reminders, weather, air quality (`off` unless enabled), preview metadata, storage warning. |
| `PATCH /api/settings`          | Validated nested partial settings                                      | Full saved settings.                                                         |
| `POST /api/location`           | Device/fallback source, rounded coordinates for device, automatic flag | Saved settings; preserves manual overrides against automatic/failed results. |
| `GET /api/reminders`           | None                                                                   | Reminder array.                                                              |
| `POST /api/reminders`          | `text`, optional ISO `dueAt` or null, optional past `createdAt`        | Created reminder (201).                                                      |
| `PATCH /api/reminders/:id`     | Partial `text`, `completed`, `dueAt`                                   | Updated reminder.                                                            |
| `DELETE /api/reminders/:id`    | None                                                                   | Empty 204.                                                                   |
| `DELETE /api/reminders/completed` | None                                                                | `{ "deleted": n }`; removes only completed reminders, atomically.            |
| `GET /api/weather`             | None                                                                   | Cached normalized forecast.                                                  |
| `GET /api/air-quality`         | Optional `scale=us\|european` (defaults to the saved scale)            | Editor preview of [air quality](#air-quality) for the saved location, `no-store`. |
| `GET /api/locations?q=Toronto` | City query, 2–100 characters                                           | Up to eight city results with coordinates/timezone.                          |
| `GET /api/export`              | None                                                                   | Downloadable settings/reminders JSON backup.                                 |
| `POST /api/import`             | A validated export                                                     | Atomic replacement of settings/reminders.                                    |
| `GET /api/preview`             | None                                                                   | Availability, capture timestamp, dimensions.                                 |
| `GET /api/preview/image`       | None                                                                   | RAM-only PNG, `no-store`, or 404.                                            |
| `GET /api/photo/image?id=hash` | Current photo hash                                                     | Selected local PNG, `no-store`, or 404.                                      |
| `GET /api/windows/status`      | None                                                                   | Actual screensaver registry state; unavailable on other systems.             |

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
configuration. `/api/windows/status` reads existing settings without changing them.

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
it has none. The previous installed release (`3fee844`) reads a saved span; the older
`bedca44` does not, so a downgrade that far needs the
[strip procedure](install.md#removing-custom-reminders-sizes-before-a-downgrade).
Legacy version-one settings acquire the safe default grid while preserving old
widget visibility and manual location. Legacy `widgetOverrides` offsets/scale
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
At rest `color` is omitted; `native` is written and is a
[rollback exception](install.md#additive-data-and-rollback-compatibility-84).

`appearance.animation` is `off`, `subtle` or `lively`; data without it reads as
`subtle`, and `subtle` is omitted at rest. It governs motion inside widgets and the
editor (#76): Off keeps widgets still, Subtle animates changes and the reveal after
a black rest, and Lively adds reveal choreography and the current-weather glyph's
slow loops. Each screen shows Off while it prefers reduced motion, whatever is
saved. Relocation through black is unaffected, and Drift and fade between moves
(`motionEnabled`) stays separate. The Style tab's Motion → Animation control edits
it as an ordinary draft field; built-in styles keep it and saved styles store it.
Built-in styles are looks (#153, #110, #226): they write only `brightness`,
`accentMode`, `accentColor`, `textColor`, `fontFamily`, `layout` and `preset`.

Appearance PATCHes contain exactly the supplied keys: an omitted `clockStyle`,
`accentMode` or `animation` keeps its saved value (#83). Only the persisted reader
fills defaults.

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
CRLF stored as LF) and `airQuality.scale` (`us` default or `european`). IDs within a
list are unique and unknown keys are rejected. Missing sections read as defaults.
PATCH merges `calendar`, `note` and `airQuality` and replaces either list whole.
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
endpoint and are absent from settings, exports and diagnostics. Imports leave
the existing local photo unchanged. The private atomic store contains selected
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
button. No permission/position request occurs in `/display`; its response carries
`Permissions-Policy: geolocation=()`, while editor responses permit only self.
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
| `now` | A spell includes now | elevated | “Rain likely until 6 PM”; open end “Rain likely beyond 1 AM”; later spells too “on and off until 4 PM” (small: “Rain likely now” for an open end or later spells) |
| `soon` | A spell starts within 6 hours (inclusive) | elevated | “Rain likely 3–6 PM”; open end or several spells “from 3 PM” (medium/large: “on and off from 3 PM”) |
| `later` | A spell starts in 6–12 hours | hint | “Rain likely from 9 PM” (medium/large add the day when it differs: “from Tomorrow 7 AM”) |
| `unknown` | No spell, but some rain amounts are missing | hint | “Rain timing unavailable” |
| `possible` | Some hour has at least 30% chance, or precipitation without rain (for example snow) | hint | “Precipitation possible · 40%” |
| `unknown` | Partial, gapped or null coverage | hint | “Rain outlook partial” |
| `calm` | Otherwise: the 12-hour forecast is complete and dry | calm | nothing about rain |

The headline, its qualifier, the detail's peak and the amount all cover the same spells:
every spell in the window (#167). “Likely” means the highest known peak hourly chance
of those spells is at least 60%; otherwise, or when no chance is known, “possible”. So
a 40% spell followed by an 80% one reads “Rain likely on and off from 10 AM” beside
“Peak 80%”. A headline names an end only when no spell follows it (“until 11 AM”);
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
(#166). The window and thresholds are defined once, in `weather-outlook.ts` (#147).

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
requests it only while the Air quality widget is saved enabled (`GET /api/state`,
in parallel with the forecast) or while the editor previews an unsaved enable or
scale change (`GET /api/air-quality`). Otherwise the state is `off` and no request
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
refreshed at once (#244).

The widget labels every value as a model estimate with its age, and credits
"Air quality: CAMS via Open-Meteo". It is not a local sensor reading or an official
index such as Canada's AQHI. Official alerts are a separate decision (#106).
Open-Meteo's free API is for non-commercial use; see
[architecture](architecture.md#current-decisions).

## Native snapshot handoff

The Windows host calls `GET /api/host/session` with `X-LRD-Native: 1`, no `Origin`,
and no browser Fetch Metadata headers. The response contains a random process-only
token, current settings, and display URL. Host/Origin checks and no CORS access
prevent a website from obtaining this handshake. It is not an account system;
other processes running as the local user remain trusted.

The host captures before ambient activation and posts PNG bytes to
`POST /api/preview` with `X-LRD-Token`, `X-Captured-At` (recent ISO timestamp),
and `Content-Type: image/png`. Maximum: 4 MiB, 4096 pixels per side, 4 megapixels.
The host clears it with `DELETE /api/preview` and the same token on exit.
Disabling the preview, importing data, server shutdown, or a 12-hour expiry also
removes availability. Every clear invalidates earlier unfinished uploads, which
return 409 instead of restoring pixels; re-enabling preview does not revive them.
No snapshot, token, capture log, or image cache is written
by the server. Actual Windows capture is owned and tested by the Windows host.

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
state is atomically retained as `state.backup.json`, written first, so a save that
fails leaves both files holding the last successful save. While another process
(a backup or scanning tool) holds a file, the rename is retried for about a second
on `EPERM`, `EACCES` or `EBUSY` before the request fails with 500 and nothing new
saved. A failed write deletes its temporary copy of the private state, and startup
removes `state.json.*.tmp` and `state.backup.json.*.tmp` left by an interrupted
save (#247). The selected photo is inspected when it changes (upload, startup and
recovery); ordinary saves keep the already checked photo and parse only its shape,
so a reminder save with a 2 MB photo costs about the time of writing both files
rather than a fresh inflate, CRC and hash of the image (#245).

An invalid/missing primary recovers a valid backup with a visible health/state
warning. An unreadable primary is preserved as `state.corrupt.json`. If neither
copy is valid, startup fails without resetting user data. Preserve the folder and
restore a known-good export. Export/import includes settings and reminders only;
weather, snapshot pixels, and native tokens are excluded. Store backups privately.

At rest, `state.json`, `state.backup.json` and exports omit additive values while
they equal the current read default: `appearance.accentMode` `color`,
`appearance.animation` `subtle`, default `widgetData` sections, and disabled widget
ids the previous installed release does not know. The previous release (`3fee844`)
reads every one of these keys and knows every widget id, so all widget ids are
written. API responses
(`/api/state`, the `PATCH /api/settings` response and the native session) always
include every key. See [rollback compatibility](install.md#additive-data-and-rollback-compatibility-84).
