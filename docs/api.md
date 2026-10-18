# Local API and data contracts

Source of truth: [shared types](../src/shared/contracts.ts) and
[validation](../src/server/validation.ts). The server binds only to `127.0.0.1`,
port 4318 by default (`LRD_PORT` may select another unprivileged port).

## Browser API

| Method/path | Request | Response |
| --- | --- | --- |
| `GET /api/health` | None | Status, version, storage recovery warning. |
| `GET /api/state` | None | Settings, reminders, weather, preview metadata, storage warning. |
| `PATCH /api/settings` | Validated nested partial settings | Full saved settings. |
| `GET /api/reminders` | None | Reminder array. |
| `POST /api/reminders` | `text`, optional ISO `dueAt` or null | Created reminder (201). |
| `PATCH /api/reminders/:id` | Partial `text`, `completed`, `dueAt` | Updated reminder. |
| `DELETE /api/reminders/:id` | None | Empty 204. |
| `GET /api/weather` | None | Cached normalized forecast. |
| `GET /api/locations?q=Toronto` | City query, 2–100 characters | Up to eight city results with coordinates/timezone. |
| `GET /api/export` | None | Downloadable settings/reminders JSON backup. |
| `POST /api/import` | A validated export | Atomic replacement of settings/reminders. |
| `GET /api/preview` | None | Availability, capture timestamp, dimensions. |
| `GET /api/preview/image` | None | RAM-only PNG, `no-store`, or 404. |
| `GET /api/windows/status` | None | Actual screensaver registry state; unavailable on other systems. |

Mutating JSON requests require `Content-Type: application/json`. Errors use
`{ "error": "message" }` and appropriate 4xx/5xx codes. Unknown settings fields
are rejected. Text/reminder limits, visual ranges, and preset limits are validated
on the server. Saved presets contain only nonrecursive visual snapshots.

All dates representing instants are ISO timestamps with an offset or `Z`.
Reminder `dueAt` is one-time, nullable, and displayed in the editor's explicit
local time context. Recurrence is not implemented. Daily forecast dates are civil
`YYYY-MM-DD` labels; they are not instants to reinterpret in the server timezone.

Settings `idle.enabled` is a preference, not proof Windows idle activation is
installed. Only the Windows host's explicit activation command changes that
configuration. `/api/windows/status` reads existing settings without changing them.

## Weather semantics

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
