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

Verified on 2026-10-18: Windows 10 Pro 19045 x64, existing Edge, Framework 4.x compiler,
PowerShell 5.1 and 7, physical primary 3840x2160. Current installed clean revision is
`d81c1e0`, including the reviewed Studio/grid, readable snapshot and reminder fixes.
Its owned Node 24.19.0 is isolated from the preexisting system Node 16. The original
blank saver/1200-second timeout/security 0 is preserved; automatic idle is off.

The new Windows surface integration is source-only pending exact-head independent
review, CI and separate runtime acceptance. Run `windows/Test-Windows.ps1`: thirteen
groups with optional `-NodeExe '<node.exe>'` (twelve without) cover compilation,
entry flags, eight fake transport/session/browser scenarios, fixed caller input
baseline and delayed-startup cancellation, surface policy, restore selections,
install transactions, provenance and scoped cleanup. Both PowerShell versions pass.
These tests create no UI/capture or actual screensaver selection. CI runs them on
Windows; the application has 71 tests and a full production build.

The production Edge browser regression separately checks real computed styles for
loading/error, viewport, descendants, editor/embedded preview and navigation.
It does not establish native cursor behavior. No prototype phase logging or
screenshot logging is included in normal product operation.

## Actual current-PC runtime evidence

- Earlier reviewed source `eba70fc` passed nonadmin official-runtime installation,
  CLI Start/Stop, real update/rollback, uninstall-retain/reinstall and synthetic
  reminder persistence. A RAM 640x360 PNG and actual 4K kiosk were inspected; exit
  cleared preview 404 and left only the independent server. Capture files were not
  created. That visual check did not establish cursor absence.
- Reviewed `d81c1e0` is installed clean. Source provenance, served assets, health
  and settings/reminder/photo preservation were checked during updates. The
  owner deliberately uses 24% preview opacity; other settings were preserved.
- Native `/c` end-to-end cold startup was not executed: automatic approval review
  rejected that optional test before action with only `blocked by policy`.
  It remains unverified. Separate CLI cold Start/Stop and warm-native startup do
  not prove it. Do not retry an equivalent route around that rejection.
- Cursor defect [#36](https://github.com/8roundshock/living-room-display/issues/36)
  was confirmed natively: stable loaded owned Edge still showed a nonNULL arrow;
  a one-time owned WM_SETCURSOR reapply completed but did not hide it.
- An independently reviewed isolated surface prototype (binary SHA256 prefix
  `2861444F`, not the installed helper) completed one normal eight-second bounded
  test. Initial sampled NULL ownership began at 59ms over the full3840x2160 client;
  actual job-owned Edge activated at 406ms while its message hint was NULL. Reveal
  occurred at 1018ms. Twenty-eight consecutive independent readings confirmed
  NULL cursor, helper hit-root, physical bounds, live loaded pinned Edge and stable
  input. The surface stayed alpha1 until bounded closure at 8015ms; helper exit 0
  needed no watchdog kill. Baseline/post cursor65541/SHOWING1, input and underlying
  foreground matched. RAM 640x360 preview cleared to 404, owned display processes
  were zero, server healthy, and settings/data/native preference hashes unchanged.
  An earlier prototype observation timed out and remains failed; its harness had
  a proven wait-before-drain pipe dependency, corrected and independently reviewed
  before the successful observation. Neither run saved pixels to disk.

Prototype evidence supports the sampled stationary lifecycle. It does not prove
the final integrated binary, every-frame flash absence, real input/Escape,
external focus/failed activation, renderer failure or session-cancel paths.
Those remain acceptance gates before resolving36 or enabling idle. Real lock,
movie/game inhibition, fresh-account installation, across-room comfort and
multi-monitor operation are also unverified. No public/signed release exists.

## Primary API basis

Checked 2026-10-18 for this Windows 10 implementation; recheck when Windows/Edge or
the host design changes. Microsoft documents [SetCursor(NULL)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcursor)
as removing the glyph, scoped to the calling window's actual client ownership.
[WM_ACTIVATE](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-activate)
is asynchronous across queues and permits NULL hints. [Layered window hit testing](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)
and [JOB_LIST at creation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
provide the implementation basis; style alone is never ownership proof.
[Thread DPI context](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext)
keeps native client/point checks physical without changing display settings.
[CURSORINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-cursorinfo)
flags are recorded alongside hCursor: NULL glyph is decisive; flags alone and
cursor-free screenshots cannot prove absence. These API facts do not replace
empirical startup/restoration and compatibility checks.
