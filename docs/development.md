# Development

The `context-help` browser suite covers compact Home/editor help with synthetic
data: hover persistence, keyboard focus and Escape, first-tap toggling, outside
actions, picker dismissal, narrow layouts and unsaved-draft preservation. It is
in the pull-request set. Its optional `capture` export returns images in RAM for
visual review; it does not write captures or inspect an installed profile.

Use Node 24 LTS and npm. Application dependencies are pinned in `package.json`
and `package-lock.json`. The React display/editor, local backend and native host
sources are implemented. Current-PC install, data lifecycle and native preview
checks passed; see [Windows evidence and remaining limits](windows.md#verification).
Do not replace an existing system Node or application runtime to work on this project.

## Application commands

For #525's bounded source-only Windows verification, use an installed PowerShell
whose effective policy already permits the script, with inherited module/policy
overrides cleared as described below:

```powershell
pwsh -NoProfile -File windows/tests/Test-PreIdleSource.ps1
```

This compiles both production binaries without running them, then executes pure
policy/claim/lifetime/framing tests, synthetic bitmap encoding, fake host/input/
surface/runtime checks, mocked preparer lifecycle and static installer policy.
It never calls the installed backend or runs a watcher/display/desktop capture.
The broader `Test-Windows.ps1` is a different integration scope; do not substitute
it when only source checks are authorized. Installer smoke CI sets the disable-only
`LRD_PREVIEW_PREPARER_DISABLED=1` so package lifecycle checks do not capture pixels.

From the checkout with Node 24/npm available:

```powershell
npm ci
npm run build
npm test
npm start
```

The production app serves Home at `http://127.0.0.1:4318/`, Edit display (the editor) at
`http://127.0.0.1:4318/editor` and the ambient view at `http://127.0.0.1:4318/display`;
`/api/health` verifies server readiness.
It stores data in the per-user directory documented in [API](api.md), not Git or
browser storage. Set `LRD_DATA_DIR` to an isolated test folder before integration
experiments: a source run without it uses the installed app's data folder (on Windows
`%LOCALAPPDATA%\LivingRoomDisplay\data`), its live private data. `LRD_PORT` can choose
another unprivileged local port. Ctrl+C stops it.

Build before `npm start` on a fresh clone: `npm run build` typechecks and builds
both server and browser assets. `build:server` alone does not produce the UI.
For development use `npm run dev:server` and `npm run dev` in separate terminals.
Vite listens on loopback port 5173 and proxies `/api` to 4318. The development
server explicitly accepts that origin; production does not expose CORS access.
Source runs may use `LRD_PORT`; the installed Windows helper/control script uses
fixed loopback port 4318 and overrides an inherited `LRD_PORT` for its owned server.
Do not run two instances there. The Windows installer uses a separate app-owned
Node 24 runtime and never changes system Node. See [installation](install.md) for
runtime updates, rollback, reparse restrictions and data recovery.

