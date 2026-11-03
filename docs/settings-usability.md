# Compact Settings and Find a setting

Source work for [#571](https://github.com/8roundshock/living-room-display/issues/571),
2026-11-03, following the owner's review of the installed page.

Settings keeps one scrollable document. The chosen direction reduces card and
heading space, aligns Units and Time format in rows, and removes the repeated
Screen heading inside This device. Actual controls retain at least 44-pixel hit
areas. The common preferences and Schedule entry fit the 1280 × 720 source
fixture; narrow windows stack groups in reading order. The independent Schedule
draft and ordinary field-scoped Save/Cancel remain intact.

Find a setting is a local navigation feature. Results appear while typing and
match familiar words such as temperature, clock, city and backup. A result clears
the query, scrolls to and focuses the real control. Enter chooses the first
result; Arrow Down reaches the first result and Tab continues through the list.
Escape or Clear clears the search. Empty searches show no results, and unmatched
queries state that no setting matched. All sections stay mounted, so searching
never hides or discards a settings or schedule draft. Finding location or recovery
does not request location, open a file picker, save data or run the action.

The coordinator and independent concept reviewer chose this compact document
over a sidebar that hides sections: the existing small set of settings benefits
from remaining visible, and separate draft scopes remain easier to understand.
Task-specific appearance controls stay in Edit display.

Primary guidance read on 2026-11-03:
[Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings)
and [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)
(the published Markdown versions were read directly), plus
[W3C combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
The adaptation uses a labeled search form and ordinary result buttons, not a
value-selecting combobox. Native Tab/Enter behavior stays available; search does
not intercept editing keys beyond its documented Escape and Arrow Down actions.
Recheck these choices when searchable controls, form ownership or navigation
change. This is a web adaptation, not an Apple certification claim.

Both production typechecks/build pass. The focused search test passes. The full
Settings browser suite passes 14 groups, retaining scrolling, conflict, retry,
leave-guard, recovery, location and independent schedule checks. New coverage
includes common search terms, multiple results, Enter/Tab selection, Clear/Escape,
no matches, retained dirty values, no search-triggered actions, the existing city
deep link and focus above the Save/Cancel bar. Preference labels remain one line
in the tested widths. RAM-only source images were inspected at 1280, 390 and 320
pixels wide and 640 × 300; those images caught and verified repairs for inherited
select width/device spacing and a search field clipped after returning from a
lower control. This evidence uses synthetic temporary data and establishes no
installed or native screensaver acceptance.
