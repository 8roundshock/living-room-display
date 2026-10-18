# Project status

Reviewed: 2026-10-18. Implementation choices were made by the coordinator under
the owner's explicit authority to choose practical defaults and build the app.

## Implemented in this backend milestone

- Node 24 LTS/TypeScript local API and shared React/Vite contracts.
- Validated settings, visual presets, reminder CRUD, atomic local JSON saves,
  previous-state backup/recovery, and export/import.
- Open-Meteo current weather, seven-day forecast, 24 hourly precipitation/rain
  intervals, city search, and honest stale/unavailable handling.
- Loopback Host/Origin protections, native-token RAM-only snapshot handoff, and
  read-only Windows screensaver status.
- Backend fixture/API/persistence tests and Windows/Linux CI; full frontend build
  becomes a CI requirement once the frontend entry point is present.

Local verification: sixteen backend checks (including five delayed-upload clear
regressions), server compile, shared/client typecheck,
and real Toronto weather/city-search requests passed. A temporary development API
was used for integration; this does not establish installed Windows idle behavior.

## In progress / not yet verified

The React ambient display/editor and Windows capture/screensaver/installer are
separate workstreams. Their integration, actual TV readability/brightness,
RAM-only Windows capture, idle dismissal/lock behavior, and clean-machine
installation require their own verification. There is no complete usable release
yet. TV control and live application preview remain future work.

## Decisions and boundaries

Selected: local web dashboard plus Windows helper; one-time/undated reminders;
last-desktop snapshot before activation; Open-Meteo; editable Toronto city default,
metric units and 12-hour time. Windows idle activation stays disabled until tested
and explicitly enabled. See [architecture](docs/architecture.md) and [API](docs/api.md).

Keep the repository private until a usable release and a reviewed publication
step. Each PR requires a separate independent reviewer and final reviewed SHA;
no external review integration is required. See the
[backlog](https://github.com/8roundshock/living-room-display/issues) and
[installation readiness](docs/install.md) for remaining acceptance work.
