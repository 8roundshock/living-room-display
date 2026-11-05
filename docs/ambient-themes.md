# Ambient themes

Work tracked in #582 (richer colour/composition/motion), following #579 and #575, with #452
hourly weather and #458 holiday cards. Themes default to Off; existing selections
are preserved. A theme is part of the visual style, so the editor
preview, Save/Cancel, saved styles and scheduled styles share the same choice.

## Design decision (2026-11-04)

Independent coordinator concept critique chose one native Theme selector in the
Style inspector over scene cards (too tall) or an automatic-only switch (hides
the requested modes). The choices are Off, Weather, Seasonal & holidays and
Combined. Seasonal/Combined reveal Canada, Korea and Russia checkboxes. Dynamic's
opt-in Holidays source exposes the same choices directly, including with themes
Off. Empty calendars still keep seasons. Combined means “Seasonal until noteworthy weather
is near.” The resolved scene distinguishes current conditions from forecasts.

Independent cultural research and concept critique for #579 compared enlarged
repeated icons, a fixed botanical vignette and migrating contour compositions.
The chosen composition has a recognizable original anchor plus simpler companion
marks. The renderer measures widget reading areas and searches bounded negative
space; a crowded board can omit a mark. It reserves only the finite mark lifetime,
using the existing float/step waypoints and upcoming swap destination, including
the pending dim-before-step window. Typography/content measurement invalidates
still placement; an existing animated mark that becomes unsafe fades smoothly
without restarting other slots. This conservative retirement can precede its
natural expiry. There are no per-frame layout reads. Three distinct winter festivities use
fir/ornaments, broad New Year arcs or the Russian tree, and an Orthodox Christmas
star. Seollal uses an open-centred rectangular kite, Chuseok a separated full-moon
circle and harvest forms, and Buddha's Birthday lotus lanterns.

