# Installation readiness

**A complete installable display release is not ready yet.** The local backend
can be built and run using [development commands](development.md). The display,
Windows host, and installer are being integrated and require separate verification.
Do not substitute the repository's GitHub maintenance helper for an installer.
Implementation readiness is tracked in
[issue #10](https://github.com/8roundshock/living-room-display/issues/10).

The repository remains private until a usable release. Access today requires
your own authorized GitHub account; never request or reuse the owner's credentials.
A future publication step needs a usable artifact and review of the material
being shared. Public visibility has not been enabled or scheduled.

## Agent handoff today

Open this checkout and read [AGENTS.md](../AGENTS.md), [STATUS.md](../STATUS.md),
and this file. Explain the current readiness accurately. The [architecture](architecture.md)
is selected; remaining work is integration and verification. A backend milestone
alone is not a complete display release. An agent cannot invent a usable release.
Agents changing source or project docs must follow the [PR workflow](agent-workflow.md),
including a separate independent review agent/session for each PR. Installing an
existing release alone does not require creating a PR.

## Contract for a future usable release

Replace this section with verified instructions when implementation exists:

- **Supported systems and prerequisites:** Windows 10 is the current target.
  Record versions actually tested, required dependencies, display assumptions,
  and permissions. Do not imply untested Windows/macOS/Linux support.
- **Local installation:** provide a user-local install path and real commands
  or a release package. Avoid administrator rights unless a chosen capability
  proves they are necessary. Document first launch and how to stop the app.
- **User-owned setup:** collect the user's weather location, units, time format,
  layout, and optional features. Any provider credential must belong to that
  user and stay outside Git; the owner's accounts and paths are never required.
- **Configuration and data:** document exact per-user storage locations, export/
  backup and restore, defaults, and migration behavior. Reminders remain private;
  screenshot pixels stay in RAM rather than accumulating files.
- **Verification and use:** give a short local smoke check for display, weather
  freshness/error states, editing, persistence, chosen preview mode, and clean
  exit. Distinguish a working manual display from optional idle/TV integration.
- **Updates:** document the tested update path, compatibility/migrations,
  backup expectations, and rollback when applicable.
- **Uninstall:** stop processes and remove installed components safely. Explain
  how users may retain/export or explicitly delete their settings and reminders.

The chosen release should work independently of this owner's private-memory
repository, local development layout, GitHub helper, and personal identity. The
default local experience must not require feedback reporting or telemetry.
Dependencies and commands belong here only after they exist and are verified.

## Optional feedback

Users may choose to star a public release or send feedback/bug reports when
sharing becomes available. These are optional, never installation requirements.
An agent may offer; it must obtain the end user's explicit permission before
starring, posting feedback, uploading diagnostics, or sending any external message.
Do not automatically report usage, screenshots, reminder data, or device details.
