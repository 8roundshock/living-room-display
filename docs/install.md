# Windows installation and use

**Current-PC source installation is verified; broader release checks remain.**
The per-user install, server/data lifecycle and bounded native visual check passed
on Windows 10. Keep idle off until review and explicit activation approval.
This is a private prerelease, not a signed/public package. Read [STATUS.md](../STATUS.md) and
[Windows verification](windows.md#verification) for current evidence.
Read AGENTS.md and follow the independent [PR workflow](agent-workflow.md) when
changing source. Readiness is tracked in [issue #10](https://github.com/8roundshock/living-room-display/issues/10).

Target: Windows 10 x64 with Microsoft Edge, .NET Framework 4.x and Windows
PowerShell 5.1 (PowerShell 7 also works). Installation is per user and needs no
administrator rights. This is an initial source installation, not a signed or
public release. The repository remains private. Use your own authorized GitHub
access while cloning; the maintainer's GitHub helper is not an app prerequisite.
The host targets one primary display; monitor selection and multi-monitor layout
are not implemented. Install directories/subdirectories must be ordinary local
paths without junctions/symlinks; cleanup refuses reparse traversal.
The backend can be run with the [development commands](development.md), which
does not establish installed display or screensaver behavior.

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
An agent composing reviewed component revisions can pass `-SourceRoot '<source
candidate directory>'` to build a separate full source snapshot. The native
helper/control script come from the invoked `windows` directory; web sources
and the lockfile come from `SourceRoot`. Other workers' files remain untouched.

In the editor, choose your own units, clock format, dim colors, widgets and motion.
Weather uses a rounded device area when browser permission is already granted,
or after you choose **Use device location**; otherwise Toronto is the fallback.
Manual city selection is preserved. Existing saved cities migrate as manual,
including Toronto, so an upgrade does not guess whether a choice was intentional.
No device lookup or permission prompt runs in ambient mode. Empty reminders hide
by default; the editor can keep the empty widget visible. See [UI behavior](ui.md).
Snapshots come from
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
| `Status` | Show installed source revision/state, owned processes and selected screensaver. |
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
Windows screensaver invocation has a cold-start implementation; its actual `/c`
end-to-end cold test remains unverified as described below.

## Optional native screensaver

Keep automatic activation off until the display and your movies/games have been
tested. The editor preference does not change Windows. To explicitly choose the
native screensaver after that review:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\LivingRoomDisplay.ps1 EnableIdle -IdleMinutes 20
```

This saves the selected screensaver, active state and timeout in
`screensaver-before.json` before changing them. It preserves lock-on-resume.
Successful changes update the desired app preference when its owned server is
running. The editor's Windows status comes from the registry and stays separate
from that preference. Supported timeout choices are 1–120 minutes.
Activation uses native Windows screensaver behavior, rather than starting over
a film based only on missing mouse input. Media applications must still be
tested for inhibition; see [Windows behavior and limits](windows.md). Managed
policy is not overridden. If you select a different screensaver yourself,
`DisableIdle` preserves your new choice, including None or an empty/missing
selection, and retains the backup for inspection.

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
| `installation.json` | Non-secret ownership/state and source provenance, retained for reinstall. |

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

### Widget geometry revision 2 update and rollback

The studio refinement in [#56](https://github.com/8roundshock/living-room-display/issues/56)
keeps `settings.version` at 1 but introduces `widgetGrid.revision: 2`. Earlier app
versions reject that geometry. Reading a valid old file migrates it in memory
without rewriting its bytes; the first ordinary save writes the new geometry,
and subsequent saves can leave **both** `state.json` and `state.backup.json` at
revision 2. Keeping `app.previous` alone is therefore insufficient for rollback.

Before upgrading, inspect the actual open editor draft read-only; the saved
backend API cannot establish whether that browser has unsaved changes. If dirty,
obtain the user's Save or Cancel choice and resolve it in the current app before
stopping or reloading that editor. Do not reload an active unsaved draft as part
of an unattended update.
Stop the owned backend, then copy the complete private `data` directory to a
separate pre-upgrade backup and verify the primary, backup and selected-image
data are included. An export is useful in addition; it excludes private images
and does not replace the directory backup. Keep those bytes private and outside
Git or diagnostics. Do not mutate the live data merely to test migration.

Update to the clean reviewed UI revision, restart and verify installed provenance,
health and served assets, then reload the editor after its draft is resolved.
The native candidate reuses that canonical backend: a new native host tested
against old served UI assets is not combined-source acceptance. Test the reviewed
`native=1` UI and candidate host together before native registration or idle use.

For rollback, stop the app, preserve the entire newer data directory separately,
and restore the matching pre-upgrade app **and** private data copy. Validate with
that older app before starting it. Never overwrite or discard newer reminders,
settings or photo data with an old backup; retain both for deliberate recovery.
No automatic geometry downgrade is provided.

### Additive data and rollback compatibility (#84)

The previous installed release is `bedca44`. Its reader rejects unknown keys, so
an additive key written to disk would make `state.json`, and after the next save
`state.backup.json`, unreadable by it. This build therefore omits additive values
from files and exports while they equal the value the current reader restores
(see [API](api.md#persistence-and-recovery)). Data that keeps default choices stays
readable by `bedca44`, so `app.previous` remains a working rollback for it.

`src/server/rollback.test.ts` (part of `npm test`) proves this with a byte-for-byte
copy of the `bedca44` reader: fresh data, previous-release data after unrelated
saves, saved styles, a photo, a revision-one legacy file and the export all parse.
Its negative controls show the documented exceptions below are rejected. After each
coordinated install, the baseline moves to the newly installed revision (#130).

A non-default choice in a shipped feature is not readable by `bedca44`. Before
rolling back after using one, follow the [revision 2 procedure](#widget-geometry-revision-2-update-and-rollback):
keep the newer data directory and restore the matching pre-upgrade data copy.

| Feature | Data the previous release cannot read |
| --- | --- |
| #73 reminder history | Not shipped yet |
| #73 custom Reminders sizes | Not shipped yet |
| #74 Weather and Rain merge | Not shipped yet |
| #75 Native colours | Not shipped yet |
| #76 Animation level | Not shipped yet |
| #78 Calendar, Countdown and Note | Not shipped yet |
| #78 World clocks, Sun & moon and Air quality | Enabling any of the three widgets, adding a world clock city, or choosing the European AQI scale (`widgets.worldClocks/sunMoon/airQuality: true` or non-default `widgetData.worldClocks`/`airQuality`). While all three stay off with no cities and the US scale, files and exports remain readable. |

`Update` reuses an existing Node24 runtime; `-NodeVersion` selects a version only
when the runtime is absent. For a deliberate runtime update, stop the app, rename
`runtime` to `runtime.previous`, then run source `Update -NodeVersion <explicit
24.x.y release>`. The new official ZIP is checksum-verified. Keep the previous
runtime until verified; rollback by stopping, renaming the new runtime aside and
renaming `runtime.previous` back. No system runtime or PATH is changed.

`Status` reports `SourceRevision` and `SourceState` from the installed marker,
so advancing your checkout does not relabel the installed app. A complete Git
checkout records its verified commit and `clean` or `dirty` state. Archives,
missing Git, sources inside an unrelated parent repository, and separate web/helper
source candidates report `unknown` with no invented revision. Only successful
app replacement refreshes provenance; failed updates and retained-data uninstall
preserve it. A dirty revision identifies its base commit, not the uncommitted edits.
For bug reports prefer an installation from a clean reviewed revision.

`Uninstall` retains `data` by default. Add `-RemoveData` to explicitly delete it.
Run uninstall from the clone so removal does not remove its executing script.
A backup is retained if a different screensaver is now selected. The parent
directory retains its ownership marker, even with `-RemoveData`. Run `Install`
again at the same path to reuse retained data and screensaver backup. An unrelated
nonempty unmarked directory is still refused. Deliberately preserved recovery or
runtime backup folders are not removed by uninstall.

## JSON export/import and offline recovery

The JSON API and offline validation/file replacement steps were checked with
synthetic data under PowerShell 7 and 5.1; installed Start/Stop and data lifecycle
were also exercised separately. The installed server is fixed at 4318; use the
actual `LRD_PORT` URL for source runs.
Choose a private backup path; exports contain your reminders/location/settings.
With the app running:

```powershell
$backupFile = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'living-room-display-backup.json'
Invoke-WebRequest 'http://127.0.0.1:4318/api/export' -OutFile $backupFile -UseBasicParsing
# Restore a previously saved app export (replaces settings/reminders):
Invoke-RestMethod 'http://127.0.0.1:4318/api/import' -Method Post -ContentType 'application/json' -InFile $backupFile -UseBasicParsing
```

If both `data\state.json` and `state.backup.json` are unreadable, startup refuses
to overwrite them and the online import endpoint is unavailable. Keep installed
app/runtime files, stop the app with its control script, and use a valid export.
The following validates against this installed version's schema before preserving
the data folder and replacing anything. Set `$installRoot`/`$backupFile` to your
actual paths. Do not use an export from an incompatible future schema version.

```powershell
$installRoot = Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay'
$control = Join-Path $installRoot 'app\windows\LivingRoomDisplay.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Stop
$dataDirectory = Join-Path $installRoot 'data'
$node = Join-Path $installRoot 'runtime\node.exe'
$validator = Join-Path $installRoot 'app\dist\server\validation.js'
$candidate = Join-Path $installRoot ('restore-' + [Guid]::NewGuid().ToString('N') + '.json')
$validationCode = @'
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
  const exported=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  const {dataSchema}=await import(pathToFileURL(process.argv[2]).href);
  const restored=dataSchema.parse({version:exported.version,settings:exported.settings,reminders:exported.reminders});
  fs.writeFileSync(process.argv[3],JSON.stringify(restored,null,2),{encoding:'utf8',flag:'wx'});
})().catch(()=>{console.error('Backup validation failed; preserved data was not modified.');process.exitCode=1;});
'@
& $node -e $validationCode $backupFile $validator $candidate
if ($LASTEXITCODE -ne 0) { throw 'Backup validation failed; stop without replacing data.' }
$preserved = Join-Path $installRoot ('data-before-restore-' + [Guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $dataDirectory -Destination $preserved -Recurse -ErrorAction Stop
Move-Item -LiteralPath $candidate -Destination (Join-Path $dataDirectory 'state.json') -Force -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $dataDirectory 'state.json') -Destination (Join-Path $dataDirectory 'state.backup.json') -Force -ErrorAction Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start
```

The preserved folder contains the original files for inspection. Keep it private.
If no valid export exists, retain the data folder and request diagnosis; do not
delete corrupt files merely to get a clean startup. See [agent runbook](agent-runbook.md)
and [contribution workflow](../CONTRIBUTING.md) for a consent-based bug/fix handoff.

## Verification and troubleshooting

- Check `Status` reports the owned server healthy and the editor opens locally.
- Choose a location; check weather age/error labels and seven forecast days.
- Add/edit/complete a test reminder; `Stop`/`Start` and verify persistence.
- Run `Display`; check dim moving widgets, labeled last state and input dismissal.
- Disable preview; verify it clears and re-enabling does not reuse an old image.
- Confirm `Stop` leaves normal Edge tabs open and reports no owned processes.
- Test update, data retention and uninstall before relying on unattended use.
- Test movie/game/fullscreen and lock behavior before `EnableIdle`; compilation
  and a manual smoke test do not establish those cases. Native `/c` cold startup
  remains unverified after automatic review blocked that optional test before
  execution; CLI cold Start/Stop and the warm native test are separate evidence.

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
