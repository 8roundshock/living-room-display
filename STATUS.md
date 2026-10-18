# Project status

Reviewed: 2026-10-18. Implementation choices were made by the coordinator under
the owner's explicit authority to choose practical defaults and build the app.

## Implemented

- Node 24 LTS/TypeScript local API and shared React/Vite contracts.
- Validated settings, visual presets, reminder CRUD, atomic local JSON saves,
  previous-state backup/recovery, and export/import.
- Open-Meteo current weather, seven-day forecast, 24 hourly precipitation/rain
  intervals, city search, and honest stale/unavailable handling.
- Loopback Host/Origin protections, native-token RAM-only snapshot handoff, and
  read-only Windows screensaver status.
- React display/editor with moving compositions, appearance/widget controls,
  reminders, forecasts and last-state preview presentation. Empty reminders hide
  by default with a saved override; typography, spacing and reduced motion follow
  the [design notes](docs/design.md). See [UI checks](docs/ui.md).
- Focused display-studio inspector, visual style miniatures, soft transitions,
  settings/location/style Save and Cancel, debounced keyboard city dropdown,
  concurrent-draft refresh and an atomic automatic-location guard.
- Standalone display cursor CSS covers loading/error pages and descendants;
  editor/embedded preview cursor behavior is preserved. The production Edge
  route regression passes; actual native cursor proof remains pending [#36](https://github.com/8roundshock/living-room-display/issues/36).
- Editor-only device location with permission-aware one-shot lookup, rounded
  coordinates, Toronto fallback and manual-city protection. Existing choices
  migrate as manual; no location prompt or lookup occurs in the screensaver.
- Framework Windows host and per-user installer/control sources, with screensaver
  backup/restore, isolated Edge job, cancellation and scoped process management.
- Full production build and 53 application tests. Windows/Linux CI runs the full
  application checks. Windows
  source regression checks cover startup cancellation, restore selection,
  owned-process recognition and filesystem transaction/cleanup behavior.

Local verification: full build and all 53 application tests pass using the
app-owned Node 24 runtime. Eleven Windows check groups pass on PowerShell 5.1
and 7 with the optional real child-process test (ten without). Provenance tests
cover clean/dirty Git, archives, enclosing repositories and composed sources;
successful install refreshes metadata while failed updates and uninstall retain it.
Synthetic
online export/import and validated offline recovery after both saved JSON files
were corrupted pass, retaining original corrupt evidence. Native static/unit
checks use fake transport/session/native boundaries and scoped filesystem fixtures;
they do not establish actual installed capture, kiosk, idle or lock behavior.
The isolated production Edge studio harness passes fourteen interaction/layout
groups, including async Save/Cancel/city/location races, reminder CRUD, all four
1080p/4K compositions, reduced motion, 390px/320px reflow and focused-field clearance
above the measured Save bar at full/compact heights. Source desktop/mobile
visuals are inspected in RAM; final independent visual review is required and
tracked on the PR. No screenshots or real device positions are retained. See [UI evidence](docs/ui.md).

## In progress / not yet verified

Current-PC source `eba70fc` passed official-runtime per-user install, real
Stop/Start/update/rollback/uninstall-retain/reinstall and reminder persistence.
Actual 3840x2160 native view and 640x360 RAM PNG were inspected; normal exit cleared
the image to 404 and removed only owned display processes. No capture files were
found. See [runtime evidence](docs/windows.md#actual-current-pc-runtime-evidence).

The reviewed Windows/cursor baseline `7f6313a` was subsequently installed and its
47 tests/build/control checks passed. This display-studio change has not yet been
installed; its refresh follows final independent review/CI. The native host is
unchanged by the redesign.
The user reported a bright white pointer during the previous native test;
WGC image inspection did not establish cursor absence. A reviewed bounded native
test must verify cursor hiding and restoration before calling that bug resolved.
Native `/c` cold startup was blocked by automatic approval review before action
and remains unverified. Fresh-account installation, movie/game inhibition,
secure lock/resume and across-room readability are unverified. Automatic idle
stays off with the original blank saver, 1200-second timeout and security 0 preserved until explicitly
enabled after final QA. This is a working current-PC source installation, not a
public/signed release. TV control, live app preview and multi-monitor selection
remain future work; the host targets one primary display.

## Decisions and boundaries

Selected: local web dashboard plus Windows helper; one-time/undated reminders;
last-desktop snapshot before activation; Open-Meteo; device area when permitted,
otherwise Toronto with a manual-city override;
metric units and 12-hour time. Windows idle activation stays disabled until tested
and explicitly enabled. See [architecture](docs/architecture.md) and [API](docs/api.md).

Keep the repository private until a usable release and a reviewed publication
step. Each PR requires a separate independent reviewer and final reviewed SHA;
no external review integration is required. See the
[backlog](https://github.com/8roundshock/living-room-display/issues) and
[installation readiness](docs/install.md) for remaining acceptance work.
