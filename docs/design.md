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

## Native palette

The accent is either one colour (`color`, the original behaviour) or **Native**
(#75), where each widget takes its catalog tone so the board reads by kind at a
glance: time is lilac, sky is mist, rain is sea glass, your own items are rose.
Native is the default for new installs and built-in styles; the colour swatches
stay available. The split follows Apple's accented widget rendering: primary
content (time, temperatures, conditions, reminder titles) keeps the text colour,
and only the accent group is tinted. Both modes tint exactly the same elements,
so Native adds hue, not light. Status cues keep their own tones in both modes.

| Role | Tone | Hex | OKLCH (L C h) | Meaning |
| --- | --- | --- | --- | --- |
| time | Lilac | `#aaa0ca` | 0.729 0.061 296 | Time and night (Clock, World clocks, Calendar, moon) |
| sky | Mist | `#8aa8c2` | 0.718 0.050 245 | Sky and conditions (Weather, Forecast, Air quality, snow) |
| water | Sea glass | `#73b1ab` | 0.717 0.065 188 | Precipitation (rain chance, rain and storm glyphs) |
| sun | Gold | `#b3a774` | 0.726 0.070 96 | Clear daytime (Sun & moon, clear-day glyph) |
| personal | Rose | `#c99695` | 0.721 0.062 20 | Your own items (Reminders, Countdown, Note) |
| stone | Stone | `#a9a49c` | 0.721 0.013 80 | Images, clouds and neutral (Last screen, Photo, cloud glyph) |

Status tones are unchanged: stale amber `#b0926b` and offline mauve `#977e88`.

Method. Every tone sits in one OKLCH lightness band (0.72–0.73) with low chroma
(0.05–0.07; stone ≤ 0.02), so relative luminance stays within 6% of the Mist
default and no tone is brighter than the brightest single-accent swatch. Each has
more than 8:1 contrast on true black at full brightness; the saved brightness cap
then dims every mode alike, and a browser luminance check keeps the native
composition within 5% of colour mode at Room and Night brightness. Hues are spread
so any two tones that can share a screen, and every tone against both status
tones, are at least ΔE_ok 0.05 apart. Gold was chosen over Sand because Sand sits
too close to the stale amber. `src/shared/palette.test.ts` proves these numbers.

Meaning is never carried by colour alone: every widget keeps its words, glyph
shapes, positions and status labels ("Saved forecast", "Offline", "Overdue"). For
protan and deutan vision (Machado 2009 simulation at full severity), Lilac/Mist,
Sea glass/Stone and Rose/Stone converge to under ΔE_ok 0.03; they remain separated
by glyph shape, labels and position, which is why colour is only a tint here.
Nothing new is filled or framed and images are never tinted. Browser checks cannot
establish perceived harmony, comfort or burn-in on the S90F; that stays with
physical acceptance (#87). Per-widget colour overrides (#85) and a warm night tint
(#86) are separate follow-ups.

Sources: [Apple Widgets: accented rendering](https://developer.apple.com/design/human-interface-guidelines/widgets),
[Apple Dark Mode contrast](https://developer.apple.com/design/human-interface-guidelines/dark-mode),
[Material dark theme](https://m2.material.io/design/color/dark-theme.html) (desaturated
tones on dark surfaces), and [OKLab](https://bottosson.github.io/posts/oklab/) for
perceptual lightness and distance.

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
actual TV brightness or viewing comfort. Ambient metadata keeps a display-relative
floor (1.4% of display height; 1.65% for secondary values), about 10/12 CSS px on
a 720-CSS-pixel-tall display such as a 4K TV at 300% scaling, instead of shrinking
with each widget. See [UI contracts](ui.md), [API](api.md)
and the [UX role guide](roles/ux.md) for verification and future work.
