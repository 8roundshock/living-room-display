# Windows host

A small .NET Framework `.scr` host launches Microsoft Edge to render
`/display?native=1`.
`windows/Build-Host.ps1` uses the Windows Framework compiler; no SDK, native
package or administrator installation is required. The installed backend can own
one non-display producer while automatic activation and Last screen are enabled
(#538). No service or scheduled task is added. An existing owned idle/Last screen
opt-in can register the exact per-user native sign-in command described below
(#540), with an explicit opt-out.

The lifecycle below is the source helper since
[PR #51](https://github.com/8roundshock/living-room-display/pull/51): its own
fullscreen input surface for the pointer
([#36](https://github.com/8roundshock/living-room-display/issues/36)) and one fixed
input baseline for dismissal
([#50](https://github.com/8roundshock/living-room-display/issues/50)).
[STATUS.md](../STATUS.md) records which revision is installed; native acceptance of
this helper is still pending (see [verification](#verification)).

## Widget-first native presentation (#539)

The native host keeps its black input cover opaque while Edge prepares. An
ordinary `Still · Display` title does not certify content readiness: it used to
appear even while state was loading. The native page alone now emits
`Still · Display · Ready` after state has mounted the ambient board, fonts are
ready and browser paint opportunities have passed. Only that marker can satisfy
the existing exact-job, window-class, full-primary-client and cursor checks.
Loading and initial error content stays covered; failed preparation retains the
15-second startup limit and immediate input cancellation. A later disconnected
state that still renders the saved board does not restart this entrance.

The native page has one 280 ms startup fade, disabled by reduced motion. The
readiness lifecycle does not restart during ordinary polling or widget movement.
This startup exception does not alter the always-on movement requirement (#436).

The owned kiosk command adds `--disable-backgrounding-occluded-windows` so it can
prepare frames behind the opaque input cover. This is a rendering switch scoped
to this one browser process tree, documented in [Chromium's switches](https://chromium.googlesource.com/chromium/src/+/lkgr/content/public/common/content_switches.cc)
and [GoogleChrome's tooling guide](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md)
(checked 2026-10-25; recheck on a browser/lifecycle change). It is not evidence that
Edge's actual native composition or #503's occlusion concern has been accepted.
The source repair's physical reveal, grey-screen report and pointer behavior
still need a current, separately authorized watched native check.

## Entry points and lifetime

- `/s`: ensure the installed backend is owned/ready, then show its canonical
  latest screenshot through the isolated Edge kiosk. Automatic startup neither
  captures nor claims a replacement of its own surface (#544).
- `--display`: ensure the backend is owned/ready, capture one last-desktop
  thumbnail if enabled, then launch the isolated Edge kiosk.
- `/c` (also `/c:<handle>`) or no argument: start the backend and open `/editor`
  (Edit display); `--editor` (the Start menu, desktop and Setup-finish shortcuts)
  opens Home (`/`, #438).
- `/p <parent HWND>` (also `/p:<handle>`): draw a dim, capture-free placeholder
  in the Windows screensaver preview; no Edge/backend is launched.
- `--check`: verify Edge can be found; no display or capture.
- `--start`, `--stop`, `--status`: control only this installation's backend without
  PowerShell (#117). Start opens no browser; Status writes `ServerRunning` and
  `Healthy` JSON. Stop leaves any display host alone; the control script's `Stop`
  remains the full display-and-backend shutdown used during updates.
- `--test-display`: display with automatic dismissal after eight seconds, for
  bounded integration verification. Capture still follows the preview setting.

The helper observes input to dismiss an active display, not to decide when to
activate. One fixed input baseline is captured before startup and never replaced;
genuine input cancels startup or dismisses the display, including its first
second. Manual `--display` launches follow the same rule
([#502](https://github.com/8roundshock/living-room-display/issues/502) tracks
checking that against the launching click). A per-user mutex (`Local\LivingRoomDisplay.Ambient`) prevents simultaneous
ambient sessions: `/s`, `--display` and `--test-display` exit at once when it is
already held, so the native host never starts a second display (#436). Session lock,
logoff and disconnect close the display. A named event scoped to the installed
helper path lets `Stop` ask it to exit normally.
Session observation starts before cold server startup and handshake. A cancelled
startup aborts pending HTTP, acknowledges preview cleanup, skips later capture/kiosk steps,
and releases its event subscription. Cancellation also closes an already-created
owned browser job; failed startup and ordinary exit share cleanup.

<a id="earlier-automatic-snapshot-525"></a>
### Periodic automatic snapshot (#538)

This is source behavior, separate from installation and native acceptance in
STATUS/#519. The installed owned backend supervises one distinct
`LivingRoomDisplay.Preview.exe` using a child-only capability on redirected stdin.
Source `npm start`, imported applications and test servers never opt in. The child
dies with its exact parent and Stop waits for it. For an already enabled owned
idle display with Last screen on, supported setup synchronizes an exact per-user
sign-in entry invoking the installed native `.scr --start` without a browser
(#540). New idle-off installations stay off. `EnableStartup`/`DisableStartup`
control the choice; AUTO creates no private-data preference file.

Owner decision, 2026-10-27 (#544): the first safely eligible observation captures
the full primary desktop, then a monotonic five-minute cadence refreshes one
canonical `InstallRoot/run/cache/last-screen.png`, downscaled to at most 640 by
360. Only the backend writes it, through a fixed temp and atomic rename. The PNG
mtime is set to capture time before rename; image readers use one open handle for
fstat metadata, dimensions and bytes. Failed capture/write keeps the last success
and original time. There is no in-place truncation, history or `.bak`.
No extra input after launch is required; ordinary input does not erase the file
or reset cadence. Fresh eligibility after invalidation captures immediately.

Capture requires this app's selected/enabled saver and an unlocked local console
session on the current Default input desktop. Unknown, locked, disconnected or
other-desktop contexts clear the cache. Actual saver state and the owned ambient
mutex exclude capture throughout ambient startup/display. A thirty-second band
on either side of the validated Windows idle threshold pauses copying; afterwards
an otherwise safe desktop can resume when video has inhibited the nominal saver.
Pre/post-copy checks and cancellation retain the same context/actual-timeout
requirements. No desktop is opened/switched and no power-request inventory is used.

The backend is the sole file/metadata authority. Child-secret safe observations
renew the ten-second producer lease; public reads cannot renew it. Unknown,
locked or disconnected context, configuration/disable, observation/clock loss or
producer loss deletes the file and invalidates arriving bodies. Cold backend
startup removes the prior unvalidated PNG and orphan fixed temp before capturing
again. Keep this private runtime cache outside Git, app/data and backups. This
one app-specific file is not permission to save agent/computer-use screenshots.

Browser and native state/image readers use that same file. Required
`sharedSnapshot:true` producer bootstrap starts no claim pipe; automatic `/s`
does no extra copy or private claim. Native handshake, normal exit and ordinary
input retain the file; privacy invalidation deletes it. The existing manual
capture's upload limits are unchanged. Child-only publishing, parent identity,
Host/Origin/Fetch Metadata/CORP and no-CORS guards remain.

A visible browser display establishes a separate capture pause before painting;
it does not disable safe producer heartbeats or erase the previous image.
Capture-revision checks fence uploads across pause transitions. A confirmed
hide/close releases the pause; missing release remains paused until the user
closes previews and explicitly resumes snapshots from Home. Fixed capture
events/counters stay in RAM, with no private strings or pixel logging.
The timestamp remains honest after a failed refresh. These source contracts and
CI checks do not prove installed capture, protected-content support or physical
native acceptance; #519 remains unresolved. Earlier RAM-only claim evidence is
historical, and native dismissal/cursor/deadline behavior is unchanged.

For source/CI safety, `LRD_PREVIEW_PREPARER_DISABLED=1` is a disable-only override
used by installer smoke checks. It cannot enable the watcher or bypass any guard.
Normal installed launch restores its scoped environment after spawning Node.

Edge is atomically assigned to an owned Windows job at suspended creation, then
resumes after a cancellation check. The job uses `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so dismissal and helper crashes
terminate only that browser process tree. No global Edge/node kill, window input
injection, audio change or media key is used. The backend lives independently.
The native runtime and control script validate PID, executable path, command line
and process start time before using or stopping it. Source runs and other apps are
not adopted. Native startup runs the app-owned Node executable directly, with the
installed data directory and fixed loopback port 4318; it never invokes a shell,
looks up Node on PATH, or changes an execution policy. It shares the control script's
operation mutex and `run/server.json` format, so either path can recognize and stop
the other's server. Health is accepted only with the loopback listener owned by
that exact process. A foreign listener is refused; cancelled or failed cold startup
stops only its newly launched, pinned child and removes only its matching record.

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
cursor state or forces focus. The off-UI input monitor marks cancellation terminal,
records exit intent and releases the exact renderer before synchronous
cancellation callbacks or HTTP cleanup can wait (#532). The UI poll checks that
terminal state before new window/cursor/renderer observations. UI stop and cleanup
also release the renderer before posting an asynchronous surface hide, without a
redundant synchronous `Form.Hide`. Normal disposal still serializes preview-cleanup acknowledgment (#505).

The six-second exit timer becomes eligible only after the one native host handshake
returns, before any own fullscreen surface or display stage. If cancellation came
earlier, eligibility arms it before even rejected-session cleanup can block. An
unresolved/aborted handshake is not force-terminated by this watchdog; cold startup
keeps its existing bounded HTTP/runtime cancellation behavior (#503). Concurrent
cleanup waits for renderer release completion; claiming disposal is not enough.
Only genuinely completed surface/session/HTTP teardown disarms the one-session
deadline. If expiry wins first, the helper requests `TerminateProcess` on its fixed
current-process handle, never a supplied PID, backend or foreign process. This
exists only for an already-requested `/s`, `--display` or `--test-display` session;
it adds no service, restart loop, focus/input repair or FailFast/crash dump.
Termination requests pending-I/O cancellation, so kernel/GPU recovery and exact
OS exit time are not guaranteed. A forced exit can interrupt best-effort HTTP clear.
Native startup also uses one ten-second monotonic budget for read-only installed
file, record, process-identity, listener and health observations (#546). A blocked
reader cannot keep the caller waiting indefinitely or turn unknown into permission
to launch. Observers own their own handles and may only close them when late;
the mutex, launch and record mutations stay on the calling thread. Cold-failure
cleanup separately budgets preparer discovery plus all parent/child waits within
ten seconds. Unknown discovery still requests termination only through the
revalidated retained server handle, reports incomplete cleanup and retains its
record; it cannot authorize child kills. This does not bound every synchronous
OS launch/write/termination call (#547) or establish physical recovery. It does
not enable the forced-exit timer before the handshake or change #534 ordering.
Each completed authorized handshake gets a new native-preview capability, so a
previous helper's delayed DELETE or in-flight POST cannot clear/replace the new
session's pixels. The pending pre-idle frame and preparer capability stay separate
and unchanged. Token rotation does not order older naturally cancelled or
externally killed handshake GETs; that availability limit remains in #534.
Readiness matches the owned Edge window by the display document's title
(`Still · Display · Ready`), so a change to that readiness title in
`src/client/nativeReadiness.ts` must also change `windows/SurfacePolicy.cs`
(selected by `NativeDisplay.cs`) until
[#444](https://github.com/8roundshock/living-room-display/issues/444) removes that
dependency.

Cross-queue WM_ACTIVATE is asynchronous: its next-window hint can be NULL/stale.
One fresh actual foreground sample controls immediate closure; the mandatory poll
also catches a later Edge-to-foreign transition. The fullscreen surface has no
external owner/parent and never attaches input queues. The unchanged /p placeholder
uses the conventional Windows control-panel parent; it is separate from fullscreen.
There is no ShowCursor counter change, system cursor replacement, borrowed cursor
retention/destruction, pointer movement, input injection, global hook or registry
setting. Natural desktop cursor restoration needs actual measurement. The editor
and its embedded preview keep their normal pointer. Unexpected UI-thread errors
close instead of displaying a modal dialog.

## One display window and keeping the screen on (#436)

Browser displays are kept to one window by the web app, not the host: the editor's
**Open display** reuses and focuses a window named `still-display`, and a display
opened any other way announces itself on a BroadcastChannel so older browser displays
close themselves, or show a card and stop polling (see [UI](ui.md)). The native
kiosk runs in its own Edge profile and job and takes no part; its mutex already keeps
it single. On the owner's PC the seven "Still · Display" windows of 2026-10-20 were
browser tabs: the earlier `target="_blank" rel="noreferrer"` link opened a new tab
on every click, and Esc turned each into another editor.

**Keep the screen on** (`screen.keepAwake`, on by default) is a Screen Wake Lock
requested by the display page itself (`useWakeLock.ts`), so the host needs no
change: it is held while the page is visible and either the native kiosk
(`native=1`) or full screen, re-requested after the browser releases it (for
example when the page is hidden) and on full-screen changes, retried at most every
10 s after a refusal, and released on dismissal, when the page is hidden or when
the setting is off. Edge implements it as a display-required power request, which
also blocks the Windows screensaver and display-off, so it is never held in a
windowed tab, where a forgotten display would keep the screen on. Headless Edge on
loopback (a secure context) grants it; the native host's own
`SetThreadExecutionState(ES_DISPLAY_REQUIRED | ES_CONTINUOUS)` hold for the whole
session is [#442](https://github.com/8roundshock/living-room-display/issues/442).
A wake lock cannot help when Windows turns the screen off or sleeps before the
screensaver starts, so `/api/windows/status` adds the active power plan's
display-off and sleep timeouts, read with `powercfg.exe /query SCHEME_CURRENT
SUB_VIDEO VIDEOIDLE` and `SUB_SLEEP STANDBYIDLE` (read-only, no administrator
rights, 2 s timeout; the last two `0x…` values are AC then DC whatever the display
language) and the plan name from `powercfg /getactivescheme`. The editor shows them
and warns when either comes before the screensaver wait. Verified read-only on a
Windows 10 PC on 2026-10-20: the plan name and both timeouts matched `powercfg`'s
own output.

## Preview and privacy

The owned producer copies the full primary display with `CopyFromScreen` on the
first safe observation and every five minutes while capture remains eligible.
It scales to at most 640 by 360, uploads the PNG to loopback and disposes pixel
buffers. The backend atomically overwrites one `run/cache/last-screen.png` outside
data backups; the browser and native widget read that same file. Privacy loss
removes availability immediately and attempts to unlink it. There is no history,
capture log or image export. DPI awareness makes bounds physical pixels. This is
last state, not a live view.

Capture uses `Format32bppRgb`, whose fourth byte is unused, and the thumbnail
uses `Format24bppRgb` (#519). GDI color data can have zero high bytes; treating
them as ARGB alpha made GDI+ scaling erase valid RGB. The synthetic
`DesktopSnapshotTests` exercises the production encoding helper with those
bytes, checks opaque decoded colors including black, the unchanged scaling
bounds and cancellation. See Microsoft's [GDI alpha explanation](https://devblogs.microsoft.com/oldnewthing/20210915-00/?p=105687)
and [pixel format definitions](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.imaging.pixelformat).

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

Windows may switch to a separate desktop before a secure screensaver starts;
an unsecured screensaver runs on the default desktop ([Microsoft desktop
documentation](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)).
Capturing before this app's surface exists does not establish capture before
that Windows switch. Manual `--display` evidence therefore does not prove
automatic `/s` can obtain the same source. The #519 encoding regression does
not establish the cause or resolution of a particular native blank scene.

## Idle and security

Native Windows screensaver activation is preferred over a blind idle timer:
media/game apps can inhibit the system screensaver. No background service,
scheduled task or global input hook is installed. The optional owned per-user
sign-in entry starts the backend early for the five-minute cache; it does not
activate the display or alter lock/security policy. `EnableIdle`
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

## Windows Setup and Windows 11

`LivingRoomDisplaySetup-<version>.exe` ([#77](https://github.com/8roundshock/living-room-display/issues/77),
[user guide](install.md#install-with-setup-recommended)) is a per-user Inno Setup
6.7 wrapper. Setup ships a prebuilt `LivingRoomDisplay.scr` with an icon and
version info, so **setup users don't need `csc.exe` at install time**. Only
source installs compile the helper. Setup runs the version-matched control script
(`InstallPackage`) with Windows PowerShell 5.1 from `{sys}` using a per-process
`-ExecutionPolicy Bypass`. A Group Policy execution policy, AppLocker or
Constrained Language Mode can still block it; Setup then shows a plain message
([#117](https://github.com/8roundshock/living-room-display/issues/117)).

### Windows 11 compatibility review (2026-10-18)

| Area | Windows 11 behaviour | Evidence and status |
| --- | --- | --- |
| Per-user install | `%LOCALAPPDATA%\LivingRoomDisplay`, no elevation (`PrivilegesRequired=lowest`, no override). Not MSIX, so there is no AppData or registry virtualization. | CI smoke on windows-2025 (Windows Server 2025 shares the Windows 11 24H2 base); a real Windows 11 desktop and a fresh standard account remain [#116](https://github.com/8roundshock/living-room-display/issues/116). |
| Setup UI | `WizardStyle=modern dynamic` follows the Windows light/dark setting at startup (Inno 6.6+). | Token checked against the Inno documentation; not inspected on screen. |
| SmartScreen and Smart App Control | Unsigned Setup shows **Windows protected your PC** (More info, Run anyway). Smart App Control blocks unsigned code with no override. | Owner decision on signing: [#115](https://github.com/8roundshock/living-room-display/issues/115). |
| `.scr` screensaver | Windows 11 still selects `.scr` files per user (`HKCU\Control Panel\Desktop`) through **Settings > Personalization > Lock screen > Screen saver**. Setup never selects it; `EnableIdle` stays opt-in. | Unchanged code path; idle opt-in after review: [#118](https://github.com/8roundshock/living-room-display/issues/118). |
| Edge kiosk | Edge is built in; `--kiosk --edge-kiosk-type=fullscreen` with an isolated profile and job object is unchanged. Setup warns if Edge is missing. | `--check` passes in CI. Kiosk use on a Windows 11 desktop is part of #116. Edge-free fallback: [#119](https://github.com/8roundshock/living-room-display/issues/119). |
| .NET Framework | 4.8.1 is built into Windows 11 and runs the AnyCPU helper. | CI runs `--check` on every smoke runner. |
| Windows PowerShell 5.1 | Present on Windows 10 and 11; used by Setup and the uninstaller. Native everyday startup uses no PowerShell. | CI runs `Test-Windows.ps1` under 5.1 and 7. |
| Port 4318 | Bound to 127.0.0.1 only, so there's no firewall prompt. A port already in use stops Setup with E11. | The CI smoke asserts a loopback-only listener and the E11 refusal; alternate port: [#121](https://github.com/8roundshock/living-room-display/issues/121). |
| Windows on Arm | `x64compatible`: the x64 Node runs under emulation; the AnyCPU helper runs natively. | Non-gating CI on windows-11-arm, recorded under [#122](https://github.com/8roundshock/living-room-display/issues/122). |
| Path length | Windows PowerShell 5.1 file APIs stop at 259 characters. Every payload path stays within 115 characters, so install folders of up to 130 characters always fit; InstallPackage refuses a folder too long for the payload before writing anything (E21). Both numbers come from `packagePathBudget` in the control script. | `Test-InstallerPayload.ps1` fails a payload over the budget; `Test-InstallerPolicy.ps1` checks that both docs quote the same limit; E21 unit test in `Test-PackageInstall.ps1`. |

### Inno Setup assumptions

| Assumption | How it was checked |
| --- | --- |
| `ExtractTemporaryFile` places each `dontcopy` file in `{tmp}` under its own name. | CI silent install: the helper runs from `{tmp}` and verifies `payload.zip`. |
| `Exec` keeps the `PrepareToInstall` marquee responsive. | Inno 6.7.1 source: `Exec` waits with `MsgWaitForMultipleObjects` and processes messages; `TOutputMarqueeProgressWizardPage.Animate` only pumps messages for the native marquee. The step timer (`SetTimer` + `CreateCallback`) fires in the same loop, and CI exercises it in silent mode. **Not visually inspected.** |
| The uninstaller's first phase waits for the second. | Inno 6.7.1 `Setup.Uninstall.pas` (`RunFirstPhase`): it waits for the second phase's signal or exit. The control script and smoke test still poll for the registration to disappear (up to 120 s). |
| `{param:REMOVEDATA}` is readable in the uninstaller. | CI: the `/REMOVEDATA=1` uninstall removes data, snapshots and the folder. |
| Raising in `CurUninstallStepChanged(usUninstall)` aborts the uninstall. | Inno 6.7.1 source (`Setup.Uninstall.pas`): the exception is logged as fatal and shown through `ShowExceptionMsg`, whose message box is suppressible, so `/VERYSILENT /SUPPRESSMSGBOXES` can't block on it; then `Abort`. The first phase exits with code 1 because the second phase never reports success. CI exercises it ([#158](https://github.com/8roundshock/living-room-display/issues/158)): the smoke test holds a file in `app` open, and the silent uninstall must exit non-zero within 5 minutes and keep the registration, the uninstaller, `installation.json` and data, and the uninstall log must carry the helper's `Failed:` reason and the abort message. Because the helper renames every folder aside before it deletes any ([#207](https://github.com/8roundshock/living-room-display/issues/207)), `app` must also stay complete. A repair with Setup then exits 0. |
| `TaskDialogMsgBox` custom labels (**Keep my data** / **Delete my data**). | Documented Inno API; interactive only. **Not verified in CI.** |
| `WizardStyle` tokens in 6.7.x. | Inno documentation: base `classic` or `modern`, plus `light`, `dark` or `dynamic`. |
| `ISCC.exe` has no numeric file version. | Observed in CI (version info read as 0.0.0). The build asks the preprocessor (`DecodeVer(Ver)`) instead. |
| Windows PowerShell 5.1 started (through Setup) from PowerShell 7 can inherit PowerShell 7 module folders. | Observed in CI: `Get-FileHash` was not recognized. The control script now keeps only Windows PowerShell module folders on 5.1 and hashes with .NET ([#123](https://github.com/8roundshock/living-room-display/issues/123)). |
| GitHub runners run Setup elevated with UAC on. | Observed in CI: the refusal of an elevated launch fired. The smoke test passes the automation-only `/ALLOWELEVATED=1`. Normal users still get the refusal. |

### Installer CI

`.github/workflows/installer.yml` runs on installer-related pull requests, pushes
to `main` and manual dispatch.

- **Build** (windows-2025): `Test-Windows.ps1` under PowerShell 5.1 and 7, the
  Inno version check (installs the pinned, hash-verified 6.7.1 if needed),
  `Build-Installer.ps1`, the payload checks, and the artifact (14 days). A pull
  request from a fork uploads no artifact and skips the smoke job, so an installer
  built from unreviewed fork code is never offered as this repository's artifact.
- **Smoke** (windows-2022 and windows-2025 gating, windows-11-arm non-gating,
  each with the default folder and a folder path containing a space and a
  non-ASCII character): records the before-state, then installs silently. It then
  checks the marker, the manifest, health and routes, `--check`, the
  loopback-only listener, the uninstall key and the shortcuts, and that the
  before-state is unchanged. Then it runs a synthetic reminder, a repair
  (snapshot, `app.previous`, `Status`), a keep-data uninstall, a reinstall and a
  `/REMOVEDATA=1` uninstall. Two refusal cases must exit 7: a foreign folder and
  a taken port.
- **Automatic rollback on a real install** ([#189](https://github.com/8roundshock/living-room-display/issues/189)):
  after the repair, the smoke test runs the rollback-test Setup (see
  [development](development.md#building-the-windows-installer)), whose real
  server reports the wrong version. It must exit 7 with `Helper exit code: 15`,
  leave `app` and `runtime` hash-identical to before, keep the candidate in
  `app.failed`, leave no `package-transaction.json`, restore
  `installation.json`, keep data unchanged and leave the previous version
  answering `/api/health`. A repair with the normal Setup then exits 0 and
  removes `app.failed`. Setup has to stop the real server before it renames
  `app`, but this case does not catch a `Stop` that returns early: each rename
  retries for a few seconds, which covers a server that is still exiting
  (checked on the owner's PC with Windows PowerShell 5.1: 1 of 20 first rename
  attempts failed straight after a kill, none after the retries). The guard
  against a `Stop` that returns early is the `HasExited` check of
  `Test-Windows.ps1 -NodeExe` in the build job, which stops a real owned server
  five times and fails if `Stop` returns before it has exited
  ([#205](https://github.com/8roundshock/living-room-display/issues/205)).
- **An older app.previous in use** ([#200](https://github.com/8roundshock/living-room-display/issues/200)):
  with a file in `app.previous` held open, Setup must exit 7 with
  `Helper exit code: 22` naming `app.previous`, leave `app`, `app.previous`,
  `runtime`, data, snapshots and `installation.json` unchanged and the server
  still answering; once the file is released, the update exits 0.
- **A rollback record that can't be read, then a damaged one**
  ([#204](https://github.com/8roundshock/living-room-display/issues/204)): a
  record that names the committed update, held open without read sharing, must
  give exit 7 with `Helper exit code: 20` ("in use by another program") and
  change nothing; once released, the next run removes it without a rollback.
  A NUL-filled record beside the committed install is then only removed too.
- **A NUL-filled installation.json** ([#199](https://github.com/8roundshock/living-room-display/issues/199)):
  the update rebuilds the marker from `app\release.json`, logs that, exits 0 and
  leaves a valid marker, unchanged data and a healthy server; a leftover
  `removing` folder is removed on the way.
- **A failed uninstall** ([#158](https://github.com/8roundshock/living-room-display/issues/158),
  [#207](https://github.com/8roundshock/living-room-display/issues/207)):
  with `app\package.json` held open, the silent uninstaller must fail as
  described under [Inno Setup assumptions](#inno-setup-assumptions) and leave
  `app`, `runtime` and `app.previous` hash-identical with no removal folder, and
  a repair must then succeed before the normal uninstall steps run.

**Evidence (2026-10-18).** Run 39177635973 (PR #149) passed every job: the build (Setup 0.1.0, 27.1 MB, Inno Setup 6.7.1 preinstalled on windows-2025; the payload and both Windows check runs passed) and all six smoke jobs. That covers windows-2022, windows-2025 and windows-11-arm (x64 emulation) × the default folder and the `Living Room Ünicode` folder. The refusal with port 4318 taken left no install folder, which confirms that Setup doesn't create `{app}` before `PrepareToInstall`. Earlier runs on the same PR found the elevated runners, the ISCC version probe and the inherited module path recorded above. After the review fixes (Stop waits for stopped processes, the resumable rollback record, E20 and E21 and the #180 wording), run 39181451761 on 66eeec5 passed the build again (15 Windows check groups under 5.1 and 7, including the real owned-server Stop-then-rename check; the payload checks; Setup 27.1 MB) and all six smoke jobs. PR #201 then added the real-install rollback ([#189](https://github.com/8roundshock/living-room-display/issues/189)) and the failed uninstall ([#158](https://github.com/8roundshock/living-room-display/issues/158)). Run 39187153452 on bd26691 passed the build (15 Windows check groups under 5.1 and 7, with 26 InstallPackage and 9 policy groups; the payload checks; Setup 27.1 MB and the rollback-test Setup) and all six smoke jobs. In each, the rollback-test Setup exited 7 with helper exit code 15 and the repair after it exited 0; the forced uninstall failure exited 1 with the registration kept, and the repair after it exited 0.

The smoke script refuses to run outside GitHub Actions, or with an existing
install, a 4318 listener or the Setup registration. It never starts the kiosk,
captures the screen or selects the screensaver.

## Verification

Observed 2026-10-18: Windows 10 Pro 10.0.19045 x64, existing Edge, Framework
v4.0.30319 compiler, PowerShell 7 and Windows PowerShell 5.1. Helper compilation,
`--check` and invalid-parent preview exit were exercised. The control script
parses under both PowerShell engines. Run `windows/Test-Windows.ps1` for native
compile/argument checks, cleanup containment including nested junction refusal,
malformed/unrelated PID refusal, and optional real process/start-time ownership
checks (`-NodeExe '<node.exe>'`). With Node they also stop a real owned test
server whose working folder is `app` and rename `app` straight after `Stop`,
which only works because `Stop` waits for the process to exit. Seventeen check
groups with Node (fifteen without) pass on PowerShell 7 and 5.1, including
successful final cleanup. They now also
cover the InstallPackage transaction (`tests/Test-PackageInstall.ps1`), the static
installer policy and the versioned helper build, and every script is checked to be
ASCII for Windows PowerShell 5.1; use process-scoped
`-ExecutionPolicy Bypass` where script policy requires it. These include eight
fake native lifecycle scenarios using the production startup coordinator with
delayed transport/browser operations and synthesized session ends, the fixed
caller-input baseline suite (`ActiveInputTests`: genuine first-second input,
delayed startup cancellation, in-flight callback disposal and serialized old RAM
cleanup), the pure surface-policy suite (`SurfacePolicyTests`), plus
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
[STATUS.md](../STATUS.md) records the current installed revision, its install
evidence and its rollback pair. On 2026-10-19 three coordinated web installs followed
`bedca44` (PR #70): clean `3fee844` (PR #163), `4cb7dc1` (PR #327) and then `3446400`
(PR #286), each with a verified data copy (see the
[#130 install evidence](https://github.com/8roundshock/living-room-display/issues/130)).
An earlier rollout installed clean `7e654fd`, the normal merge of PR #57. Its 79
application tests, full production build, independent final-head reviews and
Windows/Linux CI passed before rollout. The
[dated rollout evidence](https://github.com/8roundshock/living-room-display/pull/57#issuecomment-6253029701)
verifies installed provenance, owned backend/listener, health, served asset hashes
and unchanged private data after the owner confirmed a clean editor and authorized
the update. A complete private pre-revision-2 data recovery copy was verified;
retain it for the [matching app/data rollback](install.md#widget-geometry-revision-2-update-and-rollback).
No native launch, capture, editor reload or screensaver registration accompanied
that rollout. This documentation correction adds no live probes. Recheck current
provenance using installed CLI `Status` or
`%LOCALAPPDATA%\LivingRoomDisplay\installation.json`; see [installation](install.md).
On 2026-10-18 a later marker-only read reported clean `bedca44e` after PR #70,
installed that day, without rechecking backend/served assets, private
data/backup equality or registration. Each install since `3fee844` rechecked
provenance, health, served assets, data hashes and screensaver values; see
[current status](../STATUS.md).
The optional `windows/tests/Test-CursorBrowser.mjs` production Edge regression
checks that browser loading/error, viewport edges, widgets, editor/embedded preview
and new display tabs retain their pointer, while explicit native presentation
hides the document cursor. Synthetic state is intercepted in an isolated headless
browser; it neither changes app data nor establishes the visible Windows cursor
state.

Independent static review approved source `eba70fc` before the earlier runtime QA;
later merged application changes also passed their final-head reviews and CI.
The native cursor replacement from
[PR51](https://github.com/8roundshock/living-room-display/pull/51) was brought up to
date with `main` (Setup, installer CI and the feature wave) without changing its
host semantics; its earlier source approvals and CI were for older heads and do
not transfer. Merging it is not deployment or native acceptance evidence; its
integrated runtime gates below still apply.

## Actual current-PC runtime evidence

The clean `7e654fd` historical web rollout is verified as described above; no
combined-host native acceptance was performed during that update, established by
the later marker-only `bedca44e` read, or performed during any web install since
(see [STATUS.md](../STATUS.md)). Earlier actual
native preview source/content and readability on the 3840x2160 primary were
accepted under
[#46](https://github.com/8roundshock/living-room-display/issues/46): raw PNG and
rendered preview were inspected in RAM, normal exit cleared preview to 404 and
left zero owned display processes, and no screenshot files were saved. This
does not establish room comfort, cursor hiding or the proposed replacement host.

Earlier lifecycle tests on 2026-10-18 used source `eba70fc`, Windows 10 Pro 19045
x64 and the same actual 3840x2160 display:

- Per-user nonadmin install downloaded/checksummed official Node 24.19.0 and built
  the web/native app. The system Node installation was unchanged. Installed
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
glyph despite correct document CSS. WGC may omit the cursor. Actual visual,
real-input, focus/failure, restoration and combined-source checks of the PR51
helper remain.
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
`084c79cb9d7c8c2bfe869a791312c36aeef9d115`. Bound to the then-installed healthy
owned `2e010f0` backend and a separate candidate Edge profile, one coordinated
round produced 26 consecutive qualified NULL-cursor samples, quiet input baseline
true, helper exit 0, no forced stop and empty stdout/stderr. Foreground
restoration passed; RAM preview cleared to 404 and owned candidate host/browser
counts were zero. Saved data, settings and the original screensaver settings were
unchanged. No screenshots or genuine input were used. This old-source result is
not visual/input acceptance of the current helper.

The early-input baseline defect [#50](https://github.com/8roundshock/living-room-display/issues/50)
stays open until real startup/first-second input is checked on an installed PR51
helper; the deterministic regressions above are not physical-input acceptance. Read-only
[`GetCursorInfo`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getcursorinfo)
and [`CURSORINFO`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-cursorinfo)
provide cursor handle, visibility flags and screen position. Require a successful
read, NULL glyph and actual owned client/hit-root with live renderer and stable
input; a failed read or cursor-free screenshot proves no absence. Record context
and restoration separately. Earlier command preflights returned error 5 (access
denied) and current `Default` desktop `UOI_IO=false`; struct checks did not
isolate a cause. An old partial candidate layout also failed because the
unchanged control treated it as an incomplete installation. These failures remain
historical evidence; the later successful stationary round supersedes them as the
latest result. Recheck only with the owner's go-ahead, on the normal interactive
desktop with cursor observation available, with a new coordinated preflight/GO,
after rechecking current artifacts, the served backend and data preservation; do
not open/switch desktops, dismiss security UI or weaken guards. See
[diagnosis](https://github.com/8roundshock/living-room-display/pull/51#issuecomment-6249615459).

References: [Screensaver library](https://learn.microsoft.com/en-us/windows/win32/lwef/screen-saver-library),
[Edge kiosk](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode),
[Windows jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[Node release files](https://nodejs.org/download/release/v24.19.0/).

## Primary API basis for the native host

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
