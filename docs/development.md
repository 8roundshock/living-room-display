# Development

Use Node 24 LTS and npm. Application dependencies are pinned in `package.json`
and `package-lock.json`. The React display/editor, local backend and native host
sources are implemented. Current-PC install, data lifecycle and native preview
checks passed; see [Windows evidence and remaining limits](windows.md#verification).
Do not replace an existing system Node or application runtime to work on this project.

## Application commands

From the checkout with Node 24/npm available:

```powershell
npm ci
npm run build
npm test
npm start
```

The production app serves the editor at `http://127.0.0.1:4318/editor` and ambient
view at `http://127.0.0.1:4318/display`; `/api/health` verifies server readiness.
It stores data in the per-user directory documented in [API](api.md), not Git or
browser storage. Set `LRD_DATA_DIR` to an isolated test folder before integration
experiments. `LRD_PORT` can choose another unprivileged local port. Ctrl+C stops it.

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
recognition. Native capture/fullscreen/lock acceptance remains separate. Follow
[CONTRIBUTING.md](../CONTRIBUTING.md) and the [agent runbook](agent-runbook.md) for
self-service issue/fork/fix handoff; neither enables automatic reporting.

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
element), so the palette harness checks its colours (#214).

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
the login, exact origin, repository name, and private visibility, scopes GitHub
CLI environment variables to the command, and restores them afterward. It does
not require the personal-memory repository or write a token to disk.

```powershell
.\scripts\gh-personal.ps1 api user --jq '.login'
.\scripts\gh-personal.ps1 repo view --json 'nameWithOwner,isPrivate,url'
```

The helper finds an installed `gh` on PATH or at this PC's existing user-level
GitHub CLI location. It does not install packages or change global accounts.
Where ordinary `gh` is already authenticated to `8roundshock`, it may be used
with the same explicit identity, repository, and privacy verification. Bare `gh`
authentication has not been established by this scaffold.

Do not broaden credential scopes or switch a shared work account as a routine
workaround. If the personal credential or CLI is unavailable, report the exact
blocker. Credential lookup disables Git terminal prompts and Git Credential
Manager interaction for the command, restoring both settings afterward. Never
print credential output or persist a token.

Direct Git uses the repository-local personal identity and credential username.
Before pushing, verify the exact origin and the helper's identity/privacy checks:

```powershell
git remote get-url origin
git config --local user.name
git config --local user.email
git config --local credential.https://github.com.username
.\scripts\gh-personal.ps1 repo view --json 'nameWithOwner,isPrivate'
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

From Git Bash, a bare `pwsh` or `powershell.exe` resolves through `PATH`. Run the
check with `-Command` on the exact executable you intend to use. If the host is
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
  -File scripts/gh-personal.ps1 repo view --json 'nameWithOwner,isPrivate'
```

The same variable clearing applies when `powershell.exe` is the intended host. The
explicit `-ExecutionPolicy Bypass` in the `windows\Test-Windows.ps1` command above
and in the `LivingRoomDisplay.ps1` commands in [installation](install.md) is a
deliberate, process-scoped choice for those commands. It is not an inherited
default. Do not change global execution policy, agent configuration or `PATH` to
work around an unexpected host; report it. See
[#81](https://github.com/8roundshock/living-room-display/issues/81).

## Verification now

Run `git diff --check` for working changes and `git diff --cached --check` for
staged changes. Review changed files and check relative Markdown links and agent
imports resolve within the checkout. Check that status, requirements, and
architecture agree about what is implemented and what is pending.

For helper changes, exercise a real read-only identity/repository query and verify
that process environment variables are restored. Review output for accidental
credential disclosure. Do not add tests that simply repeat script statements.

CI installs the lockfile, typechecks, runs tests, and builds the full application
on Windows and Linux with Node 24. Every PR still needs an independent review
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