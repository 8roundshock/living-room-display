# Contributing with an agent

You can ask an agent to install and use this project, investigate a problem, or
prepare a fix. Start with the [copy/paste prompts and runbook](docs/agent-runbook.md).
The agent should read the repository instructions and do the work with your own
local configuration and accounts. No maintainer coordination, usage registration,
or owner credentials are required for a supported local installation.

Check [installation readiness](docs/install.md) and [STATUS.md](STATUS.md) first.
The repository is currently private; a link alone does not grant access. Do not
change its visibility or publish a copy to work around missing access. A future
public release will still need its own reviewed publication step.

## Choose the scope

- **Install/use:** follow [installation](docs/install.md), verify locally, and keep
  personal data local. Do not post reports, open a fork/PR, or star the repository
  merely because someone asked to install it.
- **Diagnose locally:** reproduce with isolated synthetic data, preserve the
  user's installation, and prepare a minimal sanitized report or patch. This can
  continue without upstream access or permission to publish.
- **Contribute:** with the user's scoped authorization, search existing issues
  and PRs, report useful new evidence, and submit a focused fix from their fork.
  The optional contribution prompt grants that scope once; agents should not ask
  for the same authorization at each routine step.

## Reports that help

Search **open and closed** issues and PRs first. Use an existing matching issue,
including for feature requests. Keep one issue per root cause; one concise update
with new reproduction or a fix link is more useful than repeated progress posts
or attention requests. A previously fixed bug needs the new affected commit and
evidence of recurrence. Do not mass-create speculative findings or mention/ping
maintainers or other agents to start work. There is no response-time promise.

Use the [bug](.github/ISSUE_TEMPLATE/bug_report.md) or
[feature](.github/ISSUE_TEMPLATE/feature_request.md) template. Include exact
version/commit, relevant platform, expected/observed behavior, minimal reproduction,
impact, attempted fixes, and sanitized relevant error lines. Follow the
[evidence allowlist](docs/agent-runbook.md#safe-evidence) before any upload.
Never upload the user's data directory, configuration export, reminder text,
weather coordinates, screenshots, browser profiles, tokens, or raw logs.

## Fixes and review

Use your own account and a fork, with the original project as `upstream` and your
fork as `origin`. The [runbook](docs/agent-runbook.md#fork-and-fix) gives commands.
Do not use `scripts/gh-personal.ps1`; it is only for the original owner's private
maintenance. The owner must continue to verify their exact identity, origin, and
private visibility as described in [development](docs/development.md).

Create or reuse the **upstream primary ticket before creating a PR**. The PR
title is exactly `#<ticket-number> - <Ticket Name>` using the actual ticket title
and complete tracker identifier. Link the primary ticket, reason, resulting
change, actual validation, and related tickets in the body. Target upstream
`main`, push only a topic branch, and follow the complete
[review workflow](docs/agent-workflow.md#branches-review-and-pull-requests).

Every PR requires a separate independent review agent/session of the final
pushed head. Record reviewer, outcome, and full SHA; fix findings and have the
reviewer recheck every later commit. CI and author self-review do not replace
that review. If an independent reviewer is unavailable, leave the PR open and
say so. Do not configure external automatic review services. Contributors leave
upstream merging to authorized maintainers; CI, privacy, or permission failures
must not be bypassed to finish a contribution.

## When something is unavailable

No authorized GitHub access, fork permission, network, reviewer, or upstream
ticket means that part of the workflow is blocked, not the user's local use.
Keep a focused local branch/patch and sanitized issue/PR draft outside committed
user data, state what was actually done, and give the user a concrete next step.
Never claim an issue, PR, review, or merge happened without a verified URL/SHA.
Private repository forks may be restricted; preserve that boundary and do not
publish a mirror. Stars and feedback are optional. No telemetry or automatic
usage report is part of installation.
