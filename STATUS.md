# Project status

Reviewed: 2026-10-18. Product requirements come from the owner's project brief.

## Ready

- Independent private GitHub repository and Windows checkout.
- Portable agent instructions, product brief, architecture comparison, and PR workflow.
- Project-scoped GitHub authentication helper using an existing personal credential.

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
