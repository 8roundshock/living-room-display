# Home and Settings refinement (#463, #483, #564)

Source checkpoint, 2026-11-03. Home manages world-clock labels and countdown
names/dates directly in its existing sheets. The selected item exposes keyboard
Move earlier/later controls, with one Save edits / Cancel edits pair for the list.
Add stays unavailable during editing. Remove becomes **Remove from draft**,
which changes only the retained list until Save; ordinary Remove/Undo remains an
immediate action outside editing. Closing the sheet retains effective edits in RAM.

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

Production build and all 598 unit tests passed. The Settings browser suite passed
13 groups, including section focus, short/narrow scrolling, concurrent saves and
recovery. Focused Home checks cover rename/re-date/reorder, cancellation, retained
drafts, remote additions/field edits, a write racing the revision read, failed-save
retry, stable IDs and edited-item Remove/Undo.

Actual synthetic RAM images were inspected at 1280×720, 390×640, 320×480 and
640×300. A sticky action row initially obscured a field on short windows; the
replacement footer is outside the scrolling body. Focused assertions now check
every field and reorder button against that scroller and footer. The Home suite passed 24 groups and Settings passed 13; the delayed-close/newer-draft
regression also passed in the focused harness. Final pushed-head CI and independent
functional/visual review remain pending. This source work
has not changed the installed app, native settings or real private data.


## Independent review follow-up: merged-list limits

Review of `7b7b670` reproduced a local edit to an item removed/replaced in another
window merging into five clocks or thirteen countdowns. Home now blocks Save and
names how many items must be removed. **Remove from draft** resolves that list
without a request, keeps other edits and survives sheet close; Cancel restores the
latest server list. The save handler also refuses an over-limit list. Regression
cases cover both caps, no-write removal/Cancel and saving with a second newer local
edit preserved. The existing late-save/reopened-draft regression remains covered.


## Combined release integration and focus regression (#565, #463)

Home recognizes either Clock or dedicated Timers as a timer display. With only
Timers enabled, its sheet and start message no longer claim that timers are
confined to an off Clock, and the Home display card has no waiting Clock cue.
The existing Show Clock action remains the default when neither surface is on.
A focused synthetic production probe and the full Home suite cover this path.

The combined Home run reproduced a delayed-focus race: Edit queued focus over
animation frames, which could steal a subsequent date-field focus and scroll it
behind the footer in a short sheet. List edit/finish/remove focus now belongs to
the React layout commit, and initial modal focus is synchronous with opening.
A deterministic test holds then releases queued frames; it failed the prior
production assets and passed the corrected build. Existing viewport checks now
also assert the actual focused element and report scalar geometry on failure.
The final Home run passed all 28 groups. A RAM-only 640×300 inspection confirmed
the date stayed focused and clear of the footer. No save, concurrency or draft
retention behavior was removed; exact-head review and CI remain release gates.
