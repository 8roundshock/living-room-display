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
  source refinement in [draft PR #57](https://github.com/8roundshock/living-room-display/pull/57)
  adds stable direct drag/neighbor reflow, selected resize handles, reversible
  fitted density drafts and a bounded compact studio/picker. Local arrangement
  rebasing is atomic; valid legacy settings/presets retain revision-one backfill
  before migration. Save/Cancel is hidden unless an effective draft exists.
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
  highlights remain bounded and controls/clear behavior work. The reviewed
  correction was installed in the last verified baseline below; actual 4K native
  preview content/readability was
  accepted under [#46](https://github.com/8roundshock/living-room-display/issues/46),
  with raw capture/inspection in RAM and no screenshot files.
- The candidate browser display keeps its pointer visible through loading/error
  and fullscreen, with an unmodified F fullscreen toggle. Only explicit
  `native=1` presentation hides the document cursor. The minimal host URL flag
  does not include held native cursor-surface/lifecycle changes in PR #51;
  combined native acceptance remains pending [#36](https://github.com/8roundshock/living-room-display/issues/36).
- Editor-only device location with permission-aware one-shot lookup, rounded
  coordinates, Toronto fallback and manual-city protection. Existing choices
  migrate as manual; no location prompt or lookup occurs in the screensaver.
- Framework Windows host and per-user installer/control sources, with screensaver
  backup/restore, isolated Edge job, cancellation and scoped process management.
- Full production build and focused application tests. Windows/Linux CI runs the full
  application checks. Windows
  source regression checks cover startup cancellation, restore selection,
  owned-process recognition and filesystem transaction/cleanup behavior.

Local verification: the full build and all 79 application tests pass using the
app-owned Node 24 runtime. Eleven Windows check groups pass on PowerShell 5.1
and 7 with the optional real child-process test (ten without). Provenance tests
cover clean/dirty Git, archives, enclosing repositories and composed sources;
successful install refreshes metadata while failed updates and uninstall retain it.
Synthetic
online export/import and validated offline recovery after both saved JSON files
were corrupted pass, retaining original corrupt evidence. Native static/unit
checks use fake transport/session/native boundaries and scoped filesystem fixtures;
they do not establish actual installed capture, kiosk, idle or lock behavior.
The isolated production Edge studio harness passes sixteen interaction/layout
groups, including async Save/Cancel/city/location races, reminder CRUD and exact
due-date preservation through title edits, all four
1080p/4K bounds, reduced motion, 390px/320px reflow and focused-field clearance
above the measured Save bar at full/compact heights. Source desktop/mobile
visuals were inspected in RAM. Earlier merged UI changes received independent
functional and actual visual review; current PR #57 final-head review is recorded
separately in that PR before merge. No screenshots or real device positions
are retained. See [UI evidence](docs/ui.md).
The long-city wrapping correction
[#52](https://github.com/8roundshock/living-room-display/issues/52) has isolated
browser coverage for complete option text and keyboard/Cancel behavior at 320px,
390px and desktop widths. See [PR #54](https://github.com/8roundshock/living-room-display/pull/54)
for final-head review and rollout evidence; use the dated installation baseline
and live provenance guidance below to check installed state.

Feature [#43](https://github.com/8roundshock/living-room-display/issues/43) and
its isolated grid/photo harness were reviewed, merged and installed; the
[feature PR](https://github.com/8roundshock/living-room-display/pull/45) records
functional, actual visual and widget-skill review evidence. The held-drag polling
race [#44](https://github.com/8roundshock/living-room-display/issues/44) was resolved.

## Last verified installation and remaining acceptance

The source-only refinement in PR #57 passes the 16-group Studio, 15-group Grid,
seven-group compact Workspace, six-group Widget and five-group Preview optical
browser suites. Workspace checks include 1280×720/600, 1024×600, 760×600,
390×700/480 and a 640×300 CSS viewport equivalent to 200% zoom on 1280×600.
Widget checks cover 21 families across three densities at 1080p and 4K, with
actual descendant bounds and long/unknown/partial/image failure states. Final
compact picker images and component atlases were inspected in RAM without files.
Independent data review verified 128 legacy omitted-key subsets plus startup,
HTTP import, presets, selected-image/reminder preservation and backup recovery.
Exact final-head independent review and CI are recorded in PR #57; these source
results do not establish installed behavior, native acceptance or TV comfort.
See the [revision-2 backup/rollback requirement](docs/install.md#widget-geometry-revision-2-update-and-rollback)
before any coordinated rollout.

The last verified installed baseline on 2026-10-18 was clean
`2e010f04aded296f896df5065e391b62d36e2bb1`,
including the reviewed Studio/grid, preview, reminder and city-wrap corrections.
Recheck current provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](docs/install.md).
The installation marker and HTTP health were rechecked on that date. Current UI
refinements in PR #57 remain source-only until coordinated rollout. Earlier
rollout verified source/served-asset provenance, preservation of settings/reminders/
private photos and actual 3840x2160 native preview acceptance.
Device location was not requested during rollout. Simulated composition/browser
checks and actual 4K preview inspection do not establish across-room comfort.

Earlier current-PC source `eba70fc` passed official-runtime per-user install, real
Stop/Start/update/rollback/uninstall-retain/reinstall and reminder persistence.
Actual 3840x2160 native view and 640x360 RAM PNG were inspected; normal exit cleared
the image to 404 and removed only owned display processes. No capture files were
found. See [runtime evidence](docs/windows.md#actual-current-pc-runtime-evidence).

That verified native baseline has the cursor and early-input issues
[#36](https://github.com/8roundshock/living-room-display/issues/36) and
[#50](https://github.com/8roundshock/living-room-display/issues/50), both open.
The proposed replacement in [draft PR51](https://github.com/8roundshock/living-room-display/pull/51)
is candidate-only: head `43beadc` received independent code approval and both CI
jobs passed, but it is draft, unmerged and uninstalled. Frozen old-source
`3a492b0` staging passed a bound stationary round with 26 qualified NULL cursor
samples, exit 0, owned cleanup and unchanged data/screensaver settings. That
old-source result does not establish visual/input or combined-source acceptance.
The reviewed UI must first be merged normally into the candidate and served by
the canonical backend before combined `native=1` acceptance and registration.

The user confirmed the normal interactive desktop on 2026-10-18. An earlier
access-denied preflight is historical, not the current desktop state. Native
visual/input dismissal, cursor restoration and combined-source tests remain
coordinated gates; do not switch desktops or weaken capture/input guards.
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
