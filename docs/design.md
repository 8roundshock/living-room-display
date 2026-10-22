# Display studio design

## Widget discovery (#516, 2026-10-22)

The picker keeps its grouped rail and one actual synthetic preview, adding catalog
search and a native availability filter. A full thumbnail gallery would crowd the
compact inspector; extra category tabs would add navigation while making cross-category
search less useful. Independent concept review chose the compact direction. Empty
results never keep an actionable stale Add. Current draft state supplies added checks,
filters and counts; search never reads private widget content.

The existing room solver supplies pre-add guidance and explicit draft fixes (#448).
Selecting a fix is the only action that changes the board. Preview families retain
their shared geometry, and accessible descriptions expose cell footprints (#430).

Primary guidance checked 2026-10-22: [W3C APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
for predictable focus, Tab between components and arrow keys within the rail;
[APG button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) for native button
activation, stable names and descriptions. The native search and select keep their
own keys. Recheck this adaptation when catalog navigation, filtering or panel sizing
changes; a browser test does not establish assistive-technology usability on every device.

## Studio foundation

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
opens a grouped catalog (Time, Weather & sky, Personal, Pictures; a narrow rail on
desktop) with one actual widget renderer with synthetic content, family
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
| time | Lilac | `#aaa0ca` | 0.729 0.061 296 | Time and night (Clock, World clocks, Calendar, moon, partly cloudy night's moon) |
| sky | Mist | `#8aa8c2` | 0.718 0.050 245 | Sky and conditions (Weather, Forecast, Air quality, snow) |
| water | Sea glass | `#73b1ab` | 0.717 0.065 188 | Precipitation (rain chance and its droplet, drizzle, rain and storm glyphs) |
| sun | Gold | `#b3a774` | 0.726 0.070 96 | Clear daytime (Sun & moon, clear-day glyph, partly cloudy day's sun) |
| personal | Rose | `#c99695` | 0.721 0.062 20 | Your own items (Reminders, Countdown, Note) |
| stone | Stone | `#a9a49c` | 0.721 0.013 80 | Images, clouds and neutral (Last screen, Photo, cloud, partly cloudy and fog glyphs) |

There is one status tone: stale and offline both use the amber `#b0926b`
(`--ambient-caution`), as Weather and Air quality already showed (#223). The unused
mauve offline token and the display-level disconnected line are gone (#133).

The five single-colour swatches are Mist `#8aa8c2`, Lilac `#aaa0ca`, Dusk `#8d9dcc`,
Sand `#b6a588` and Sage `#88afa6`. Sand was retuned in #224 from `#b8a17a`, which sat
ΔE_ok 0.043 from the amber, to a lighter, quieter sand at 0.055 (OKLCH 0.729 0.045
81, the same hue and within 6% of Mist's luminance), so a stale or offline label
never reads as the accent. Data that stores the old value is aliased at read time:
the editor selects it as Sand and the display renders the new value, while the
saved file keeps the old value until another colour is saved.

Method. Every tone sits in one OKLCH lightness band (0.72–0.73) with low chroma
(0.05–0.07; stone ≤ 0.02), so relative luminance stays within 6% of the Mist
default and no tone is brighter than the brightest single-accent swatch. Each has
more than 8:1 contrast on true black at full brightness; the brightness cap (the
Fixed level, or Follow daylight's value for the minute, #439) then dims every mode
alike, and a browser luminance check keeps the native composition within 5% of
colour mode at Room and Night brightness. Hues are spread
so any two tones that can share a screen, every tone against the status tone, and
every colour swatch against the status tone, are at least ΔE_ok 0.05 apart. Gold
was chosen over the old Sand because it sat too close to the stale amber.
`src/shared/palette.test.ts` proves these numbers.

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

## Weather symbols and unavailable weather

The weather symbols are original outline drawings on one 24-unit grid with a 1.5-unit
round stroke (`GLYPH_PARTS` in `src/client/icons.tsx`), so a symbol never contradicts
its condition text (#251): clear (sun by day, crescent by night), partly cloudy (WMO
codes 1–2: a smaller front cloud with the sun's visible arc and rays, or a crescent,
above and to its left), overcast (3), fog (45, 48: a cloud over two lines of mist),
drizzle (51–57: the rain cloud with short, staggered drops), rain, snow and storm. A code
the provider does not document draws a plain cloud. Each symbol is separate parts, so the
Lively loops and settles move a part on the compositor, and a two-tone symbol paints its
sun or moon part with that glyph's own sub-tone while the cloud stays Stone. Forecast
marks its precipitation chance with a small droplet rather than repeating a weather
symbol. Glyph boxes keep their CSS sizes (#128).

Unavailable weather is never louder than the weather it replaces (#362). Weather and
Forecast keep their footprint with a dim (35%), still cloud, the widget's own icon rather
than a condition, beside a dim “—°”, and say so once in the status tone at the family's
label size: “Weather unavailable · retrying”, or “· offline” while the display cannot
reach the computer. The age shows only when an update time is known, and the credit goes
while no forecast is shown. Nothing is invented; there is no option to hide the widget
when unavailable.

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
widget follows the pointer continuously. Reduced motion removes effects and ambient travel while the
board still moves in one step each interval, never through black (#436). Information never
depends on animation or tint alone. No audio or haptics are introduced.

The owner's movement requirement deliberately differs from Apple's stable
Always On layout advice: the arrangement stays as placed but floats slowly, and
each widget's content floats inside its own box; varied collision-free compositions
(Swap places) are opt-in and glide. The screen never goes dark to move (#436). The grid editor exposes one layout-editing mode, a catalog
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

## Dynamic emphasis

Dynamic (#437) must make an official warning or a storm starting soon noticeable from the
couch without adding light. Urgency comes from words, rank and size only: the warning or
focus card leads, its headline takes the elevated step (`min(8cqw, 11cqh)` in small and
large, `min(6.2cqw, 14cqh)` in medium; rotation one step smaller), and "Warning" alone uses
the status tone (`--ambient-caution`), as "Overdue" does. No weight above 500, no fill,
frame, underline, inverse text, glow, pulse, blink or loop; opacity never rises above its
resting value; colour is never the only signal, and the official provider's colour code is
ignored. Its weather glyph is never the hero glyph (no loops) and is still while the data is
saved or the display is offline. There is no audio and no live region. One card shows at a
time: a new card is a new element (the old one leaves at once), fading in with the
value-change fade at Subtle and Lively (Lively adds a settle from above, within the padding,
under 1.3 s); Off and reduced motion swap instantly, and the first card after the widget
appears never animates.

## Motion levels

Style → Motion → **Animation** offers Off, Subtle (default) and Lively (#76). It is
separate from moving the board (#436): **Float gently** (`motionEnabled`; called Drift
and fade between moves from #240, and Soft motion before that) floats the whole board
within ±3.5% of the display and each widget's content inside its own slack, one device
pixel at a time and at most 30 steps a second, with nothing animating in between, so
the display draws a frame only when something moves (#248's principle, which replaced
a continuous drift that drew about 120 frames a second). **Swap places** (opt-in) also
trades cells every interval with a glide. The screen never fades out or rests on
black. Animation level does not control the board's float. Float gently off or
reduced motion replaces continuous float with one step each interval. A screen that asks for reduced motion shows Off whatever is saved; on
the TV that is Windows Settings → Accessibility → Visual effects → Animation effects.

- **Off** keeps widget content animations still: no value, digit, glyph or entrance motion. The editor
  keeps its existing brief transitions.
- **Subtle** animates content only when something changes and has no glyph loops. When the display first
  loads (Float gently on, swap glide above 0) each widget settles from about 1.5% of
  the display height above over 700 ms, 70 ms apart in reading order (capped at six
  steps).
  Changed clock characters and values fade in (weather and rain timing, forecast,
  Air quality, Calendar, Countdown, Note, Sun & moon and World clocks), as do newly
  pending reminders (by opacity alone, so the measured list keeps its geometry), new
  rain and air-quality bars (to their resting opacity) and new images. Existing bars
  ease to new heights (by `translate` from their baseline, #161), analog hands ease
  clockwise, and the current-weather glyph settles once (at most 1 s) on a reveal or a
  condition change. A stale or offline weather label takes the status tone at once,
  with its words, rather than fading its colour.
- **Lively** adds richer reveal choreography (forecast days, rain and air-quality bars
  rising from their baseline, weather metrics, reminder rows fading in place) and
  content loops on the current-weather glyph: sun rays
  turn once in 90 s while the core dims to 82% every 8 s, the moon rocks ±4°, clouds
  drift ±2.5%, rain and drizzle drops fall and fade every 1.8 s, snow turns once in
  40 s, and the storm bolt dims once for 1.2 s every 9 s. Partly cloudy's partial rays
  stay still (they would turn into the cloud) while its sun dims or its moon rocks around
  its own centre and the cloud drifts; fog's mist drifts against its cloud. Loops never
  pause: nothing goes black (#436).

Rules for every level: only transform (translate, rotate, scale) and opacity
animate; opacity never rises above its resting value, so nothing flashes or
brightens; offsets come from above or the left, or stay inside the glyph box, and
never exceed the widget padding, so content stays inside its rectangle and the fit
scale never changes; numbers are never tweened through invented values; stale,
offline or unavailable weather keeps its glyph still; age and attribution have no
independent animation. The whole widget still participates in the shared float.
Content transitions last at most 2 s except the Lively glyph loops; board float and
optional swap glides follow the separate movement contract (#436, #481). Editor
micro-interactions (sliding tab indicator, disclosures, picker, drag pickup and
settle, new-widget drop-in, Save bar entrance) last at most 240 ms and never bounce.

| Source | Application |
| --- | --- |
| [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Purposeful, brief, optional motion that never blocks; respect Reduce Motion. |
| [WidgetKit: Animating data updates](https://developer.apple.com/documentation/widgetkit/animating-data-updates-in-widgets-and-live-activities) | Animate a change rather than continuously; each widget animation is capped at 2 s. |
| [Apple Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Always-On widgets do not animate; here Lively adds a chosen hero-glyph loop, while the owner-requested shared float is independent of content animation. |
| [WCAG 2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | Lively glyph loops are opt-in and Off stops them. Float gently is separately enabled by default; turning it off or requesting reduced motion replaces continuous float with periodic steps. |
| [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | `prefers-reduced-motion: reduce` turns all animation off on that screen. |
| [WCAG 2.3.1 Three Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) | No flashes: opacity only dims, and the bolt pulse is one 1.2 s dip in 9 s. |
| [Chrome compositing](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations) | Transform and opacity on HTML boxes run on the compositor. Chromium does not composite them on SVG roots (verified in Edge 155), so glyph loops move HTML wrappers. |

`tests/ui/motion-browser.mjs` checks the levels, reduced motion, the reveal
sequence, rectangles and fit at 50% of an entrance for the whole merged catalog,
the loop inventory, glyph pixel parity, adaptive Weather, the measured Reminders
list, value changes in every widget unit, the float acceptance (#436: plane at opacity
1, one device pixel per step, no layout), steps, swaps, analog hands that only turn
forward, a 15 s CDP budget at 1280×720 ×3 for the default board and a full board of
every widget, and a frame budget (at Off with Float gently on, at most 30 drawn frames
a second and only when something steps, at 1280×720 ×3 and 3840×2160 ×1). Browser checks do not establish TV
smoothness, comfort or long-term OLED behaviour; physical acceptance is #111.
