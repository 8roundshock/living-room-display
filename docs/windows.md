# Windows host

A small .NET Framework `.scr` host launches Microsoft Edge to render `/display`.
`windows/Build-Host.ps1` uses the Windows Framework compiler; no SDK, native
package, administrator installation or always-running idle watcher is required.

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
activate. A 1.2-second launch grace prevents the activation key from dismissing
it. A per-user mutex prevents simultaneous ambient sessions. Session lock,
logoff and disconnect close the display. A named event scoped to the installed
helper path lets `Stop` ask it to exit normally.
Session observation starts before cold server startup and handshake. A cancelled
startup aborts pending HTTP, clears the image, skips later capture/kiosk steps,
and releases its event subscription. Cancellation also closes an already-created
owned browser job; failed startup and ordinary exit share cleanup.

Edge starts suspended, is assigned to an owned Windows job, then resumes. The
job uses `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so dismissal and helper crashes
terminate only that browser process tree. No global Edge/node kill, window input
injection, audio change or media key is used. The backend lives independently.
Scripts validate PID, executable path, command line and process start time before
stopping it. Source runs and other apps are not adopted.

The standalone `/display` document uses scoped `cursor: none`, including loading,
error and descendant controls. The class is removed on unmount; the editor and
its embedded preview keep ordinary cursor behavior. No global Windows cursor
counter, cursor image, registry setting or input hook is changed.

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
checks (`-NodeExe '<node.exe>'`). Eleven check groups with Node (ten without) pass
on PowerShell 7 and 5.1, including successful final cleanup; use process-scoped
`-ExecutionPolicy Bypass` where script policy requires it. These include seven native lifecycle scenarios using the production
startup coordinator with delayed fake transport/synthesized session ends, plus
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
The last verified installed baseline on 2026-10-18 is clean `7e654fd`, the normal
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
The optional `windows/tests/Test-CursorBrowser.mjs` production Edge regression
passes actual computed-style checks for loading/error, viewport edges, widget
controls, display-to-editor navigation, the embedded preview and a new display
tab. Synthetic state is intercepted in an isolated headless browser; it neither
changes app data nor establishes the visible native cursor state.

Independent static review approved source `eba70fc` before the earlier runtime QA;
later merged application changes also passed their final-head reviews and CI.
The native cursor replacement is a separate, uninstalled candidate in
[draft PR51](https://github.com/8roundshock/living-room-display/pull/51), reviewed
at combined head `f4a57b5` with both CI jobs successful. Its integrated runtime
gates still apply; the repository stays private and this PR is not deployment evidence.

## Actual current-PC runtime evidence

The clean `7e654fd` installed web baseline is verified as described above; no
combined-host native acceptance was performed during that update. Earlier actual
native preview source/content and readability on the 3840x2160 primary were
accepted under
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
The user is away as of the latest 2026-10-18 handoff. Wait for fresh readiness
before physical tests; do not launch native tests, capture or input, change the
installed app/data, or alter idle/TV settings during unattended source work.

Cursor bug [#36](https://github.com/8roundshock/living-room-display/issues/36):
the user reported a bright white pointer, and native readings confirmed a visible
glyph despite correct standalone CSS. WGC may omit the cursor. The independent
surface prototype has positive sampled evidence, but PR51 is candidate-only;
integrated normal, visual, real-input, focus/failure and restoration checks remain.
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
