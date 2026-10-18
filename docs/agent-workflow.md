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

Every PR has one primary ticket, created first if none fits, and an explanation
of why the change is needed. This project's convention is exactly
`#<ticket-number> - <Ticket Name>` using the ticket's actual title. Retain the
complete tracker identifier if a different tracker is adopted. Put related
tickets in the body alongside the primary link, reason, resulting change, and
validation; do not combine multiple ticket numbers in the title.

Keep the [GitHub backlog](https://github.com/8roundshock/living-room-display/issues)
current. Link meaningful feature work to an issue, update scope/checklists as
decisions change, and connect implementation PRs. Mark actual progress rather
than closing tickets merely because code was drafted. Close only when the issue's
acceptance criteria are verified; leave remaining work explicit.

File reproducible bugs with expected/observed behavior, steps, affected version,
severity/impact, and relevant evidence. Do not invent bugs or include secrets,
private reminders, or screenshots without authorization. Use the issue templates.
Outside users follow the [agent runbook](agent-runbook.md): installation alone
does not authorize external reporting, fork creation, or PR submission. Once
authorized, search open and closed issues and PRs before creating a ticket. Keep
one issue per root cause, add new evidence to a matching report, and do not post
repeated progress comments, agent mentions, or requests for attention. A closed
report with a verified recurrence needs the affected version and new evidence;
do not reopen it without maintainer authority. Use an existing feature issue
before proposing a duplicate. The [contribution guide](../CONTRIBUTING.md)
describes the own-account fork path and local-only fallback.
Write focused commits with clear descriptions; do not mix unrelated cleanup or
other workers' changes into a feature commit.

## Branches, review, and pull requests

1. Inspect status/remotes and preserve pending work. For owner maintenance, fetch
   origin and start from `origin/main`. For an outside contribution, use your own
   fork as origin and the original repository as upstream, fetch upstream, and
   start from `upstream/main`. Use `git worktree add -b` for isolation when needed.
2. Make the scoped change. Update docs/status and the linked issue. Run checks in
   [development.md](development.md), plus checks introduced with the feature.
3. Inspect the diff against acceptance criteria and recheck affected behavior.
   This author check does not replace the independent PR review below.
4. Stage only reviewed files. Inspect `git diff --cached`, commit, and inspect
   the log from the chosen base (`origin/main..HEAD` for owner maintenance,
   `upstream/main..HEAD` for fork contributions) for unintended commits.
5. Verify identity and remotes before a push. Owner maintenance must verify
   `8roundshock`, exact original origin, and private visibility with the project
   helper. Contributors verify their own account and fork; never run the owner's
   helper or broaden shared-account credentials. Push only the topic branch to
   the intended repository. Create the PR against the original repository with
   explicit `--base main` and `--head` (for forks, `<your-login>:<branch>`), the
   exact ticket/title format above, and a reviewed multiline `--body-file` in
   `.local/`. Identify the primary ticket and reason, link related tickets, and
   describe scope, verification, and remaining decisions accurately.
6. Attach created PRs to the active chat when supported. For every PR, run a
   separate independent review agent with focused project requirements, PR diff,
   acceptance criteria, and test evidence. The reviewer must differ from the
   author. If native subagents are unavailable, use a separate fresh reviewer
   session/process with that context. No particular model or paid service is
   required. If independent review cannot run, leave the PR open and report why;
   never label author self-review as independent.
7. The author fixes findings, pushes the changes, and requests a reviewer recheck
   of the final commit. Record reviewer identity/role, outcome, and exact reviewed
   SHA in the PR body or comment. Keep this evidence distinct from CI results.
   Do not install or activate an external review integration.
8. Wait for applicable checks/reviews on the current head. Resolve findings; do
   not bypass required reviews or protection. No checks configured is not a pass.
9. A contributor submits the PR and leaves merging to authorized maintainers;
   permission to contribute is not permission to merge upstream. Within maintainer
   merge authorization, use a merge commit with `pr merge --merge
   --match-head-commit` and the reviewed SHA. Never force-push, push `main`
   directly, use admin bypass, or merge an unreviewed replacement head.
10. Verify merged state/SHA, update linked issues, fetch the original project's
   remote, and fast-forward clean local `main` from that verified base. Remove
   only your own clean, fully merged worktrees/branches.

The owner's helper passes through ordinary GitHub CLI arguments; consult subcommand help
for syntax. Run commits, pushes, and merges sequentially. If `main` advances,
merge the current base (`origin/main` for owner maintenance, `upstream/main` for
fork contributions) into the topic branch, preserve both sides' useful changes,
resolve conflicts from evidence, and review/check the new head before merging.

Creating a scaffold does not authorize deployments, persistent services, network
exposure, TV control, or connection changes. Match those actions to the user's
actual implementation request; do not ask again for clearly authorized actions.
Report concrete blockers rather than inventing an approval step.

## Finish

Return outcome, branch/PR/commit, checks and results, material limits, and the next
decision if needed. Update project docs with durable findings. Do not claim a
feature is built, running, visually verified, reviewed, or deployed without evidence.
