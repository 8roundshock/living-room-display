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
- Shared catalog/renderer registry, adaptive size families and optional modules;
  grid drag/resize with touch/keyboard alternatives, collision rejection and
  density controls. Save/Cancel is hidden unless an effective draft exists.
- Outline/digital/analog clock styles and optional private local photo drafts,
  normalized PNG validation and atomic settings/image saves. Exports omit image
  bytes; recovery backups may retain an older selected image. Desktop captures
  remain a separate RAM-only feature.
- Varied collision-free composition search with black rests. Reduced motion and
  Soft motion off remove travel/effects while discrete relocation continues.
- Reminder title edits preserve an unchanged due instant instead of reparsing a
  repeated local daylight-saving hour or discarding imported seconds/offsets.
  Explicit date changes, clearing and creation retain their local-time behavior.
- Snapshot presentation uses family sizing, black-preserving midtone correction
  and a 24% new default; existing opacity choices stay unchanged. The isolated
  optical harness confirms raw bytes remain in RAM unchanged, black stays zero,
  highlights remain bounded and controls/clear behavior work. The reviewed correction is installed; actual native content was inspected in RAM
  under [#46](https://github.com/8roundshock/living-room-display/issues/46).
- Standalone display cursor CSS covers loading/error pages and descendants;
  editor/embedded preview cursor behavior is preserved. The production Edge
  route regression passes. A native input-surface replacement has positive isolated
  prototype evidence; integrated acceptance remains open under [#36](https://github.com/8roundshock/living-room-display/issues/36).
- Editor-only device location with permission-aware one-shot lookup, rounded
  coordinates, Toronto fallback and manual-city protection. Existing choices
  migrate as manual; no location prompt or lookup occurs in the screensaver.
- Framework Windows host and per-user installer/control sources, with screensaver
  backup/restore, isolated Edge job, cancellation and scoped process management.
- Full production build and focused application tests. Windows/Linux CI runs the full
  application checks. Windows
  source regression checks cover startup cancellation, restore selection,
  owned-process recognition and filesystem transaction/cleanup behavior.

## Current verification and installation

The reviewed Studio/grid, snapshot optics and reminder corrections are merged;
clean revision `d81c1e0` is installed on the current Windows 10/4K PC. Source and
served-asset provenance, health and preservation of settings/reminders/private
photo data were checked. Device location was never requested during rollout.
The owner's preview opacity is intentionally 24%; automatic idle stays off with
the original blank saver, timeout 1200 and security 0. This is a private local
installation, not a public/signed release.

All 71 application tests and the full production build pass. Reviewed production
Edge harnesses cover Studio/city/location/reminder races, grid/photo behavior,
desktop/mobile bounds and cursor CSS. Windows source checks now cover thirteen
groups with the optional owned-process test (twelve without), on PowerShell 5.1
and 7. They include native compilation/flags, session and early-input cancellation,
surface policy, restore selection, install/reinstall/rollback data retention,
provenance and safe cleanup. Pure/fake tests do not establish actual native UI.

The native cursor replacement is source-only, awaiting final-head independent
review and CI before any installed update. Its independently reviewed isolated
prototype completed normally with 28 consecutive qualified NULL cursor readings
through the loaded 4K Edge session, helper hit-root, stable input, matched desktop
cursor/context afterward, preview 404, zero owned display processes and unchanged
data/native preferences. This is sampled prototype evidence; integrated runtime,
real input/Escape, external focus, renderer failure and startup/error visuals
remain separate gates. The first-second input-loss bug is tracked by
[#50](https://github.com/8roundshock/living-room-display/issues/50) with actual
caller-baseline and fake delayed-startup regressions.

Earlier current-PC installation tests passed real CLI Start/Stop, update/rollback,
uninstall-retain/reinstall and synthetic reminder persistence. A native RAM PNG
and actual 4K ambient window were inspected, without screenshot files. See
[Windows evidence](docs/windows.md#actual-current-pc-runtime-evidence).

Native `/c` cold startup remains unverified after automatic approval blocked that
optional test; do not equate it with CLI startup or retry an equivalent route.
Movie/game screensaver inhibition, real lock/resume, fresh-account installation,
across-room comfort and multi-monitor support remain unverified. Current input
polling exists only inside an already requested ambient session; activation uses
conventional Windows screensaver registration, with no new idle service/loop.
Keep automatic idle off until actual acceptance and explicit coordinator approval.

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
