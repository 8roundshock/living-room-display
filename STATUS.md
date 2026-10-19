# Project status

Reviewed: 2026-10-19 for [#130](https://github.com/8roundshock/living-room-display/issues/130)
step 8. Implementation choices were made by the coordinator under the owner's
explicit authority to choose practical defaults and build the app. Each linked PR
and ticket carries its own review and check evidence; this file summarizes it.

## Installed on the owner's PC

The owner's per-user install runs clean
`3fee844743c6fb469231b348a7c4d2178a887459`, the merge of
[PR #163](https://github.com/8roundshock/living-room-display/pull/163). It was
installed on 2026-10-19 at 05:27 UTC with the control script's
`Update -NoBrowser`, replacing `bedca44` (PR #70). Setup has not run on the
owner's PC. The [install evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6260374373)
records:

- a verified data copy: the owned display and server were stopped, and the complete
  private data directory was copied with a manifest under
  `%LOCALAPPDATA%\LivingRoomDisplayRecovery`, with matching copy hashes;
- installed provenance (`sourceRevision` `3fee844…`, `sourceState` clean), a healthy
  `/api/health`, and served JavaScript and CSS matching the installed build (SHA-256);
- unchanged `state.json` and `state.backup.json` hashes after the install and after
  one live render;
- unchanged Windows screensaver values (`scrnsave.scr`, active, 1200 s, not secure).
  Idle activation was not changed (no `EnableIdle`);
- `app.previous` matching `bedca44`, and one headless render each of `/display` and
  `/editor`, viewed and deleted, with no saved data written.

The rollback pair is `app.previous` (`bedca44`) plus that pre-update data copy.
Restore both together once the owner has saved in `3fee844`: the first save writes
the merged Weather and Rain state. See [rolling back the installed 3fee844](docs/install.md#rolling-back-the-installed-3fee844-to-bedca44).
No native launch, screensaver registration, capture or device-location request
accompanied the install. This is a dated record, not a guarantee against later
changes: before another rollout or native test, recheck provenance read-only with
the installed CLI `Status` or `%LOCALAPPDATA%\LivingRoomDisplay\installation.json`
(see [installation](docs/install.md)).

The installed feature wave is below. The install evidence lists each PR's merge
commit and independently reviewed head; main CI at `3fee844` passed the build, the
Windows and Linux checks and the Windows Setup smoke matrix.

| Ticket | Feature | PRs |
| --- | --- | --- |
| [#127](https://github.com/8roundshock/living-room-display/issues/127) | Shared catalog, settings and rollback-safe persistence | [#134](https://github.com/8roundshock/living-room-display/pull/134) |
| [#77](https://github.com/8roundshock/living-room-display/issues/77) | One-click Windows Setup, built by CI (private, unsigned) | [#149](https://github.com/8roundshock/living-room-display/pull/149) |
| [#73](https://github.com/8roundshock/living-room-display/issues/73) | Free-size Reminders with check-off, Undo and local history | [#145](https://github.com/8roundshock/living-room-display/pull/145), [#141](https://github.com/8roundshock/living-room-display/pull/141) |
| [#74](https://github.com/8roundshock/living-room-display/issues/74) | One adaptive Weather widget that absorbs Rain | [#148](https://github.com/8roundshock/living-room-display/pull/148) |
| [#78](https://github.com/8roundshock/living-room-display/issues/78) | Calendar, Countdown and Note; World clocks, Sun & moon and Air quality | [#157](https://github.com/8roundshock/living-room-display/pull/157), [#171](https://github.com/8roundshock/living-room-display/pull/171) |
| [#75](https://github.com/8roundshock/living-room-display/issues/75) | Native widget colours from one dim palette | [#138](https://github.com/8roundshock/living-room-display/pull/138) |
| [#76](https://github.com/8roundshock/living-room-display/issues/76) | Animation levels: Off, Subtle and Lively | [#163](https://github.com/8roundshock/living-room-display/pull/163) |

## Merged on main, not yet installed

These merged after `3fee844`, up to `ee2af85` (PR #307). They reach the owner's PC
only when the coordinator reinstalls under #130; until then the installed app is
`3fee844`. Each PR records its independent review and checks.

| PR | Ticket | Change |
| --- | --- | --- |
| [#201](https://github.com/8roundshock/living-room-display/pull/201) | [#196](https://github.com/8roundshock/living-room-display/issues/196) | Setup's automatic rollback stays rename-only; rollback-record, interrupted-first-install, folder-length and CI rollback/uninstall hardening (#158, #159, #179, #180, #189, #190) |
| [#113](https://github.com/8roundshock/living-room-display/pull/113) | [#81](https://github.com/8roundshock/living-room-display/issues/81) | Docs: verify the PowerShell host and policy before running project scripts from agent shells |
| [#278](https://github.com/8roundshock/living-room-display/pull/278) | [#263](https://github.com/8roundshock/living-room-display/issues/263) | The frozen previous-release reader and `PREVIOUS_RELEASE` move to `3fee844`; `bedca44` stays as a legacy-data fixture |
| [#279](https://github.com/8roundshock/living-room-display/pull/279) | [#265](https://github.com/8roundshock/living-room-display/issues/265) | Reminders editor: visible Undo, safer edit and delete, focus and date validation |
| [#284](https://github.com/8roundshock/living-room-display/pull/284) | [#264](https://github.com/8roundshock/living-room-display/issues/264) | Weather and Forecast: compact times, outlook wording and honest stale days |
| [#292](https://github.com/8roundshock/living-room-display/pull/292) | [#266](https://github.com/8roundshock/living-room-display/issues/266) | Reminders, Countdown, Note and Calendar display polish |
| [#282](https://github.com/8roundshock/living-room-display/pull/282) | [#268](https://github.com/8roundshock/living-room-display/issues/268) | Style tab: built-in styles keep your choices, accent and status colours, backup restore |
| [#294](https://github.com/8roundshock/living-room-display/pull/294) | [#269](https://github.com/8roundshock/living-room-display/issues/269) | Widget picker and inspector: room guidance, time format, first run and accessible names |
| [#299](https://github.com/8roundshock/living-room-display/pull/299) | [#267](https://github.com/8roundshock/living-room-display/issues/267) | Editor shell: error row, focus after Save, clear network errors and two-tab list merges |
| [#307](https://github.com/8roundshock/living-room-display/pull/307) | [#270](https://github.com/8roundshock/living-room-display/issues/270) | Ambient runtime and storage: widget fit, plane drift, relocation variety and save cost |

The installed `3fee844` reads everything current `main` writes, with no rollback
exceptions ([rollback compatibility](docs/install.md#additive-data-and-rollback-compatibility-84)).
After the next install `app.previous` becomes `3fee844`. A rollback two releases
back, to `bedca44`, then needs the pre-wave data copy or one ordinary save in
`3fee844` first.

Still open from the same polish wave when this was written:
[PR #286](https://github.com/8roundshock/living-room-display/pull/286) for the time,
sky and pictures widgets ([#271](https://github.com/8roundshock/living-room-display/issues/271)),
whose merge order with #307 is recorded on #271. #268 and #234 stay open for one
`docs/install.md` paragraph on restoring from a backup. Consult each PR and ticket
for its current state.

## Implemented

This describes current `main`. The installed `3fee844` lacks only the polish listed
above.

- Node 24 LTS/TypeScript local API and shared React/Vite contracts.
- Validated settings, visual presets, atomic local JSON saves, previous-state
  backup/recovery and export/import. Legacy settings and presets migrate through
  revision-one backfill to grid revision 2. A frozen copy of the previous installed
  release's reader in `npm test` proves that release can still read the files and
  exports this build writes ([rollback check](docs/development.md#rollback-compatibility-check)).
- Twelve optional widgets in four picker groups: Clock, World clocks and Calendar;
  Weather, Forecast, Air quality and Sun & moon; Reminders, Countdown and Note;
  Photo and Last screen. The retired Rain id is kept only so the previous release
  can read data. See the [widget contract](docs/widgets.md).
- Open-Meteo current weather, seven-day forecast, hourly precipitation, city search
  and honest stale/unavailable handling. Weather adds the chance and estimated
  timing of rain when rain is near, labelled as a forecast estimate (#74). Air quality
  uses keyless CAMS model data via Open-Meteo; Sun & moon is calculated locally.
- Reminders: add, edit, delete and one-tap check-off of one-time or undated
  reminders, with Undo and a local history (the latest 500 kept). The widget can be
  any whole-cell size from 2 × 2 up to the full grid height and two-thirds of the
  width, and shows as many pending reminders as fit, with an honest “+N more” (#73).
  Title edits keep an unchanged due instant, including a repeated daylight-saving hour.
- Loopback Host/Origin protections, native-token RAM-only snapshot handoff, and
  read-only Windows screensaver status.
- Display studio: a live canvas beside a focused Style, Widgets, Weather and
  Reminders inspector; direct drag with neighbour reflow, selected resize handles,
  fitted grid densities, keyboard alternatives and a grouped widget picker with
  synthetic samples. Save/Cancel appears only while effective settings or a photo
  differ from the saved baseline. See [UI checks](docs/ui.md).
- Appearance: Native colours (one dim palette, each widget in its own tone) or a
  single accent (#75); Off, Subtle or Lively animation inside widgets (#76);
  outline, digital and analog clocks; built-in Phone, Room and Night looks and saved
  styles; typography and spacing per the [design notes](docs/design.md).
- Varied collision-free compositions with black rests; dense boards keep relocating
  through reflections. Turning off **Drift and fade between moves**, or a reduced-motion
  preference, removes travel and effects while discrete relocation continues.
- Optional private local photo with normalized PNG validation; exports omit image
  bytes and recovery backups may retain an older selected image. Desktop snapshots
  stay a separate RAM-only feature with family sizing and black-preserving midtone
  correction.
- Editor-only device location with permission-aware one-shot lookup, rounded
  coordinates, Toronto fallback and manual-city protection. No location prompt or
  lookup occurs in the screensaver.
- The browser display keeps its pointer visible; only explicit `native=1`
  presentation hides the document cursor. Unmodified F toggles fullscreen.
- Windows host and per-user control script with screensaver backup/restore, an
  isolated Edge job and scoped process management. Windows Setup (#77, #201) builds
  reproducibly from a clean commit in CI, installs per user without administrator
  rights and puts the previous version back when an update fails its health check.
  It is a private, unsigned prerelease.

## Verification

For this status PR on `ee2af85`, `npm ci`, `npm run build` and `npm test`
(309 tests) pass with the app-owned Node 24 runtime, and `windows/Test-Windows.ps1`
passes its 13 checks under Windows PowerShell 5.1. This docs-only change did not
re-run the fifteen isolated browser suites in `tests/ui/`; the polish PRs record
their own runs. Those suites cover studio, workspace, grid, widgets,
free-size Reminders, palette, motion, preview, weather, reminders, both #78
catalogs, first run, editor sync and display controls. CI runs the
application checks on Windows and Linux and the Setup smoke matrix on Windows; it
does not run the browser suites. Open test follow-ups include
[#165](https://github.com/8roundshock/living-room-display/issues/165) (settle CSS
motion before geometry assertions) and the readability-floor allowances tracked
in [#221](https://github.com/8roundshock/living-room-display/issues/221).

Browser and headless renders establish source behaviour only. They do not establish
native acceptance or comfort across the room.

## Still owner- or TV-gated

- **Native screensaver acceptance and idle activation.** Draft
  [PR #51](https://github.com/8roundshock/living-room-display/pull/51) (pointer
  [#36](https://github.com/8roundshock/living-room-display/issues/36)) and early-input
  dismissal [#50](https://github.com/8roundshock/living-room-display/issues/50) stay
  open, unmerged and uninstalled; PR #51's source predates the feature wave and its
  frozen acceptance bundles are outdated. Acceptance tooling and its capture/stop
  decisions are [#125](https://github.com/8roundshock/living-room-display/issues/125).
  Actual combined visual, input, cursor-restoration and cleanup acceptance needs a
  current reviewed candidate, the owner's fresh physical readiness and a coordinated
  go-ahead. Windows idle activation (`EnableIdle`) stays off until that acceptance
  and coordinator approval ([#7](https://github.com/8roundshock/living-room-display/issues/7);
  the screensaver choice is [#118](https://github.com/8roundshock/living-room-display/issues/118)).
  Native `/c` cold startup, movie/game inhibition and secure lock/resume are unverified.
- **Couch-distance readability on the TV.** The owner's Samsung S90F runs 4K at 300%
  scaling (1280 × 720 CSS pixels). Reminders density in short Fine-grid boxes
  ([#144](https://github.com/8roundshock/living-room-display/issues/144)) and the
  secondary-text floors ([#255](https://github.com/8roundshock/living-room-display/issues/255))
  need the owner's judgement at viewing distance.
- **Distribution.** How non-technical users get Setup
  ([#114](https://github.com/8roundshock/living-room-display/issues/114)), signing for
  SmartScreen and Smart App Control ([#115](https://github.com/8roundshock/living-room-display/issues/115))
  and verification on a clean Windows 11 PC and a fresh standard Windows 10 account
  ([#116](https://github.com/8roundshock/living-room-display/issues/116)).
- **Owner decisions** recorded on their tickets, including the product name
  ([#250](https://github.com/8roundshock/living-room-display/issues/250)), locale
  defaults ([#253](https://github.com/8roundshock/living-room-display/issues/253)) and
  device-location naming ([#239](https://github.com/8roundshock/living-room-display/issues/239)).

This is a current-PC source installation, not a public or signed release. TV
control, live app preview and multi-monitor selection remain future work; the host
targets one primary display.

## Earlier evidence

- `bedca44` (PR #70, #63 ambient readability) was installed on 2026-10-18. Its
  [install receipt](https://github.com/8roundshock/living-room-display/pull/70#issuecomment-6253957062)
  reports a stopped-app data copy, provenance, health, matching served assets and
  unchanged data hashes and screensaver values.
- `7e654fd` (PR #57, studio grid) was installed after the owner confirmed a saved
  editor ([evidence](https://github.com/8roundshock/living-room-display/pull/57#issuecomment-6253029701)).
  A complete private pre-revision-2 data recovery copy was verified outside installer
  cleanup. Retain it: a rollback to before revision 2 needs the matching older app
  and data ([procedure](docs/install.md#widget-geometry-revision-2-update-and-rollback)).
- Source `eba70fc` passed an official-runtime per-user install and real
  Stop/Start/update/rollback/uninstall-retain/reinstall with reminder persistence.
  The actual 3840 × 2160 native view and its RAM-only preview were inspected, and
  normal exit cleared the image and removed only owned display processes
  ([runtime evidence](docs/windows.md#actual-current-pc-runtime-evidence)). Native
  preview content and readability were accepted under
  [#46](https://github.com/8roundshock/living-room-display/issues/46).

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
