# Windows host

A small .NET Framework `.scr` host launches Microsoft Edge to render
`/display?native=1`.
`windows/Build-Host.ps1` uses the Windows Framework compiler; no SDK, native
package, administrator installation or always-running idle watcher is required.

The lifecycle below describes the proposed replacement in
[draft PR51](https://github.com/8roundshock/living-room-display/pull/51), not the
installed helper. See [verification](#verification) for the dated installed
baseline and remaining integrated runtime gates.

## Entry points and lifetime

- `/s` or `--display`: ensure the installed backend is owned/ready, capture one
  last-desktop thumbnail if enabled, then launch the isolated Edge kiosk.
- `/c` (also `/c:<handle>`) or no argument: start the backend and open `/editor`.
- `/p <parent HWND>` (also `/p:<handle>`): draw a dim, capture-free placeholder
  in the Windows screensaver preview; no Edge/backend is launched.
- `--check`: verify Edge can be found; no display or capture.
- `--test-display`: display with automatic dismissal after eight seconds, for
  bounded integration verification. Capture still follows the preview setting.

The helper observes input to dismiss an active display, not to decide when to
activate. One fixed input baseline is captured before startup; genuine input
cancels startup or dismisses the display, including its first second. A per-user mutex prevents simultaneous ambient sessions. Session lock,
logoff and disconnect close the display. A named event scoped to the installed
helper path lets `Stop` ask it to exit normally.
Session observation starts before cold server startup and handshake. A cancelled
startup aborts pending HTTP, clears the image, skips later capture/kiosk steps,
and releases its event subscription. Cancellation also closes an already-created
owned browser job; failed startup and ordinary exit share cleanup.

Edge is atomically assigned to an owned Windows job at suspended creation, then
resumes after a cancellation check. The
job uses `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so dismissal and helper crashes
terminate only that browser process tree. No global Edge/node kill, window input
injection, audio change or media key is used. The backend lives independently.
Scripts validate PID, executable path, command line and process start time before
stopping it. Source runs and other apps are not adopted.

Ordinary browser `/display`, including fullscreen, keeps its visible pointer and
F fullscreen toggle. Explicit `native=1` presentation hides the document cursor
through loading/errors and descendants and omits browser navigation/shortcuts.
Native kiosk startup also needs its own input surface: the stationary Edge cursor
was empirically still visible despite the earlier document CSS alone.

The fullscreen host creates one independent, borderless primary-display window,
initially opaque black. It establishes NULL cursor only over its own foreground
client, through its initial handler and WM_SETCURSOR. A 50ms native-only poll
requires actual hit-root, physical full-primary bounds, readable NULL cursor and
helper/job-owned foreground before launching Edge. Exact loaded Edge readiness
and a fresh ownership check permit alpha1 reveal; alpha0, color-key transparency
and WS_EX_TRANSPARENT are not used. Loading that never becomes ready closes after
15 seconds. Renderer loss, foreign/NULL foreground, visible cursor, input, stop
or cancellation hide the surface and end its exact browser job. No timer repairs
cursor state or forces focus. HTTP cleanup follows hiding/disposal of the surface.

Cross-queue WM_ACTIVATE is asynchronous: its next-window hint can be NULL/stale.
One fresh actual foreground sample controls immediate closure; the mandatory poll
also catches a later Edge-to-foreign transition. The fullscreen surface has no
external owner/parent and never attaches input queues. The unchanged /p placeholder
uses the conventional Windows control-panel parent; it is separate from fullscreen.
There is no ShowCursor counter change, system cursor replacement, borrowed cursor
retention/destruction, pointer movement, input injection or global hook. Natural
desktop cursor restoration needs actual measurement. The editor keeps its normal
pointer. Unexpected UI-thread errors close instead of displaying a modal dialog.

## Preview and privacy

The helper captures the primary display once with `CopyFromScreen`, before any
ambient browser exists. It scales to at most 640 by 360, encodes PNG into a
`MemoryStream`, uploads to loopback, and disposes pixel buffers. No screenshot
file, history, capture log or image export is implemented. DPI awareness makes
bounds physical pixels. This is last state, not live capture.

A memory-only token obtained through `/api/host/session` authenticates upload and
delete; browser-origin requests cannot retrieve it. Preview responses use
no-store. Tokens/pixels never enter settings, reminders, backup or diagnostics.
Dismissal calls DELETE; server age expiry, preview disable and process exit also
clear pixels. If the host is forcibly killed, server expiry bounds retention;
stopping the server clears RAM.

The snapshot may contain anything visible on the primary desktop. Minimized apps
are not captured separately. Protected content may be black/unavailable; failed
capture omits preview. No elevated access, protection bypass or locked-desktop
capture is attempted. Capture precedes display creation to avoid recursive
previews. Multi-monitor selection and live capture are not built.

## Idle and security

Native Windows screensaver activation is preferred over a blind idle timer:
media/game apps can inhibit the system screensaver. No background service,
scheduled task, startup entry or global input hook is installed. `EnableIdle`
saves the previous per-user screensaver/timeout and selects this app;
`DisableIdle`/uninstall restore it when this app remains selected. Lock-on-resume
is never edited. Managed policy is not overridden. This is a visual screensaver,
not a lock-screen replacement.
If the user chooses None, clears the selection or selects another saver, restore
does not overwrite that choice or remove the saved backup.

Not every player/game necessarily inhibits screensavers. Test the actual apps,
including fullscreen video, controller-only games, presentations and lock/resume.
Keep automatic activation off until those tests pass. A manual smoke test cannot
establish them.

## Verification

Observed 2026-10-18: Windows 10 Pro 10.0.19045 x64, existing Edge, Framework
v4.0.30319 compiler, PowerShell 7 and Windows PowerShell 5.1. Helper compilation,
`--check` and invalid-parent preview exit were exercised. The control script
parses under both PowerShell engines. Run `windows/Test-Windows.ps1` for native
compile/argument checks, cleanup containment including nested junction refusal,
malformed/unrelated PID refusal, and optional real process/start-time ownership
checks (`-NodeExe '<node.exe>'`). The merged baseline passed eleven groups with
Node (ten without) on PowerShell 7 and 5.1, including final cleanup. Proposed PR51
source has thirteen groups with Node (twelve without), adding fixed caller-input
baseline and surface-policy suites. Its eight fake native lifecycle scenarios use
the production startup coordinator with delayed transport/browser operations and
synthesized session ends. Active-input tests cover genuine first-second input,
delayed startup cancellation, in-flight callback disposal and serialized old RAM
cleanup. Use process-scoped `-ExecutionPolicy Bypass` where needed. There are also
four real restore-function scenarios with mocked registry/file/SPI boundaries
(missing, empty, other and owned selections).
Retained-data uninstall/reinstall and failed-update regressions exercise real
filesystem transactions with external build/runtime/process/native boundaries
mocked. Cleanup deletes only the verified test junction without recursion and
checks that its target survives. These tests use scoped synthetic fixtures and
a sleeping child; no real app installation, capture, kiosk or settings change.
An actual child PowerShell `-File` invocation verifies default parameter binding
reaches the missing-install guard; dot-sourced tests alone do not cover that path.
Source provenance checks use synthetic local Git repositories to verify clean,
dirty, archive, wrong-parent and composed-source results. Lifecycle fixtures
verify metadata refresh on successful install and retention after failed update
or uninstall. No paths, remotes, changes or credentials are saved in provenance.
The current installed baseline is recorded in [STATUS.md](../STATUS.md) (clean
`bedca44`, PR #70, on 2026-10-18). The preceding rollout installed clean `7e654fd`, the normal
merge of PR #57. Its 79 application tests, full production build, independent
final-head reviews and Windows/Linux CI passed before rollout. The
[dated rollout evidence](https://github.com/8roundshock/living-room-display/pull/57#issuecomment-6253029701)
verifies installed provenance, owned backend/listener, health, served asset hashes
and unchanged private data after the owner confirmed a clean editor and authorized
the update. A complete private pre-revision-2 data recovery copy was verified;
retain it for the [matching app/data rollback](install.md#widget-geometry-revision-2-update-and-rollback).
No native launch, capture, editor reload or screensaver registration accompanied
that rollout. This documentation correction adds no live probes. Recheck current
provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](install.md).
A later marker-only read reports clean `bedca44e` after PR #70, installed at
19:08:23 UTC. The coordinator has not rechecked current backend/served assets,
private data/backup equality or registration; see [current status](../STATUS.md).
The optional `windows/tests/Test-CursorBrowser.mjs` production Edge regression
checks that browser loading/error, viewport edges, widgets, editor/embedded preview
and new display tabs retain their pointer, while explicit native presentation
hides the document cursor. The reviewed UI source passed this isolated browser
check before its merge in PR57. Synthetic state is intercepted; this neither
changes app data nor establishes the visible Windows cursor state.

Independent static review approved source `eba70fc` before the earlier runtime QA;
later merged application changes also passed their final-head reviews and CI.
The native cursor replacement is a separate, uninstalled candidate in
[draft PR51](https://github.com/8roundshock/living-room-display/pull/51). Historical
combined head `f4a57b5` received independent source approval and both CI jobs passed.
The source-only refresh normally merges main `141af7c` (PR #70 readability and
PR #67 browser controls) while preserving Windows tree
`4b269ffc22624168955d651a15d91a7abffc51ee` unchanged. The new head needs its own
independent review and current-head CI; earlier approvals do not transfer.
The repository stays private, PR #51 stays draft/unmerged/uninstalled, and source
approval is not deployment or native acceptance. No new phase or screenshot
logging is introduced.

Historical `f4a57b5` preparation passed 79 application tests/full build, native
compilation, three pure C# lifecycle/input/policy suites and three mocked/synthetic
PowerShell restore/install/provenance suites. Those tests were not replayed as part
of this refresh. Current local validation is limited to source/tree comparisons,
diff/link checks and compilation into a new ignored source-check directory; the
compiled host is not loaded or executed. Hosted CI remains a separate check.

All frozen candidates and direct/r3 visual bundles keep their original bytes and
old `f4a57b5` / `7e654fd` pins. They cannot establish eligibility against the newer
installation. Future native acceptance requires a new identified candidate/build,
independent artifact/JavaScript-binding review, verified current backend/served
asset pins and fresh user readiness with a coordinated heads-up/GO. No operational
launcher or live binding is created by this source-only refresh.

## Actual current-PC runtime evidence

The clean `7e654fd` historical web rollout is verified as described above; no
combined-host native acceptance was performed during that update or established
by the newer marker-only `bedca44e` read. The separate PR #70 session's
[rollout receipt](https://github.com/8roundshock/living-room-display/pull/70#issuecomment-6253957062)
reports backup/data preservation, healthy API, matching served assets and unchanged
screensaver values. Those checks belong to that session, separate from the
coordinator's marker-only read; this source refresh adds no installed-service
requests or runtime probes. Earlier actual native preview source/content and
readability on the 3840x2160 primary were accepted under
[#46](https://github.com/8roundshock/living-room-display/issues/46): raw PNG and
rendered preview were inspected in RAM, normal exit cleared preview to 404 and
left zero owned display processes, and no screenshot files were saved. This
does not establish room comfort, cursor hiding or the proposed replacement host.

Earlier lifecycle tests on 2026-10-18 used source `eba70fc`, Windows 10 Pro 19045
x64 and the same actual 3840x2160 display:

- Per-user nonadmin install downloaded/checksummed official Node 24.19.0 and built
  the web/native app. The system Node 16.14.2 installation was unchanged. Installed
  editor/display routes returned 200; owned server on 4318 was healthy.
- Synthetic reminder add/edit/complete survived restart. Stop removed the owned
  listener; repeated Start retained the PID. Real update, previous-app rollback
  and restore were healthy. Uninstall removed app/runtime and retained data plus
  ownership marker; same-path reinstall preserved the data hash. Reinstall
  reused a cached copy of the already verified official runtime. Only the
  synthetic reminder was deleted afterward; user preferences were not reset.
- An actual 640x360 RAM PNG was emitted/inspected, followed by a WGC view of a
  returned window matched to the owned Edge PID/HWND. Black/dim clock, weather,
  forecasts and faint time-labeled last state were visible without recursion.
  Helper exit 0/stderr empty after 6222ms, within the eight-second test bound.
  The precise expiry cause was not isolated from input/browser dismissal.
- After exit, preview metadata was absent and image GET returned 404; helper and
  app-profile Edge process counts were 0 and the server remained healthy. No
  capture file was found. New PNG files were only Edge 128x128/448x448 static icons.
  Preview flags were unchanged.
- The original Windows screensaver settings stayed unchanged; this app's
  automatic idle activation remains off.

Native `/c` end-to-end cold startup was **not executed**: automatic approval review
rejected that optional test before action, stating only `blocked by policy`.
Do not infer this path passed from separate CLI cold Start/Stop and native warm
EnsureServer checks. This is an unverified path, not an established application
bug; do not route around the rejected test.

Pending: actual combined-source acceptance and a subsequent reviewed update for PR51,
fresh-account install, movie/game/screensaver inhibition, real lock/resume,
across-room comfort and multi-monitor behavior. The earlier native smoke test
does not prove these cases. The coordinator's last direct verification kept app
idle off with the original screensaver settings unchanged; the newer marker
read does not establish current registration or authorize activation.
Physical tests need the owner's fresh go-ahead. Until then, do not launch native
tests, capture or input, change the installed app/data, or alter idle/TV settings
during unattended source work.

Cursor bug [#36](https://github.com/8roundshock/living-room-display/issues/36):
the user reported a bright white pointer, and native readings confirmed a visible
glyph despite correct document CSS. WGC may omit the cursor. PR51 is candidate-only;
actual visual, real-input, focus/failure and combined-source checks remain.
The independently reviewed isolated prototype (binary SHA256 prefix `2861444F`)
completed a bounded run normally: initial sampled NULL ownership at 59ms over
the physical 3840x2160 client, job-owned Edge activation at 406ms, reveal at 1018ms,
and 28 consecutive qualified NULL-cursor readings with helper hit-root, loaded
pinned Edge and stable input. Bounded closure occurred at 8015ms without a
watchdog kill; baseline/post cursor and underlying foreground matched. RAM preview
cleared to 404, owned display processes were zero, and data/native preference
hashes stayed unchanged. An earlier observation failed from a proven
wait-before-drain pipe dependency; it remains failed. Neither run saved pixels.
These are sampled prototype results, not proof of this integrated binary,
every-frame startup flash absence or the remaining negative paths.

The first integrated frozen-candidate stationary round subsequently passed on
2026-10-18. Candidate source `3a492b0b206fa9fcd64904832db0530b4022ca4e` and old PR
head `43beadce917bf268ee56116b5d10b54f9fd2f597` share Windows tree
`084c79cb9d7c8c2bfe869a791312c36aeef9d115`. Its unchanged binary SHA256 is
`0425FE225139AC19A6AC5B3844D9FA5B64962C0857A7BDAD26D0D7ED47318317`.
A separately reviewed non-installation staging layout bound the unchanged
control to the canonical healthy owned `2e010f0` backend and a separate candidate
Edge profile. No second backend, installation marker, private state or token was
copied. One coordinated direct-runtime round produced 26 consecutive qualified
NULL-cursor samples, quiet input baseline true, helper exit 0, no forced stop and
complete empty stdout/stderr. Observation took 10,573ms including startup/cleanup
around the eight-second helper bound. Foreground restoration/context compatibility
passed; RAM preview cleared to 404 and owned candidate host/browser counts were
zero. Separate post-reads confirmed both saved data files, full settings, the
original screensaver settings and backup absence unchanged. No screenshots
or genuine input were used. This old-source result does not relabel the frozen
binary as the newly merged combined candidate or establish its visual/input
acceptance; reviewed UI assets must first be served by the canonical backend.

The early-input baseline defect [#50](https://github.com/8roundshock/living-room-display/issues/50)
also remains open, with its proposed fix only in PR51. Read-only
[`GetCursorInfo`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorinfo)
and [`CURSORINFO`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-cursorinfo)
provide cursor handle, visibility flags and screen position. Require a successful
read, NULL glyph and actual owned client/hit-root with live renderer and stable
input; a failed read or cursor-free screenshot proves no absence. Record context
and restoration separately. Earlier command preflights returned error 5 (access
denied) and current `Default` desktop `UOI_IO=false`, despite the user's normal
interactive desktop confirmation. Struct checks and a separate official window
inventory did not isolate a cause. An old partial candidate layout also failed
because the unchanged control treated it as an incomplete installation. These
failures remain historical evidence; the later successful integrated stationary
round supersedes them as the latest result. No desktop switch or guard bypass
was used. Recheck current artifacts, served backend and preservation state before
each newly coordinated bounded test; do not repeat the unchanged stationary test
solely to repeat its proof. Never open/switch desktops, dismiss security UI or
weaken guards. See
[diagnosis](https://github.com/8roundshock/living-room-display/pull/51#issuecomment-6249615459).

References: [Screensaver library](https://learn.microsoft.com/en-us/windows/win32/lwef/screen-saver-library),
[Edge kiosk](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode),
[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[Node release files](https://nodejs.org/download/release/v24.19.0/).

## Primary API basis for the proposed host

Checked 2026-10-18 for this Windows 10 implementation; recheck when Windows/Edge
or the host design changes. Microsoft documents
[SetCursor(NULL)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursor)
as removing the glyph while the calling window owns mouse input.
[WM_ACTIVATE](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-activate)
is asynchronous across queues and permits NULL hints.
[Layered window hit testing](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)
and [JOB_LIST at creation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
provide the implementation basis; style alone is not ownership proof.
[Thread DPI context](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext)
keeps native client/point checks physical without changing display settings.
These facts do not replace empirical startup, restoration or compatibility checks.
