---
name: living-room-widget
description: Add or change Living Room Display widgets, their supported sizes, catalog entries, renderers, configuration, or ambient presentation. Use for this repository's widget implementation and design, including clock and photo variants.
---

# Living Room Display widgets

Work from the repository's `AGENTS.md` and [widget contract](../../../docs/widgets.md).
This is a local web app; Apple's widgets inspire its families and glanceability,
but it does not use WidgetKit or inherit Apple's display protection.

## Find the authority

Read the contract's source map before changing code. The shared catalog defines
supported types, families and grid geometry; the renderer registry supplies their
presentation. Extend those paths rather than adding a second list of widgets,
special cases in the picker, or a separate ambient layout engine. Inspect current
code and tests for actual symbols and commands; the documentation is not a schema.

## Build the smallest useful widget

- Define its single purpose, smallest useful family, larger-family content, and
  configuration/data ownership. Offer a size only when its information fits and
  adds value. Keep every widget optional and removable.
- Route placement and resizing through shared grid helpers. Preserve collision,
  bounds, migration, export/import and preset behavior. Provide a keyboard/control
  alternative to dragging; never persist an intermediate drag frame.
- Reuse ambient type/color/motion tokens and the centralized relocation wrapper.
  Avoid a bright card, fixed frame, separator or permanent header. For large time
  numerals favor a legible dim outline treatment; do not add a stationary clock
  face or hide meaningful data merely to make a size fit.
- Keep the entire widget, including labels and attribution, inside its movable
  group. Spatial relocation and black intervals must continue when motion effects
  are reduced. Dimness or movement does not guarantee prevention of OLED burn-in.
- Use honest loading, unavailable, stale and empty states. An empty widget can
  disappear according to its option; a failed request must not imply no content.
  Ambient widgets are silent and passive; configuration/actions belong in the editor.
- For image widgets, read the contract's photo boundary. User-selected photo
  storage and the RAM-only last-desktop capture are different features.

## Rules for new widgets

- Declare a `category` and an existing palette `tone` on the catalog entry, one
  line per entry, appended after existing ones. Activate a reserved `planned` entry
  by deleting its `status`; do not add a second id for it.
- Implement a `WidgetModule` in its own file under `src/client/widgets/`, with its
  own CSS file imported from that module. Register it on its line in
  `WIDGET_MODULES`. Use `Settings`, `draftProblem` and `sample` hooks instead of
  editing the inspector, editor or picker.
- Use `WeatherGlyph` for weather symbols and `TransitionText` for changing values.
  Add no per-widget animation loop.
- Know when the shared fit reruns (#314): on a box or content-size change, a text or
  structure change, a `class` change inside the content, and a Text size or typeface
  change, never on a `style` or `data-*` change alone. Restyle through a class when the
  change can alter overflow, or ask for a refit.
- The registry wraps your renderer in an error boundary (#318): a throw shows
  "<Widget> unavailable" in your widget's footprint instead of blanking the display
  or editor. Still render honest unavailable states yourself; the boundary is a net.
- Colour follows the contract's [colour rules](../../../docs/widgets.md#ambient-appearance-and-recurring-exposure)
  (#75, #214): primary content (times, temperatures, titles) uses the text colour;
  labels, units, captions, secondary values, bars and dots use `var(--ambient-accent)`,
  which Native mode turns into the widget's catalog tone. Never hard-code a hue,
  fill or frame anything for colour, or tint an image. Mark a glyph icon `data-glyph`
  (a `WEATHER_GLYPH_TONE` name) so it paints its own sub-tone, or wrap a subtree in
  `tone-<role>`. A stale or offline line takes the shared `.status-caution` class
  (`widgets.css`): it paints the one status tone, `--ambient-caution`, at full opacity,
  so a dimmed parent never fades the cue. Do not write a separate colour rule for it
  (#322). The Overdue word keeps its own rule in the same tone. A face of primary text
  only is allowed (Note).
- A free-size widget uses the optional `freeSize` catalog rule (#73) rather than
  its own geometry.
- Never delete a catalog id the previous release knows: mark it `retired` with
  `mergedInto` so its keys stay readable for rollback.
- Add a `tests/ui/widget-checks/<id>.mjs` module, and prove new persisted data
  with rollback scenarios using the helpers in `src/server/compat/previous-reader.ts`.

Configuration edits join the existing settings draft: Save/Cancel, dirty-only
save bar, async cancellation and concurrent-draft preservation. Do not add an
independent autosave path for a new widget's settings.

## Verify and hand off

Use isolated synthetic data. Run relevant build/tests and inspect actual rendering
for each supported family, grid and relocation phase, including reduced motion,
long content and no-data states. Run the palette harness,
`tests/ui/palette-browser.mjs`: add a newly active widget to its `FULL_BOARD`, and
to `ACCENT_SELECTOR` when its accent element is a new kind or to `TEXT_ONLY` when
it has none. It fails for any painted colour other than the element's accent, the
text colour or the status tone. Check black transition intervals, clipping,
overlap, pointer isolation and mobile/keyboard editing. Keep captures in memory.
Report actual evidence and what still needs physical-display acceptance; a browser
image cannot establish long-term OLED behavior.

Update the catalog, focused tests and affected project docs together. Follow the
repository's primary-ticket PR convention and obtain independent review of the
final pushed head. No global skill installation, TV changes, live capture or
external reporting is implied by adding a widget.
