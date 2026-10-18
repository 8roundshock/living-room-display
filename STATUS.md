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
  the merged, installed [PR #57](https://github.com/8roundshock/living-room-display/pull/57)
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
- The installed browser display keeps its pointer visible through loading/error
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
functional and actual visual review; PR #57 records independent review of its
final author head and successful Windows/Linux CI before merge. No screenshots
or real device positions are retained. See [UI evidence](docs/ui.md).
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

The reviewed refinement merged in PR #57 passes the 16-group Studio, 15-group Grid,
seven-group compact Workspace, six-group Widget and five-group Preview optical
browser suites. Workspace checks include 1280×720/600, 1024×600, 760×600,
390×700/480 and a 640×300 CSS viewport equivalent to 200% zoom on 1280×600.
Widget checks cover 21 families across three densities at 1080p and 4K, with
actual descendant bounds and long/unknown/partial/image failure states. Final
compact picker images and component atlases were inspected in RAM without files.
Independent data review verified 128 legacy omitted-key subsets plus startup,
HTTP import, presets, selected-image/reminder preservation and backup recovery.
Exact final-head independent review and CI are recorded in PR #57; these source
results do not establish combined native acceptance or TV comfort. The installed
web rollout was verified separately below.
See the [revision-2 backup/rollback requirement](docs/install.md#widget-geometry-revision-2-update-and-rollback)
before any coordinated rollout.

The last verified installed baseline on 2026-10-18 is clean
`bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8`, the normal merge of
[PR #70](https://github.com/8roundshock/living-room-display/pull/70) (#63 ambient
readability, full-height inspector) on top of PR #67 and the #57 studio UI. The owner
directed this merge and install after independent final-head review. The
[install evidence](https://github.com/8roundshock/living-room-display/pull/70#issuecomment-6253957062)
records a stopped-app private data copy with manifest, installed provenance, health,
served JavaScript/CSS matching the reviewed build, unchanged private data hashes and
unchanged Windows screensaver values; `app.previous` holds the `7e654fd` app.
For the preceding `7e654fd` (PR #57) rollout, the owner confirmed the editor
was saved/clean and authorized that update.
The [dated rollout evidence](https://github.com/8roundshock/living-room-display/pull/57#issuecomment-6253029701)
records installed provenance, owned backend/listener and health verification,
and served HTML/JavaScript/CSS hashes matching the installed files. All private
data file sets, lengths and hashes remained unchanged; legacy geometry is
migrated only in memory until an ordinary save. A complete private pre-revision-2
data recovery copy and its manifest were verified outside installer cleanup.
Retain that copy: rollback requires the matching older app and data, and both
saved JSON files can become revision 2 after normal saves.
Recheck current provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](docs/install.md).
This is a dated baseline, not a guarantee against concurrent changes. Before
future rollout or native acceptance, verify current provenance and asset pins
read-only rather than assuming the recorded values still match.
No native launch/test, registration, device-location request or editor reload
was performed during that rollout. The existing editor should be refreshed
normally before further editing. Earlier native preview acceptance remains
historical evidence, not a new combined-host result. Simulated composition/browser
checks and earlier actual 4K preview inspection do not establish across-room comfort.

Earlier current-PC source `eba70fc` passed official-runtime per-user install, real
Stop/Start/update/rollback/uninstall-retain/reinstall and reminder persistence.
Actual 3840x2160 native view and 640x360 RAM PNG were inspected; normal exit cleared
the image to 404 and removed only owned display processes. No capture files were
found. See [runtime evidence](docs/windows.md#actual-current-pc-runtime-evidence).

That verified native baseline has the cursor and early-input issues
[#36](https://github.com/8roundshock/living-room-display/issues/36) and
[#50](https://github.com/8roundshock/living-room-display/issues/50), both open.
The proposed replacement in [draft PR51](https://github.com/8roundshock/living-room-display/pull/51)
is candidate-only: combined head `f4a57b5a8897e6e7a0a81efcde87a284c339d979`
includes the merged UI, received independent source approval and passed Windows/Linux
CI, but remains draft, unmerged and uninstalled. Frozen old-source
`3a492b0` staging passed a bound stationary round with 26 qualified NULL cursor
samples, exit 0, owned cleanup and unchanged data/screensaver settings. That
old-source result does not establish visual/input or combined-source acceptance.
The merged UI is included in the candidate and was served by the canonical
backend at the verified rollout. The revision-3 visual observer has
[independent preparation-only source/pure approval](https://github.com/8roundshock/living-room-display/pull/51#issuecomment-6253359163);
its final JavaScript binding review and actual combined visual/input runtime
acceptance remain incomplete. This observer review does not establish actual
stdin/physical-stop delivery, input or cleanup timing.

The user earlier confirmed the normal interactive desktop on 2026-10-18, but
subsequently left the PC. Physical acceptance is on hold until fresh readiness
on return. This coordinator's unattended work must not launch native/screensaver
tests, capture, synthesize input or change the installed backend/assets/data,
Windows idle settings or TV while away.
An earlier access-denied preflight is historical, not a current blocker. Native
visual/input dismissal, cursor restoration and combined-source tests remain
coordinated gates; do not switch desktops or weaken capture/input guards.
Native `/c` cold startup was blocked by automatic approval review before action
and remains unverified. Fresh-account installation, movie/game inhibition,
secure lock/resume and across-room readability are unverified. Automatic idle
stays off with the original blank saver, 1200-second timeout and security 0 preserved until explicitly
enabled after final QA. This is a working current-PC source installation, not a
public/signed release. TV control, live app preview and multi-monitor selection
remain future work; the host targets one primary display.

## Continuing source work

Installed in `bedca44`: [#63](https://github.com/8roundshock/living-room-display/issues/63)
via [PR #70](https://github.com/8roundshock/living-room-display/pull/70) (separate Claude
Code session, independent Codex review), [PR #67 / #66](https://github.com/8roundshock/living-room-display/pull/67)
browser controls, and the docs-only PRs #65 and #69.

- Draft [PR #51](https://github.com/8roundshock/living-room-display/pull/51) and its
  observer were bound to the `7e654fd` served assets. Before combined native acceptance,
  merge current `main` into the candidate, rebuild, and re-pin/re-review against the
  served `bedca44` assets; the old asset pins no longer match the installed backend.
- [PR #65 / #64](https://github.com/8roundshock/living-room-display/pull/65) documents
  bounded Claude Code collaboration; the coordinator's own headless request remains on
  hold after `blocked by policy`.

Consult each PR for its current review/merge state. Unattended source checks do not
replace the physical native acceptance above.

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
