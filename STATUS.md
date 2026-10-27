# Project status
## Shared latest screenshot file (#544, work in progress)

The owner chose one overwritten app screenshot file on 2026-10-27, replacing
this app's earlier RAM-only requirement. The initial source checkpoint implements
an atomic PNG store with capture time on the same file, retaining the prior
success when replacement fails and clearing unknown prior-session files. Four
isolated synthetic-file tests pass. Browser/native integration, capture pause,
independent final-head review and CI remain unfinished; this does not change the
installed app or establish actual capture success. #519 remains unresolved.

## Periodic Last screen cache (#538, #540)

The source checkpoint replaces the one-shot pre-idle attempt with an immediate
first eligible desktop snapshot and a monotonic five-minute cadence. It keeps
one private latest-success RAM thumbnail across normal input and failed capture
refreshes, atomically zeroing the preceding bytes on successful replacement.
The full primary desktop is copied before downscaling; no screenshots are saved.
Only the child-secret safe-context heartbeat maintains the cache's short producer
lease. Unknown/locked/session/configuration/disabled contexts or lost observation
clear it; an image has no arbitrary age expiry while the safe producer is healthy.
Actual saver/ambient surfaces are excluded, with a brief band around the nominal
idle transition. Claim still requires an exact frame identity and completion
before the actual automatic process was created. Active-session expiry remains
separate.

The integration includes reviewed widget-first source #539. All 570 unit tests,
both TypeScript checks and the production build pass. The bounded Windows source
suite passes, including 58 cadence/recovery assertions, 18 injected context checks,
36 mocked sign-in setup assertions and both compiled production binaries without
execution. Private claim fetches the authoritative frozen frame, so a committed
upload with a lost response cannot strand stale native metadata. Deterministic
API checks cover that failure, late in-flight bodies, and an ambient transition
before handshake.

Early sign-in setup under #540 supports an existing owned idle/Last screen opt-in,
including referenced visible saved styles under an explicitly enabled schedule
when manual preview is off. One shared fixture checks backend/PowerShell parity;
unused styles and disabled schedules do not authorize startup.
AUTO never creates or rewrites the data preference. Explicit CLI startup choices
are retained in complete data backups. Mocked source install transactions pass.
Package test-isolation correction #543 supplies synthetic child status facts and
a source-only mode excluding three OS integration cases; hosted CI retains the
full cases. Final head review/CI remain required. No installed capture or native
session acceptance is established; #519 remains open.

## Native widget-first reveal (#539)

The native selector previously accepted the ordinary Display title, which React
also assigned while the initial state request was pending. Native presentation
now publishes a distinct content-ready title only after a committed ambient
board, font readiness and paint opportunities. The exact owned job/window class,
fullscreen bounds, input surface and NULL-cursor checks remain prerequisites.
The opaque black cover remains until that marker; native loading/error content
is hidden. A short native-only startup entrance runs once, with reduced motion
honored; normal polls and movement never replay it. The native kiosk's rendering
flag lets covered content prepare without changing ordinary browser settings.

Four deterministic readiness tests, the surface/lifecycle/input/deadline source
fixtures, both compiled production binaries, typechecks/build and eight isolated
display-control browser groups pass. The latter holds state delivery to prove
the page cannot advertise readiness before the actual board, and retains the
1080p/4K premount black-pixel checks, plus initial error, retained disconnected
content and an intentional empty board. Display-control QA explicitly stubs
device and wake-lock APIs. The existing eight-group Screen suite also passed;
its real headless wake-lock subcase acquired and released a browser request, not
a native screen/power-policy acceptance test. No installed/native display was run. Actual
grey-screen cause and physical native reveal still require fresh watched
acceptance; #503 remains separate. Independent final-head review and applicable
CI are recorded on the linked PR before any merge.

## Settings scrolling and layout (#535)

