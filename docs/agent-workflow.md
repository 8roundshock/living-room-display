# Agent workflow

The owner wants delegated project work. A coordinator plans bounded tasks and
reviews results; specialized workers perform project interaction and building.
Use the available subagent mechanism, not extra user-owned chats unless requested.
These instructions do not install a background orchestration system.

## Roles and ownership

| Role | Responsibility |
| --- | --- |
| Coordinator | Define outcomes, track decisions, assign ownership/dependencies, resolve findings, report verified state. |
| Visual/interaction worker | Composition, readability, motion, preview presentation, presets, and editor experience. |
| Data/application worker | Weather semantics, stale/error states, reminders, settings, and persistence. |
| Windows worker | Optional activation/fullscreen host, capture source/lifecycle, dismissal, and media/game compatibility. |
| Reviewer/verifier | Independent review and checks relevant to the change; concrete findings and verification evidence. |

These are responsibility areas, not mandatory permanent agents. Use only the
workers needed for the authorized scope. One worker owns integration and Git
operations for a change. Only one writer owns a file or shared interface at a time.

Give each worker the checkout/worktree path and base revision; `AGENTS.md` and
`STATUS.md`; relevant requirement/architecture sections and open decisions; its
task, owned paths, boundaries, dependencies, and acceptance criteria. Require a
handoff with changed files/commit, checks/evidence, risks, decisions, and next owner.

Workers read project files first. Give relevant task context without depending on
hidden chat history or copying personal memory. Agree shared interfaces before
parallel implementation. Use separate branches/worktrees for concurrent writers;
a shared checkout requires disjoint ownership and one controller of its index.
Never switch a branch under another worker.

## Issues and commits

Keep the [GitHub backlog](https://github.com/8roundshock/living-room-display/issues)
current. Link meaningful feature work to an issue, update scope/checklists as
decisions change, and connect implementation PRs. Mark actual progress rather
than closing tickets merely because code was drafted. Close only when the issue's
acceptance criteria are verified; leave remaining work explicit.

File reproducible bugs with expected/observed behavior, steps, affected version,
severity/impact, and relevant evidence. Do not invent bugs or include secrets,
private reminders, or screenshots without authorization. Use the issue templates.
Write focused commits with clear descriptions; do not mix unrelated cleanup or
other workers' changes into a feature commit.

## Branches, review, and pull requests

1. Inspect status, fetch origin, and preserve pending work. Start a topic branch
   from current `origin/main`; use `git worktree add -b` for isolation when needed.
2. Make the scoped change. Update docs/status and the linked issue. Run checks in
   [development.md](development.md), plus checks introduced with the feature.
3. Have an independent worker review the diff against acceptance criteria when
   delegation is available. Resolve findings and recheck affected behavior.
4. Stage only reviewed files. Inspect `git diff --cached`, commit, and inspect
   `git log --oneline origin/main..HEAD` for unintended commits.
5. Verify personal identity, exact origin, and private visibility. Push only the
   topic branch. Use the project helper's `pr create`, explicit `--base main`,
   `--head`, and a reviewed multiline `--body-file` in `.local/`. Link issues and
   describe scope, verification, and remaining decisions accurately.
6. Attach created PRs to the active chat when supported. Request/verify automatic
   review after opening a PR and after relevant new commits. Check the exact
   pushed head; CI checks and AI review are different evidence. Do not claim
   automatic review is enabled or completed without an observed configuration
   and review result. Use an independent review while automation is unavailable.
7. Wait for applicable checks/reviews on the current head. Resolve findings; do
   not bypass required reviews or protection. No checks configured is not a pass.
8. Within merge authorization, use a merge commit with `pr merge --merge
   --match-head-commit` and the reviewed SHA. Never force-push, push `main`
   directly, use admin bypass, or merge an unreviewed replacement head.
9. Verify merged state/SHA, update linked issues, fetch, and fast-forward clean
   local `main`. Remove only your own clean, fully merged worktrees/branches.

The helper passes through ordinary GitHub CLI arguments; consult subcommand help
for syntax. Run commits, pushes, and merges sequentially. If `main` advances,
merge `origin/main` into the topic branch, preserve both sides' useful changes,
resolve conflicts from evidence, and review/check the new head before merging.

Creating a scaffold does not authorize deployments, persistent services, network
exposure, TV control, or connection changes. Match those actions to the user's
actual implementation request; do not ask again for clearly authorized actions.
Report concrete blockers rather than inventing an approval step.

## Finish

Return outcome, branch/PR/commit, checks and results, material limits, and the next
decision if needed. Update project docs with durable findings. Do not claim a
feature is built, running, visually verified, reviewed, or deployed without evidence.
