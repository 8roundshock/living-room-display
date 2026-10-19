# Local API and data contracts

Source of truth: [shared types](../src/shared/contracts.ts) and
[validation](../src/server/validation.ts). The server binds only to `127.0.0.1`,
port 4318 by default (`LRD_PORT` may select another unprivileged port).

## Browser API

| Method/path                    | Request                                                                | Response                                                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/health`              | None                                                                   | Status, version (read once at startup from the shipped `package.json`), storage recovery warning. |
| `GET /api/state`               | None                                                                   | Settings, reminders, weather, preview metadata, storage warning.             |
| `PATCH /api/settings`          | Validated nested partial settings                                      | Full saved settings.                                                         |
| `POST /api/location`           | Device/fallback source, rounded coordinates for device, automatic flag | Saved settings; preserves manual overrides against automatic/failed results. |
| `GET /api/reminders`           | None                                                                   | Reminder array.                                                              |
| `POST /api/reminders`          | `text`, optional ISO `dueAt` or null                                   | Created reminder (201).                                                      |
| `PATCH /api/reminders/:id`     | Partial `text`, `completed`, `dueAt`                                   | Updated reminder.                                                            |
| `DELETE /api/reminders/:id`    | None                                                                   | Empty 204.                                                                   |
| `DELETE /api/reminders/completed` | None                                                                | `{ "deleted": n }`; removes only completed reminders, atomically.            |
| `GET /api/weather`             | None                                                                   | Cached normalized forecast.                                                  |
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
Legacy version-one settings acquire the safe default grid while preserving old
widget visibility and manual location. Legacy `widgetOverrides` offsets/scale
and `appearance.layout` remain parseable data but no longer affect rendering;
old manual visual positions are not converted to cells. The same applies to
legacy presets/imports. `appearance.clockStyle` is `outline` (default), `digital` or `analog`.

`appearance.accentMode` is `color` or `native`; settings, saved styles and imports
without it read as `color`. `color` tints every widget's accent group with
`accentColor`; `native` will use each widget's palette tone. The editor has no
control yet and rendering arrives with #75.

`appearance.animation` is `off`, `subtle` or `lively`; data without it reads as
`subtle`. It will govern motion inside widgets and the editor (#76); relocation
through black is unaffected. The editor has no control yet.

Appearance PATCHes contain exactly the supplied keys: an omitted `clockStyle`,
`accentMode` or `animation` keeps its saved value (#83). Only the persisted reader
fills defaults.

Planned catalog ids (`worldClocks`, `calendar`, `countdown`, `note`, `airQuality`,
`sunMoon`) appear in `widgets`, `widgetOverrides` and `widgetGrid.placements` but
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

### Forecast normalization and caching

The server requests Open-Meteo epoch timestamps and the configured timezone.
It normalizes seven daily forecasts and 24 upcoming hourly intervals. Hourly
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
Switching location/units never reuses a mismatched forecast. City search uses the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with an
hour-long in-memory query cache. No IP/address auto-location is used.

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
state is atomically retained as `state.backup.json`.

An invalid/missing primary recovers a valid backup with a visible health/state
warning. An unreadable primary is preserved as `state.corrupt.json`. If neither
copy is valid, startup fails without resetting user data. Preserve the folder and
restore a known-good export. Export/import includes settings and reminders only;
weather, snapshot pixels, and native tokens are excluded. Store backups privately.

At rest, `state.json`, `state.backup.json` and exports omit additive values that
the previous installed release cannot parse while they equal the current read
default: `appearance.accentMode` `color`, `appearance.animation` `subtle`, disabled
planned or retired widget ids, and default `widgetData` sections. API responses
(`/api/state`, the `PATCH /api/settings` response and the native session) always
include every key. See [rollback compatibility](install.md#additive-data-and-rollback-compatibility-84).
