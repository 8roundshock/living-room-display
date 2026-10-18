# Development

Use Node 24 LTS and npm. Application dependencies are pinned in `package.json`
and `package-lock.json`. The backend, shared types, and tests are implemented;
the frontend and Windows host are integrated in separate changes. Do not replace
an existing system Node or application runtime to work on this project.

## Application commands

From the checkout with Node 24/npm available:

```powershell
npm ci
npm run typecheck
npm test
npm run build:server
npm start
```

The backend listens at `http://127.0.0.1:4318`; `/api/health` verifies readiness.
It stores data in the per-user directory documented in [API](api.md), not Git or
browser storage. Set `LRD_DATA_DIR` to an isolated test folder before integration
experiments. `LRD_PORT` can choose another unprivileged local port. Ctrl+C stops it.

Once the frontend entry point is present, `npm run build` typechecks and builds
both server and browser assets; `npm start` then serves the display and editor.
For development use `npm run dev:server` and `npm run dev` in separate terminals.
Vite listens on loopback port 5173 and proxies `/api` to 4318. The development
server explicitly accepts that origin; production does not expose CORS access.
Do not claim a full application build passed on a backend-only branch.

## Local checkout and agent startup

On the owner's Windows PC:

```powershell
Set-Location 'C:\Users\8roun\source\repos\living-room-display'
git status --short --branch
git remote -v
codex -C 'C:\Users\8roun\source\repos\living-room-display'
```

The installed Codex CLI's `--help` confirms that `-C` sets the working directory.
The final command launches an agent, not the display. On another computer, use
the actual checkout path and installed agent. An agent that does not discover
instruction files must be told to read `AGENTS.md` explicitly.

`CLAUDE.md` and `GEMINI.md` import `AGENTS.md`, following the official
[Claude import syntax](https://code.claude.com/docs/en/memory#import-additional-files)
and [Gemini import syntax](https://geminicli.com/docs/cli/gemini-md/#modularize-context-with-imports).
Live startup in those clients has not been tested on this PC. These pointers do
not change global agent settings or start background work.

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
Expected Git identity: `Vladimir Dolgopolov <vladimir@dolgopolov.ca>`; GitHub login
and credential username: `8roundshock`. Configure identity only in this repo if
needed. See the [PR workflow](agent-workflow.md).

## Verification now

Run `git diff --check` for working changes and `git diff --cached --check` for
staged changes. Review changed files and check relative Markdown links and agent
imports resolve within the checkout. Check that status, requirements, and
architecture agree about what is implemented and what is pending.

For helper changes, exercise a real read-only identity/repository query and verify
that process environment variables are restored. Review output for accidental
credential disclosure. Do not add tests that simply repeat script statements.

CI installs the lockfile, typechecks, runs tests, and builds the server on Windows
and Linux with Node 24. Once `index.html` exists it also requires the full app
build. Every PR still needs an independent review agent; CI is not that review.
UI checks
require actual visual inspection, not only compilation or a successful tool call.

Keep temporary PR bodies and scratch files under ignored `.local/`. Do not commit
screenshots, private reminders, weather location details, or local credentials.
Capture screenshots only for authorized verification and keep them in memory;
persistent copies require an explicit user request. Honor physical stop and
applicable screenshot safeguards.
