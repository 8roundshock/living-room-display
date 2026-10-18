# Display studio design

Reviewed 2026-10-18 for [#56](https://github.com/8roundshock/living-room-display/issues/56),
following the earlier [#39](https://github.com/8roundshock/living-room-display/issues/39) studio.
Primary Apple HIG and W3C APG pages, including Apple's live Markdown, were checked
on this date. Recheck when interactions, geometry, typography or motion change,
or upstream guidance changes. This is original web UI without Apple assets,
downloaded SF fonts, native Apple libraries or platform certification.

## Chosen direction

Synthetic browser mockups compared a long settings dashboard, a broad theme
gallery, and a focused preview studio. The studio keeps the result and relevant
controls together without pushing controls below a gallery or exposing every
setting simultaneously. An independent critic refined the concept first.

One black canvas leads; a stable Style/Widgets/Weather/Reminders switcher reveals
one inspector at a time. Rounded charcoal groups, consistent insets, system type,
small style miniatures and restrained active tint establish hierarchy. No slogans
or decorative intro cards compete with controls. Save/Cancel appears only for an
effective draft; clean views have no status bar. Advanced details stay in context disclosures.
At widths above 700 CSS pixels, a 64px header and bounded workspace keep canvas
actions and inspector tabs visible. Inspector content scrolls within its panel;
the canvas fits the available height at 16:9. Footer room is reserved whether or
not Save/Cancel exists, so starting a draft never moves a drag target. Narrow
windows use normal scrolling and a nonsticky preview, leaving room for keyboard
editing. The city query is separate from the selected location. Reminders explain
their independent immediate-save behavior once.

The authored canvas is stable by default. **Preview movement** explicitly enters
the ambient arrangement preview; editing returns to authored placement. The plus
opens a category rail, one actual widget renderer with synthetic content, family
choices and a reachable Add action. This replaces twenty-one tiny simultaneous
miniatures. Clicking a widget selects its relevant controls; moving uses direct
dragging, and only the selected/focused widget exposes a resize handle. Keyboard
focus reveals that same handle and arrow-key alternatives. Technical Position
coordinates and four-arrow inspector controls are removed.

Density changes immediately fit one complete draft, shrinking families only when
capacity requires it, without dropping enabled content. Returning to an explored
density restores its exact placement/families until a meaningful widget edit.
Draft layout/visibility is one atomic arrangement during polling; unrelated saved
settings still refresh. Impossible arrangements leave the current draft intact.

## Primary guidance and adaptation

| Source | Application |
| --- | --- |
| [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Deliberate alignment/grouping, focused sections, progressive disclosure, responsive reflow. |
| [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System fonts, few weights, sturdier time/temperature numerals, clear hierarchy and large-text fitting. |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Brief nonblocking feedback with gentle easing; no bounce or forced waiting. |
| [Apple Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) | Continuous direct feedback, predictable destinations, cancellation and keyboard alternatives. |
| [Apple Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) | Glanceable time/current conditions, forecast/rain graphics, StandBy-like enlarged information, no filled ambient cards or default empty reminders. |
| [Apple Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Legible key information, dim secondary content, sparse decoration and restrained updates. |
| [W3C APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | Editable manual-selection listbox, input-held focus, active-descendant semantics, arrows/Enter/Escape, no blur selection. |

Primary Apple Markdown was re-read on 2026-10-18 for this refinement; the focused
studio was independently critiqued against settings-first and full-gallery
alternatives. Original web controls, icons and system fonts are used without
copied Apple assets or platform point sizes.

Inspector content stays stable in the bounded desktop panel; controls transition
around 180ms and neighboring widgets ease briefly into a legal reflow. The dragged
widget follows the pointer continuously. Reduced motion removes effects and ambient travel while discrete
relocation through black continues. Information never
depends on animation or tint alone. No audio or haptics are introduced.

The owner's relocation requirement deliberately differs from Apple's stable
Always On layout advice: varied collision-free compositions remain with a black
rest between them. The grid editor exposes one layout-editing mode, a catalog
picker with synthetic family content, selected handles and keyboard alternatives.
Outline clock numerals, minimal analog hands and dim local photos reuse the same
protected grid/motion boundary. See the [widget contract](widgets.md) for Apple
WidgetKit/Always On sources and concrete adaptation rules.
Unused ambient pixels remain true black; saved brightness caps are unchanged.
These choices do not reproduce Apple power behavior or guarantee OLED safety.
The editor is more legible than the distant display; browser images do not prove
actual TV brightness or viewing comfort. See [UI contracts](ui.md), [API](api.md)
and the [UX role guide](roles/ux.md) for verification and future work.