Owner direction, 2026-11-04 (#582), asks for noticeably more colour, more visible
forms and richer characteristic movement across all 23 scenes. The chosen pass
uses three prominent palette roles and multi-scale contours with small local
13%-opacity fills, instead of a particle-count-only change or broad filled
vignettes. Global brightness stays authoritative; compare at 26% and 36% rather
than raising saved settings. A feature form recurs every third seasonal birth,
with distinct smaller companions between it. Winter crystals, summer flowers,
Maslenitsa pancake stacks and geometric Pascha eggs improve silhouette identity.
The first visual pass found weather still disproportionately faint; the second
uses a broader feature every third birth, smaller companions and stronger coloured
strokes. Rain has droplets/ripples and streaks, snow readable crystal groups,
storms curled cloud/rain, fog three separated ribbons and wind leaves/currents.

One bounded layer sits behind widgets. Its larger contours stay dim against true
black, without full-screen fills, blur, persistent borders, lightning flashes or
audio. Weather chooses the geometry; a seasonal or celebratory tint can remain.
Exact selected quiet dates use neutral seasonal/weather contours. Off does
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

Each mark uses one finite 12-second transform/opacity animation. Twelve weather
slots renew one at a time every 1.2 seconds, nine seasonal/holiday slots every
1.6 seconds, or eight fog slots every two seconds. Exact quiet dates keep four
slots at four-second intervals, neutral colour, no fills and reduced travel.
A slot lives 14.4–16 seconds,
so it becomes invisible before replacement. Initial marks fade in individually;
motif changes, quiet-day transitions and motion resumption start a fresh sequence.
Several forms stay visible at once. This provides continuous atmosphere without a per-frame
JavaScript loop; it does not claim zero continuous GPU work or unchanged energy use.
The normal editor immediately shows a representative still scene when enabled
and motion is allowed; Preview movement runs the same finite sequence. Animation
Off and system reduced motion remove both and explain why in Style.
Eight registry motion profiles provide five actual waypoints each: sway, flutter,
rise, drift, rain, snow, mist and wind. The renderer passes these to finite CSS
transforms; placement derives its bounds from the same waypoints, maximum
interpolated rotation and stroke extent. Per-mark scale/direction variation stays
inside those bounds. No frame-by-frame script, paint animation or flashing.

Try a scene occupies the existing canvas caption and opens a compact native
grouped select. Its Preview/display-unchanged label stays visible until Automatic
is restored. It can demonstrate a scene with Theme Off, without changing the
saved mode, dates, weather or display. This is local editor state, cleared by
Cancel, mode/calendar/style changes, layout editing and leaving. It never makes
the draft dirty or adds a persistence field. The collapsed control keeps the
default Style inspector's 720px height budget.
On narrow/short windows the expanded chooser follows document flow, so the sticky
style toolbar cannot cover its label/select. The native popup retains the app's
explicit dark option/optgroup contrast.

## Extension authority

The repository-local [theme skill](../.agents/skills/living-room-theme/SKILL.md)
routes future changes. `src/shared/theme-registry.ts` is the actual shared source
for art, palette, scale, motion cadence and explicit holiday eligibility/windows/
priorities; the picker derives its options from it. `holidays.ts` owns factual
calendar rules. `ambient-theme.ts` resolves current weather/season/holiday and
creates explicitly labelled illustrations. `AmbientTheme.tsx` owns bounded
placement/finite slots; `Display.tsx` supplies reading-area exclusions/brightness.
Add one scene and explicit policy, source its cultural meaning in the calendar
doc, and exercise date boundaries, weather priority, scene demonstration isolation,
ordinary preview, motion resumption and compact controls. Do not duplicate a
second list in UI, infer eligibility from a new public holiday, or rewrite date
facts just to change a decorative lead window.

## Source verification

The dedicated `themes` browser suite uses an ephemeral source server and synthetic
dates/weather. It verifies Save/Cancel, shared calendar controls, 44px keyboard
targets, 320/390px and short editors, holiday/weather geometry at 1080p and 4K,
reduced-motion behavior, steady/initial slot lifetimes and real browser Dangi.
Its optional images are returned in RAM, never saved. Bounded CDP samples compare
active atmosphere with motion off. Faster births use the prior allowance of 15
style recalculations per two renewals (rounded up), with five while idle; the
4.2-second sample also caps renewals, task time, layout, paint and layer count.
A deliberate per-frame style invalidation must fail that budget. This is a
per-renewal adaptation, not an unchanged absolute work allowance; the general
performance budget remains #364.
Calendar and weather units exercise lunar dates, lead-window expiry, stale data,
hourly hazards, DST and gust intervals. Persistence checks retain the frozen reader.
Canvas preview control changes also run the existing `workspace` browser suite
for alert clearance, dirty-state and scroll interactions alongside `themes`.

The original foundation's review/CI evidence belongs to [PR #576](https://github.com/8roundshock/living-room-display/pull/576).
The cultural refinement's review and CI belong to [PR #581](https://github.com/8roundshock/living-room-display/pull/581).
The richer styling pass's all-scene comparisons, focused regressions and current-head
review/CI belong to [PR #583](https://github.com/8roundshock/living-room-display/pull/583).
These are source checks; the theme suite establishes no installation or
native/physical-TV acceptance.

## Optional annual birthdays (#584)

Birthdays are global private content in Settings, independent of saved and
scheduled styles. The collapsed section edits up to 24 named month/day entries
with Classic, Russian accents or Korean accents, through ordinary Save/Cancel.
No birth year or age is requested. Invalid month/day pairs stay editable and
block Save. February 29 appears only in leap years, with conditional help.

Seasonal and Combined use the exact civil day only. A birthday takes precedence
over public festive windows and seasons; selected exact quiet dates retain
neutral subdued geometry. Weather mode stays weather. In Combined, noteworthy
weather keeps its geometry with birthday colours. Same-day birthdays share their
treatment when identical; mixed treatments use Classic, independent of list order.
No personal label enters scene metadata or generic Try a scene options.

The birthday-first original cake, balloons and gift vocabulary uses three tones
and the existing finite, bounded placement. The candle is a static contour in a
moving mark, never a flicker. The accents are textile-inspired product art, not
claims about a birthday ritual or a culture's canonical colours:

- [Russian Ethnographic Museum, REM2740-26](https://collection.ethnomuseum.ru/entity/OBJECT/378562)
  describes red embroidery bands and rows of diamonds on a nineteenth-century
  Vologda linen towel. The artwork uses an original small diamond ribbon on the
  cake/gift, without copying the object or its symbolic figures.
- [V&A, Jogakbo](https://www.vam.ac.uk/articles/jogakbo-traditional-korean-patchwork)
  describes irregular squares/rectangles and flat seams. Original offset panels
  sit inside a cake band or gift; there is no full-screen grid.

Primary museum sources reviewed 2026-11-04 by the independent cultural/UX critic.
Recheck on changes to cultural motifs or descriptions. Compared style-local dates,
a new content widget and global Settings; the latter preserves dates across style
switches and avoids adding a display surface or crowding the Style inspector.

The central registry owns all three birthday scenes and treatment-to-scene mapping;
`shared/birthdays.ts` owns date validation and same-day treatment resolution.
Top-level `settings.birthdays` is private local content included in explicit
exports/backups. Empty entries are omitted at rest; nonempty entries are an
explicit strict older-reader rollback exception. Remove them and save twice or
restore the pre-update backup before rolling back. Frozen compatibility readers
remain unchanged. Settings, themes and Workspace browser checks cover the new
controls and previews; source checks do not establish installed/native acceptance.
