# Project status

Reviewed: 2026-10-20 for [#130](https://github.com/8roundshock/living-room-display/issues/130)
step 8, after the second polish wave merged. Implementation choices were made by the
coordinator under the owner's explicit authority to choose practical defaults and
build the app. Each linked PR and ticket carries its own review and check evidence;
this file summarizes it.

## Installed on the owner's PC

The owner's per-user install runs clean
`34464001af41af0e2ea67fb090734b296f72c1c2`, the merge of
[PR #286](https://github.com/8roundshock/living-room-display/pull/286) (time, sky
and pictures polish, [#271](https://github.com/8roundshock/living-room-display/issues/271)).
It was installed on 2026-10-19 with the control script's
`Update -NoBrowser`, over `4cb7dc1` (the merge of PR #327), which had been installed
earlier the same day over `3fee844` (PR #163, also installed that day). Setup has
not run on the owner's PC. The
[install evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6275615800)
records:

- a verified data copy: the owned server and display were stopped, and the complete
  private data directory was copied with a manifest under
  `%LOCALAPPDATA%\LivingRoomDisplayRecovery`, with verified hashes;
- installed provenance (`installation.json` at `3446400`, clean), a healthy
  `/api/health`, and served JavaScript and CSS matching the installed build;
- unchanged `state.json` and `state.backup.json` hashes, the same bytes as before the
  `3fee844` install;
- unchanged Windows screensaver settings. Idle activation was not changed
  (no `EnableIdle`);
- `app.previous` matching `4cb7dc1`, and one headless render of `/editor`, viewed and
  deleted, with no saved data written.

Main CI at `3446400` passed the build, the Windows and Linux application checks and
all six Windows Setup smoke jobs.

The rollback pair is `app.previous` (`4cb7dc1`) plus that pre-update data copy.
Neither `4cb7dc1` nor `3fee844` has a rollback exception for data that `3446400`
writes; see [rolling back the installed 3446400](docs/install.md#rolling-back-the-installed-3446400).
The data copies from the two earlier installs stay in the recovery folder. `bedca44`
cannot read data written since #263, so a rollback that far needs the data copy taken
before the `3fee844` install
([earlier rollback target](docs/install.md#earlier-rollback-target-bedca44)). The
frozen previous-release reader in `npm test` is `3446400`'s
([PR #376](https://github.com/8roundshock/living-room-display/pull/376)); the
`bedca44` copy is kept only as a legacy-data fixture.

The install evidence records no native launch, screensaver registration, capture or
device-location request. This is a dated record, not a guarantee against later
changes: before another rollout or native test, recheck provenance read-only with
the installed CLI `Status` or `%LOCALAPPDATA%\LivingRoomDisplay\installation.json`
(see [installation](docs/install.md)).

### What the installed 3446400 contains

The feature wave, first installed as `3fee844`. The
[3fee844 install evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6260374373)
lists each PR's merge commit and, for the unit PRs, the independently reviewed head;
the foundation PR #134 was reviewed at `cbbe493`
([review](https://github.com/8roundshock/living-room-display/pull/134#issuecomment-6257379754)).

| Ticket | Feature | PRs |
| --- | --- | --- |
| [#127](https://github.com/8roundshock/living-room-display/issues/127) | Shared catalog, settings and rollback-safe persistence | [#134](https://github.com/8roundshock/living-room-display/pull/134) |
| [#77](https://github.com/8roundshock/living-room-display/issues/77) | One-click Windows Setup, built by CI (private, unsigned) | [#149](https://github.com/8roundshock/living-room-display/pull/149) |
| [#73](https://github.com/8roundshock/living-room-display/issues/73) | Free-size Reminders with check-off, Undo and local history | [#145](https://github.com/8roundshock/living-room-display/pull/145), [#141](https://github.com/8roundshock/living-room-display/pull/141) |
| [#74](https://github.com/8roundshock/living-room-display/issues/74) | One adaptive Weather widget that absorbs Rain | [#148](https://github.com/8roundshock/living-room-display/pull/148) |
| [#78](https://github.com/8roundshock/living-room-display/issues/78) | Calendar, Countdown and Note; World clocks, Sun & moon and Air quality | [#157](https://github.com/8roundshock/living-room-display/pull/157), [#171](https://github.com/8roundshock/living-room-display/pull/171) |
| [#75](https://github.com/8roundshock/living-room-display/issues/75) | Native widget colours from one dim palette | [#138](https://github.com/8roundshock/living-room-display/pull/138) |
| [#76](https://github.com/8roundshock/living-room-display/issues/76) | Animation levels: Off, Subtle and Lively | [#163](https://github.com/8roundshock/living-room-display/pull/163) |

The first polish wave, installed as `4cb7dc1`
([evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6274585737))
and then `3446400` (PR #286). Each PR records its independent review and checks.

| PR | Ticket | Change |
| --- | --- | --- |
| [#201](https://github.com/8roundshock/living-room-display/pull/201) | [#196](https://github.com/8roundshock/living-room-display/issues/196) | Setup's automatic rollback stays rename-only; a source `Update` on a Setup install keeps Setup's ownership fields (#159); rollback-record, interrupted-first-install, folder-length and CI rollback/uninstall hardening (#158, #179, #180, #189, #190) |
| [#113](https://github.com/8roundshock/living-room-display/pull/113) | [#81](https://github.com/8roundshock/living-room-display/issues/81) | Docs: verify the PowerShell host and policy before running project scripts from agent shells |
| [#278](https://github.com/8roundshock/living-room-display/pull/278) | [#263](https://github.com/8roundshock/living-room-display/issues/263) | The frozen previous-release reader and `PREVIOUS_RELEASE` move to `3fee844`; `bedca44` stays as a legacy-data fixture |
| [#279](https://github.com/8roundshock/living-room-display/pull/279) | [#265](https://github.com/8roundshock/living-room-display/issues/265) | Reminders editor: visible Undo, safer edit and delete, focus and date validation |
| [#284](https://github.com/8roundshock/living-room-display/pull/284) | [#264](https://github.com/8roundshock/living-room-display/issues/264) | Weather and Forecast: compact times, outlook wording and honest stale days |
| [#292](https://github.com/8roundshock/living-room-display/pull/292) | [#266](https://github.com/8roundshock/living-room-display/issues/266) | Reminders, Countdown, Note and Calendar display polish |
| [#282](https://github.com/8roundshock/living-room-display/pull/282) | [#268](https://github.com/8roundshock/living-room-display/issues/268) | Style tab: built-in styles keep your choices, accent and status colours, backup restore |
| [#294](https://github.com/8roundshock/living-room-display/pull/294) | [#269](https://github.com/8roundshock/living-room-display/issues/269) | Widget picker and inspector: room guidance, time format, first run and accessible names |
| [#299](https://github.com/8roundshock/living-room-display/pull/299) | [#267](https://github.com/8roundshock/living-room-display/issues/267) | Editor shell: error row, focus after Save, clear network errors and two-tab list merges |
| [#307](https://github.com/8roundshock/living-room-display/pull/307) | [#270](https://github.com/8roundshock/living-room-display/issues/270) | Ambient runtime and storage: widget fit, plane drift, relocation variety and save cost |
| [#327](https://github.com/8roundshock/living-room-display/pull/327) | [#130](https://github.com/8roundshock/living-room-display/issues/130) | Docs: the status after the feature wave |
| [#286](https://github.com/8roundshock/living-room-display/pull/286) | [#271](https://github.com/8roundshock/living-room-display/issues/271) | Time, sky and pictures widgets: analog clock, Last screen caption and Air quality |

#270, #271 and the related #99 and #221 are closed. Main CI passed at `3fee844`,
`4cb7dc1` and `3446400`: the build, the Windows and Linux application checks and the
Windows Setup smoke matrix.

## Merged on main, not yet installed

The second polish wave merged after `3446400`, up to `caee22d` (PR #410). It reaches
the owner's PC only when the coordinator reinstalls under #130; until then the
installed app is `3446400`. Each PR records its independent review and checks.

| PR | Ticket | Change |
| --- | --- | --- |
| [#376](https://github.com/8roundshock/living-room-display/pull/376) | [#367](https://github.com/8roundshock/living-room-display/issues/367) | The frozen previous-release reader and `PREVIOUS_RELEASE` move to `3446400`; the `3fee844` copy is removed, additive values stay omitted at rest (#272) and the Native rollback wording is aligned (#321) |
| [#380](https://github.com/8roundshock/living-room-display/pull/380) | [#375](https://github.com/8roundshock/living-room-display/issues/375) | Browser suites in CI (#323), a canvas-scope suite (#313), diagnosable suite flakes, a plain-language [user guide](docs/user-guide.md) and agent-doc fixes |
| [#386](https://github.com/8roundshock/living-room-display/pull/386) | [#369](https://github.com/8roundshock/living-room-display/issues/369) | Server data path and editor sync: prompt state answers, a forecast only when needed, stale-Save detection between windows |
| [#395](https://github.com/8roundshock/living-room-display/pull/395) | [#370](https://github.com/8roundshock/living-room-display/issues/370) | Display runtime: relocation fades and variety, Clock, widget error containment and a black start |
| [#411](https://github.com/8roundshock/living-room-display/pull/411) | [#371](https://github.com/8roundshock/living-room-display/issues/371) | Weather, Forecast, Air quality and Sun & moon: fit 1, one last-known rule, glyphs and honest states |
| [#394](https://github.com/8roundshock/living-room-display/pull/394) | [#372](https://github.com/8roundshock/living-room-display/issues/372) | Reminders: more rows per box, a faster editor list, cross-tab conflicts and kept forms |
| [#409](https://github.com/8roundshock/living-room-display/pull/409) | [#373](https://github.com/8roundshock/living-room-display/issues/373) | Style tab, Data & recovery and widget picker: spoken values, focus, saved styles and readable samples |
| [#410](https://github.com/8roundshock/living-room-display/pull/410) | [#374](https://github.com/8roundshock/living-room-display/issues/374) | Widgets tab and Edit layout: selection in view, spoken positions, resize undo and 44 px targets |

**GitHub Actions has been blocked since 2026-10-19 at about 22:28 UTC.** No job
starts on this account ("recent account payments have failed or your spending limit
needs to be increased"); the owner's action is tracked in
[#384](https://github.com/8roundshock/living-room-display/issues/384). PR #376's
reviewed head `d4b80c4` passed both application checks before the block. The other
seven (#380, #386, #395, #411, #394, #409 and #410) merged on an independent review of
the exact merged head plus local checks at that head on the owner's Windows PC:
`npm ci`, `npm run build`, `npm test`, all sixteen browser suites and
`windows/Test-Windows.ps1`. The Linux leg of the application checks has not run on
them, and no push CI has run on any wave-2 merge on `main`. Re-run CI on `main` once
Actions runs again.

No wave-2 PR changes the persisted data format (#386's new API fields and settings
revision stay in memory). The installed `3446400` reads everything current `main`
writes, with no rollback exceptions
([rollback compatibility](docs/install.md#additive-data-and-rollback-compatibility-84)),
and after the next install `app.previous` becomes `3446400`.

**Held for CI:** [PR #385](https://github.com/8roundshock/living-room-display/pull/385)
([#368](https://github.com/8roundshock/living-room-display/issues/368), Setup and
control-script transaction hardening) was approved at `80b5b0f` but stays open; its
head after a forward merge with `main`, `721706b`, still needs re-review. It changes
`windows/LivingRoomDisplay.ps1`, which `Update` runs, and its review requires a green
Windows installer workflow (the Setup, Update and Uninstall smoke matrix on clean
runners) on the merged head, which cannot run until #384 is cleared. No wave-2 PR
changed anything under `windows/`, `package.json` or the lockfile, so the next
install runs the same control script as the installed `3446400`, which passed that
smoke in CI. #385 then installs in its own round. It also carries the `docs/install.md` backup-restore
paragraph that keeps #234 and #268 open.

## Implemented

This describes current `main`. The installed `3446400` lacks only the second polish
wave listed above.

- Node 24 LTS/TypeScript local API and shared React/Vite contracts.
- Validated settings, visual presets, atomic local JSON saves, previous-state
  backup/recovery and export/import. Legacy settings and presets migrate through
  revision-one backfill to grid revision 2. A frozen copy of the previous installed
  release's reader in `npm test` proves that release can still read the files and
  exports this build writes ([rollback check](docs/development.md#rollback-compatibility-check)).
- Twelve optional widgets in four picker groups: Clock, World clocks and Calendar;
  Weather, Forecast, Air quality and Sun & moon; Reminders, Countdown and Note;
  Photo and Last screen. The retired Rain id is kept only so the previous release
  can read data. A widget that fails to render shows "unavailable" in its own space
  and keeps relocating (#318). See the [widget contract](docs/widgets.md).
- Open-Meteo current weather, seven-day forecast, hourly precipitation, city search
  and honest stale/unavailable handling. Weather adds the chance and estimated
  timing of rain when rain is near, labelled as a forecast estimate (#74). Air quality
  uses keyless CAMS model data via Open-Meteo; Sun & moon is calculated locally. The
  local server asks for the forecast only while a saved widget or the editor needs it
  (#352), and answers without waiting more than about a second for a refresh (#351).
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
  differ from the saved baseline. The server refuses a Save over settings that
  another window changed; the editor then merges in that window's changes and saves
  again when the merge is clean, or keeps the merged draft and asks for a review
  (#287, #350). See [UI checks](docs/ui.md).
- Appearance: Native colours (one dim palette, each widget in its own tone) or a
  single accent (#75); Off, Subtle or Lively animation inside widgets (#76);
  outline, digital and analog clocks; built-in Phone, Room and Night looks and saved
  styles; typography and spacing per the [design notes](docs/design.md).
- Varied collision-free compositions with black rests; dense boards keep relocating
  through reflections and exchanges, and the relocation search avoids a composition
  from two cycles back and moves that keep a widget mostly in place (#317, #338).
  Turning off **Drift and fade between moves**, or a reduced-motion preference,
  removes travel and effects while discrete relocation continues.
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
  It is an unsigned prerelease; no release is published yet.
- A plain-language [user guide](docs/user-guide.md) for everyday use (#360, part 1).

## Verification

For this docs-only status PR on `caee22d`, with the project's pinned Node 24.19.0
(not the installed app's runtime): `npm ci`, `npm run build` and `npm test`
(354 tests) pass; all sixteen isolated browser suites in `tests/ui/` pass; and
`windows/Test-Windows.ps1` passes under Windows PowerShell 5.1. The PR records the
exact runs. GitHub CI did not run on it (#384).

Since [#323](https://github.com/8roundshock/living-room-display/issues/323)
(PR #380), CI runs the browser suites on a Windows runner: the pull-request set on
pull requests and pushes to `main`, and the slower motion, weather and palette suites
weekly and on manual dispatch; the runner has no GPU, so the motion suite's
GPU-dependent checks stay local. Markdown-only changes skip that workflow. The
application checks run on Windows and Linux and the Setup smoke matrix on Windows. See
[browser suites](docs/development.md#browser-suites). None of these workflows runs
until #384 is cleared, and #323 stays open for five clean CI runs. Open test
follow-ups include
[#165](https://github.com/8roundshock/living-room-display/issues/165) (settle CSS
motion and page clocks before timing assertions),
[#431](https://github.com/8roundshock/living-room-display/issues/431) (the widgets and
weather suites under machine load),
[#414](https://github.com/8roundshock/living-room-display/issues/414) (a reminders
keyboard-completion flake) and
[#392](https://github.com/8roundshock/living-room-display/issues/392) (keep every
suite's pages local and define the full board once).

Browser and headless renders establish source behaviour only. They do not establish
native acceptance or comfort across the room.

## Still owner- or TV-gated

- **Native screensaver acceptance and idle activation.** Draft
  [PR #51](https://github.com/8roundshock/living-room-display/pull/51) (pointer
  [#36](https://github.com/8roundshock/living-room-display/issues/36)) and early-input
  dismissal [#50](https://github.com/8roundshock/living-room-display/issues/50) stay
  open, unmerged and uninstalled; PR #51's source predates the feature wave and its
  frozen acceptance bundles are outdated. The acceptance method and tooling (from
  #125) are now part of [#7](https://github.com/8roundshock/living-room-display/issues/7).
  Actual combined visual, input, cursor-restoration and cleanup acceptance needs a
  current reviewed candidate, the owner's fresh physical readiness and a coordinated
  go-ahead. Windows idle activation (`EnableIdle`) stays off until that acceptance
  and coordinator approval (#7; the screensaver choice is
  [#118](https://github.com/8roundshock/living-room-display/issues/118)).
  Native `/c` cold startup, movie/game inhibition and secure lock/resume are unverified.
- **Couch-distance readability on the TV.** The owner's Samsung S90F runs 4K at 300%
  scaling (1280 × 720 CSS pixels). The owner's couch session after the wave-2 install
  ([#156](https://github.com/8roundshock/living-room-display/issues/156)) judges
  clocks, colours, widget readability, motion and Reminders density in short
  Fine-grid boxes (from [#144](https://github.com/8roundshock/living-room-display/issues/144)),
  with the secondary-text floors of
  [#255](https://github.com/8roundshock/living-room-display/issues/255).
- **Distribution.** How non-technical users get Setup
  ([#114](https://github.com/8roundshock/living-room-display/issues/114)), signing for
  SmartScreen and Smart App Control ([#115](https://github.com/8roundshock/living-room-display/issues/115),
  now part of #114) and verification on a clean Windows 11 PC and a fresh standard
  Windows 10 account ([#116](https://github.com/8roundshock/living-room-display/issues/116)).
- **Owner decisions** recorded on their tickets, including the product name
  ([#250](https://github.com/8roundshock/living-room-display/issues/250)), locale
  defaults ([#253](https://github.com/8roundshock/living-room-display/issues/253)) and
  device-location naming ([#239](https://github.com/8roundshock/living-room-display/issues/239)).
- **GitHub Actions billing** ([#384](https://github.com/8roundshock/living-room-display/issues/384)).
  The owner checks Settings > Billing and plans for the `8roundshock` account. Until
  jobs start again there is no CI on any branch, and PR #385 stays held.

This is a current-PC source installation, not a published or signed release. TV
control, live app preview and multi-monitor selection remain future work; the host
targets one primary display.

## Earlier evidence

- `4cb7dc1` (PR #327) was installed on 2026-10-19 over `3fee844`, with
  the first polish wave except PR #286. Its
  [install evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6274585737)
  reports a stopped-app data copy, provenance, health, matching served assets,
  unchanged data hashes and screensaver values, and `app.previous` matching `3fee844`.
- `3fee844` (PR #163, the feature wave) was installed on 2026-10-19 over
  `bedca44`, with the same checks
  ([install evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6260374373)).
  Its pre-update data copy is the one a rollback to `bedca44` needs.
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

The repository is public (owner decision, 2026-10-20,
[#441](https://github.com/8roundshock/living-room-display/issues/441)); follow the
privacy rule in [AGENTS.md](AGENTS.md#change-and-verify), and publishing a release
remains a separate reviewed step. Each PR requires a separate independent reviewer
and final reviewed SHA; no external review integration is required. See the
[backlog](https://github.com/8roundshock/living-room-display/issues) and
[installation readiness](docs/install.md) for remaining acceptance work.
