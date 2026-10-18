# Living Room Display

A silent, customizable ambient display for a Windows 10 leisure PC connected to
a Samsung S90F OLED TV: large time and date, weather, a seven-day outlook, rain
estimates, optional reminders, and an optional dim screen preview.

**Current state: local display/editor and current-PC source install verified.**
The selected approach is a custom local web dashboard plus a Windows helper.
The React UI, local API, persistence, weather and RAM-only snapshot handoff are implemented.
Device-area weather with a Toronto fallback, editable presets and reminders,
and configurable hiding of empty reminders are implemented. The sparse interface
uses the [recorded HIG-inspired design choices](docs/design.md). The display studio
puts one focused Style, Widgets, Weather or Reminders inspector beside its live
preview. Settings/location have Save/Cancel, cities appear as you type, and
advanced controls stay out of the way. See [editing and browser checks](docs/ui.md).
This redesigned source still needs an installed refresh and native acceptance.
Wider release
compatibility checks remain; see [STATUS.md](STATUS.md).

This is the independent private
[8roundshock/living-room-display](https://github.com/8roundshock/living-room-display)
repository. Its code, branches, pull requests, documentation, and future local
data belong here, separate from personal-memory repositories. The owner has
chosen to keep it private until a usable release; there is no public release yet.

## Start here

- [AGENTS.md](AGENTS.md): primary instructions for any coding agent.
- [Product requirements](docs/product.md): desired experience and boundaries.
- [Architecture](docs/architecture.md): selected design and boundaries.
- [Development](docs/development.md): verified tools, authentication, and checks.
- [Local API](docs/api.md): shared contracts, weather semantics, and data recovery.
- [Agent workflow](docs/agent-workflow.md): ownership, handoffs, review, and PRs.
- [Installation and use](docs/install.md): commands, recovery and current limits.
- [Contributing](CONTRIBUTING.md) and [agent runbook](docs/agent-runbook.md):
  install/diagnose, prepare a useful issue, or fork/fix using your own setup.

From this checkout, start an installed Codex CLI with:

```powershell
codex -C .
```

The installed CLI's version and directory option were checked on 2026-10-18;
an interactive agent launch was not part of app verification.

For another agent, open this repository as the working directory and ask it to
read `AGENTS.md` and `STATUS.md`. The project context does not depend on the
original chat. `CLAUDE.md` and `GEMINI.md` import the same primary instructions;
their live startup behavior has not been tested on this PC.

Implementation follows the recorded [architecture decisions](docs/architecture.md).
The [backlog](https://github.com/8roundshock/living-room-display/issues) tracks
feature acceptance and remaining integrated checks.

## Ask an agent to install or use it

> Read AGENTS.md, STATUS.md, and docs/install.md in this repository. Check whether
> a usable release exists for my computer. If it does, follow its documented
> local installation and verification steps with my own configuration. If it
> does not, explain what is missing without inventing setup commands. Keep my
> data local and do not post feedback or star the repository without my permission.

The per-user Windows install, data lifecycle and bounded native RAM-preview/kiosk
check passed on the current 4K PC. Keep automatic idle off until the coordinator
approves activation after review. See [Windows verification](docs/windows.md#verification) for limits.
Future releases should work without the owner's accounts, paths, or private memory.
