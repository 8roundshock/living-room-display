# Local API and data contracts

Source of truth: [shared types](../src/shared/contracts.ts) and
[validation](../src/server/validation.ts). The server binds only to `127.0.0.1`,
port 4318 by default (`LRD_PORT` may select another unprivileged port).

## Browser API

| Method/path                    | Request                                                                | Response                                                                     |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/health`              | None                                                                   | Status, version, storage recovery warning.                                   |
| `GET /api/state`               | None                                                                   | Settings, reminders, weather, preview metadata, storage warning.             |
| `PATCH /api/settings`          | Validated nested partial settings                                      | Full saved settings.                                                         |
| `POST /api/location`           | Device/fallback source, rounded coordinates for device, automatic flag | Saved settings; preserves manual overrides against automatic/failed results. |
| `GET /api/reminders`           | None                                                                   | Reminder array.                                                              |
| `POST /api/reminders`          | `text`, optional ISO `dueAt` or null                                   | Created reminder (201).                                                      |
| `PATCH /api/reminders/:id`     | Partial `text`, `completed`, `dueAt`                                   | Updated reminder.                                                            |
| `DELETE /api/reminders/:id`    | None                                                                   | Empty 204.                                                                   |
| `GET /api/weather`             | None                                                                   | Cached normalized forecast.                                                  |
| `GET /api/locations?q=Toronto` | City query, 2–100 characters                                           | Up to eight city results with coordinates/timezone.                          |
| `GET /api/export`              | None                                                                   | Downloadable settings/reminders JSON backup.                                 |
| `POST /api/import`             | A validated export                                                     | Atomic replacement of settings/reminders.                                    |
| `GET /api/preview`             | None                                                                   | Availability, capture timestamp, dimensions.                                 |
| `GET /api/preview/image`       | None                                                                   | RAM-only PNG, `no-store`, or 404.                                            |
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

Settings `idle.enabled` is a preference, not proof Windows idle activation is
installed. Only the Windows host's explicit activation command changes that
configuration. `/api/windows/status` reads existing settings without changing them.

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
