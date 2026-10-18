# Bounded Claude Code collaboration

A coordinator can delegate project work to an existing Claude Code CLI without
controlling a terminal window. This is an optional development workflow, not an
application prerequisite, background service, or permission to change a user's
installation. Follow [AGENTS.md](../AGENTS.md) and the [agent workflow](agent-workflow.md).

## Start with the existing account

Find the installed `claude` executable with `Get-Command claude`, then check its
`--version`, `--help` and `auth status`. Native Windows installations may have
`claude.exe` in the user's `.local/bin` before that folder reaches the current
process's PATH. Verify that any fallback executable is the user's existing
installation. Do not install a replacement, log in, create a key, change account,
or change authentication scopes just to delegate work. Report missing access.

Inspect authentication locally and retain only whether the intended account is
authenticated and which provider it uses. Do not put email addresses, tokens,
account output, personal memory or other repositories in a task or Git.

Checked on 2026-10-18: the owner's existing Claude Code 2.1.302 reports an
authenticated first-party subscription account. Local help supports print mode,
JSON results, explicit session IDs/resume, tool selection and denying unanswered
permission requests. No agent was installed and no account, model or global
permission setting was changed. This discovery does not prove a model request ran.

## One request and one handoff

1. Search existing issues. Create/reuse the scoped ticket before implementation;
   assign a clean worktree/branch, one file owner and acceptance checks. Publish a
   meaningful checkpoint and draft PR early, using the exact ticket/title rule.
2. Write a curated project-only request under ignored `.local/claude-runs/<task>/`.
   Include relevant source/instructions instead of unrelated machine context.
   Review that request before sending it. Never copy the user's store, browser
   profile, desktop image, credentials or personal-memory repository.
3. Run one headless request from the trusted project worktree. Feed text through
   stdin rather than building a shell command from task text. Capture the result
   and stderr locally, inspect exit status, JSON `is_error`, `permission_denials`
   and the actual response. A session ID alone is not success.
4. Set a finite deadline for the owned process and stop only that process on
   timeout. No automatic retry after a denial or failure. Do not kill another
   Claude session or attach to a session whose ownership is unknown.
5. Summarize verified findings in the issue/PR. Keep raw request/results ignored;
   publish only the sanitized change, checks, limitations and next owner.

For a **curated text-only audit**, current help offers this restrictive shape:

```powershell
# Use the already verified existing executable; $request is reviewed project text.
$request | & $claudeExe -p --safe-mode --tools '' `
  --permission-mode dontAsk --permission-prompts none --output-format json `
  --no-session-persistence
```

Safe mode disables auto-loaded custom instructions, hooks and integrations, so
this request must explicitly include the applicable project instructions. It
keeps normal authentication/model selection; omit model/effort overrides. Tool
selection here permits no file reads, shell commands, edits or browser actions.
It is a proposed command shape, **not a workaround for a rejected invocation**.

When a later task genuinely needs tools, recheck current help and obtain the
appropriate authorized, narrowly scoped access. Keep normal permission checks;
do not use bypass modes, broad shell rules, global allowlists or new security
permissions. Denied tools are blockers to report, not instructions to reroute.
The coordinator can apply a reviewed recommendation and run relevant tests when
the worker has only read-only access. A task's prose ownership is not a sandbox.

If continuity is useful, omit `--no-session-persistence` for a separately
authorized session, record its returned ID in the ignored handoff, and use
`--resume <that-owned-session-id>` for an explicit next request. Never use
`--continue` to guess which task to resume. A reviewer must start a fresh session
with the exact pushed SHA rather than resume the author's conversation.

## Task envelope

```text
Ticket and reason:
Coordinator / worker:
Worktree, branch and base SHA:
Owned paths / forbidden paths:
Relevant project instructions and curated source:
One bounded outcome:
Acceptance checks and finite deadline:
Allowed actions / explicit exclusions:
Required handoff: findings or diff, checks actually run, permission denials,
remaining risks, session ID if retained, and next owner.
```

Every implementation still needs a ticket, scoped commits, final pushed-head
independent review and applicable CI before an authorized merge. Keep Git/PR
operations with one named integrator. A read-only audit is not independent
approval of later code. No installed-app update, native launch, idle activation,
desktop input, capture or Windows/TV settings change follows from a code task.

## Verified limit on this PC

The first proposed text-only audit under [#64](https://github.com/8roundshock/living-room-display/issues/64)
was rejected by automatic approval review before execution, with the stated
reason **"blocked by policy"**. No Claude response or task process was produced;
the request was not retried through another tool or permission mode. Existing
CLI/account discovery succeeded, but end-to-end delegation remains unverified.
Continue useful authorized project work and report this exact boundary. Do not
claim that Claude reviewed or authored a change until an actual response exists.

Primary references checked 2026-10-18: [headless operation](https://code.claude.com/docs/en/headless),
[CLI reference](https://code.claude.com/docs/en/cli-reference), and
[permissions](https://code.claude.com/docs/en/permissions). Recheck local help and
these sources after a CLI upgrade, changed account/tool permissions, or a failed
invocation. Local CLI help is the source for flags available in that installation.
