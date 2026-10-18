# Project status

Reviewed: 2026-10-18. Product requirements come from the owner's project brief.

## Ready

- Independent private GitHub repository and Windows checkout.
- Portable agent instructions, product brief, architecture comparison, and PR workflow.
- Project-scoped GitHub authentication helper using an existing personal credential.
- Feature/decision backlog and issue/PR templates; see the
  [GitHub issues](https://github.com/8roundshock/living-room-display/issues).

Visibility decision: stay private until a usable release. Installation is not
available yet; [install.md](docs/install.md) defines the future portability and
verification contract. Each PR requires a separate independent review agent,
an outcome recorded on the PR, and review of the final pushed SHA. No external
code-review integration is configured or required.

## Not built

No dashboard, weather integration, reminder store/editor, layout engine, screen
preview/capture, Windows host, TV integration, installer, active background process,
or deployment exists. No application dependencies or application tests were added.

## Next decision

The owner has not selected an architecture. Compare the three options in
[architecture.md](docs/architecture.md), record the choice and its scope there,
then plan a small first implementation through delegated work and a reviewed PR.

Stack, weather provider/location, units, time format, storage, activation,
initial visual preset, and snapshot versus live preview remain undecided. Do not
infer weather location from the computer's timezone or a folder name.

Once implementation is authorized, establish a manual preview and actual checks
before optional idle activation or TV control. This sequence is a proposal, not
an implementation already underway.
