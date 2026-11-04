# Ambient themes

Work tracked in #575, with #452 hourly weather and #458 holiday cards. Existing
installations keep themes Off. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Design decision (2026-11-04)

Independent coordinator concept critique chose one native Theme selector in the
Style inspector over scene cards (too tall) or an automatic-only switch (hides
the requested modes). The choices are Off, Weather, Seasonal & holidays and
Combined. Seasonal/Combined reveal Canada, Korea and Russia checkboxes. Dynamic's
opt-in Holidays source exposes the same choices directly, including with themes
Off. Empty calendars still keep seasons. Combined means “Seasonal until noteworthy weather
is near.” The resolved scene distinguishes current conditions from forecasts.

One sparse layer sits behind widgets. Its small motifs stay dim against true
black, without full-screen fills, blur, persistent borders, lightning flashes or
audio. Weather chooses the geometry; a seasonal or celebratory tint can remain.
Commemorations use restrained marks rather than celebratory particles. Off does
not mount the layer; reduced motion and Animation Off remove it entirely. This
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

## Resolution and motion

Weather uses fresh, connected readings for the selected location. Current codes
must be at most 90 minutes old; forecast conditions look ahead three hours.
Hourly codes are instants, while gusts describe the preceding hour. Only a wholly
upcoming gust interval produces “expected soon.” Wind and gust thresholds are
shared with Dynamic. Stale, disconnected or unknown weather falls back to seasons
and holidays in Combined; Weather alone becomes quiet. This is decoration, not an
official warning. Enabling Weather or Combined requests the existing forecast
even if all weather widgets are hidden; it adds no provider or faster polling.

Seasons follow the configured location's hemisphere. Holiday dates follow the
computer's civil date, with selectable curated calendars documented in
[Holiday calendar](holiday-calendar.md). Major holidays have bounded lead windows;
commemorations take precedence over festive anticipation. Unsupported Korean
lunar-date runtimes show a brief limitation; fixed dates and seasons remain.

Each mark uses one finite 12-second transform/opacity animation. Eight weather
slots renew one at a time every two seconds, six holiday slots every three seconds,
or five fog/commemoration slots every four seconds. A slot lives 16–20 seconds,
so it becomes invisible before replacement. Initial marks fade in individually;
motif changes and motion resumption start a fresh sequence. Only a few marks are
visible at once. This provides continuous sparse atmosphere without a per-frame
JavaScript loop; it does not claim zero continuous GPU work or unchanged energy use.
The editor's normal canvas stays still; Preview movement shows the atmosphere.

## Source verification

The dedicated `themes` browser suite uses an ephemeral source server and synthetic
dates/weather. It verifies Save/Cancel, shared calendar controls, 44px keyboard
targets, 320/390px and short editors, holiday/weather geometry at 1080p and 4K,
reduced-motion behavior, steady/initial slot lifetimes and real browser Dangi.
Its optional images are returned in RAM, never saved. Bounded CDP samples compare
active atmosphere with motion off; the general performance budget remains #364.
Calendar and weather units exercise lunar dates, lead-window expiry, stale data,
hourly hazards, DST and gust intervals. Persistence checks retain the frozen reader.

Final pushed-head review and CI evidence belong to [PR #576](https://github.com/8roundshock/living-room-display/pull/576).
These are source checks; no installation or native/physical-TV acceptance is
established by the theme suite.
