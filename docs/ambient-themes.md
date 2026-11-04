# Ambient themes

Work tracked in #575, with #452 hourly weather and #458 holiday cards. Existing
installations keep themes Off. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Design decision (2026-11-04)

Independent coordinator concept critique chose one native Theme selector in the
Style inspector over scene cards (too tall) or an automatic-only switch (hides
the requested modes). The choices are Off, Weather, Seasonal & holidays and
Combined. Seasonal/Combined reveal Canada, Korea and Russia checkboxes. Empty
calendars still keep seasons. Combined means “Seasonal until noteworthy weather
is near.” The resolved scene distinguishes current conditions from forecasts.

One sparse layer sits behind widgets. Its small motifs stay dim against true
black, without full-screen fills, blur, persistent borders, lightning flashes or
audio. Weather chooses the geometry; a seasonal or celebratory tint can remain.
Commemorations use restrained marks rather than celebratory particles. Off does
not mount the layer; reduced motion and Animation Off remove its motion. This
does not promise OLED burn-in prevention or substitute for weather alerts.

Primary guidance checked 2026-11-04: [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
informs optional, purposeful, restrained movement; [Apple reduced-motion criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
informs stopping decorative motion when the system requests it. Existing native
select/checkbox controls preserve platform keyboard behavior. This is an original
web adaptation, not Apple certification. Recheck on changes to motion, theme
selection, accessibility preferences or new render platforms.

## Compatibility

The default theme is omitted from saved data and exports, including saved styles.
Selecting a theme or custom calendar selection writes an additive appearance
field older strict readers cannot understand; turn it Off and restore all three
calendars before rolling back, or restore the pre-update backup. The new Dynamic
holiday source is opt-in and omitted when false. Enabling it is likewise an
explicit older-reader rollback exception. No historical compatibility fixture is
modified to make a new feature pass.

## Verification status

Foundation checkpoint only. Calendar, weather integration, rendered scenes,
source/browser checks and independent final-head review are still in progress.
No installation or native acceptance is claimed.
