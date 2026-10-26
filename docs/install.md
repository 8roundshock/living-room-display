# Windows installation and use

**Current-PC source installation is verified; broader release checks remain.**
The per-user install, server/data lifecycle and bounded native visual check passed
on Windows 10. Keep idle off until review and explicit activation approval.
This is an unsigned prerelease, not a signed/published package. Read [STATUS.md](../STATUS.md) and
[Windows verification](windows.md#verification) for current evidence.
Read AGENTS.md and follow the independent [PR workflow](agent-workflow.md) when
changing source. Readiness is tracked in [issue #10](https://github.com/8roundshock/living-room-display/issues/10).

Target: Windows 10 x64 with Microsoft Edge, .NET Framework 4.x and Windows
PowerShell 5.1 (PowerShell 7 also works). Installation is per user and needs no
administrator rights. This is an initial source installation, not a signed or
published release. Clone with your own Git access; the maintainer's GitHub helper
is not an app prerequisite.
The host targets one primary display; monitor selection and multi-monitor layout
are not implemented. Install directories/subdirectories must be ordinary local
paths without junctions/symlinks; cleanup refuses reparse traversal.
The backend can be run with the [development commands](development.md), which
does not establish installed display or screensaver behavior.

The installer downloads the official Node 24.19.0 x64 ZIP over HTTPS, checks its
SHA256 against that release's official `SHASUMS256.txt`, and keeps Node/npm inside
the app directory. It does not replace system Node or alter PATH outside its own
process. npm retrieves the pinned dependencies in `package-lock.json`.

## Install with Setup (recommended)

`LivingRoomDisplaySetup-<version>.exe` is a per-user setup for people who don't
use Git or PowerShell ([#77](https://github.com/8roundshock/living-room-display/issues/77)).
CI builds it from reviewed commits as the `living-room-display-setup` artifact,
with a `.sha256` file and the `release.json` manifest. It is still an
unsigned prerelease: how it is distributed ([#114](https://github.com/8roundshock/living-room-display/issues/114))
and code signing ([#115](https://github.com/8roundshock/living-room-display/issues/115))
are owner decisions, and clean-PC acceptance is tracked in
[#116](https://github.com/8roundshock/living-room-display/issues/116).

**Supported systems.** Windows 10 22H2 and Windows 11, x64. Setup refuses
anything older than Windows 10 1809 and anything that isn't x64-compatible.
Windows 11 on Arm runs it through x64 emulation; that path is checked in CI
but doesn't gate releases yet ([#122](https://github.com/8roundshock/living-room-display/issues/122)).
The full-screen display needs Microsoft Edge ([#119](https://github.com/8roundshock/living-room-display/issues/119))
and the .NET Framework 4.x, which is built into Windows 10 and 11. Setup users
don't need the C# compiler, Node.js, Git or a terminal.

**Download warnings.** Until the file is signed, Edge may say it "isn't
commonly downloaded" (choose **Keep**). Running it shows **Windows protected your
PC**: choose **More info**, then **Run anyway**. On Windows 11 with Smart App
Control turned on, unsigned setups are blocked with no override; that needs
signing (#115). To check the download, compare
`(Get-FileHash .\LivingRoomDisplaySetup-<version>.exe).Hash` with the `.sha256`
file.

**What Setup does.** One page, **Ready to install Living Room Display**, with
one unchecked option: **Create a desktop shortcut**. Click **Install**. Setup
installs for your account only (no administrator rights) into
`%LOCALAPPDATA%\LivingRoomDisplay`, using the same layout as the
[table below](#data-updates-recovery-and-removal) plus `backups\` (data snapshots),
`uninstall\` (the uninstaller and its copy of the control script) and
`app\release.json`. Setup does the following:

- checks the download, including every file against `release.json` and the
  bundled Node runtime against its pinned SHA-256;
- installs the app;
- starts the local server and confirms it answers before it reports success;
- finishes with **Open Living Room Display** checked, which opens Home at
  <http://127.0.0.1:4318/> (#438), with **Edit display** (`/editor`) a click away.

It does not change your screen saver or add a service/scheduled task. An already
enabled owned idle display with Last screen can synchronize the per-user sign-in
entry described below (#540); fresh idle-off users are not opted in. There's no firewall prompt because the server
listens only on 127.0.0.1. No account and no cloud are involved.

**Start menu.** **Living Room Display** opens Home in a new browser tab (it starts the
server if needed); **Edit display** is the link at the top. **Living Room Display -
Show display** shows the ambient display now; move the mouse or press a key to close
it. There's no Uninstall shortcut:
right-click the Start entry, or use **Settings > Apps**.

**Updating.** Download and run the newer Setup. The Ready page says
**Update Living Room Display to version X**. Save any unsaved editor changes
first: the display closes during the update. Setup then:

1. clears what earlier runs left while the app still runs: an older
   `app.previous`, a Setup-made `runtime.previous` when this update replaces the
   runtime, and stale staging. Each goes aside by a whole-folder rename to
   `removing` (or `removing-2`, ...) and is deleted from there; if a file in one
   of them is open, Setup stops with E22 and changes nothing
   ([#200](https://github.com/8roundshock/living-room-display/issues/200));
2. stops this install's display and server;
3. copies the whole `data` folder to `backups\data-before-<old version>-<UTC time>`
   and verifies every file's size and SHA-256 (the newest three copies are kept);
4. keeps the previous app as `app.previous`;
5. installs the new app, restarts it and checks its health.

Running the same version again repairs the install. Setup also adopts an
existing source install at the same folder through its `installation.json`
marker. After an uninstall that kept your data, the Ready page says **Install
Living Room Display version X** and that Setup found the kept settings, reminders
and photo; it uses them again after the same backup. Running an older Setup is
refused (see E12), so an older version never
"recovers" over newer data; agents may override this with `/ALLOWDOWNGRADE=1`
only after following the rollback steps below.
The runtime is replaced only when the packaged Node 24 is newer and any
`runtime.previous` was made by Setup; a runtime that isn't Node 24 stops
the update untouched (E18).
A later source `Update` on a Setup install works. It records
`"channel": "source"` and keeps what is still true of the Setup install
([#159](https://github.com/8roundshock/living-room-display/issues/159)):
`runtimeVersion`, the ownership of a Setup-made `runtime.previous`
(`runtimePreviousOwner`, so uninstall still removes it and a later Setup may
still replace it) and `lastPackageVersion`, the newest version Setup installed
there. A Setup older than `lastPackageVersion` is still refused (E12).
`Status` reports `Channel` `source`, and Apps & Features keeps showing the
Setup version until the next Setup run.

**Uninstalling.** From **Settings > Apps** or the Start menu, confirm **Remove
Living Room Display from this PC?** Then choose **Keep my data** (the default)
or **Delete my data**. Keeping it lets you pick up where you left off if you
reinstall. Either way, uninstall does the following:

- restores your previous screen saver, but only if this app is the selected one
  and a saved backup exists;
- stops the display and server;
- removes `app`, `app.previous`, `app.failed` (and numbered copies such as
  `app.failed-2`), `runtime` (and a Setup-made `runtime.previous`), `run`,
  `edge-profile`, leftover staging and removal folders, the
  record of an unfinished rollback (`package-transaction.json`), the shortcuts
  and the Apps & Features entry.

**Keep my data** leaves `data`, `backups` and `installation.json`. **Delete my
data** removes `data` and `backups` as well, then removes the folder once only
the marker is left. Uninstall first renames every folder it removes, `app` first,
to a removal name inside the install folder (`removing`, `removing-2`, ...), and
only then deletes the renamed folders
([#207](https://github.com/8roundshock/living-room-display/issues/207)). If a file
in one of them is open, that rename fails: uninstall puts back any folder it had
already renamed and stops with "Living Room Display couldn't stop or remove some
files: ...". The app stays complete, your data is not deleted, and the Apps &
Features entry stays. Close the program using the file (or restart the PC) and
uninstall again; if the app doesn't open, run Setup again to repair it first (CI
checks this path, [#158](https://github.com/8roundshock/living-room-display/issues/158)).
A renamed folder that can't be deleted yet (a program opened a file in it after
the rename) doesn't stop the uninstall; it stays as `removing...` until the next
Setup run, `Update` or `Uninstall` removes it. The CLI `Uninstall` command on a
Setup install hands over to the same uninstaller.

**Silent use (agents and administrators).**

| Command | Result |
| --- | --- |
| `LivingRoomDisplaySetup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="<file>"` | Install or update. Exit 0 = success, 7 = refused by the checks below (nothing registered). The editor is not opened. |
| add `/DIR="<dedicated folder>"` | Install elsewhere: a new empty folder, or an existing Living Room Display folder. Keep the path at most 130 characters (E21 otherwise). |
| add `/ALLOWDOWNGRADE=1` | Allow installing an older version over a newer Setup install. |
| add `/ALLOWELEVATED=1` | Build agents only (for example GitHub's runners, which are always elevated with UAC on). Setup otherwise refuses an elevated launch, because the server it starts would run elevated. |
| `"%LOCALAPPDATA%\LivingRoomDisplay\uninstall\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` | Uninstall and keep data. The first process can exit early; wait until the Apps & Features entry is gone. |
| add `/REMOVEDATA=1` | Uninstall and delete data and backups. |

Installed `Status` also reports `Channel` (`package` or `source`), `Version`,
`RuntimeVersion` and `PackageSha256`. The Setup log (`/LOG`, or `Setup Log
<date> #<n>.txt` in `%TEMP%`) includes the helper's own log.

**When Setup stops.** Every refusal (E10 to E14, E17 to E19, E21 and E22)
happens before anything is replaced; your previous version and data stay as
they were. Setup clears leftovers of earlier runs, such as an older
`app.previous` (step 1 of **Updating**), before it unpacks the update, so they
are already gone after a later refusal: E13 when unpacking fails, or E11 (another
program took the port after Stop) and E19, which restart the previous version. A
run that first finished an earlier unfinished rollback (see **Rollback**) says
so: its refusal ends with "Setup first put back the version from before an
earlier unfinished update. Nothing else was changed." instead of "Nothing was
changed." (or "Setup first undid an earlier unfinished installation." when that
earlier run was a first install), and E15,
E16 and E20 start with the same sentence
([#206](https://github.com/8roundshock/living-room-display/issues/206)). E15, E16
and E20 come after the new version was put in place and failed to start, or
after a replacement step failed; data is never touched. Setup exits with code 7
in every case.

| Code | Message |
| --- | --- |
| E10 | Setup can't use the folder `<path>` because it contains other files. Nothing was changed. (Also for a missing or damaged `installation.json` in a folder that isn't clearly Living Room Display's; see **A damaged installation.json**.) |
| E11 | Another program is already using the connection Living Room Display needs (local port 4318). Close any other copy of Living Room Display, then run Setup again. Nothing was changed. |
| E12 | A newer version of Living Room Display (`<v>`) is already installed. Nothing was changed. After a keep-data uninstall: The settings kept in this folder are from a newer version of Living Room Display (`<v>`). Install that version or a newer one to use them. Nothing was changed. After a source `Update` on a Setup install: Living Room Display in this folder was installed by a newer Setup (`<v>`) and updated from source since. Use Setup `<v>` or newer. Nothing was changed. |
| E13 | The setup files look damaged or incomplete. Download Setup again. Nothing was changed. |
| E14 | Living Room Display is busy with another update or uninstall. Wait a moment and try again. |
| E15 | The new version didn't start, so Setup put the previous version back. Your data was not changed. Details are in the setup log. |
| E16 | As E15, plus: Neither version could start; your data was not changed. On a first install, worded from what Setup's helper logged it did: Living Room Display didn't start on this PC, so Setup couldn't finish installing it and removed everything it had added. Run Setup again to try again. (If the app had written its data: ...and removed the program files it had added. Run Setup again to try again. If you don't want to, you can delete the folder `<path>`. If something it added couldn't be removed yet: ...couldn't finish installing it, and it couldn't remove everything it had added yet. Run Setup again: it cleans up first, then tries again. If you don't want to, you can delete the folder `<path>`.) On a reinstall after a keep-data uninstall: ...couldn't finish installing it. The settings, reminders and photo you kept were not changed. Run Setup again to try again. Otherwise: ...couldn't finish installing it. Your data was not changed. Run Setup again to try again. (Plus the log path.) |
| E17 | There isn't enough free disk space (about 500 MB needed). |
| E18 | An unexpected runtime is in the app folder; Setup left it untouched. |
| E19 | Setup couldn't make a safe backup of your data, so nothing was changed. |
| E20 | Setup couldn't finish, and couldn't put the previous version back by itself. Your previous version and data are kept. Run Setup again: it puts the previous version back first, then tries the update again. (Plus the log path. With no previous version: "...couldn't undo all of its changes by itself. Your data was not changed. Run Setup again: it finishes undoing them first, then tries again." When another program holds the rollback record open: "Setup couldn't read its record of an earlier unfinished update (package-transaction.json) because another program is using it, so it didn't move anything. Your previous version and data are kept. Close that program or restart the PC, then run Setup again.") |
| E21 | The install folder `<path>` is too long a path for Living Room Display's files. Install it in a shorter folder. Nothing was changed. |
| E22 | A file in `<folder>`, which an earlier update left, is in use, so Setup couldn't remove that folder before updating. Close the program that's using it, or restart the PC, then run Setup again. Nothing was changed. (`<folder>` is the full path of `app.previous`, `runtime.previous` or `package.next`.) |
| Script blocked | Windows settings on this PC don't allow Setup's helper script to run (common on work or school PCs). Ask the PC's administrator, or install on a personal PC. ([#117](https://github.com/8roundshock/living-room-display/issues/117)) |
| Run as administrator | Please run Setup normally, without 'Run as administrator'. |
| Other | Setup couldn't finish. Your previous version and data were not changed. (Plus the log path.) |

Missing Edge or .NET Framework 4 shows a warning but doesn't stop Setup.

**A first install that fails or is interrupted.** Setup writes
`installation.json` (state `installing`) before it unpacks anything. If the app
then doesn't start (E16), Setup removes what it added: the app and the runtime,
and, when nothing else is left, `installation.json` and the folder it created.
If the app had already written its default settings to `data`, that folder and
`installation.json` stay. If Setup is killed or the PC loses power part-way,
`installation.json` and `package.next` stay. In every case, running Setup again
cleans up and installs; its Ready page then says that an earlier installation
didn't finish. To give up instead, delete the install folder
(`%LOCALAPPDATA%\LivingRoomDisplay` unless you chose another one with `/DIR`):
an install that never started holds none of your settings or reminders. A
failed reinstall after a keep-data uninstall is different: it leaves your kept
`data`, `backups` and `installation.json` as they were, so don't delete that
folder unless you want to remove your data.

**A damaged installation.json.** Setup and the control script write
`installation.json` like the rollback record below: flushed to the disk, then
swapped in whole, so a crash or a power cut leaves the old or the new marker,
never a torn one ([#199](https://github.com/8roundshock/living-room-display/issues/199)).
A marker that an older version left missing, empty, NUL-filled or not valid JSON
no longer blocks Setup when the folder clearly holds Living Room Display: its
`app\release.json` or `app\package.json` names `living-room-display`, or, without
an `app`, every item in the folder has a name this app creates and
`runtime\node.exe`, `data\state.json` or only the marker is there. Setup then logs
"installation.json ... but the folder holds Living Room Display's files;
continuing with a rebuilt marker", rebuilds a minimal marker and carries on. The
rebuilt marker takes its version from `app\release.json` (with
`"channel": "package"`, so the downgrade guard E12 still holds) or
`app\package.json`; without an app it says `uninstalled` beside kept data, or
`installing`. Setup writes it once the update starts changing files, so a refusal
before that leaves the marker as it was. A source `Update` rebuilds it the same
way. Any other folder is still refused (E10). The rebuilt marker can't say who made
a `runtime.previous`, so that folder is then treated as made by hand: kept by
updates and by uninstall. `Start`, `Stop`, `Status` and `Uninstall` stop with "The
installation marker ... is damaged" and point to Setup or `Update`.

**Rollback.** If the new version fails its health check, Setup restores it
automatically: `app.previous` goes back to `app` (and `runtime.previous` if
this run swapped the runtime). The candidate is kept as `app.failed` and the
previous version is restarted; data is never touched. Before any folder is
renamed, `Stop` waits (up to 10 seconds per process) until the display, its
Edge processes and the server have exited, because a process that is still
ending keeps its folders open. Each rename is retried for a few seconds, and
every step is a whole-folder rename, so a step either happens or leaves its
folders as they were. The rollback never deletes a folder part-way: if an
older `app.failed` is still in use (for example while a virus scanner reads
it), the candidate goes to the next free name, such as `app.failed-2`. The next
Setup run removes earlier `app.failed` copies it can, and uninstall removes
them all.

While a swap or its rollback is under way, `package-transaction.json` in the
install folder records which renames are done. Each change to it is flushed to
the disk and swapped in whole, so a crash leaves either the old or the new
record. If the rollback can't finish (E20), or Setup is killed or the PC loses
power part-way, that record stays. The next Setup run then finishes putting the
previous version back before it does anything else, so `app.previous` is never
mistaken for an older copy and deleted; a refusal later in that run says so
(see **When Setup stops**). A source `Update` refuses to run while the record
exists. Three rare cases:

- **A record left after a healthy install.** Once the new version passes its
  health check, `installation.json` names the swap as committed
  (`committedTransaction`) before the record is removed. If the record still
  can't be removed, the next Setup run or source `Update` deletes it and never
  rolls that install back.
- **A record that can't be read.** If another program holds
  `package-transaction.json` open without letting others read it, for longer
  than a few seconds of retries, Setup moves nothing and stops with E20 ("the
  record of an earlier unfinished update is in use by another program"); a
  source `Update` refuses too. The folders alone can't tell a swap in progress
  from a healthy install that left its record, so nothing is worked out from
  them ([#204](https://github.com/8roundshock/living-room-display/issues/204)).
  Close that program or restart the PC, then run Setup again.
- **A damaged record.** A record that was read but doesn't parse. If
  `installation.json` names a committed update and its `version` is the one in
  `app\release.json`, the record is that healthy install's leftover and is only
  removed. Otherwise Setup logs its text and works the steps out from the
  folders. While a record exists, `app.previous` can only be the app that swap
  moved (the run set any older one aside before it wrote the record), so it goes
  back to `app`; an `app` beside it is the candidate and is kept as `app.failed`;
  a missing `runtime` comes back from `runtime.previous`. Because the damaged
  record carried the marker text to restore, Setup then sets `version` in
  `installation.json` from the restored app's `release.json` (or `package.json`).
  If the folders don't make it clear (`app`, `app.previous` and a staged
  `package.next\app` all present), Setup moves nothing and stops with E20.

If E20 repeats, follow the manual steps below, then delete
`package-transaction.json`. To roll back by hand:

1. Run the installed control script's `Stop`.
2. Rename `app` to `app.failed` and `app.previous` to `app`.
3. Swap `runtime` and `runtime.previous` only if `installation.json` says
   `"runtimePreviousOwner": "package"`.
4. Restore the matching `backups\data-before-...` copy only if the newer
   version wrote data the older one can't read (see the
   [compatibility table](#additive-data-and-rollback-compatibility-84)). Keep
   the newer `data` folder separately.
5. Run `Start`.

`app.previous` carries its own `release.json`. Never run Setup on a PC that has
a live install you care about without its owner's go-ahead and a saved editor
([#130](https://github.com/8roundshock/living-room-display/issues/130)).

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
| `DisableIdle` | Restore the saved Windows screensaver and timeout; remove only the owned sign-in entry. |
| `EnableStartup` | Explicitly enable Start with Windows after owned idle display and Last screen are enabled. |
| `DisableStartup` | Remove only the exact owned sign-in command and save an explicit opt-out. |
| `Uninstall` | Restore idle configuration, stop owned processes and remove app/runtime. |

The installed script also lives at
`%LOCALAPPDATA%\LivingRoomDisplay\app\windows\LivingRoomDisplay.ps1`. Controls can
run there; run `Install`/`Update` from the source clone supplying build sources.

Everyday native launches no longer run PowerShell (#117). The installed
`app\windows\LivingRoomDisplay.scr` also accepts `--start`, `--stop` and `--status`
for backend-only control without opening a window. It uses the app-owned Node,
fixed loopback port and the same ownership record as the script; it refuses a
different process on that port. `--stop` stops only the backend. Use the script's
`Stop` for a full display-and-backend shutdown before an update. Installation,
updates and screensaver registration still use the supported PowerShell script;
an installed PowerShell 7 can run it without an execution-policy override when
the effective policy permits local scripts. No command changes machine or user
execution policy.

Move the mouse or press a key to dismiss ambient mode after its short launch
grace period. `Stop` also dismisses it. The host owns an isolated Edge profile/job;
it does not close normal browser windows. Closing ambient clears the snapshot
and leaves the local server available for later use. `Stop` stops both. The
loopback server is not a Windows service or scheduled task. An opted-in per-user
sign-in entry starts it before idle activation so the five-minute RAM cache exists.
Windows screensaver invocation has a cold-start implementation; its actual `/c`
end-to-end cold test remains unverified as described below.

## Start with Windows and the snapshot cache (#540)

A screensaver that cold-starts its backend cannot show a screenshot from before
that startup. Successful source/package setup, public `Start`/`Editor`/`Display`,
and `EnableIdle` synchronize a per-user Run value only when idle is on, this
installed saver is selected/enabled, and Last screen can be shown either manually
or by an explicitly enabled schedule's referenced saved style. Disabled schedules
and unused saved styles do not authorize startup. This matches backend preview
supervision; the effective board still decides when capture is actually allowed.
The exact value is `"<installed app>\windows\LivingRoomDisplay.scr" --start`.
It uses the existing owned Node backend, opens no browser and needs no admin.
Fresh idle-off installations and source/fixture servers do not register it.

AUTO is the absence of `data/startup.json` and never creates or rewrites that
file during setup. Explicit `EnableStartup` or `DisableStartup` writes only that
small choice; full data backups retain it and updates preserve an opt-out.
Disabling Last screen stops capture/clears RAM immediately; a sign-in entry may
remain inert until the next supported sync as an independent startup choice.
Windows Startup Apps can also disable the existing entry; setup never rewrites
an already exact value or changes Windows' separate approval record.

Registration refuses a foreign command at the same value name, including during
preflight before a source/package swap. DisableIdle/uninstall delete only this
installation's exact owned command, preserving other values. Registration occurs
only after successful install health/commit; failed swaps do not add an entry.
Source checks use mocked registry facts. No actual sign-in/capture acceptance is
implied; agents must not run live startup or native tests as part of those checks.

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

**Keep the screen on** (Style › Motion › Screen, on by default, #436) holds a Screen Wake
Lock while the display shows as the screensaver (`native=1`) or full screen, so
Windows does not turn the screen off or sleep during the session; Windows' own
power settings apply the rest of the time, and a windowed display tab never holds
it. It cannot help when Windows turns the screen off or sleeps *before* the
screensaver starts: the editor's Screen part reads the power plan's display-off
and sleep timeouts (`powercfg /query`, read-only) and warns when either is shorter
than the screensaver wait. Change them in Settings › System › Power & sleep, or
choose a shorter wait. The native host's own hold (`SetThreadExecutionState`) is
[#442](https://github.com/8roundshock/living-room-display/issues/442).

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
| `installation.json` | Non-secret ownership/state and source provenance, retained for reinstall. Written durably (flushed, then swapped in whole). |
| `package-transaction.json` | Setup installs only: present while an update or its rollback is unfinished (see [Rollback](#install-with-setup-recommended)). |
| `removing`, `removing-2`, ... | A folder being deleted: Setup, `Update` and `Uninstall` rename a folder to one of these names first, then delete it. One left behind (a file in it was in use) is removed by the next Setup run, `Update` or `Uninstall`. |

Use the editor's export, or stop the app and copy `data` to a private backup.
Snapshot pixels and native tokens are RAM only and excluded from persisted
data/exports/diagnostics. Do not include private data or screenshots in reports.

For an update, review/pull the desired source revision and run `Update`. The
installer builds first, keeps data outside app files, stops owned processes,
and retains `app.previous`. A build/dependency failure leaves the installed app
untouched. Before it stops anything, `Update` sets the older `app.previous`
aside by a rename and deletes it from there; if a file in it is open, `Update`
stops with "Update stopped before stopping or replacing anything: A file in
...\app.previous is in use" and the app keeps running
([#200](https://github.com/8roundshock/living-room-display/issues/200)). Its
folder renames are plain renames, retried briefly, never a copy. A missing or
damaged `installation.json` is rebuilt as described under **A damaged
installation.json** above. A replacement failure restores the prior app directory. To roll back,
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

The frozen rollback reader is `d66832b` (the merge of PR #491). Its reader
rejects unknown keys, so an additive key written to disk would make `state.json`,
and after the next save `state.backup.json`, unreadable by it. `d66832b` reads
default data with Fixed brightness and Dynamic off with all sources on, including
every choice that was
an exception for `bedca44` (custom Reminders sizes, Native colours, Animation Off or
Lively, and the new widgets of #78 with their content), so that revision remains a
data-compatible rollback target unless a choice in the table below was used. This build still omits a few additive values from files and
exports while they equal the value the current reader restores (see
[API](api.md#persistence-and-recovery)). `d66832b` reads `accentMode`, `animation`
and pre-Dynamic `widgetData` either way, so their omission is optional. It was kept to avoid a
data-format change ([#272](https://github.com/8roundshock/living-room-display/issues/272)).
`d66832b` does not know `daylightBrightness`, so omitting its Fixed value (`null`) is
required: that is what keeps Fixed data readable.
Swap places' `rearrange` and the `screen` section (#436) are also unknown to
`d66832b`: both are omitted while they hold their defaults (Swap places off, Keep
the screen on on); a non-default choice is a documented exception below.

`src/server/rollback.test.ts` (part of `npm test`) proves this with a byte-for-byte
copy of the `d66832b` reader: fresh Native data, previous-release data after unrelated
saves, saved styles, a photo, a revision-one legacy file, the export, each former
`bedca44` exception, Reset layout to the #435 default board (which `d66832b` reads as
the same board, Calendar included), and every optional omitted value written out in full, in
`state.json`, `state.backup.json` and the export, all parse. Fixed brightness is
omitted at rest and parses; a Follow daylight range in the settings, a saved style or
the export is rejected until Fixed is saved again or the key is stripped. The default
board adds no key: it only changes which widgets a fresh data folder shows and where. Its negative
controls show that an unknown key and invalid values are still rejected. After each
coordinated install, the baseline moves to the newly installed revision (#130).

A non-default choice that `d66832b` cannot read is listed here. Before rolling back
after using one, either switch it back and save (then save once more, so
`state.backup.json` holds the switched-back settings too), or follow the
[revision 2 procedure](#widget-geometry-revision-2-update-and-rollback): keep the
newer data directory and restore the matching pre-upgrade data copy.

| Feature | Data the previous release (`d66832b`) cannot read |
| --- | --- |
| Everything up to `d66832b` (#73, #74, #75, #76, #78 and the polish since) | None. |
| Saved-style schedule (#514) | None in canonical state, backup or export. The separate `schedule.json` and `schedule.backup.json` sidecars are ignored by older releases; older releases use the saved manual style. Keep both sidecars with a complete private data backup. The schedule's separate export refers to saved style IDs and excludes the temporary override. |
| Brightness → Follow daylight (#439) | `appearance.daylightBrightness` in the settings and in saved styles made while it was on. Fixed, the default, writes no key, so Fixed data stays readable. See [removing Follow daylight before a downgrade](#removing-follow-daylight-before-a-downgrade). |
| #437 Dynamic | An enabled Dynamic widget, a saved style made while it was on, or Dynamic sources other than all on. Before rolling back to `d66832b`, turn all sources on, remove Dynamic, delete or re-save styles that include it, then Save; or restore the pre-upgrade data copy. The next reader bump (#130) removes this exception. Dynamic off with its sources all on is omitted at rest, and its transform is never written (#135), so that data reads. |
| #436 **Swap places** on (`appearance.rearrange: true`, also inside a saved style) | The settings, the backup after the next save, and exports. Switch **Swap places** off (and re-save or delete a saved style that has it on), Save, then roll back; or restore the pre-update copy. |
| #436 **Keep the screen on** off (`screen: { keepAwake: false }`) | The settings, the backup after the next save, and exports. Switch **Keep the screen on** back on, Save, then roll back; or restore the pre-update copy. |
| #436 float (the default: no swap, keep the screen on) | None: both keys are omitted at rest. |

<a id="rolling-back-the-installed-3446400"></a>

#### Historical rollback pair for d66832b

At the `d66832b` installation, `3446400` (the merge of PR #286) was recorded as
`app.previous`. This is historical evidence; recheck the current installation and
recovery pair before using it. [STATUS.md](../STATUS.md) records the latest marker
observation, which does not establish the current backup directory contents. `3446400` was
installed on 2026-10-19 over `4cb7dc1` (the merge of PR #327), which had replaced
`3fee844` the same day.

| Rolling `d66832b` back to | Data it cannot read |
| --- | --- |
| `3446400` (`app.previous`) | None, as proven against the `3446400` reader by `npm test` at `d66832b`. |
| `4cb7dc1` | None: its reader is the same eight files as `3446400`'s, with the same git blob ids. |
| `3fee844` | None: `npm test` at `d66832b` also passes against a copy of the `3fee844` reader (checked for #497). |

<a id="rolling-back-the-installed-3fee844-to-bedca44"></a>

#### Earlier rollback target: bedca44

`bedca44` (PR #70) was `app.previous` while `3fee844` was installed, and the
previous-release reader until #263. It cannot read custom Reminders sizes (#73),
Native colours (#75), Animation Off or Lively (#76), or an enabled #78 widget, its
content or a transform for it. Every file and export written since #263 carries the six #78
widget keys, so `bedca44` cannot read data from `4cb7dc1`, `3446400`, `d66832b` or this build,
even with default choices. A rollback that far needs the data copy taken before
`3fee844` was installed, or one ordinary save in `3fee844` first, which omits the
unused #78 widgets at rest again. The #74 Weather and Rain merge added no keys: an
enabled Rain merges into Weather in memory, the next ordinary save writes
`rain: false` with Weather in the merged cells, and only a pre-upgrade data copy
restores a separate Rain placement. The per-feature table and its workarounds stay
in [install.md at `3446400`](https://github.com/8roundshock/living-room-display/blob/34464001af41af0e2ea67fb090734b296f72c1c2/docs/install.md#rolling-back-the-installed-3fee844-to-bedca44).
`src/server/compat/bedca44/` is kept unedited only as a legacy-data fixture.

#### Removing custom Reminders sizes before a downgrade

A custom size is stored as `span` beside the placement's `size`, and `size` is
always the largest family inside the span. Deleting every `span` therefore leaves
each Reminders widget at that family in the same corner, inside its old cells, so
the layout stays valid and collision-free (`src/server/freesize.test.ts` proves
this). Prefer the pre-upgrade data copy; use this only when newer reminders or
settings must be kept. Run it **after** restoring the older app, with that app
stopped; it validates with the installed (older) app's own reader before
preserving the data folder and replacing anything. If you chose another install
folder with Setup's `/DIR` (or `-InstallRoot` for a source `Install`), set
`$installRoot` to that folder in the first line; with a wrong folder the script stops
before it runs anything:

```powershell
$installRoot = Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay' # or your /DIR folder
$control = Join-Path $installRoot 'app\windows\LivingRoomDisplay.ps1'
$node = Join-Path $installRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $control -PathType Leaf) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) { throw ('No installed app under ' + $installRoot + '. Set $installRoot to your install folder.') }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Stop
$dataDirectory = Join-Path $installRoot 'data'
$validator = Join-Path $installRoot 'app\dist\server\validation.js'
$source = Join-Path $dataDirectory 'state.json'
$candidate = Join-Path $installRoot ('strip-spans-' + [Guid]::NewGuid().ToString('N') + '.json')
$stripCode = @'
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
  const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  const grids=[data.settings?.widgetGrid,...(data.settings?.savedPresets??[]).map(preset=>preset?.visual?.widgetGrid)];
  for(const grid of grids) for(const placement of Object.values(grid?.placements??{})) if(placement&&typeof placement==='object') delete placement.span;
  const {dataSchema}=await import(pathToFileURL(process.argv[2]).href);
  dataSchema.parse(data);
  fs.writeFileSync(process.argv[3],JSON.stringify(data,null,2),{encoding:'utf8',flag:'wx'});
})().catch(()=>{console.error('Validation failed after removing custom sizes; preserved data was not modified.');process.exitCode=1;});
'@
& $node -e $stripCode $source $validator $candidate
if ($LASTEXITCODE -ne 0) { throw 'Validation failed; stop without replacing data.' }
$preserved = Join-Path $installRoot ('data-before-strip-' + [Guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $dataDirectory -Destination $preserved -Recurse -ErrorAction Stop
Move-Item -LiteralPath $candidate -Destination (Join-Path $dataDirectory 'state.json') -Force -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $dataDirectory 'state.json') -Destination (Join-Path $dataDirectory 'state.backup.json') -Force -ErrorAction Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Start
```

If `state.json` itself is unreadable, point `$source` at `state.backup.json`. Only
`span` keys are removed; any other data the older app cannot read (for `bedca44`,
see the note above) still needs its own handling, and validation stops with nothing
replaced. The preserved
folder keeps the original files; keep it private. An export that contains spans
must be stripped the same way (delete `settings.widgetGrid.placements.*.span` and
`settings.savedPresets[].visual.widgetGrid.placements.*.span`) before importing it
into the older app.

#### Removing Follow daylight before a downgrade

Follow daylight (#439) is stored as `appearance.daylightBrightness`; `brightness`
beside it keeps the Fixed level. Deleting the key therefore leaves Fixed brightness at
that level, which `d66832b` reads (`src/server/rollback.test.ts` proves this for
`state.json` and the export). Prefer doing it in the newer app before the rollback:
choose Style → Brightness → **Fixed** and Save, then save once more (any settings or
reminder change) so `state.backup.json` no longer holds the range either. A saved
style made while Follow daylight was on still carries it: apply it, choose Fixed and
update it, or delete it, and export again afterwards if you want a backup the older
app can import.

If the older app is already restored, use the procedure above for custom sizes with
one change: in `$stripCode`, replace the `grids` and `for` lines with

```powershell
  const looks=[data.settings?.appearance,...(data.settings?.savedPresets??[]).map(preset=>preset?.visual?.appearance)];
  for(const look of looks) if(look&&typeof look==='object') delete look.daylightBrightness;
```

and name the candidate `strip-daylight-…` instead of `strip-spans-…`. It validates
with the older app's own reader before it preserves the data folder and replaces
anything. An export taken while Follow daylight was on needs the same deletion
(`settings.appearance.daylightBrightness` and
`settings.savedPresets[].visual.appearance.daylightBrightness`) before the older app
imports it.

### Runtime updates and installed provenance

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

### Uninstall and retained data

`Uninstall` retains `data` by default. Add `-RemoveData` to explicitly delete it.
Run uninstall from the clone so removal does not remove its executing script.
It renames each folder it removes, `app` first (and `data` and `backups` last with
`-RemoveData`), to `removing`, `removing-2`, ... inside the install folder before
it deletes any ([#207](https://github.com/8roundshock/living-room-display/issues/207)).
If a file in one of them is open, it puts back the folders it had renamed and
stops with "Uninstall stopped and left the app in place: A file in <folder> is in
use: ..."; nothing is half-deleted, and running it again once that program is
closed finishes. A renamed folder that can't be deleted yet stays as
`removing...`; the next `Uninstall`, `Update` or Setup run removes it.
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

The editor does both without PowerShell: **Style > Data & recovery > Export saved
data** downloads the backup, and **Restore from backup...** restores one
([#234](https://github.com/8roundshock/living-room-display/issues/234)). After you
pick the file, the editor checks it and shows its date and contents with
**Restore** and **Don't restore**; it refuses while settings edits are unsaved
(save or cancel them first). A restore replaces your saved settings, saved styles
and reminders with the backup's and keeps your current photo, which a backup never
contains. The state it replaced stays on this computer only as the automatic
recovery backup (`data\state.backup.json`), and only until the next saved change
of any kind: a settings save, a new photo or any reminder change (adding, editing,
checking off or deleting one) overwrites it. That file is read only when
`state.json` can't be, or by hand; the editor can't restore it. To keep what you
have now, export it before you restore. Use the offline steps below only when the
editor can't open.

If both `data\state.json` and `state.backup.json` are unreadable, startup refuses
to overwrite them and the online import endpoint is unavailable. Keep installed
app/runtime files, stop the app with its control script, and use a valid export.
The following validates against this installed version's schema before preserving
the data folder and replacing anything. Set `$installRoot`/`$backupFile` to your
actual paths (`$installRoot` is your Setup `/DIR` or source `-InstallRoot` folder if
you chose one); with a wrong folder the script stops before it runs anything. Do
not use an export from an incompatible future schema version.

```powershell
$installRoot = Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay' # or your /DIR folder
$control = Join-Path $installRoot 'app\windows\LivingRoomDisplay.ps1'
$node = Join-Path $installRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $control -PathType Leaf) -or -not (Test-Path -LiteralPath $node -PathType Leaf)) { throw ('No installed app under ' + $installRoot + '. Set $installRoot to your install folder.') }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $control Stop
$dataDirectory = Join-Path $installRoot 'data'
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
- Check that native `Display` shows no pointer for its whole session, that
  keyboard or mouse input (including during startup and its first second)
  dismisses it, and that the ordinary pointer returns. Keep idle off until the
  installed helper passes this native cursor/dismissal/restoration acceptance; CSS
  or a cursor-free screenshot alone does not establish it.
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