For nonintrusive Windows regression checks (process-scoped policy only):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Test-Windows.ps1
```

Pass `-NodeExe '<Node24 node.exe>'` to also test exact owned-process/start-time
recognition. Native capture/fullscreen/lock acceptance remains separate. The native
surface and active-session input-baseline regressions (`SurfacePolicyTests`,
`ActiveInputTests`) run without a window or real input; the Windows installer
workflow runs them under both PowerShell 5.1 and 7 when `windows/` changes. Follow
[CONTRIBUTING.md](../CONTRIBUTING.md) and the [agent runbook](agent-runbook.md) for
self-service issue/fork/fix handoff; neither enables automatic reporting.

When an installed PowerShell 7 permits local scripts, `pwsh -NoProfile -File
.\windows\Test-Windows.ps1` runs the same checks without a policy override. Child
PowerShell checks inherit that host's effective policy instead of overriding it.
The native `ServerRuntimeTests` cover ownership, foreign listeners and cancellation
without a display window; native everyday startup itself uses no PowerShell (#117).
With `-NodeExe`, a second runtime check uses a copied Node and synthetic data on an
ephemeral loopback port to verify cold startup, actual process/listener ownership,
and PowerShell/native recognition and stop in both directions. It never contacts
the installed server on 4318.

Optional production cursor regression, using an already available Playwright
module and Edge plus an isolated source server:

```powershell
node windows/tests/Test-CursorBrowser.mjs --base-url http://127.0.0.1:4324 --playwright '<Playwright module path>' --edge '<msedge.exe path>'
```

It intercepts state with synthetic data and checks actual computed cursor styles
through loading/error, widgets, editor navigation/embedded preview and a new
display tab. It saves no images or app data. This requires Node 24; Playwright
is a verification tool, not an app runtime dependency. Native cursor visibility
and restoration remain separate Windows acceptance checks.

## Rollback compatibility check

`npm test` includes `src/server/rollback.test.ts`. It writes synthetic data in
temporary folders and parses the results with the frozen previous-release reader in
`src/server/compat/` (excluded from the build). To prove a change keeps default
data readable by the previous release, add a scenario that saves through the store
or API and call `assertPreviousReaderAccepts('data' | 'import', value, label)` from
`src/server/compat/previous-reader.ts` on `state.json`, `state.backup.json` or the
export. Use `assertPreviousReaderRejects` for a documented exception, and record
it in the [install rollback table](install.md#additive-data-and-rollback-compatibility-84).
Never edit the vendored copy; the coordinator replaces it after each install (#130).

Browser widget checks live in `tests/ui/widget-checks/`, one module per widget
(`id`, optional `prepare`, `selectors`, `family` and a once-per-viewport `sweep`).
The widget harness loads every module in that folder and requires one for each
active catalog id; extra modules such as `reminders-span.mjs` add only a sweep.
A newly active widget also joins `FULL_BOARD` in `tests/ui/palette-browser.mjs`,
plus `ACCENT_SELECTOR` (a new kind of accent element) or `TEXT_ONLY` (no accent
element), so the palette harness checks its colours (#214), and the shared
`FULL_BOARD` in `tests/ui/lib/boards.mjs`, which the canvas scope harness uses to
check that no studio rule reaches it on the editor canvas (#313). The `home` suite
(`tests/ui/home-browser.mjs`, #438) drives Home end to end with the display beside it: its
server follows the pages' fake clock, so timers end on cue. The motion and
widgets suites keep their own copies of that board until
[#388](https://github.com/8roundshock/living-room-display/issues/388).
The widgets suite is the longest: 10–12 minutes on the owner's PC on 2026-10-19 with
other suites running, and up to 30 minutes when several widgets suites share the
machine. Its display loads therefore wait up to 90 s for a specific element (#306).

## Browser suites

The `tests/ui/*-browser.mjs` suites drive the built app in headless Microsoft Edge
through Playwright. Each starts its own loopback server on an ephemeral port with
temporary synthetic data, keeps screenshots in RAM and never uses an installed app
or port 4318. Playwright and sharp (the preview suite measures pixels with it) are
verification tools, not app dependencies: never add them to `package.json`. CI pins
Playwright 1.62.1 and sharp 0.35.5; install the same versions outside the checkout
(installing `playwright` downloads no browser) and run every suite after `npm ci`
and `npm run build`:

```powershell
npm install --prefix "$env:TEMP\lrd-browser-tools" --no-save --no-package-lock playwright@1.62.1 sharp@0.35.5
$tools = "$env:TEMP\lrd-browser-tools\node_modules"
node tests/ui/lib/run-suites.mjs --playwright "$tools\playwright" --edge "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --sharp "$tools\sharp"
```

`tests/ui/lib/run-suites.mjs` runs the suites one after another, each in its own
process, and ends with a pass/fail and time summary. Name suites to run only those
(`... widgets palette`), use `--set pull-request` for CI's set, `--repeat 5` for
consecutive runs when checking a flake, `--no-gpu` to pass that option to the
motion suite and `--list` for the sets. A suite also
runs on its own as `node tests/ui/<name>-browser.mjs --playwright <module> --edge
<browser>`; the preview suite also takes `--sharp <module>`, and the motion suite
`--no-gpu` (no GPU-dependent checks) or `--skip-performance`.

CI runs them in `.github/workflows/browser-suites.yml` (#323) on `windows-2025` with
Node 24 and the runner's Edge, in one job per set. It installs the pinned tools into
the runner's temporary folder (the step fails if `package.json` or the lockfile
changes), runs one set through the runner and uploads nothing. Pull requests and
pushes to `main` run the **pull-request set**: the widgets suite, so a fix that leaves
a no-longer-needed allowance fails CI, and every suite that takes under a minute on
the runner. The weekly schedule (Monday 07:23 UTC) and a manual run
(`workflow_dispatch`) add the **scheduled set**, the slower motion, palette and
weather suites. A change to Markdown files only skips the workflow. On the first
CI runs the pull-request set took about 11 minutes of suites (widgets about 6) plus
about a minute of setup, and the scheduled set about 6; every run still takes runner
time and delays a PR's checks, so weigh adding a slow suite to the pull-request set
against that
([#384](https://github.com/8roundshock/living-room-display/issues/384)). The Dynamic
suite (#437) joined the pull-request set at about 50 seconds locally; its runner time is
not measured yet. The runner
has no GPU, so CI passes `--no-gpu` to the motion suite: its resting glyph pixel
parity and #248 frame budget depend on GPU rasterising and stay local checks. A new
suite fails the runner until it is placed in one set in
`tests/ui/lib/run-suites.mjs`.

A suite that fails and then passes on a rerun with no change is a flake, not a
pass: record it on its ticket (or a new one) with the run, the load on the machine
and the failing step, and keep a suite with a known flake out of the pull-request
set until it is fixed.

A filtering proxy or ad blocker on the test machine can add its own script to the
suites' pages (AdGuard for Windows, for example, loads
`http://local.adguard.org/?…&type=content-script…` into every page), which slows the
suites and, under load, has failed one with a console error. The motion and canvas
scope suites answer every request outside their own server with an empty response
(`tests/ui/lib/local-only.mjs`) and list it; the other suites do not yet
([#392](https://github.com/8roundshock/living-room-display/issues/392)).

Every source-browser context must answer `/api/windows/status` with synthetic
device facts before navigation. `keepPagesLocal` installs the default fixture;
contexts that do not use that helper call `mockWindowsStatus` directly. The
Screen suite registers scenario-specific synthetic responses after that default.
Headless source QA must not read the testing machine's registry or power settings.
Unit tests likewise pass a synthetic runner and platform to `windowsStatus` and
`powerStatus`; their ordinary application defaults continue to query the device.

## Local checkout and agent startup

On Windows, from the checkout (replace `<checkout>` with its actual path):

```powershell
Set-Location '<checkout>'
git status --short --branch
git remote -v
codex -C '<checkout>'
```

Checked 2026-10-18: `Get-Command codex` resolves a CLI and `codex --version`
reports `codex-cli 0.163.0`; its `--help` confirms that `-C` sets the working directory.
The final command launches an agent, not the display; no interactive launch was
performed as part of these checks. On another computer, use
the agent actually installed there. An agent that does not discover
instruction files must be told to read `AGENTS.md` explicitly.

`CLAUDE.md` and `GEMINI.md` import `AGENTS.md`, following the official
[Claude import syntax](https://code.claude.com/docs/en/memory#import-additional-files)
and [Gemini import syntax](https://geminicli.com/docs/cli/gemini-md/#modularize-context-with-imports).
Live startup in those clients has not been tested on this PC. These pointers do
not change global agent settings or start background work.

For explicitly authorized CLI collaboration, use the
[bounded Claude workflow](claude-collaboration.md), including its current
verification limit. Discovery/authentication checks alone are not a successful task.

## GitHub authentication on Windows

This section is for the owner's repository maintenance. End users must not need
this helper, this identity, or any owner credential to install or run a release.
Other contributors use their own authorized GitHub access and normal Git/PR
workflow. See [installation readiness](install.md).

Use [scripts/gh-personal.ps1](../scripts/gh-personal.ps1) for GitHub CLI operations
on this PC. It uses the existing `8roundshock` Git credential in memory, verifies
the login, exact origin and exact repository name, scopes GitHub CLI environment
variables to the command, and restores them afterward. It accepts either
repository visibility and never changes it. It does
not require the personal-memory repository or write a token to disk.

```powershell
.\scripts\gh-personal.ps1 api user --jq '.login'
.\scripts\gh-personal.ps1 repo view --json 'nameWithOwner,visibility,url'
```

The helper finds an installed `gh` on PATH or at this PC's existing user-level
GitHub CLI location. It does not install packages or change global accounts.
Where ordinary `gh` is already authenticated to `8roundshock`, it may be used
with the same explicit identity and repository verification. Bare `gh`
authentication has not been established by this scaffold.

`pr create`, `pr view`, `pr comment`, `pr merge`, `issue` commands and `api` work
with the helper's credential. `gh pr edit` does not: it also queries organisation
fields over GraphQL, which need the `read:org` scope that this credential lacks
("Your token has not been granted the required scopes ... `read:org`"). Do not
broaden the token ([#181](https://github.com/8roundshock/living-room-display/issues/181));
change a PR's body or title through the REST API instead:

```powershell
.\scripts\gh-personal.ps1 api -X PATCH repos/8roundshock/living-room-display/pulls/<n> -F 'body=@.local/pr-body.md'
.\scripts\gh-personal.ps1 api -X PATCH repos/8roundshock/living-room-display/pulls/<n> -f 'title=#<ticket> - <Ticket Name>'
```

Write the body file as UTF-8 without a byte-order mark: Windows PowerShell 5.1's
`Set-Content -Encoding UTF8` and `Out-File` add one, and it becomes the first
character of the PR body. PowerShell 7's `Set-Content -Encoding utf8` and most
editors write none. From Git Bash, give API endpoints without a leading slash;
Git Bash rewrites `/repos/...` into a Windows path.

Do not broaden credential scopes or switch accounts as a routine
workaround. If the personal credential or CLI is unavailable, report the exact
blocker. Credential lookup disables Git terminal prompts and Git Credential
Manager interaction for the command, restoring both settings afterward. Never
print credential output or persist a token.

Direct Git uses the repository-local personal identity and credential username.
Before pushing, verify the exact origin and the helper's identity/repository checks:

```powershell
git remote get-url origin
git config --local user.name
git config --local user.email
git config --local credential.https://github.com.username
.\scripts\gh-personal.ps1 repo view --json 'nameWithOwner,visibility'
```

Expected origin: `https://github.com/8roundshock/living-room-display.git`.
Commit with the owner's GitHub noreply email
(`78567380+8roundshock@users.noreply.github.com`, owner decision on
[#441](https://github.com/8roundshock/living-room-display/issues/441)); GitHub login
and credential username: `8roundshock`. Configure identity only in this repo if
needed. See the [PR workflow](agent-workflow.md).

## PowerShell host for project scripts

An agent shell may start PowerShell from a runtime bundled with an agent, possibly
a different agent, or pass an inherited execution-policy override. On the owner's
PC on 2026-10-18, one agent's PowerShell tool ran another agent's cached `pwsh` with
`-ExecutionPolicy Bypass`, and that `pwsh` was also first on `PATH` in Git Bash.
A project script started that way depends on a runtime the project does not own
and on a policy override nobody chose for that command. Before running a project
`.ps1` from an agent shell, confirm the host inside the same PowerShell that will run
it. This check works in Windows PowerShell 5.1 and PowerShell 7:

```powershell
(Get-Process -Id $PID).Path; $PSVersionTable.PSVersion
Get-ExecutionPolicy -List
(Get-AuthenticodeSignature (Get-Process -Id $PID).Path).SignerCertificate.Subject
```

The path decides whether this is the installed PowerShell you intend to use. The
signature does not: an agent's cached copy (for example under
`~/.cache/codex-runtimes/`) carries the same valid Microsoft signature as an
installed `pwsh`, so the signature only confirms the binary is authentic.

From Git Bash, a bare `pwsh` or `powershell.exe` resolves through `PATH`. Run the
check with `-Command` on the exact executable you intend to use, and single-quote
the command: inside double quotes Git Bash expands `$PID` and `$PSVersionTable`
itself, to empty strings, before PowerShell sees them. With the owner's Store
`pwsh` (substitute your install path; the path may stay in double quotes):

```bash
"$LOCALAPPDATA/Microsoft/WindowsApps/pwsh.exe" -NoProfile -Command '(Get-Process -Id $PID).Path; $PSVersionTable.PSVersion; Get-ExecutionPolicy -List'
```

If the host is
not an installed PowerShell you intend to use, or the Process scope shows an
override you did not request, call an installed PowerShell explicitly. Clear the
inherited `PSExecutionPolicyPreference`, which carries a parent's `-ExecutionPolicy`
to child processes, and the inherited `PSModulePath`. A module path from another
PowerShell or a bundled runtime can stop Windows PowerShell 5.1 from loading its own
core modules; on that PC, `Get-ExecutionPolicy` then failed with
`CouldNotAutoloadMatchingModule`. Use the actual install path. This owner example
uses the Microsoft Store `pwsh`; substitute your own script and arguments:

```bash
env -u PSModulePath -u PSExecutionPolicyPreference \
  "$LOCALAPPDATA/Microsoft/WindowsApps/pwsh.exe" -NoProfile -NonInteractive \
  -File scripts/gh-personal.ps1 repo view --json 'nameWithOwner,visibility'
```

The same variable clearing applies when `powershell.exe` is the intended host, but
Windows PowerShell 5.1 then commonly runs no script at all: on a Windows client
every scope is usually `Undefined`, so the effective policy is `Restricted`
(PowerShell 7 from the Store reports LocalMachine `RemoteSigned`). That is why
every documented 5.1 command carries its own process-scoped
`-ExecutionPolicy Bypass`; a script documented without one, such as the auth
helper, runs under PowerShell 7 or needs that explicit option.

Every documented project command that passes `-ExecutionPolicy Bypass` makes a
deliberate, process-scoped choice for that command; none is an inherited default.
They are the `windows\Test-Windows.ps1` command above, the `LivingRoomDisplay.ps1`
commands in [installation](install.md), the installed `Status` command in the
[agent runbook](agent-runbook.md), Setup's own `powershell.exe` runs of
`InstallPackage` and `Uninstall` (`windows/installer/LivingRoomDisplay.iss`, see
[Windows](windows.md)), and the [Windows](windows.md) guidance to use a
process-scoped Bypass where script policy requires it. Do not change global
execution policy, agent configuration or `PATH` to work around an unexpected host;
report it. See [#81](https://github.com/8roundshock/living-room-display/issues/81)
and [#210](https://github.com/8roundshock/living-room-display/issues/210).

## Verification now

Run `git diff --check` for working changes and `git diff --cached --check` for
staged changes. Review changed files and check relative Markdown links and agent
imports resolve within the checkout. Check that status, requirements, and
architecture agree about what is implemented and what is pending.

For helper changes, exercise a real read-only identity/repository query and verify
that process environment variables are restored. Review output for accidental
credential disclosure. Do not add tests that simply repeat script statements.

CI installs the lockfile, typechecks, runs tests, and builds the full application
on Windows and Linux with Node 24, and runs the browser suites on Windows
([browser suites](#browser-suites)). Every PR still needs an independent review
agent; CI is not that review.
UI checks
require actual visual inspection, not only compilation or a successful tool call.

Keep temporary PR bodies and scratch files under ignored `.local/`. Do not commit
screenshots, private reminders, weather location details, or local credentials.
Capture screenshots only for authorized verification and keep them in memory;
persistent copies require an explicit user request. Honor physical stop and
applicable screenshot safeguards.

## Building the Windows installer

The Setup build is reproducible from a clean commit
([#77](https://github.com/8roundshock/living-room-display/issues/77)):

```powershell
# Node 24 first on PATH. Builds and checks payload.zip + release.json only.
.\windows\installer\Build-Installer.ps1 -PayloadOnly
.\windows\installer\tests\Test-InstallerPayload.ps1 -ArchivePath .local\installer\payload.zip -ReleaseJson .local\installer\release.json
```

- `Build-Installer.ps1` exports `HEAD` with `git archive` into
  `.local\installer-build-<id>`. It then runs `npm ci` and `npm run build`, and
  assembles `app\` (the built `dist`, production `node_modules`, `package.json`,
  the lockfile, the control script, the helper with the generated icon and version
  info, and `THIRD-PARTY-NOTICES.txt`). It adds the official Node ZIP pinned in
  `windows/installer/runtime.json` (downloaded once into `.local\installer-cache`,
  SHA-256-checked, `node.exe` OpenJS signature and `--version` checked). Then it
  writes the exact `release.json` manifest and a stored `payload.zip`, and
  without `-PayloadOnly` compiles `windows/installer/LivingRoomDisplay.iss`. The
  work folder is removed afterwards unless you pass `-KeepWork`.
- It refuses a dirty tree. `-AllowDirty` builds the tracked changes for a local
  experiment and records `sourceState: dirty`; CI always refuses it. Use
  PowerShell 7 locally: the Node runtime has long paths. Expect about 120 MB
  of payload and a Setup file of about 27 MB (0.1.0 in CI: 27.1 MB).
- Pins: `runtime.json` must name the control script's default `NodeVersion`
  (the policy test enforces it); `inno.json` sets the minimum (6.7.0) and tested
  (6.7.1) Inno Setup with the tested installer's SHA-256. Change a pin in its own
  reviewed PR.
- The release version is `package.json`'s `version` (x.y.z). The coordinator
  bumps it with `npm version <x.y.z> --no-git-tag-version` in a release PR; the
  health endpoint, helper file version, Apps & Features entry and setup name follow.
- Run the ISCC compile and the install/uninstall smoke test only in CI
  (`.github/workflows/installer.yml`). It runs on installer-related pull
  requests, pushes to `main` and manual dispatch, and uploads a 14-day artifact.
  A pull request from a fork builds and checks the installer but uploads nothing
  and skips the smoke job, so an installer built from unreviewed fork code is never
  offered as this repository's artifact; the push to `main` after merge runs it.
  CI also passes `-RollbackTestOutputDirectory`, which builds a second Setup,
  `LivingRoomDisplaySetup-<version>-rollback-test.exe`, from the same files
  except `app/package.json`, whose version no longer matches `release.json`.
  Its server fails the health check, so the smoke test can watch a real
  automatic rollback ([#189](https://github.com/8roundshock/living-room-display/issues/189)).
  It is unsigned, kept as a one-day artifact, and must never be distributed.
  `windows/installer/tests/Test-InstallerSmoke.ps1` refuses to run outside
  GitHub Actions or on any PC with an install, a 4318 listener or the Setup
  registration.
- **Never run `LivingRoomDisplaySetup-*.exe`, its uninstaller or the smoke test
  on a PC with a live install** (the owner's included): Setup stops and replaces
  that install. Owner-PC adoption is a coordinated step with the owner's go-ahead
  and a saved editor ([#130](https://github.com/8roundshock/living-room-display/issues/130)).
- Local checks: `windows/Test-Windows.ps1` (under Windows PowerShell 5.1 and
  PowerShell 7) includes `windows/tests/Test-PackageInstall.ps1`, which runs the
  InstallPackage transaction with synthetic packages and mocked process, port
  and health boundaries, and `windows/installer/tests/Test-InstallerPolicy.ps1`
  (static `.iss`, pin and workflow rules).
