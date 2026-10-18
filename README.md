# Living Room Display

A silent, customizable ambient display for a Windows 10 leisure PC connected to
a Samsung S90F OLED TV: large time and date, weather, a seven-day outlook, rain
estimates, optional reminders, and an optional dim screen preview.

**Current state: project foundation only.** There is no dashboard, application
runtime, installer, service, or preview to launch. Architecture and technology
choices are pending. See [STATUS.md](STATUS.md) before starting work.

This is the independent private
[8roundshock/living-room-display](https://github.com/8roundshock/living-room-display)
repository. Its code, branches, pull requests, documentation, and future local
data belong here, separate from personal-memory repositories.

## Start here

- [AGENTS.md](AGENTS.md): primary instructions for any coding agent.
- [Product requirements](docs/product.md): desired experience and boundaries.
- [Architecture choices](docs/architecture.md): alternatives and pending decisions.
- [Development](docs/development.md): verified tools, authentication, and checks.
- [Agent workflow](docs/agent-workflow.md): ownership, handoffs, review, and PRs.

On the owner's Windows PC, start an installed Codex CLI in this checkout:

```powershell
codex -C "C:\Users\8roun\source\repos\living-room-display"
```

For another agent, open this repository as the working directory and ask it to
read `AGENTS.md` and `STATUS.md`. The project context does not depend on the
original chat. `CLAUDE.md` and `GEMINI.md` import the same primary instructions;
their live startup behavior has not been tested on this PC.

The next decision is which [architecture](docs/architecture.md) to pursue.
Document the user's selection before beginning implementation.
