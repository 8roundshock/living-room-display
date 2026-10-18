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
  highlights remain bounded and controls/clear behavior work. The reviewed
  correction was installed in the last verified baseline below; actual 4K native
  preview content/readability was
  accepted under [#46](https://github.com/8roundshock/living-room-display/issues/46),
  with raw capture/inspection in RAM and no screenshot files.
- Standalone display cursor CSS covers loading/error pages and descendants;
  editor/embedded preview cursor behavior is preserved. The production Edge
  route regression passes; actual native cursor proof remains pending [#36](https://github.com/8roundshock/living-room-display/issues/36).
- Editor-only device location with permission-aware one-shot lookup, rounded
  coordinates, Toronto fallback and manual-city protection. Existing choices
  migrate as manual; no location prompt or lookup occurs in the screensaver.
- Framework Windows host and per-user installer/control sources, with screensaver
  backup/restore, isolated Edge job, cancellation and scoped process management.
- Full production build and focused application tests. Windows/Linux CI runs the
  full application checks. Proposed Windows source regressions also cover
  early-input cancellation and native surface policy; they do not establish
  installed behavior.

Local verification: the full build and all 71 application tests pass using the
app-owned Node 24 runtime. The merged baseline passed eleven Windows check groups
on PowerShell 5.1 and 7 with the optional real child-process test (ten without).
The proposed native source adds active-input and surface-policy suites, for
thirteen groups with Node (twelve without). Provenance tests
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
visuals were inspected in RAM, and the merged UI changes received independent
functional and actual visual review. No screenshots or real device positions
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

The last verified installed baseline on 2026-10-18 was clean
`2e010f04aded296f896df5065e391b62d36e2bb1`, including the reviewed Studio/grid,
preview-readability, reminder and long-city wrapping corrections. The latest
CLI-only rollout verified all 21 built and 11 served files, preserved data/backup,
settings, reminders and private photo state, and left a healthy owned server;
see [rollout evidence](https://github.com/8roundshock/living-room-display/pull/54#issuecomment-6249798540).
Recheck current provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](docs/install.md).
The city update rechecked the installation marker, HTTP health, source/served-asset
provenance and data preservation without a native/current-desktop probe or display
launch; it added no native runtime acceptance. Actual 3840x2160 rendered preview
readability was accepted earlier on installed `2b564c9` under
[#46](https://github.com/8roundshock/living-room-display/issues/46#issuecomment-6249125861).
Device location was not requested during either rollout. Simulated composition/browser
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
is candidate-only: native code at `c06a9a9` received independent approval and both
CI jobs passed. Any later head requires a final-head recheck; the replacement
remains unmerged and uninstalled. It adds an independent native
input surface with exact job ownership, terminal foreground/renderer guards,
and a fixed input baseline from before startup. Active-session monitoring stops
on disposal; fake delayed-startup and cleanup-race regressions cover cancellation.
Positive isolated prototype evidence does not establish integrated production
acceptance. Actual native normal/visual/input dismissal, focus/renderer failure
and cursor restoration gates remain pending.

On 2026-10-18 the user confirmed this PC was on its normal interactive desktop.
A fresh command-run preflight still stopped before launch: `GetCursorInfo`
returned error 5 and its current desktop reported `UOI_IO=false`, despite the
same active console session as the desktop apps. No isolation cause is confirmed.
One official Computer Use inventory succeeded (four windows, three apps; no
Edge/display window), without capture or input; it does not qualify the native
observer. The next prepared fallback is one user-initiated, nonadmin PowerShell
run of the exact reviewed stationary candidate observer, with a fresh 30-second
authorization, fail-closed preflight and eight-second test bound. It has not run.
Require successful preflight and a new coordinated GO; do not repeatedly ask the
user to unlock, switch desktops, dismiss security UI or weaken the guard. See the
[sanitized diagnosis](https://github.com/8roundshock/living-room-display/pull/51#issuecomment-6249615459).
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
