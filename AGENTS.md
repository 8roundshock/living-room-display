# Project instructions

Build a silent ambient display, initially targeted at the owner's Windows 10
leisure PC and Samsung S90F OLED. Other users supply their own local settings;
do not infer that their location, display, or preferences match the owner.
This is an independent project, not a personal-memory workspace.

## Start

1. Inspect `git status --short --branch` and `git remote -v`. Preserve pending work.
2. Fetch the original project's remote: `origin` for owner maintenance, `upstream`
   for a contributor fork. Fast-forward a clean, nondivergent local `main` from
   that verified base; preserve pending work. See the workflow before remapping
   any remote.
3. Read [STATUS.md](STATUS.md), [product requirements](docs/product.md), and
   [architecture choices](docs/architecture.md).
4. Read [development](docs/development.md) and [agent workflow](docs/agent-workflow.md)
   before edits, authentication, or delegation. Read further files only as needed.
5. For installation, diagnosis, or outside contributions, follow the
   [agent runbook](docs/agent-runbook.md) and [contribution guide](CONTRIBUTING.md).
   They include copy/paste user prompts, privacy rules, and a fork workflow.
6. For widget work, read [the shared widget contract](docs/widgets.md) and apply
   the repository-local [widget creation skill](.agents/skills/living-room-widget/SKILL.md).

The selected architecture is a custom local web dashboard with a Windows
idle/screensaver helper. Implementation is authorized and in progress;
`STATUS.md` records what has actually been built and verified.

## Ownership and context

- Use a coordinator and focused subagents when delegation tools are available.
  The coordinator scopes work, coordinates dependencies, and evaluates results;
  workers own project interaction, edits, implementation, and verification.
  If delegation is unavailable, report that limitation before implementation.
- Give each worker a bounded task, relevant project files, owned paths or a separate
  worktree, acceptance criteria, and a required handoff. Avoid competing edits.
- Keep project decisions and verified findings in these docs. Agents must be able
  to work from this repository without the original chat or agent-specific memory.
- Do not load or copy unrelated personal context just because the checkout is
  under the user's home directory. Do not put app code, app PRs, or project tooling
  in the owner's personal repositories. The app and other users must not depend on them.
- Keep future installation/use portable for other users. The owner's developer
  paths and GitHub helper are not application prerequisites; follow the
  [installation contract](docs/install.md).

## Product guardrails

- True black background, sparse dim color, large readable information, no audio.
- Never blank or fade the screen to move (#436, owner decision 2026-10-20). By
  default keep the user's arrangement and float the whole board and each widget's
  content slowly and continuously; swapping places is opt-in and glides. Do not
  promise prevention of OLED burn-in.
- Every widget is optional. Share the catalog, family geometry and collision
  helpers between the editor, validation and ambient renderer. Keep layout/image
  edits cancellable and show Save/Cancel only for effective unsaved changes.
- The TV stays powered on by choice. TV power, wake, input, and remote integration
  are optional future work, never prerequisites or recurring power-off advice.
- Present rain timing as a forecast estimate. Show weather age and stale/error
  states; never invent current weather or present a model estimate as certainty.
- Owner decision, 2026-10-27 (#544): use one private runtime snapshot at
  `InstallRoot/run/cache/last-screen.png`, atomically replaced every five minutes
  when safely eligible. Browser and native displays read that same file; automatic
  startup never captures or claims a replacement. Keep it out of Git, app/data
  backups, exports and diagnostics; create no history or `.bak` files. This narrow
  app-cache exception does not change the RAM-only rule for agent/computer-use
  screenshots. Preserve capture access and physical-stop safeguards; see
  [preview requirements](docs/product.md#screen-preview).
- Local implementation, dependency setup, and scoped testing are authorized.
  Keep loopback-only defaults; enable Windows idle activation only after actual
  verification and coordinator approval. TV control, LAN exposure, and release
  publication remain separate scope.

## Change and verify

- Use command-line Git and GitHub CLI/API. For owner-side maintenance, keep origin
  at `8roundshock/living-room-display`, verify the `8roundshock` identity and the
  exact repository, and use [the project auth helper](docs/development.md). Outside
  contributors use their own authorized account, a fork as `origin`, and the
  original repository as `upstream`; never use owner credentials or its helper.
- The repository is public (owner decision, 2026-10-20,
  [#441](https://github.com/8roundshock/living-room-display/issues/441)). Never
  commit or post secrets, tokens, the owner's private data (state.json, exports,
  reminder or calendar text, photos, screen captures), personal contact details,
  PC security settings or presence/away details, hostnames, network names, or
  links into the owner's personal repositories. Do not change repository visibility.
- Use topic branches and reviewed pull requests; never push directly to `main`,
  force-push, discard others' work, or bypass branch protection.
- In owner-authorized project work, track all intended work in GitHub issues:
  find or create the ticket before starting and record meaningful progress there.
  Whenever you notice follow-up work, an idea, a bug, a risk or a deferred item,
  search open and closed issues, then update the matching issue or file a new one
  with its reason and scope, and link it from the PR or ticket. A read-only or
  issue-restricted worker lists candidate tickets in its handoff; the coordinator
  files them before finishing. Never leave such thoughts only in chat or code
  comments. Pass this rule to every delegated agent.
- Keep feature and bug issues current, link PRs, and write meaningful scoped
  commits. Every PR needs a primary ticket and a reason. Use exactly
  `#<ticket-number> - <Ticket Name>` as the title; put related tickets, the change,
  and validation in the body. Every PR needs a separate independent review agent
  before merge. The author fixes findings and the reviewer checks the final
  pushed commit.
  Record the review outcome and SHA in the PR. If native subagents are unavailable,
  use a separate fresh reviewer session/process; if neither is possible, leave
  the PR open and report the blocker. Self-review is not independent review.
  No external review integration or particular paid service/model is required.
  See [workflow](docs/agent-workflow.md).
- Keep secrets, personal reminder contents, raw transcripts, and employer content
  out of Git. Use ignored `.local/` for temporary local files.
- Installing or using the app does not authorize publishing issues, diagnostics,
  forks, PRs, stars, or other external messages. Obtain the end user's scoped
  authorization, or keep a sanitized local report/patch. With authorization,
  search open and closed issues first, update useful existing reports, and follow
  the [runbook](docs/agent-runbook.md) to avoid duplicate reports and repeated pings.
- Run checks relevant to the change, review the exact diff, and report real
  failures or blockers. Do not invent build/test commands or claim UI success
  without inspecting the result. See [verification](docs/development.md).
- Update affected requirements, decisions, commands, and `STATUS.md` with changes.
