# Living Room Display

A silent, customizable ambient display for a Windows 10 leisure PC connected to
a Samsung S90F OLED TV: large time and date, weather with rain estimates when rain
is near, a seven-day outlook, reminders, world clocks, a calendar, countdowns, a
short note, air quality, sun and moon times, and an optional dim screen preview.
All modules are optional. Drag and resize widgets on a snapping grid, choose
adaptive sizes and outline/digital/analog clocks, or add a dim local photo.

**Current state: local display/editor and current-PC source install verified.**
The selected approach is a custom local web dashboard plus a Windows helper.
The React UI, local API, persistence, weather and RAM-only snapshot handoff are implemented.
Device-area weather with a Toronto fallback, editable presets and reminders,
and configurable hiding of empty reminders are implemented. The sparse interface
uses the [recorded HIG-inspired design choices](docs/design.md). The display studio
puts one focused Style, Widgets, Weather or Reminders inspector beside its live
preview. Save/Cancel appears only for effective settings/photo edits, cities appear as you type, and
advanced controls stay out of the way. See [editing and browser checks](docs/ui.md).
The owner's PC runs a verified install of `main` with the new widgets and the first
polish wave; later changes on `main` wait for the next coordinated install, and native
screensaver acceptance and wider release compatibility checks remain.
[STATUS.md](STATUS.md) records the installed revision and what is still pending.

This is the independent
[8roundshock/living-room-display](https://github.com/8roundshock/living-room-display)
repository. Its code, branches, pull requests, documentation, and future local
data belong here, separate from personal-memory repositories. The repository is
public (owner decision, 2026-10-20,
[#441](https://github.com/8roundshock/living-room-display/issues/441)); there is
no published release yet. Never commit or post secrets or private data; see the
[privacy rule](AGENTS.md#change-and-verify).

## Install on Windows

For Windows 10 and 11 (x64), the simplest route is Setup:
`LivingRoomDisplaySetup-<version>.exe` installs just for your account, with no
administrator rights, no developer tools and no account. Double-click it, click
**Install**, and it opens the editor when it's done. Find it again in the Start
menu as **Living Room Display** (editor) and **Living Room Display - Show
display**. It doesn't start with Windows or change your screen saver. To update,
run a newer Setup: your settings, reminders and photo stay, and a backup copy is
saved first. To remove it, use **Settings > Apps** (or right-click the Start
entry) and choose whether to keep your data.

Once it's installed, the [user guide](docs/user-guide.md) explains everyday use in
plain words: choosing your city, showing the display full screen on the TV and
leaving it, reminders, looks, why things move, animation levels, backups, updating
and uninstalling.

There's no published download yet: Setup is an unsigned prerelease built
by CI, so Windows SmartScreen will warn before it runs. See
[installation](docs/install.md#install-with-setup-recommended) for the details,
messages and rollback, and the source-clone install for development.

## Start here

- [AGENTS.md](AGENTS.md): primary instructions for any coding agent.
- [Product requirements](docs/product.md): desired experience and boundaries.
- [Architecture](docs/architecture.md): selected design and boundaries.
- [Development](docs/development.md): verified tools, authentication, and checks.
- [Local API](docs/api.md): shared contracts, weather semantics, and data recovery.
- [Widget contract](docs/widgets.md) and [repo-local creation skill](.agents/skills/living-room-widget/SKILL.md): centralized families, grid, motion and authoring.
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