A synthetic desktop regression reproduces the clipped Settings page: the shared
editor's later viewport-height rule wins the old single-class page rule, leaving
native wheel scrolling at zero with recovery controls below the viewport.
Settings now explicitly keeps ordinary document flow independently of stylesheet
order. Weather and device preferences share the first row; Schedule and Data &
recovery use full-width rows in reading order, without the weather row span or
Schedule's redundant inner divider. Narrow windows retain a single column and
no inherited editor footer padding. Empty location messages no longer reserve
blank space; Settings focus scrolling reserves the dirty-only Save/Cancel bar.

Both TypeScript checks and the production build pass. Settings browser checks
pass all 12 groups, including real wheel/keyboard recovery reachability, expanded
schedule rows, narrow reflow and unobscured native Tab targets. All eight Schedule
groups pass. Desktop and expanded narrow synthetic renders were inspected in RAM.
Independent final-head review and applicable CI remain required; installed
behavior has not changed.

## Movement preview mode-reset readiness (#537)

The first final Settings CI run (`40204925957`) passed 21 of 22 browser suites,
including Settings and Schedule, but read the movement slider as `121.2` rather
than zero immediately after a mode change. Controlled browser breakpoints on
unchanged production clients from both `97c7d71` and `15ffe4a` reproduce the exact
intermediate state: the native range maximum has committed while the local
clock's passive reset is held. Resuming that callback produces the required
zero slider and zero rendered frame without advancing either test clock.

The fixture now waits for those actual reset values and paused Play state before
retaining its exact zero and duration assertions. It changes no product code,
time/frame tolerance, clock, lifecycle or no-write guard. The focused five-group
suite passes; the earlier failed CI evidence remains diagnostic. The integrated
final head still needs independent review and fresh applicable CI before merge.

## Native dismissal recovery source (#532)

A managed-only regression reproduces an ordering vulnerability in `81b6839`:
input cancellation reaches a blocked preview clear while the owned renderer stays
alive unless the UI/disposer progresses. The checkpoint releases that exact browser
before synchronous cancellation callbacks or HTTP cleanup, rejects late browser
publication after shutdown, and checks cancellation before UI/native observations.
It also posts an asynchronous surface hide. Terminal exit intent is recorded
immediately, but a six-second exact-self termination deadline is eligible only
after the one host handshake has returned, before any own surface/display stage.
Cancellation during an unresolved handshake retains the existing bounded startup
transport behavior; it is not force-terminated by this fallback. Concurrent
disposal waits for the first renderer release and teardown to actually finish;
same-thread callback reentry cannot wait on itself. Only genuine completed
teardown disarms the deadline. This requests termination, not kernel/GPU recovery
or an exact OS process-exit time.

The old cancellation-only regression fails and the new scoped Windows source
suite passes, including 27 injected deadline assertions and both compiled
production binaries without execution. The integrated backend rotates only the
native-preview session token at each authorized handshake and clears the old
active image. Stale DELETE and in-flight POST cannot mutate a replacement; the
separate preparer capability and private pending frame survive for automatic claim.
Production API regressions cover these cases. A naturally cancelled or externally
killed older handshake arriving late remains an availability limit in #534.

All 558 unit tests, both TypeScript checks and the production build pass. No actual
native session, desktop or installed operation was used. Independent final-head
review, applicable CI and actual native acceptance remain required. #532 and #519
remain open; this is not an exclusive diagnosis of the reported black screen or a
completed installation. PR #531's claim-pipe correction is already in this source
base, distinct from the version-bound older installation report.

## Automatic Last screen claim-pipe correction (#519)

The production claim-pipe constructor has a reproduced source defect:
`WindowsIdentity.Groups` filters out logon-ID groups, so searching it for the
logon SID throws before the pipe exists. The focused source patch queries
`TokenLogonSid` with query-only access and retains the logon-only principal and
claim guards. An alternate test entry point reproduces the old exception without
starting the worker, reading a desktop or contacting an installed backend.

