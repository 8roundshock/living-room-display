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
actual TV brightness or viewing comfort. Ambient metadata keeps a display-relative
floor (1.4% of display height; 1.65% for secondary values), about 10/12 CSS px on
a 720-CSS-pixel-tall display such as a 4K TV at 300% scaling, instead of shrinking
with each widget. See [UI contracts](ui.md), [API](api.md)
and the [UX role guide](roles/ux.md) for verification and future work.

## Motion levels

Style → Motion → **Animation** offers Off, Subtle (default) and Lively (#76). It is
separate from Soft motion, which still controls whole-arrangement fades, drift and
travel. Relocation through black always continues, at every level and under reduced
motion. A screen that asks for reduced motion shows Off whatever is saved; on the
TV that is Windows Settings → Accessibility → Visual effects → Animation effects.

- **Off** keeps widgets still: no value, digit, glyph or entrance motion. The editor
  keeps its existing brief transitions.
- **Subtle** moves only when something changes and never loops. After a black rest
  (Soft motion on, fade above 0) each widget settles from about 1.5% of the display
  height above over 700 ms, 70 ms apart in reading order (capped at six steps).
  Changed clock characters, values and new reminders or images fade in, analog
  hands ease clockwise, and the current-weather glyph settles once (at most 1 s) on
  a reveal or a condition change.
- **Lively** adds richer reveal choreography (forecast days, rain bars, weather
  metrics, reminders) and the only loops, all on the current-weather glyph: sun rays
  turn once in 90 s while the core dims to 82% every 8 s, the moon rocks ±4°, clouds
  drift ±2.5%, rain drops fall and fade every 1.8 s, snow turns once in 40 s, and the
  storm bolt dims once for 1.2 s every 9 s. Loops pause during the black rest.

Rules for every level: only transform (translate, rotate, scale) and opacity
animate; opacity never rises above its resting value, so nothing flashes or
brightens; offsets come from above or the left, or stay inside the glyph box, and
never exceed the widget padding, so content stays inside its rectangle and the fit
scale never changes; numbers are never tweened through invented values; stale,
offline or unavailable weather keeps its glyph still; age and attribution never
move; every animation lasts at most 2 s except the Lively glyph loops. Editor
micro-interactions (sliding tab indicator, disclosures, picker, drag pickup and
settle, new-widget drop-in, Save bar entrance) last at most 240 ms and never bounce.

| Source | Application |
| --- | --- |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Purposeful, brief, optional motion that never blocks; respect Reduce Motion. |
| [WidgetKit: Animating data updates](https://developer.apple.com/documentation/widgetkit/animating-data-updates-in-widgets-and-live-activities) | Animate a change rather than continuously; each widget animation is capped at 2 s. |
| [Apple Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Always-On widgets do not animate; here only Lively's one hero glyph loops, and only when chosen. |
| [WCAG 2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | Perpetual motion is opt-in (Lively); Off or the system setting stops it. |
| [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | `prefers-reduced-motion: reduce` turns all animation off on that screen. |
| [WCAG 2.3.1 Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) | No flashes: opacity only dims, and the bolt pulse is one 1.2 s dip in 9 s. |
| [Chrome compositing](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations) | Transform and opacity on HTML boxes run on the compositor. Chromium does not composite them on SVG roots (verified in Edge 155), so glyph loops move HTML wrappers. |

`tests/ui/motion-browser.mjs` checks the levels, reduced motion, the reveal
sequence, rectangles and fit at 50% of an entrance, the loop inventory, glyph pixel
parity and a 15 s CDP budget at 1280×720 ×3. Browser checks do not establish TV
smoothness, comfort or long-term OLED behaviour; physical acceptance is #111.
