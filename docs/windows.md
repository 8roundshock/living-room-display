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
| Windows PowerShell 5.1 | Present on Windows 10 and 11; used only by Setup, the uninstaller and the helper's Start. | CI runs `Test-Windows.ps1` under 5.1 and 7. |
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
  `Build-Installer.ps1`, the payload checks, and the artifact (14 days).
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
which only works because `Stop` waits for the process to exit. Fifteen check
groups with Node (thirteen without) pass on PowerShell 7 and 5.1, including
successful final cleanup. They now also
cover the InstallPackage transaction (`tests/Test-PackageInstall.ps1`), the static
installer policy and the versioned helper build, and every script is checked to be
ASCII for Windows PowerShell 5.1; use process-scoped
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
The current installed baseline is recorded in [STATUS.md](../STATUS.md) (clean
`3fee844`, the merge of PR #163, on 2026-10-19, replacing `bedca44` from PR #70;
[evidence](https://github.com/8roundshock/living-room-display/issues/130#issuecomment-6260374373)).
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
installed at 19:08:23 UTC, without rechecking backend/served assets, private
data/backup equality or registration. The `3fee844` install rechecked provenance,
health, served assets, data hashes and screensaver values; see [current status](../STATUS.md).
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

The clean `7e654fd` historical web rollout is verified as described above; no
combined-host native acceptance was performed during that update or established
by the newer marker-only `bedca44e` read. Earlier actual
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
does not prove these cases. The coordinator's last direct verification kept app
idle off with the original blank saver, 1200-second timeout and security 0; the newer marker
read does not establish current registration or authorize activation.
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