After correcting the lookup, the real owned-pipe fixture exposed a second failure:
the original data/synchronize ACL allows waiting but the unchanged client cannot
connect. This reproduces locally and in the first PR #531 Windows installer run
(`40105194193`); that failed evidence is retained. A controlled comparison changes
only the server ACL's read-attributes bit (`0x80`) for the same logon SID and makes
the full production scalar exchange pass. The correction adds that individual
right, without generic write, create-instance, write-attributes or wider principals.
This is observed Windows connection behavior, not a claim that the API documentation
specifies a universal implicit access requirement.

The source-only checks pass: 20 token-buffer and real owned-pipe assertions,
including the exact protected single-logon ACE, unchanged client exchange, peer
PID, scalar framing and first-instance refusal. Existing policy, context, claim,
encoding and fake lifecycle/runtime checks also pass, and both production binaries
compile without execution. Independent final-head review, applicable CI and actual
automatic Last screen acceptance remain required; source checks do not establish
installed capture or rendering. #519 remains open.

## Automatic Last screen after timer drift (#519)

Automatic acceptance remains unsuccessful after source `70673ea`: the reported
activation reached the ambient widgets without a recognizable Last screen image,
after a grey interval of unmeasured duration. The separate startup investigation
remains in #503; this change does not establish that interval's cause.

A production-used synthetic regression reproduces one capture-blocking mechanism:
when the saved desired timer is 20 minutes but the validated active Windows timer
is 10 minutes, the previous mapping disables preparation throughout the actual
pre-idle window. Preparation now uses the actual timeout returned only after the
existing selected-saver, enable, session and input-desktop checks. Actual timeout
changes invalidate pending and active frames without reopening a consumed input
epoch. No Windows timer, saved preference, installed app or native artifact changes
are part of this source fix.

The regression fails with the previous mapping and passes with the correction.
Source-only Windows checks pass: 47 preparation-policy and six actual production
context-comparison assertions, existing fake lifecycle/claim/runtime tests and
synthetic RAM-only encoding. Both production binaries compile without execution.
This confirms a blocking source mechanism, not the exclusive cause of black
pixels or actual capture/claim/render acceptance. #519 remains open.

## Workspace native-scroll fixture readiness (#523)

The first PR #529 Browser run (`40057144646`) passed 20 of 22 suites, with
Workspace and Motion-preview failures. That failed evidence is retained.
On unchanged production source, 32 ms of virtual clock frames could precede native
scroll delivery and read the alert's old position over Done. A native rendering
turn delivers the scroll handler and places the alert clear of Done before paint.
The fixture now waits for that delivery before its existing strict geometry and
centre-hit checks. A held-delivery regression fails with the old virtual-only
wait and passes with the barrier. All 19 Workspace groups pass; no product UI,
geometry tolerance or timing guard changed. Combined review and fresh CI remain
required; the prior failed job was not rerun unchanged.

## Motion-preview fixture readiness (#530)

The unchanged production renderer's 550 ms Clock entrance runs on CSS time,
independently of the editor's movement clock. A controlled synthetic browser
probe reproduced CI's exact backward-seek mismatch at 123 s: Clock float Y was
0 px during the entrance and -1 px after it, while every other frame field matched.
The fixture now waits for that finite entrance to finish before comparing seeks;
it leaves controlled swaps, infinite glyph loops and complete frame equality intact.
The controlled settled probe replays all six reverse seeks exactly, and the full
Motion-preview suite passes its five check groups. This fixture correction keeps
runtime and native sources unchanged; these source checks do not establish
installed screensaver acceptance.

## Active PR reconciliation (#517, #519)

PR #518 has resumed. Its integration includes PR #522's corrected toolbar source
at `8310497` and merged pre-idle snapshot source `7771b178`, preserving the
Home/Edit display/Settings roles and the newer reminder focus, native capture and
teardown safeguards. It includes PR #522's reviewed main merge `943c54fc`.
Final pushed-head review and CI are still required.

The scheduled preview now admits frames using the effective visual and a composite
configuration generation. An unobserved on/off/on interval, schedule edit or
override expiry invalidates a pending/in-flight frame. A scheduled off interval
keeps the same disabled worker so it cannot reset one-attempt input history.
Explicit idle disable still stops the child and revokes its private capability.
Preview fields belong to saved visual styles; idle enablement and Windows
selection remain independent global gates.

