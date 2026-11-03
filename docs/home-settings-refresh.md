# Home and Settings refinement (#463, #483, #564)

Source checkpoint, 2026-11-03. Home manages world-clock labels and countdown
names/dates directly in its existing sheets. The selected item exposes keyboard
Move earlier/later controls, with one Save edits / Cancel edits pair for the list.
Add and remove stay unavailable during editing, avoiding mixed immediate/draft
operations. Closing the sheet retains effective edits in RAM.

List saves use the existing settings PATCH with a freshly read revision. Another
window's list changes merge by stable item ID through the editor's existing
three-way merge, and require review before another save. Unrelated settings are
never included in the patch. This replaces the proposed new item PATCH endpoints
in #463 without adding a server contract or persisted field.

Settings keeps one outer document scroller. Location/weather occupies the left
column; Time & units and This device occupy the right, with Schedule and recovery
below. Five ordinary section links lead to those groups. Native controls and the
independent schedule draft remain unchanged.

## Direction and evidence

Compared keeping every action in Edit display, a separate content-management
page, and direct editing in the existing Home sheets. The last keeps the user's
context and reuses existing modal/focus behavior; the coordinator independently
approved this direction on 2026-11-03. Settings uses simple anchor navigation rather
than tabs hiding settings or a second scroll pane.

Primary guidance consulted 2026-11-03:
- [Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings):
  related preferences remain grouped, with concise labels and secondary help.
- [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
  native modal containment, visible close controls, keyboard access and focus return.

These are adaptations for a local web app, not vendor certification. Recheck when
page groups, modal containment or list persistence changes.

The initial production build passed. Browser regression coverage, synthetic RAM
image inspection and independent final-head review are pending. This source work
has not changed the installed app, native settings or real private data.
