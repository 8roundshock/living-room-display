# Windows host

A small .NET Framework `.scr` host launches Microsoft Edge to render `/display`.
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

The standalone web route retains scoped CSS cursor hiding for browser use,
loading/errors and descendants. Native kiosk startup needs its own input surface:
the stationary Edge cursor was empirically still visible despite that CSS.

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
The last verified installed baseline on 2026-10-18 was clean `d81c1e0`; its 71
application tests and the full production build passed using the app-owned Node
24.19.0. The reviewed Studio/grid, snapshot-readability and reminder corrections
were installed in that baseline. The
installation marker and HTTP health were rechecked on 2026-10-18; the rollout
separately verified served assets and data preservation. That documentation-only
recheck performed no GUI, capture or native/current-desktop probe. Recheck current
provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](install.md).
The optional `windows/tests/Test-CursorBrowser.mjs` production Edge regression
passes actual computed-style checks for loading/error, viewport edges, widget
controls, display-to-editor navigation, the embedded preview and a new display
tab. Synthetic state is intercepted in an isolated headless browser; it neither
changes app data nor establishes the visible native cursor state.

Independent static review approved source `eba70fc` before the earlier runtime QA;
later merged application changes also passed their final-head reviews and CI.
The native cursor replacement is a separate, uninstalled candidate in
[draft PR51](https://github.com/8roundshock/living-room-display/pull/51), reviewed
at `3a492b0` with both CI jobs successful. Its integrated runtime gates still
apply; merging current main requires a final-head independent recheck. The
repository stays private and this PR is not deployment evidence. Normal product
operation contains no prototype phase logging or screenshot logging.

## Actual current-PC runtime evidence

The last verified installed baseline on 2026-10-18 was clean `d81c1e0`, including
the reviewed Studio/grid, readable snapshot and reminder fixes. Actual native preview source/content and
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
  capture file was found. New PNG files were only Edge 128x128/448x448 static icons,
  plus the preexisting npm QR example. Preview flags were unchanged.
- The original Windows blank saver, 1200-second timeout and security 0 stayed
  unchanged; this app's automatic idle activation remains off.

Native `/c` end-to-end cold startup was **not executed**: automatic approval review
rejected that optional test before action, stating only `blocked by policy`.
Do not infer this path passed from separate CLI cold Start/Stop and native warm
EnsureServer checks. This is an unverified path, not an established application
bug; do not route around the rejected test.

Pending: actual integrated acceptance and a subsequent reviewed update for PR51,
fresh-account install, movie/game/screensaver inhibition, real lock/resume,
across-room comfort and multi-monitor behavior. The earlier native smoke test
does not prove these cases. Automatic idle remains off with the original blank
saver, 1200-second timeout and security 0 until explicitly authorized after QA.

Cursor bug [#36](https://github.com/8roundshock/living-room-display/issues/36):
the user reported a bright white pointer, and native readings confirmed a visible
glyph despite correct standalone CSS. WGC may omit the cursor. The independent
surface prototype has positive sampled evidence, but PR51 is candidate-only;
integrated normal, visual, real-input, focus/failure and restoration checks remain.
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

The early-input baseline defect [#50](https://github.com/8roundshock/living-room-display/issues/50)
also remains open, with its proposed fix only in PR51. Read-only
[`GetCursorInfo`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorinfo)
and [`CURSORINFO`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-cursorinfo)
provide cursor handle, visibility flags and screen position. Require a successful
read, NULL glyph and actual owned client/hit-root with live renderer and stable
input; a failed read or cursor-free screenshot proves no absence. Record context
and restoration separately. The last hardware preflight on 2026-10-18 aborted
before launch with immediate error 5 (access denied); the borrowed current Default
desktop was not receiving input. Minimal/observer x64 structs matched under
PS5.1/7. Exact lock/secure/switch cause is unproven. All native/current-desktop
probing stopped. Recheck only after the user returns to the normal interactive
desktop and cursor observation is available, with a new coordinated preflight/GO;
do not open/switch desktops, dismiss security UI or weaken guards. See
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
