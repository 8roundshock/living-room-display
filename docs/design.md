# Display studio design

Reviewed 2026-10-18 for [#39](https://github.com/8roundshock/living-room-display/issues/39).
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
Mobile uses normal scrolling and a nonsticky preview, leaving room for keyboard
editing. The city query is separate from the selected location. Reminders explain
their independent immediate-save behavior once.

## Primary guidance and adaptation

| Source | Application |
| --- | --- |
| [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Deliberate alignment/grouping, focused sections, progressive disclosure, responsive reflow. |
| [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System fonts, few weights, sturdier time/temperature numerals, clear hierarchy and large-text fitting. |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Brief nonblocking feedback with gentle easing; no bounce or forced waiting. |
| [Apple Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) | Glanceable time/current conditions, forecast/rain graphics, StandBy-like enlarged information, no filled ambient cards or default empty reminders. |
| [Apple Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Legible key information, dim secondary content, sparse decoration and restrained updates. |
| [W3C APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | Editable manual-selection listbox, input-held focus, active-descendant semantics, arrows/Enter/Escape, no blur selection. |

Inspector entry fades/translates slightly over 220ms; controls transition around
180ms. Clock changes reveal briefly at minute boundaries; rain bars ease on data
updates. Reduced motion removes effects and ambient travel while discrete
relocation through black continues. Information never
depends on animation or tint alone. No audio or haptics are introduced.

The owner's relocation requirement deliberately differs from Apple's stable
Always On layout advice: varied collision-free compositions remain with a black
rest between them. The grid editor exposes one layout-editing mode, a catalog
picker with synthetic family content, visible handles and keyboard alternatives.
Outline clock numerals, minimal analog hands and dim local photos reuse the same
protected grid/motion boundary. See the [widget contract](widgets.md) for Apple
WidgetKit/Always On sources and concrete adaptation rules.
Unused ambient pixels remain true black; saved brightness caps are unchanged.
These choices do not reproduce Apple power behavior or guarantee OLED safety.
The editor is more legible than the distant display; browser images do not prove
actual TV brightness or viewing comfort. See [UI contracts](ui.md), [API](api.md)
and the [UX role guide](roles/ux.md) for verification and future work.
