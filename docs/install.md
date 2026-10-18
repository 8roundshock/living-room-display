# Windows installation and use

Target: Windows 10 x64 with Microsoft Edge, .NET Framework 4.x and Windows
PowerShell 5.1 (PowerShell 7 also works). Installation is per user and needs no
administrator rights. This is an initial source installation, not a signed or
public release. The repository remains private. Use your own authorized GitHub
access while cloning; the maintainer's GitHub helper is not an app prerequisite.

The installer downloads the official Node 24.19.0 x64 ZIP over HTTPS, checks its
SHA256 against that release's official `SHASUMS256.txt`, and keeps Node/npm inside
the app directory. It does not replace system Node or alter PATH outside its own
process. npm retrieves the pinned dependencies in `package-lock.json`.

## Install from a source clone

From the clone directory, in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\LivingRoomDisplay.ps1 Install
```

`Bypass` applies only to this process. It does not change your execution policy.
The command builds the web app and native helper, installs production files under
`%LOCALAPPDATA%\LivingRoomDisplay`, starts the local server and opens the editor at
<http://127.0.0.1:4318/editor>. It does not enable idle activation or change the
selected Windows screensaver. Use `-NoBrowser` to avoid opening a tab.
An optional `-InstallRoot '<dedicated directory>'` selects another user-owned
directory; pass that same path to later source-clone commands.

In the editor, choose your own weather location, units, clock format, dim colors,
widgets and motion. Location is not inferred from timezone. Snapshots come from
the primary display immediately before native ambient launch; disable preview
in the editor if you do not want desktop capture. No camera, microphone, audio
routing, TV control or cloud account is involved.

## Everyday commands

Replace the final word of the installation command with:

| Command | Result |
| --- | --- |
| `Start` | Start the local server and open the editor. |
| `Editor` | Open the editor, starting the server if needed. |
| `Display` | Capture the last desktop if enabled, then open the ambient Edge kiosk. |
| `Status` | Show owned server/display state, paths and selected screensaver. |
| `Stop` | Close this install's display and local server. |
| `Update` | Build the current source clone and replace the installed app. |
| `DisableIdle` | Restore the saved Windows screensaver and timeout. |
| `Uninstall` | Restore idle configuration, stop owned processes and remove app/runtime. |

The installed script also lives at
`%LOCALAPPDATA%\LivingRoomDisplay\app\windows\LivingRoomDisplay.ps1`. Controls can
run there; run `Install`/`Update` from the source clone supplying build sources.

Move the mouse or press a key to dismiss ambient mode after its short launch
grace period. `Stop` also dismisses it. The host owns an isolated Edge profile/job;
it does not close normal browser windows. Closing ambient clears the snapshot
and leaves the local server available for later use. `Stop` stops both. The
loopback server is not a Windows service, scheduled task or startup item.
Windows screensaver invocation can cold-start it.

## Optional native screensaver

Keep automatic activation off until the display and your movies/games have been
tested. The editor preference does not change Windows. To explicitly choose the
native screensaver after that review:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\LivingRoomDisplay.ps1 EnableIdle -IdleMinutes 20
```

This saves the selected screensaver, active state and timeout in
`screensaver-before.json` before changing them. It preserves lock-on-resume.
Activation uses native Windows screensaver behavior, rather than starting over
a film based only on missing mouse input. Media applications must still be
tested for inhibition; see [Windows behavior and limits](windows.md). Managed
policy is not overridden. If you select a different screensaver yourself,
`DisableIdle` preserves your new choice and retains the backup for inspection.

## Data, updates, recovery and removal

| Below `%LOCALAPPDATA%\LivingRoomDisplay` | Purpose |
| --- | --- |
| `app` | Built web/native app and production dependencies. |
| `app.previous` | Previous app after an update. |
| `runtime` | App-owned Node/npm. |
| `data` | Private settings and reminders. |
| `run/server.json` | Server PID/start time for scoped process management. |
| `edge-profile` | Dedicated Edge profile; ambient uses InPrivate/no-store preview responses. |
| `screensaver-before.json` | Prior native screensaver settings, only after opt-in. |

Use the editor's export, or stop the app and copy `data` to a private backup.
Snapshot pixels and native tokens are RAM only and excluded from persisted
data/exports/diagnostics. Do not include private data or screenshots in reports.

For an update, review/pull the desired source revision and run `Update`. The
installer builds first, keeps data outside app files, stops owned processes,
and retains `app.previous`. A build/dependency failure leaves the installed app
untouched. A replacement failure restores the prior app directory. To roll back,
run `Stop`, rename `app` to `app.failed`, rename `app.previous` to `app`, then run
the installed script `Start`. Check data compatibility before rolling back a
future schema version. Do not remove data to repair an update.

`Uninstall` retains `data` by default. Add `-RemoveData` to explicitly delete it.
Run uninstall from the clone so removal does not remove its executing script.
A backup is retained if a different screensaver is now selected. The parent
directory may remain with retained data/backup.

## Verification and troubleshooting

- Check `Status` reports the owned server healthy and the editor opens locally.
- Choose a location; check weather age/error labels and seven forecast days.
- Add/edit/complete a test reminder; `Stop`/`Start` and verify persistence.
- Run `Display`; check dim moving widgets, labeled last state and input dismissal.
- Disable preview; verify it clears and re-enabling does not reuse an old image.
- Confirm `Stop` leaves normal Edge tabs open and reports no owned processes.
- Test update, data retention and uninstall before relying on unattended use.
- Test movie/game/fullscreen and lock behavior before `EnableIdle`; compilation
  and a manual smoke test do not establish those cases.

Port 4318 occupied by another instance is not adopted or killed. Stop that
instance using its own controls. A stale PID file is insufficient ownership:
executable path, command line and process start time must match. Inspect leftover
`app.next`/`runtime-download` from an interrupted installation before retrying.
Do not work around permissions by running the whole app as administrator.

Test evidence and release blockers are in [Windows verification](windows.md#verification).
A clean-account/machine install is a separate release gate. No telemetry or
automatic feedback is sent. Stars and external feedback need your permission.

## Agent installation prompt

> Clone this repository using my authorized Git access. Read AGENTS.md, STATUS.md,
> docs/install.md and docs/windows.md. Install per user, configure my own location
> and preferences, verify manual display/reminder persistence, snapshot privacy
> and clean stop. Keep idle off until compatibility checks pass. Preserve my
> screensaver and lock settings. Do not change repository visibility, send feedback
> or star the repository on my behalf.
