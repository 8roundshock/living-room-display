# Project status

## Published continuation

The integration is published in [PR #507](https://github.com/8roundshock/living-room-display/pull/507)
for #447. It remains a draft while native startup and daily-use fixes receive
combined verification. Publication does not establish installation or activation.

The first pushed checkpoint, `018aef7`, passed Application checks and all Windows
installer jobs. Its browser job was still running when this entry was written.
The next source checkpoint adds #511, #512 and #513 below; the earlier full browser
aggregate remains evidence for its explicitly recorded revision, not these additions.

Dynamic now keeps exhausted stale forecast, alert and air sources visible as
unavailable (#511), while usable alternate sources and freshly empty sources keep
their existing behavior. The regression failed before the correction; the isolated
fix and its initial integration both passed build and all 482 unit tests.

### Home display-card follow-up (#513)

Home's card and header now share one display-window controller, with the editor using
the same controller logic. Opening from the card exposes Show/Close in the header;
repeated clicks focus the existing document without reloading, and closing resets both
links. The focused browser regression failed before the fix and passed afterward.
The screen and display-controls suites passed (8 and 6 groups), alongside build and
481 unit tests in its isolated branch. This records local source checks with synthetic
data, not installation.

### Home Note follow-up (#512)

A clean open Note now follows another page's saved text without creating a false
draft or unload prompt. Genuine local typing remains intact, Discard uses the latest
saved text, and typing back to saved clears the retained draft. The focused browser
regression failed on the prior source and passed with this fix; the earlier Note
Save/Discard/Clear-Undo sweep and the full Home browser suite also passed. Build and
all 481 unit tests passed with Node 24 in its isolated branch. This records local
source verification only; combined checks are recorded at the final source freeze.

The combined #511/#512 source checkpoint `b4ce352` passed `npm run build` and
all **482 unit tests**, with no skipped tests. Its detailed local logs are
`.local/publication-note-build.log` and `.local/publication-note-unit.log`.

Reviewed locally on 2026-10-21 for [#447](https://github.com/8roundshock/living-room-display/issues/447).
This report records the verified `codex/wave3-local` source checkpoint before
publication. Current-head CI, reviewed merging and installation are coordinated
through #447; the local evidence below does not by itself establish those outcomes.

## Source and installation are separate

The source starting point was clean `main` at
`f85be2902f4f670b395175349f97f095ec276892`, with the five feature PRs below
awaiting integration.

A read-only observation of the installation marker identified `f85be29`, clean,
installed at **2026-10-21 04:50:32 UTC**. That is marker evidence only: this session
did not validate the running server, served assets, native cursor, capture,
screensaver activation, or the current recovery directory. No installed files,
private data, screensaver settings or power settings were changed.

The original checkout and existing uncommitted work were preserved. Development
used independent full clones, without shared Git object hardlinks or build output
with the original checkout.

## Integrated locally

Each feature's original history is retained through ordinary merges with current
main; the worker branches also remain available locally.

| Ticket / existing PR | Behavior in this source |
| --- | --- |
| [#435](https://github.com/8roundshock/living-room-display/issues/435) / [#467](https://github.com/8roundshock/living-room-display/pull/467) | A full default board for new installs and Reset layout; existing saved boards keep their layout. |
| [#439](https://github.com/8roundshock/living-room-display/issues/439) / [#466](https://github.com/8roundshock/living-room-display/pull/466) | Optional Follow daylight brightness between chosen dimmest and brightest levels. Fixed remains the default. |
| [#436](https://github.com/8roundshock/living-room-display/issues/436) / [#473](https://github.com/8roundshock/living-room-display/pull/473) | Continuous gentle float, optional swaps without black rests, scoped wake-lock behavior and one browser display window. |
| [#437](https://github.com/8roundshock/living-room-display/issues/437) / [#476](https://github.com/8roundshock/living-room-display/pull/476) | Optional Dynamic widget with ranked weather, official Canadian/US alerts and personal signals; server-side bounded provider reads. |
| [#438](https://github.com/8roundshock/living-room-display/issues/438) / [#482](https://github.com/8roundshock/living-room-display/pull/482) | Home at `/`, Edit display at `/editor`, daily actions and silent timers with a Clock slot. |

Integration also includes immediate float-offset clamping after content grows
(#479), closing script-opened displays after their opener closes (#480), clarified
motion contracts (#481), composition-anchor float clamping, paused extended-timer
Undo (#487), resolved Note draft
cache handling, bounded alert error bodies, and stable widget-fit readiness in
browser tests (#431). The completed local verification phase kept new issue
write-ups as local drafts. Publication and follow-up tracking are now coordinated
through #447 under the owner's continued-work authorization.

Home and Edit display share Open/Show/Close display controls. A script-opened
display closes back to its opener. A directly opened display uses Esc for Home and
E for Edit display. A retired display stops both regular and change-marker polling.
Home's Show action never rearranges a full board: it reports no room without
changing existing placements.

The frozen rollback reader remains **d66832b**. Fixed brightness, no swaps,
keep-awake on, and Dynamic off with all sources on omit their additive defaults at
rest; Dynamic transforms unknown to that reader are omitted too. Non-default
choices and enabled Dynamic remain documented exceptions. See
[rollback compatibility](docs/install.md#additive-data-and-rollback-compatibility-84).
Timers use their own sidecar and do not enter settings exports.

## Completed local verification checkpoint

### Native runtime follow-up (#117, #505)

The native helper now starts, stops and checks its exact owned backend without
PowerShell. It shares the existing script's process record and operation lock,
checks the listener's process identity before accepting health, and preserves
ownership on cancellation. Browser cleanup no longer waits behind preview cleanup.

The complete `windows/Test-Windows.ps1 -NodeExe <existing Node 24>` passed all
**19 groups** with installed PowerShell 7 and no execution-policy override. This
includes 32 runtime contract scenarios, the blocked-preview cleanup regression,
and an isolated real Node fixture using a non-production loopback port: native
start to PowerShell recognition/stop, then PowerShell start to native recognition/stop.
Native cold startup in that fixture took **1,065 ms**. The old native bootstrap's
before-time remains unmeasured because it invokes an execution-policy override;
no performance improvement is claimed. Console transcript:
`.local/native-final-windows.log`. These checks used synthetic data and did not
launch the ambient display, update the installation, or select a screensaver.

The earlier Windows-subset limitation below describes its original checkpoint;
the full follow-up above removes the test children's policy override. Native
painting, physical-input dismissal, cursor restoration, exact installed assets,
and activation still require the separate coordinated rollout verification.

Final browser code/test checkpoint: `d58980a3697181e0e5c85aa73369912153a70f1f`.
Product implementation is unchanged since `58431495ee879c6f5d63f740d29cfcc1d16e6ea7`.
The combined features first passed build/unit at `fe7006e`. Subsequent product
corrections were the 44 px mobile Close targets (`501e0e5`), preserving the existing
fullscreen-hint glyph (`788c135`), and measuring float slack after composition-driven
alignment changes (`5843149`). The last change received a fresh full build/unit run.
Other intervening commits correct browser fixtures, selectors and close-event
synchronization; they do not change the product implementation.

- Node **24.19.0**, pinned project dependencies copied only after matching the
  source and clone lockfile hashes; no fresh `npm ci` claim.
- `npm run build`: pass. Vite reports its advisory JavaScript chunk-size warning
  (about 550 kB before gzip). Logs: `.local/final-build.log`,
  `.local/mobile-header-build.log`, `.local/studio-hint-build.log`, and
  `.local/anchor-clamp-build.log`, and `.local/anchor-conservative-final-build.log`.
- `npm test`: **481 passed, 0 failed** at that checkpoint. Integration fixtures
  explicitly distinguish the historical catalog board from the new full default;
  geometry, fit, overlap and usability requirements are preserved. Log:
  `.local/anchor-clamp-unit-tests.log` (the post-anchor-fix run, 12.858 s).
  The earlier `.local/final-unit-tests.log` is diagnostic history, not the final
  product checkpoint evidence.
- Independent source review found no remaining blocking findings in the feature
  integration, follow-up fixes and bounded UI/test corrections. The final evidence and
  documentation receive a separate bounded review after the aggregate.
- Visual inspection used 15 RAM-only screenshots of synthetic Home, editor,
  Style/Motion, Dynamic controls, default display, timers and day/night display
  states. It found a 40 px mobile Close target, fixed to 44 px; four further Home
  and editor screenshots at 320/390 px verified both display controls at 44 px,
  without overlap, horizontal overflow or browser errors. No screenshots persisted.
- Safe Windows subset: host compiled, then 8 fake lifecycle scenarios, active-input
  and surface-policy test executables, 4 fully mocked idle-restore scenarios,
  9 static installer-policy groups, synthetic install lifecycle and Git-provenance
  tests, and parsing of all 13 PowerShell scripts passed.
  The compiled screensaver was never launched. Logs:
  `.local/windows-safe-checks.log`, `.local/windows-synthetic-checks.log`.

Windows checks used installed Microsoft Store PowerShell **7.6.7**, with inherited
module/policy overrides cleared. Existing execution policy was preserved; no
bypass or policy change was used. Detailed host checks stay in ignored local logs. The complete `windows/Test-Windows.ps1` was
not run because it internally launches a Bypass-policy child and the screen host.
This subset is not a claim of the complete Windows or installer smoke suite.

### Browser acceptance

The final documented aggregate runner completed **20 of 20 suites, exit 0**, in
2,051 suite-seconds at the frozen `d58980a` code/test checkpoint. One serial
invocation covered every suite; no code or tests changed during it. It started at
2026-10-21T14:01:21.7301403Z and completed at 2026-10-21T14:35:31.4306461Z.
All runs used production assets, isolated ephemeral loopback servers and synthetic
data. No failure occurred in this final aggregate.

The runner was `node tests/ui/lib/run-suites.mjs`, with Playwright, Edge and Sharp
paths and all 20 names below. Its exact command is retained in
`.local/final-browser-command.txt`; executable, arguments, timestamps, exit code
and unchanged starting/ending HEAD are in `.local/final-browser-invocation.json`.
The complete output is `.local/final-aggregate-browser.log`; parsed results are
`.local/final-browser-results.json`. These stay in the ignored integration-clone
`.local/` directory. Earlier mixed-revision runs are explicitly diagnostic history
in `.local/diagnostic-browser-results.json`, not the final acceptance evidence.

| Suite | Result | Seconds |
| --- | --- | --- |
| daylight | Pass | 11 |
| dynamic | Pass | 31 |
| home | Pass | 152 |
| screen | Pass | 17 |
| display-controls | Pass | 5 |
| studio | Pass | 56 |
| workspace | Pass | 45 |
| first-run | Pass | 14 |
| editor-sync | Pass | 10 |
| canvas-scope | Pass | 14 |
| grid | Pass | 60 |
| catalog-sky | Pass | 68 |
| reminders | Pass | 32 |
| catalog-time | Pass | 21 |
| freesize | Pass | 27 |
| preview | Pass | 8 |
| widgets | Pass | 652 |
| motion | Pass | 434 |
| weather | Pass | 330 |
| palette | Pass | 64 |

First failures were retained, diagnosed and corrected rather than retried blindly:
Home's stale picker locator and successful-popup-close race; the shared header's
fullscreen-hint glyph; an obsolete fixed mobile header-height expectation; and
legacy five-row/free-cell fixture assumptions after the six-row default changed.
The first-run suite now keeps its original five-row fit guarantees and separately
checks the actual six-row board's bounded internal scrolling and reachable controls.
One added test initially assumed a 44 px desktop Add button; source/history confirmed
its existing 40 px contract, which the final assertion preserves. A proactive audit
also made historical Motion and Reminders-column boards explicit before their runs.
The full Widgets sweep then found a Reminders-column case. Focused measurement
separated overlapping empty section boxes from a real anchor-change offset bug:
content bounds escaped the cell because ancestor CSS alignment changed without
triggering size/content observers. The final complete-range guard measured a
9.17 px outer-cell escape before the fix; an earlier line-box-normalized probe
recorded 6.87 px outside the cell and 26.31 px beyond its padding. The new layout measurement fixed it.
The exact probe failed before and passed after; the wider 1080p/4K matrix checks
stepped and continuous movement, editor arrangements and an excessive-offset
negative control. That control leaves normalized cells unchanged while the independent
content-containment assertion correctly fails. Logs: `.local/reminders-anchor-before.log`,
`.local/reminders-anchor-after.log`, `.local/reminders-anchor-conservative-before.log`,
and `.local/reminders-anchor-focused-conservative-final.log`.
The final helper retains full text ranges: glyphs can extend beyond a short line
box. A RAM-only pixel probe distinguished a harmless 2 px range/padding discrepancy
from the actual cell-escape regression; it did not justify trimming any bounds.
The originally local issue draft is now tracked publicly as
[#510](https://github.com/8roundshock/living-room-display/issues/510).
Original failure logs remain beside the successful runs.

No fresh GitHub CI run was triggered during that local verification phase.
Publication requires current-head checks. Local checks do not replace Windows/Linux CI,
Setup smoke testing, native acceptance or physical TV comfort.

## Remaining acceptance and follow-ups

- Native fullscreen, cursor/dismissal/restoration, capture and idle activation need
  a separately coordinated current-candidate acceptance session. Historical native
  evidence is recorded in [Windows evidence](docs/windows.md#actual-current-pc-runtime-evidence).
- S90F couch-distance readability, motion comfort and long-term OLED behavior are
  unverified by these checks. Float spreads edges locally; it does not guarantee
  protection against burn-in or equal wear across screen regions.
- Dynamic follow-ups #485 (dates on secondary rows) and #486 (coverage) remain.
  Wider provider coverage and other product follow-ups retain their existing scope.
- Distribution, signing, clean Windows 11 / fresh standard-account checks and any
  future install remain separately coordinated work. The owner has authorized
  reviewed merging and activation; native acceptance and installation evidence must
  be recorded by the responsible Windows workstream.

## Earlier evidence

The previous status narrative is preserved in
[STATUS.md at f85be29](https://github.com/8roundshock/living-room-display/blob/f85be2902f4f670b395175349f97f095ec276892/STATUS.md).
Its installed-version and CI-block statements are dated historical claims, not
current runtime observations. Recovery procedures remain in [installation](docs/install.md);
recheck actual app/data provenance before any future rollout or rollback.