PR #522's compatibility repairs are tracked in #527. Mobile action errors update
their placement on scroll, focus and layout changes, and an empty location
status no longer consumes Weather's available space. Free-size focus checks now
use the top Style/Save toolbar; Home's keyboard order includes its contextual
help. The first-run checks select city results from their listbox and budget
only the measured persistent toolbar height beyond the earlier internal-scroll
contract. All 44 px row targets, center hit tests and body-overflow checks remain.

The backend integration passes 64 targeted tests, including clearing active bytes
after a missed off interval or an unreconstructable clock gap. Production build
and both TypeScript checks pass. All 554 combined unit tests pass with no skips.

The editor again consumes Home's Make-room query once without losing the selected
picker widget. Picker samples retain the existing rendered 9 px text requirement
(all 13 Catalog-time groups pass, smallest sample 9.4 px). Reminder arrangement
checks use the actual movement timeline's interval controls while retaining all
geometry, anchoring and fitted-row assertions. Home/Settings desktop and editor
mobile renders were inspected in RAM with synthetic data.

The frozen full 25-suite run at `df53cf7` finished 21/25 in 2121 s. Its failures
were the earlier #527 short-window alert, Home modal Tab focus, a no-op motion-tab
transition check, and the rain color hook's equivalent hex/RGB serialization.
It remains dated diagnostic evidence. The corrected integration
passes Studio (29 groups, 66 s), Workspace (18, 53 s), Styles (15, 22 s) and
Free-size (13, 33 s), with a synthetic 390-by-480 alert render inspected in RAM.
The aggregate, independent final-head review and applicable CI remain acceptance
gates. Earlier recorded failures remain diagnostic evidence.
No installed files/data/settings or sealed native artifacts changed; source checks
do not establish actual screensaver or screenshot-content acceptance under #519.

A further keyboard continuation exposed a help tooltip consuming a newly opened
dialog's Escape during its blur grace period. Help now consumes Escape only
while its own trigger/tip owns focus. A controlled-clock regression fails with
the old handler and passes with the correction; all three context-help groups
pass, including the existing trigger-focused parent-preservation checks.

The first integrated CI run passed 18/19 browser suites and exposed an
over-conservative alert-row rule hiding a short-window Save failure. The alert
keeps its floating visibility behavior while placement follows synchronous
captured scroll events and observed canvas/toolbar resizes. The unchanged Studio
visibility and Workspace control-clearance checks cover both requirements.
The corrected source passes Studio (29 groups, 59 s), Workspace (18, 52 s) and
Styles (15, 20 s) together, including long errors without a floating/inline loop.
Direct geometry updates preserve any pending animation-frame ID so unmount can
still cancel the scheduled resize/focus update.

Independent review also reproduced #515's glyph-loop lifecycle issue: returning
from the movement timeline left the same mounted Lively weather loop paused.
The timeline now restores only the CSS loops it borrowed, including their prior
clock and running/paused state; cancelled or replaced glyphs release their
ownership entry on the next draw and are not revived.
The real-browser regression fails before the correction and passes afterward;
movement preview and context help pass together (6 s and 7 s); the replacement
ownership extension passes movement preview again (7 s).

The frozen aggregate also exposed Home focus reaching browser chrome after a
complete Tab cycle in an open modal. Home sheets now wrap ordinary forward and
reverse Tab at their current visible, enabled boundary controls, retaining native
modal dismissal and browser modifier shortcuts. A bounded real-browser probe
fails at Tab 12 before the change and passes 30 Tabs in each direction plus
Escape focus return afterward. Motion's tab-indicator check now changes away
from the editor's default Widgets tab before measuring the Widgets transition;
a bounded probe confirms the former no-op and the corrected left/right slides.
The full affected Home continuation passes (223 s), including offline retry and
the strengthened focus guard; context help passes (10 s). Motion on frozen
`27ca78d` fails after the corrected editor-motion checks at its unchanged
full-board TaskDuration guard: 0.1603 s above Off, against 0.15 s. Its later GPU
frame-budget and 70-second stages were not reached; this is not a Motion pass.

