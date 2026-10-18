# Project instructions

Build a silent ambient display for a Windows 10 leisure PC and Samsung S90F OLED.
This is an independent private project, not a personal-memory workspace.

## Start

1. Inspect `git status --short --branch` and `git remote -v`. Preserve pending work.
2. Fetch origin. Update a clean, nondivergent `main` with `git pull --ff-only`.
3. Read [STATUS.md](STATUS.md), [product requirements](docs/product.md), and
   [architecture choices](docs/architecture.md).
4. Read [development](docs/development.md) and [agent workflow](docs/agent-workflow.md)
   before edits, authentication, or delegation. Read further files only as needed.

The repository currently contains documentation and repository tooling only.
Architecture selection is pending; do not treat a recommendation as approval to
choose a stack or implement the app. Keep status and commands truthful as it grows.

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
  in `vladimir-personal`. No runtime or documentation dependency on that repository.
- Keep future installation/use portable for other users. The owner's developer
  paths and GitHub helper are not application prerequisites; follow the
  [installation contract](docs/install.md).

## Product guardrails

- True black background, sparse dim color, large readable information, no audio.
- Move whole widget groups between distinct areas; allow periodic recomposition
  and fades. Small motion within a fixed layout is insufficient. Do not promise
  prevention of OLED burn-in.
- The TV stays powered on by choice. TV power, wake, input, and remote integration
  are optional future work, never prerequisites or recurring power-off advice.
- Present rain timing as a forecast estimate. Show weather age and stale/error
  states; never invent current weather or present a model estimate as certainty.
- A dim preview is requested; snapshot versus live selected-app capture remains
  undecided. Keep snapshots in memory, not screenshot files. No capture is needed
  for this foundation. See [preview requirements](docs/product.md#screen-preview).
- No dependency installation, active service, schedule, deployment, connection
  change, or TV control is authorized by this documentation-only foundation.
  Reassess scope against the user's next concrete instruction.

## Change and verify

- Use command-line Git and GitHub CLI/API. Keep origin at the private
  `8roundshock/living-room-display` repository and verify the `8roundshock` identity
  and privacy before owner-side pushes. Use [the project auth helper](docs/development.md).
  Keep the repository private until a usable release and a reviewed publication
  step; do not change visibility as part of the current foundation.
- Use topic branches and reviewed pull requests; never push directly to `main`,
  force-push, discard others' work, or bypass branch protection.
- Keep feature and bug issues current, link PRs, and write meaningful scoped
  commits. Every PR needs a separate independent review agent before merge;
  the author fixes findings and the reviewer checks the final pushed commit.
  Record the review outcome and SHA in the PR. If native subagents are unavailable,
  use a separate fresh reviewer session/process; if neither is possible, leave
  the PR open and report the blocker. Self-review is not independent review.
  No external review integration or particular paid service/model is required.
  See [workflow](docs/agent-workflow.md).
- Keep secrets, personal reminder contents, raw transcripts, and employer content
  out of Git. Use ignored `.local/` for temporary local files.
- Run checks relevant to the change, review the exact diff, and report real
  failures or blockers. Do not invent build/test commands or claim UI success
  without inspecting the result. See [verification](docs/development.md).
- Update affected requirements, decisions, commands, and `STATUS.md` with changes.
