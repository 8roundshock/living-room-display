# UX worker handoff

Read `AGENTS.md`, `STATUS.md`, [product](../product.md), [UI](../ui.md),
[API](../api.md), [design rationale](../design.md) and [workflow](../agent-workflow.md).
Use a bounded task, owned worktree/paths and one primary ticket. Do not depend on
the original chat, owner's memory, paths, device or credentials.
For widget changes, use [the widget contract](../widgets.md) and the repo-local
[creation skill](../../.agents/skills/living-room-widget/SKILL.md).

1. Inspect actual flows and failure states. Research current primary guidance
   (Apple HIG layout/type/motion/widgets/Always On and W3C APG for web interactions).
   Record URLs, actual dates, adaptations and recheck triggers; inspiration is
   not vendor certification.
2. Compare two or three coherent directions; choose with the coordinator and
   obtain independent concept critique. Improve actual interactions alongside the
   visual system. Prefer short labels and contextual advanced details.
3. Preserve true black/dim content, varied collision-free relocation, reduced motion,
   silence/empty reminder hiding, honest weather semantics/location/units,
   RAM-only preview, editor-only rounded one-shot device lookup/manual protection,
   global Save/Cancel and concurrent-draft rebase. Standalone cursor hiding must
   never affect editor/embedded previews or global Windows cursors. Coordinate
   shared API ownership before edits.
4. Use isolated loopback production builds, temporary synthetic data and mocked
   device services. No real GPS or desktop capture merely for editor testing.
   Inspect actual images in RAM without screenshot files/history. Exercise
   keyboard/focus, small-screen/zoom reflow, reduced motion, async races and retry,
   plus supported families/densities and 1080p/4K bounds. Reuse the harness; compile/rectangle checks alone
   are not visual inspection.
5. Push a scoped ticket/reason/change/validation PR. Obtain independent functional
   review **and actual visual review** of its exact final pushed head. Fix findings;
   recheck every later commit. Record reviewer/outcome/SHA and wait for applicable
   checks before an authorized merge. No external review service is required.
   Installation/native/physical-TV acceptance is a separate handoff.

Finish with PR/head, checks, inspected states, limits and updated project docs.
Do not claim installed behavior or viewing comfort from a build or mockup.