Typed schedule color properties serialize the rain hook as `rgb(115, 177, 171)`
rather than the equivalent `#73b1ab`. The palette check resolves the hook to a
computed color and compares the same exact palette value. No expected colors,
paint audits, geometry or timing assertions changed. The complete corrected
Palette continuation passes (72 s), including the equivalent root Sand and
canvas-tone property checks; persisted hex values remain exact.

One predeclared identical-fixture comparison measured main `943c54fc` at 0.1096 s
and candidate `3f752a8` at 0.1410 s for the same full-board Lively-minus-Off
TaskDuration delta. That candidate delta is 0.0314 s above baseline with 0.0090 s
headroom. It does not prove causality, cost neutrality, a budget exemption or a
Motion-suite pass. The original failed run and bounded diagnostic are tracked in
[#528](https://github.com/8roundshock/living-room-display/issues/528), separately
from #364's ongoing-animation decision. Motion stays in the scheduled set and
its guard remains unchanged; the complete 25-suite aggregate is not green.

The following entries retain their historical checkpoint scope.

## Historical paused integration checkpoint (#517)

Work is paused with PR #518 still a draft. Its corrected source is checkpointed,
but final independent approval, corrected RAM render inspection and the full
25-suite aggregate are outstanding. The six-suite run at `494b096` passed Studio,
Workspace, context help, movement preview and Screen; Home stopped at an obsolete
88px action-size assertion for the intended 64px compact design. The corrected
Home continuation was interrupted and establishes no result. Synthetic Windows
unit fixtures passed; no new installation or native acceptance is claimed.

PR #507 is merged as `c7c00b47b2c69514787645c8f28adfe44cbf2d75`.
Its ten published-head checks passed; the final local aggregate was 19/20 with
Motion's repeated renderer-task-time budget finding tracked as P3 #364. Do not
interpret the historical local sections below as current running-test or
installation evidence.

PR #518 integrates the preserved saved-style toolbar and compact copy, predictable
Manage style dismissal, a Home/Edit display/Settings split, scheduled styles (#514),
deterministic movement preview (#515), and picker discovery (#516). Home keeps
reminders/daily actions and a compact display summary. The editor has visual
Style/Widgets controls; Settings owns weather, global preferences, schedule and
recovery. Existing saved data is not migrated or seeded.

The integration also keeps failed drafts and recovery confirmations, restores an
enabled retry control without stealing another chosen control, guards meaningful
Home drafts across close/reopen and navigation, and requests manual-editor weather
without activating hidden providers for ordinary scheduled-display reads. Browser
suites target the actual destinations and use synthetic device-status responses;
their real geometry, focus, touch, concurrency and performance assertions remain.

PR #518 records exact pushed-head validation, failed diagnostic runs, independent
review and merge status. A production build, full units, the complete applicable
browser aggregate, independent final-head review and applicable CI are required
before source acceptance. Local installation and physical/native acceptance are
separate evidence; this source checkpoint makes no new claim about either.

## Editor style workflow (historical local checkpoint before #517)

The top Style toolbar now holds saved styles, virtual Phone/Room/Night starter
looks, and one Save/Cancel group. Save changes updates the selected style under
its existing ID; Save as new creates a separate record without changing the
original. Rename/delete management stays beside the selector. No schema migration,
default-style seeding or changes to native installation are involved.

Switching with visual/naming drafts asks whether to keep editing, discard or save
before switching. Save retains the existing atomic all-editor-drafts transaction,
with a concise scope line for weather/photo/other settings. Captured requests keep
their target, late edits survive acknowledgement, and generated style snapshots
never become hidden draft edits after a failed save. Changed/deleted targets and
new duplicate names are checked against refreshed data before retry. Reload style
offers explicit recovery without discarding unrelated drafts. Related existing
reports: #428 (save status/name validation), #488 (style labels after rebase), and
#472 (starter looks preserve Follow daylight).

Production build and 487 unit tests passed. On the final UI revision, Styles
(15 groups), Studio (29), Workspace (18) and context-help (3) passed. The style
suite covers failed-save recovery, concurrent changes, stable identity, reload,
reset, keyboard controls and a readable selector at 320 px. The original Motion
editor block also passed its three checks; the full performance suite was not rerun.

Before the last selector-width and short-window alert fixes, Catalog sky (7),
Catalog time (12), Daylight (7), Reminders (24), Palette (17), Editor sync (10) and
Screen (8) passed. That combined run retained a Workspace failure; the final
focused run verified its correction. A polling test's clock was moved before app
startup to remove a real-timer deadline race, preserving its recovery assertions.
Final synthetic desktop/mobile renders were inspected in RAM. Short windows keep
action errors in their normal, announced and dismissible row. This is a local
checkpoint, not a publication or installation claim.

## Compact context help (local checkpoint)

The local `codex/tighter-ux-copy` branch starts from reviewed integration `3f79e9b`.
Home and Edit display now keep secondary directions behind four contextual info
controls: full screen, layout editing, animation and keeping the screen awake.
Each supports hover, keyboard focus and tap/click, with Escape and outside dismissal.
Home's display caption, movement summary, saved-style hint and picker footer are
shorter. Errors, reduced-motion status, power conflicts, privacy and destructive
action consequences remain visible.

The full-screen help uses the universal display shortcut instead of assuming a
Start-menu entry exists, addressing the copy problem in [#422](https://github.com/8roundshock/living-room-display/issues/422).
It does not change native behavior, Windows settings, presets or saved data.
This is a local source checkpoint; installation and publication are separate steps.

Verification on this source: production build passed; Screen (8 groups), Studio
(29), Workspace (17) and context-help (3) browser checks passed with synthetic
data. Desktop and narrow Home/editor renders were inspected in RAM. The Motion
suite's copy assertion now opens the same help exercised by the focused checks;
its performance run was not repeated for this UI-only change.
## Widget discovery continuation (#516)

The isolated picker change adds catalog search, All widgets / Not added / On display
filters, result counts and an empty-result reset while preserving the grouped rail
and one real synthetic sample. Size choices survive filtering; added states follow
the current draft. Rail keyboard help and accessible family footprints address #430.
The shared room solver now explains unavailable sizes and offers explicit draft fixes
before Add (#448), without changing the board during browsing.

The preserved source checkpoint is published on `codex/widget-picker-next` for
integration under #517. Production build and 16 catalog/make-room tests pass.
The first extended catalog run caught inherited 34/36 px target sizes overriding
the picker's 44 px contract; scoped selectors correct that. Catalog-time and
free-size then pass 13 groups each. A later integration adjustment preserves the
current editor's detail-content scroller and pins Add outside it. Its first check
caught room-fix actions preceding Add in the keyboard order; restoring Add before
those actions preserves the established short tab path. The final responsive/browser
and independent rendered checks remain pending. No merge,
installation or activation is implied by source checks.
## Movement preview continuation (#515, #517)

The published `codex/motion-scrubber` checkpoint preserves the original local
corrections: first-composition history matches the live renderer, the synthetic
range helper dispatches real input/change events, and ink geometry accounts for
the preview's scaled slots. The original dirty patch is retained privately under
`.local/` before committing. Production build and 15 focused float/timeline tests
pass. The new isolated browser suite, responsive rendering and independent final
integration review remain pending; no installed display or native test was run.

## Motion preview timeline (#515)

The isolated feature adds a paused editor timeline for content float and widget
swaps, using shared runtime float targets and glide keyframes, with deterministic
replay of arrangement history. Windows of 4, 12 or 24 intervals include the final
transition and explicitly do not claim a short repeating cycle. Preview time is
local to the editor; saved settings and an open display are unaffected.

At this implementation checkpoint, all 15 focused float/timeline unit tests pass.
The initial implementation built successfully; the latest extraction and browser
test additions still require final build and browser/visual verification. The new
`motion-preview` browser suite awaits central runner registration during feature
integration. No native installation or activation is established by this feature.
## Scheduled styles continuation (#514, #517)

The sidecar model/API and Settings/Home component split are published on
`codex/scheduled-presets`. Configuration belongs to Settings; Home's compact
status offers a one-hour saved-manual-style override and Return to schedule.
Manual settings remain the editor source while only the effective display gets
the selected saved visual. Reduced motion removes scheduled colour/brightness
transitions. No schedule or saved style is created for an existing user.

The production build and all 490 unit tests pass at this feature checkpoint,
including boundary/DST/priority/missing-style/override/restart coverage and frozen
reader checks on canonical state, backup and export while scheduling is active.
The original Editor-based browser suite must be adapted to the integrated Settings
route and Home controls; final browser/rendering and independent review remain
pending. These source checks establish no installation or native acceptance.
## Pre-idle snapshot source work (#525)

Work is in progress on one private RAM-only snapshot attempt per eligible input
epoch, 30 seconds before the configured Windows idle threshold. A prepared image
expires after 90 seconds unless an authenticated native activation claims it.
Cold/replacement workers establish a baseline and wait for new input; early,
late, expired or uncertain activation is unavailable. This is an earlier-frame
feature, not proof of the remaining black-thumbnail cause in #519.

The source includes the private backend pending store/supervisor, separate
non-display native preparer, OS-identified pipe claim and build/package/control
lifetime integration. Typechecking and server/client build pass, alongside all
505 unit tests. `windows/tests/Test-PreIdleSource.ps1` compiles both production
binaries without running them and passes 29 preparation/order assertions, 29
injected claim/lifetime assertions, five scalar framing assertions, six synthetic
encoding cases, eight fake host lifecycle cases, active-input/surface regressions,
32 fake runtime contracts, mocked preparer lifecycle and nine static installer
policy groups. CI and independent final-head review are still pending.

No installed app/data/settings or sealed native artifacts have changed; no
watcher, desktop capture or native display was launched. Installed and actual
automatic-screen-content acceptance remain separate under #519. This source
feature does not establish the cause or resolution of the observed black image.

## Last screen encoding correction (#519)

The native snapshot now uses an opaque RGB capture surface and RGB thumbnail.
The previous ARGB surface let zero high bytes in GDI color data become transparency
during scaling, erasing otherwise valid RGB. A synthetic regression through the
production encoding helper failed with the previous formats and passes with the
correction, preserving black and colored pixels with decoded alpha 255. Four
size/scaling cases and two cancellation cases pass; host compilation, eight fake
startup/lifecycle scenarios and the active-input regressions also pass.

These are source checks only: no desktop capture, native display activation or
installed files changed. The reported blank/unavailable automatic screensaver
scene remains unverified; a secure screensaver's desktop context is a separate
possible cause, and this correction does not open or switch desktops. Session
exit still clears the RAM-only snapshot. Review and runtime acceptance remain
tracked in [#519](https://github.com/8roundshock/living-room-display/issues/519).

### Reminder focus follow-up (#521)

A queued next-row focus move now respects a newer focus choice. The deterministic
regression holds the delete callback until the new Undo is focused; the previous
source moved focus back to a reminder row, so expiry could not hand it to Up next.
With the correction, Undo keeps focus and expiry still moves it to the list switch
within the unchanged timing budget. Ordinary row handoffs and explicit Undo
restoration remain covered by the full reminders suite.

Build/typecheck, nine pure reminder unit tests, all 24 reminders browser groups
(43 s) and all six preview groups (14 s) pass. Browser checks use temporary
synthetic data, ephemeral loopback servers and mocked Windows status, with images
in RAM only. The earlier failed CI run is retained as evidence; the corrected head
still requires fresh independent review and CI before merge. This does not establish
installation or native screensaver acceptance.

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
