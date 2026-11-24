# Widget contract

Reviewed 2026-10-18 against the owner's grid/widget requirements and the primary
Apple sources below. Recheck when the catalog, family geometry, rendering or
relocation changes, and when upstream guidance changes. This contract applies to
every ambient widget, including clocks, photos and last-desktop previews.

## Source map

| Authority | Responsibility |
| --- | --- |
| [`src/shared/widgets.ts`](../src/shared/widgets.ts) | The catalog (category, tone, status), supported families, grid definitions, placement and layout helpers, and `DEFAULT_BOARD`, the board new installs start with (#435). |
| [`src/shared/palette.ts`](../src/shared/palette.ts) | Accent modes and the palette roles a catalog entry declares as its `tone`. |
| [`src/shared/motion.ts`](../src/shared/motion.ts) | Animation levels and their labels. |
| [`src/shared/contracts.ts`](../src/shared/contracts.ts) and [`defaults.ts`](../src/shared/defaults.ts) | Persisted types, `widgetData` and catalog-derived initial settings. |
| [`src/server/validation.ts`](../src/server/validation.ts) and [`store.ts`](../src/server/store.ts) | Boundary validation, compatible legacy migration and atomic storage. |
| [`src/server/persistence.ts`](../src/server/persistence.ts) | The previous release and the additive defaults omitted at rest so it can still read files and exports. |
| [`src/server/compat/previous-reader.ts`](../src/server/compat/previous-reader.ts) | Test-only frozen reader of the previous release and its assertion helpers ([rollback compatibility](development.md#rollback-compatibility-check)). |
| [`src/server/photo.ts`](../src/server/photo.ts) | Strict normalized PNG ingestion and private selected-image validation. |
| [`src/server/air.ts`](../src/server/air.ts) | Keyless CAMS air quality via Open-Meteo: request, normalization, 30-minute cache and the `off` state; [`src/client/airHourly.ts`](../src/client/airHourly.ts) rebuilds the widget's upcoming-hour bars and UV peak each minute and decides whether saved current values still stand (3 hours, #188); [`src/client/astronomy.ts`](../src/client/astronomy.ts) holds the local sun, moon and time-zone calculations. |
| [`src/client/dynamic.ts`](../src/client/dynamic.ts) and [`src/server/alerts.ts`](../src/server/alerts.ts) | Dynamic (#437): the pure engine (every Dynamic threshold, score, card, the calm rotation, `rotationSlot` and `chooseDynamic`, exported for Home, #438), and the server-only official alerts from ECCC and the NWS ([API](api.md#official-weather-alerts)). |
| [`src/client/widgets/types.ts`](../src/client/widgets/types.ts) | `WidgetContentProps`, `WidgetSettingsProps` and the `WidgetModule` interface. |
| [`src/client/widgets/registry.tsx`](../src/client/widgets/registry.tsx) | `WIDGET_MODULES` (one line per id, catalog order), renderers, `widgetVisible` and labels. |
| [`src/client/hourly-forecast.ts`](../src/client/hourly-forecast.ts) | Hourly forecast (#714): the pure shaping of its columns (hours, and a sunrise or sunset in time order), the temperature trend and the heading facts, rebuilt once a minute ([Hourly forecast](#hourly-forecast-714)). |
| [`src/client/weather-outlook.ts`](../src/client/weather-outlook.ts) | The adaptive Weather rain outlook (#74): `rainOutlook` kinds, spells and confidence, and `rainOutlookCopy` wording ([API semantics](api.md#adaptive-weather-outlook)). |
| [`src/client/widgets/`](../src/client/widgets/) `<Name>.tsx` | One module per catalog id: `Clock`, `Weather`, `Rain` (retired, renders nothing), `Forecast`, `Reminders`, `Preview` (Last screen, drawn by `SnapshotImage`) and `Photo`, then the #78 widgets `WorldClocks`, `Calendar`, `Countdown`, `Note`, `AirQuality` and `SunMoon` (#157, #171), and `Dynamic` (#437), which each import their own CSS file. No id is planned, so there are no stubs. Also shared weather pieces in `common.tsx` (among them the status line and unavailable state that Forecast and Hourly forecast share), the `WeatherGlyph` and `TransitionText` primitives, and `measure.ts`, the layout-box measurement shared by the Reminders and large Countdown lists and the Note size (#216). [`src/client/calendar.ts`](../src/client/calendar.ts) holds the civil-date, week-start and countdown helpers that Calendar and Countdown share (#157), and [`src/client/calendar-dates.ts`](../src/client/calendar-dates.ts) the Calendar's upcoming dates and grid marks (#716). |
| [`src/client/Display.tsx`](../src/client/Display.tsx) | Ambient state and the shared movement/composition boundary. |
| [`src/client/Editor.tsx`](../src/client/Editor.tsx) | Picker, grid interactions and settings draft integration. |

Read those files rather than copying type, size or default tables into another
module. A catalog entry must reach the picker and renderer through this shared
contract. The repo-local
[`living-room-widget` skill](../.agents/skills/living-room-widget/SKILL.md) is the
entrypoint for agents adding or changing a widget; it requires no global install.

## Catalog contract

Each `WIDGET_CATALOG` entry sits on one line, so parallel changes touch different
lines. Besides its families and defaults, an entry declares:

- `category`: `time`, `weather`, `personal` or `pictures` (labels in
  `WIDGET_CATEGORIES`).
- `tone`: one existing palette role from `palette.ts` (`time`, `sky`, `water`,
  `sun`, `personal`, `stone`). Native accent colours (#75) use it; sections carry
  `tone-<role>` and the ambient root `data-accent-mode`.
- `status`: omitted means active. `planned` reserves an id whose renderer has not
  shipped; `retired` keeps an id only so the previous release can read data, with
  `mergedInto` naming the active id that absorbs an enabled retired placement (the
  retiring change owns that migration). Planned and retired entries are hidden from
  the picker and inspector and never rendered. Planned ids always read as disabled
  and a PATCH enabling one returns 400. No entry is planned now: #157 and #171
  activated all six #78 ids. Rain is retired and merged into Weather
  (#74, `absorbRetiredWidgets`); removing its id is tracked in #103.
- `reshaped` (optional, #714): a family whose span changed after data was saved with
  it, and the family a saved placement falls back to when the new span no longer fits
  (`fitReshapedFamilies`, which validation runs before the grid check). Hourly forecast
  declares `large: 'medium'`; see [its migration](#hourly-forecast-714).
- `keywords` (optional, #714): extra words the picker's search matches besides the name,
  description and category; they are never displayed. Hourly forecast lists what it shows
  (hourly, hours, temperature, rain, snow, sunrise, sunset), because its name and
  description do not say "temperature".

`WIDGET_IDS` keeps every id, because schemas and geometry need them all.
`ACTIVE_WIDGET_IDS` is the load-time list of shipped ids for UI lists and test
iteration; `isActiveWidget(id)` reads the catalog live for validation and rendering.
New entries are appended, which keeps the packing and composition of existing ids
identical. To ship a planned widget, delete its `status`, replace its stub module and
add its check module; nothing else in the shared code needs to change.

Each widget implements a `WidgetModule` in its own file under `src/client/widgets/`:
`Renderer`, optional `visible(props)` (after the catalog status and enabled flag),
optional `Settings` panel rendered in the inspector under the shared Size control,
optional `draftProblem(settings)` that disables Save and shows its reason, and
optional `sample({ state, settings })` that adjusts the picker's synthetic sample
with new objects, and, for free-size widgets, an optional one-line `sizeHint`.
Use `WeatherGlyph` for weather symbols and `TransitionText` for values that
change. Browser QA loads one check module per widget from
[`tests/ui/widget-checks/`](../tests/ui/widget-checks/): `id`, optional
`prepare(state, { now })`, extra clipping `selectors` and `family(...)` assertions.
An optional `sweep({ page, viewport, state, base, now })` runs once per viewport
after the family sweep for checks beyond the families; a module whose `id` is not
a widget id (such as `reminders-span`, the free-size span check) contributes only
its sweep. The suite's main page clock is shared by every module and moves only when a
check runs it; the harness puts it back to its start before each viewport's family pass
and before each sweep, so no check runs on time another one spent. Within a pass it
still moves: work out an expectation that depends on the time (an hour, a day or night
glyph, an age) from the page's own clock, never from the suite's first hour, and give a
sweep that runs time for many cases (each offline case needs the 30 s poll) a page with
a clock of its own through `withOwnClock` in
[`tests/ui/lib/own-clock.mjs`](../tests/ui/lib/own-clock.mjs). The suite fails when one
pass or sweep spends 150 minutes of that clock, where the synthetic fixtures start to
age out (#741).

Start with `WIDGET_CATALOG`, `GRID_DENSITIES` and `widgetSpan`; use
`reflowWidget`/`fitGridDensity` rather than implementing a second collision or
packing rule. `composeWidgetGrid` and `motionOffset` own ambient placement variation.
Schema/default changes belong at these authorities with their tests.
Legacy settings/presets without a grid receive the safe catalog default grid.
The catalog's `defaultEnabled`, `defaultPlacement` and `defaultSize` are that
backfill; new installs and Reset layout use the separate default board below, so
changing one never changes the other.
Their visibility/location choices survive; old offsets/scale and
`appearance.layout` are retained data, not converted or applied to the grid.
Grid revision 2 gives the large clock real height. Revision 1 is validated against
its original geometry before migration; enabled widgets remain present, with
family reduction only when needed to fit. Current invalid layouts are rejected.

### Default board (#435)

New installs and **Reset layout** start on the owner's board, `DEFAULT_BOARD`
(`defaultBoardGrid()` and `defaultBoardVisibility()`, used by `DEFAULT_SETTINGS`).
On Balanced 12 × 8 it fills every cell:

| Widget | Column, row | Family (cells) |
| --- | --- | --- |
| Calendar | 0, 0 | Large (4 × 4) |
| Clock | 4, 0 | Large (8 × 4) |
| Weather | 0, 4 | Large (4 × 4) |
| Forecast | 4, 4 | Large (8 × 2) |
| Last screen | 4, 6 | Medium (4 × 2) |
| Reminders | 8, 6 | Medium (4 × 2) |

Every other widget is off, and every widget stays optional. Hidden widgets wait at
their catalog placement, except the retired Rain, which sits inside Weather as in the
catalog board, so a stale editor that enables it merges into Weather (#74). The
catalog itself is unchanged: Calendar's `defaultEnabled` stays `false`, so older data
without a Calendar key still reads it as off, and a settings object without a grid
still receives the catalog board (Clock, Weather, Forecast, Reminders and Last screen).
`src/server/default-board.test.ts` proves both, and that the catalog's backfill
fields equal the installed `d66832b` catalog (#497). Because the board is full, adding a
widget always goes through room guidance: every hidden widget, in every family,
gets “No room for … at … size.” with **Switch the grid to Fine** and one reduction
(**Make room: Reminders small** for a small widget, **Weather medium** for a medium
one, **Clock medium** for a large one), each one valid draft. A full-height Reminders
column names Clock, and **Make room: Clock medium** fits it. Every widget of the full
board moves in every relocation cycle (`relocation.test.ts`). Style defaults are
not part of the board.

## Families and editing

Use discrete supported families, with one focused piece of information in the
smallest useful family and additional relevant detail in larger families. A
larger family changes composition and information density; it is not merely a
scaled small widget. A widget need not support every family. Keep text real,
scalable and readable, with meaningful labels instead of relying on color.
Small labels, status lines with their age, units and secondary values use the shared floors in
[`widgets.css`](../src/client/widgets.css): `var(--min-text)`/`var(--min-data)`,
inherited from `--ambient-min-text` (1.4% of the display or editor canvas height)
and `--ambient-min-data` (1.65%), times Text size. Wrap related values onto shared
rows before letting the fit scale shrink a family. Only a family that truly cannot
fit caps the floors by its own content height: small forecast uses 7.25% (text)
and 8.5% (data), which binds only when that height is under about 19.4% of the
display (about 1.07%/1.26% in the fine grid; Balanced sits at the threshold). Its high
and low share a row when they fit, so fresh, stale and offline small forecasts render at
fit 1 at Text 100% in every density at 720p, 1080p and 4K, with “5 hr ago” kept
together (#221). No Forecast family has a line under its strip (#715, see
[data boundaries](#data-and-image-boundaries)): in medium and large the strip takes that
room, in every state. Those medium and large strips are defined once for Forecast and
Hourly forecast (the `--strip-*` properties in `widgets.css`, #720), so the two read as
one family when stacked; see [Hourly forecast](#hourly-forecast-714). A forecast that is not fresh says so in the heading's right slot,
in place of the place and unit (small: the heading's second line), with the place's own
typography, so the heading keeps its height and the strip its size and position:
nothing resizes when a status comes or goes. The place and unit return when the forecast
is fresh again; until then a Forecast used without Weather names neither. The slot stays
one line in every family and density at Text 100%, up to the longest wording (“Offline ·
Updated 364 days ago”). Small has no room for “Saved forecast · Update time unknown”,
so there a status with no update time to tell is the label alone (“Saved forecast”,
“Offline”). Above Text 100% a status can cost a little fit, because it is longer than the
place: at Text 150% the small family on the Fine grid renders at fit 0.96 saved and 0.91
offline (1 fresh), as it already does fresh on the two larger grids (0.96 to 0.97). An earlier version of #715 gave the saved
strip a smaller size through a class; review found that every slow refresh then resized
the strip for two seconds, so a status must never change a widget's sizes. Put it where
the layout already has a line for it.
Small Weather caps its floors the same way at 8.5% (text) and 10% (data) of its content
height, which binds only below about 16.5% of the display (the Fine grid: about 9 px
instead of 10.1 px at 720p), and keeps its footer to one row of short phrases (#283).
Every Weather family renders at fit 1 at Text 100% in fresh, hint, elevated, stale,
offline, last-known and unavailable states, with long place names and sub-zero values,
in every density at 720p, 1080p and 4K (#283); so do small and medium Air quality for a
three-digit or long-category AQI with either qualifier (#309).
Overfull content is laid out proportionally wider before the fit scale shrinks it,
so a larger Text size never renders text-size-scaled labels or values smaller.
Icons and the fixed unavailable dash do not follow Text size and can still shrink
with the fit. The picker sample uses a fixed 9 px text and 10.5 px data floor (#361)
with the same zoom-out fit. Ambient glyphs pass `size={null}` so
these container-query sizes apply rather than the Icon's default 20 px (#128).

The shared fit in [`Display.tsx`](../src/client/Display.tsx) does not rerun on every
render (#99). It reruns when the widget's box or its content box changes size, when
React changes text or structure inside the content, when a `class` changes anywhere
inside the content (#314), and when Text size or typeface changes. A change to an
element's `style` or a `data-*` attribute alone does not rerun it, so a restyle that
can change the content's overflow must switch a class (or change text or structure).
The fit itself writes only the content's `style`, so a refit never triggers another.
With the Classic typeface (Georgia) every number uses lining, tabular figures, so digits
share one baseline and height; a rule that sets `font-variant-numeric` itself spells out
`lining-nums tabular-nums` so it does not bring the old-style figures back (#363). The
Clock's own digits are lining figures spaced by their ink ([digit spacing](#clock-digit-spacing)).

The renderer families have deliberate visual roles:

| Widget | Small | Medium | Large |
| --- | --- | --- | --- |
| Clock | Compact time and calendar; analog puts the hands, sized to the cell height, beside the date. While a timer is visible, the date line shows it ("8 min", "Done") | Time with its calendar column beside it, after the room of the widest time so the date does not move with the minute (#717), never pushed to the far edge where it would read as the next widget's (#332); analog sizes its hands to the cell height; a timer shows as in small, Done adds "· 2 min ago" | Centered monumental time with a quiet calendar line; outline, digital and hand-only analog styles share this composition; a timer reads "8 min left · ends 6:51 PM" ([timer slot](#clock-timer-slot)) |
| Weather (adaptive, #74) | Temperature and glyph, then one line: the condition when calm, otherwise the compact rain outlook (“Rain likely now”, “Rain possible now, likely later”); confidence only when partial. No footer while fresh unless that confidence shows; a saved or offline forecast adds one row of short phrases, wrapping only between them: “Saved forecast · 5 hr ago” (#283, #715) | Calm: conditions and feels-like; hint: the outlook line replaces feels-like; elevated (rain now or within six hours): rain timing and “Peak 60% · 4 mm rain”, with “Forecast estimate” under it; calm fresh weather has no footer, and a saved or offline forecast adds “Saved forecast · Updated 5 hr ago” in the status tone (#715) | Calm: adds wind and daily high/low; hint as medium; elevated: condition and high/low, then timing, detail and an hourly chance bar for each hour overlapping the next 12 (12 on the hour, 13 otherwise; spell hours brighter, unknown hours a dotted baseline) over “Now” and the window's end (#261). Unavailable in every family: a dim, still cloud, a dim “—°” and one status-tone line at the label size, “Weather unavailable · retrying” (“· offline” while the display cannot reach the computer), with the age only when known, in the status tone (#362, #715) |
| Forecast | Three days from the city's today; high and low share a row when they fit | Five days | Seven days; compact weekday labels preserve room for temperatures and chance, marked by a small droplet (#251). Every family starts at Today and names later days by weekday (tomorrow too, #256), with “Tomorrow, <date>” in assistive text; past days never show (#243), and the heading counts the days shown (“Next 4 days”). With no day to show, “Forecast unavailable · retrying” as Weather shows it (#362). A forecast is the heading and the strip, with nothing under it; medium and large use that room for a taller strip. A saved or offline one says “Saved forecast · 5 hr ago” or “Offline · Updated 5 hr ago” in the status tone in the heading's right slot, in place of the place and unit (small: the heading's second line), as Hourly forecast does; the strip keeps its size and position in every state (#715); the place and unit return when it is fresh again |
| Hourly forecast (#714) | — | Six columns: “Now” from the current reading, then the hours ahead, each with its time, a day- or night-aware glyph, the temperature on a thin trend line and the precipitation chance from 10%. A sunrise or sunset inside the window is a column of its own (exact time, sun symbol, the word) | Twelve columns in Forecast's 8 × 2 strip, so the two sit one above the other; both strips share one definition of their sizes (#720). The heading reads “Hourly”, with at most two facts on the right: the next sunrise or sunset when the strip does not show it, and “Gusts 55 km/h” from 40 km/h or 25 mph. Not fresh: Forecast's own status there instead, “Saved forecast · 5 hr ago” or “Offline · Updated 12 min ago”, in the status tone (#715); with no hour to show, “Hourly forecast unavailable · retrying” as Forecast shows it |
| Reminders | As many pending reminders as fit the actual box (measured from layout boxes, #216), soonest first (overdue or due within a week, then undated newest first, then later dates), with an honest “+N more” | The same measured list; never a partially visible row. When not every reminder fits, more rows win over bigger titles: rows after the first may take one line with an ellipsis and titles step down to about small's width-based size, so medium shows at least as many as small and a wider box never fewer (#359) | The same measured list; titles scale with width but stay capped near 3.2% of the display height. In any free size, when every pending reminder fits, cut-off titles may use up to four lines and whole titles grow toward the cap (#254) |
| Photo | Center crop in a compact area | Wider landscape crop | Complete image fitted in the larger area |
| Last screen | Complete faint desktop, picture-only with responsive rounded and softly feathered edges; no caption and no visible timestamp (#563) | Wider complete desktop | Larger complete desktop; retains its aspect without zoom/cropping |
| World clocks | First city's label, time in regular-weight numerals, relation ("Tomorrow · +13 h"), day/night icon and a dim "+N" | Two cities side by side | Up to four rows, label and relation left, time right; hidden on the display with no cities |
| Calendar | Month name over this week's strip (weekday initials and dates) | Weekday, large date and month beside a compact month grid, and the next upcoming date on one line under them where the box has room | Month and year, a weekday header row and a generous month grid, then up to three upcoming dates ("Dec 25  Christmas"); every grid has only the 4–6 weeks the month needs, and a day with a holiday or an important date carries a small dot ([upcoming dates](#calendar-upcoming-dates-716)) |
| Countdown | The next date as a large count (“12” over “days”, or Today/Tomorrow), its title and a short date | The next date on the left; the following two as compact rows | As many rows as fit the box (title, date, days right-aligned), measured like Reminders, then an exact “+N more” (#221) |
| Note | The text at the largest size that fits the box (measured from its lines and wrapping, #194), up to a family cap | The same, wider | The same, generous; only a note that cannot fit at the text floor zooms out through the shared fit |
| Air quality | AQI and category word with place and scale; one short footer row: "Model est." for a fresh reading, with no age and no provider name, or the status and age of one that is not fresh in the status tone ("Saved reading · 2 hr ago", "Offline · Model est. · 12 min ago") (#715); values over 3 hours old read "Saved estimate" or "Last known · 9 AM" on their own line under the reading (#309) | Adds the main pollutant and UV with its WHO category (both hidden once the values are over 3 hours old, UV then from the saved estimate); one footer row | Adds AQI bars for the current and up to 23 following hours (unknown hours a dotted baseline) over "Now" and the last hour's end, as Weather's chart (#261), and today's UV peak, both from upcoming hours only; "Hourly estimate unavailable" when fewer than two remain |
| Sun & moon | Next sunrise or sunset, its time and the place | Sunrise, sunset, daylight length and change from yesterday, moon glyph and phase | Dim dotted day arc with the sun's position, times, daylight, phase with illumination and the next full (or new) moon |
| Dynamic (#437) | One card: the kicker (source word, or an official level word with the alert icon, "· +2 more" or "· 1 of 2"), the glyph or a value beside a short headline (up to three lines), a one-line detail and one footer phrase | A glyph or value column of about 30% beside the headline (two lines) and detail; one footer run: what kind of information the card is or the place it is for ("Forecast estimate", "Model est.", the city), then the status and age of its data only when that is not fresh, then other sources' statuses. No provider name and no credit (#715) | A hero row and the detail, then up to three whole rows (source word, short headline, time right-aligned) measured from layout boxes like the large Countdown, an exact "+N more", and the footer; one card alone is centred with no list |

The large clock requires actual vertical room in the central catalog; do not
recreate a giant option by scaling within the previous short large family.

### Calendar upcoming dates (#716)

Owner request, 2026-11-22: "calendar should say like upcoming holidays or important dates, or
something, just make it a bit more useful". The Calendar lists what is coming up from data the app
already has, so nothing new is entered or saved (no new persisted key):

| Source | What it gives | Rule |
| --- | --- | --- |
| Holiday calendars | The observances of the calendars ticked for themes (`appearance.theme.calendars`, shared with Dynamic; absent means all three, an empty list none), from [`holidays.ts`](../src/shared/holidays.ts) | Each observance on its own date under its short name. One occasion in several calendars shows once under the first calendar's name (Christmas; New Year's Day rather than Russia's "New Year holidays"; Labour Day for Korea's and Russia's May 1; Easter when both Easters share a Sunday). Different occasions on one day each get a line. |
| Birthdays | `settings.birthdays` | "Mina's birthday" on the exact day every year, like the birthday scene: a February 29 birthday appears in leap years only. A name that already says "birthday" is kept as written. |
| Countdown dates | `widgetData.countdowns` | `nextOccurrence`, as Countdown counts: a yearly date rolls to its next anniversary (February 29 falls on February 28 in a common year), a passed one-time date is gone. They show whether or not the Countdown widget is on the board. |

Reminders are not listed: Reminders, Agenda and Week ahead show those (#98 stays the ticket for
reminder dots on the grid). `calendarDates` in [`calendar-dates.ts`](../src/client/calendar-dates.ts)
is pure and unit-tested:

- **Upcoming** means today through the next 90 days (`UPCOMING_HORIZON_DAYS`), on this computer's
  civil date like the grid, soonest first; on one day your own dates come before holidays. Within 90
  days a month and day name one date, so no year is shown, also across the turn of the year.
- **Each occasion once.** Items of one day that share a name or an occasion, directly or through
  another item, are one line, and the first in order stands for the others. So a countdown called
  "Christmas" is the one Christmas line, and a countdown called "New Year's Day" also stands for
  Russia's "New Year holidays", which is the same occasion as the Canadian day of that name. Names
  match whatever their case, spacing or kind of apostrophe.
- **Nothing in range:** the widget looks as it did before, with no list, no marks and no room made
  for them. Captures of the small, large and medium families with nothing in range are identical to
  captures from before #716, with one intended exception: a six-week medium month on the Fine grid,
  which zoomed out before and now closes its rows up to fit (see Medium).
- **Lines** read "Dec 25  Christmas": the date in the accent tone, the name in the text colour, and
  "Today" for today's own dates. A line never wraps. A name has room for 32 letters
  (`UPCOMING_NAME_LENGTH`), where a wide character (Hangul, kana, CJK ideographs, full-width forms,
  emoji) counts as two because it is about twice as wide. A longer name is cut by `cleanCut` and ends
  in an ellipsis:
  - after the last whole word that fits, when that keeps at least half the line ("A deliberately long
    synthetic…", "할머니 생신 잔치 준비하고 선물…");
  - otherwise inside the word, so a line is never reduced to a stub: one long word, or "A
    Supercalifragilisticexpialido…" rather than "A…";
  - with no space, full stop, comma or dash left before the ellipsis, and never between a letter and
    its combining mark or inside a joined emoji (grapheme segmentation).

  A birthday reads "Mina's birthday" when that fits (names of up to 21 letters). When it does not,
  the line is the name alone, cut like any other name ("Grandmother Alexandra…"), so a possessive is
  never left without its word. Every bundled holiday short name fits and shows whole. The day's
  accessible name always carries the whole names.
- **Last resort in the browser:** the count cannot know the typeface, so a name that is still wider
  than its line (capital W or M throughout, for example) stays on one line and ends in the browser's
  own ellipsis where it runs out (`text-overflow: ellipsis`), which can fall inside a word. A Korean
  and a Russian title show exactly as the model cut them on every grid at 720p, 1080p and 4K, and 31
  capital W end in that ellipsis (the widget check).
- **Large** shows up to three lines under the month (`.calendar-upcoming`). The month gives up spare
  height, not type size: the heading and weekday rows sit closer and the week rows fill what is left.
  Four- and five-week months keep their numbers; only a six-week month takes slightly smaller ones
  (6.2cqh instead of 6.6cqh, 28 px instead of 30 px on the Balanced grid at 1080p).
- **Medium** shows the next date on one line under the date and the month (`.calendar-next`). At Text
  100% it is shown on the Spacious and Balanced grids in every month, and on Fine only in a four-week
  month, where the box is too short beside five or six weeks. The big date gives the line its room
  (48cqh instead of 54cqh). A six-week medium month shares the height that is left between its rows:
  with room to spare they are exactly as before, with less the gap under the weekday labels and then
  the rows' padding close up, down to the digits' own line. So it makes room for the next date on
  Balanced and renders at fit 1 at the data floor on Fine instead of zooming out (before, to 0.88 at
  720p).
- **The dates give way before the month does.** The lines of both families are measured from layout
  boxes like the Countdown list (`fittingLines` in `Calendar.tsx`): a line that does not fit takes no
  layout, and with no line left the family has exactly the layout it has with nothing upcoming. So the
  dates never make the shared fit zoom the month out, at any Text size, and the Calendar's fit is
  never below what it was before #716. At Text 100% all three lines fit everywhere. Above it fewer
  fit: on the Balanced grid at 1080p a five-week large month shows two lines at Text 105%, one at 110%
  and 115% and none from 125%; a four-week month still shows one at 125%; medium shows its next date up
  to Text 105% and none from 110%. The dots stay at every Text size.
- **Small** is unchanged: the week strip has no list and no marks.
- **Marks:** a day of the shown month that carries one of these dates, past days included, gets one
  small dot in the accent tone (`.calendar-mark`, a real element so the palette harness audits it),
  centred on the bottom of the day's pill, which is today's ring. It takes no room, adds no fill or
  frame, and dims with its day (0.45 past, 0.7 ahead, 1 today). The cell's accessible name carries
  the names ("25, Christmas").
- **Once per day:** the rows, their strings and the marks are built once per civil day and set of
  sources. A state refresh that hands over new arrays with the same content keeps them
  (`sourcesSignature`), so a one-second tick formats nothing (#193) and the list changes only at
  local midnight or when a source changes. No timer or animation of its own.
- **Settings:** the Calendar panel carries the same **Holiday calendars** boxes as Style and Dynamic
  (one shared selection, part of the style) and says where the dates come from. With Theme Off and
  Dynamic's Holidays off it is the only place that shows them; a selection other than all three is the
  #575 rollback exception ([install](install.md#additive-data-and-rollback-compatibility-84)).
  Birthday names and countdown titles are private content: tests and fixtures use synthetic entries
  only.

Every family renders at fit 1 at Text 100% on every grid density at 720p, 1080p and 4K in four-, five-
and six-week months (the widgets suite's Calendar sweep, which also checks Text 110%, 125% and 150%).

### Clock timer slot

Timers started from Home (#438) show on the display in the Clock's date line, so they
need no new widget id or layout change and work on a full board (the frozen previous
release rejects a new widget id). `clockTimer` in [`src/client/timer.ts`](../src/client/timer.ts)
takes the first of `orderTimers(visibleTimers(timers, now, true))` from
[`src/shared/timers.ts`](../src/shared/timers.ts) (done newest first, then running by end,
then paused by what is left); with none visible the date returns. It renders in the same
`.clock-calendar` elements and fonts as the date, so the fit does not change:
`.ambient-label.clock-timer-label` holds the name in the accent colour (a label, or "5 min
timer"), on one line ending in an ellipsis and at most 60% of a large clock's width, with a
dim "+N" for more visible timers; `.clock-date.clock-timer-value` holds the time in the text
colour, and Done uses the shared status tone (`--ambient-caution`). Both carry
`data-timer-phase`. Every analog family uses the same slot.

| Phase | Small | Medium | Large |
| --- | --- | --- | --- |
| Running, over a minute left | "8 min" or "1 h 5 min" (whole minutes rounded up) | the same | "8 min left · ends 6:51 PM" (24-hour "ends 18:51", another day "ends tomorrow 1:10 AM") |
| Running, the last minute | "45 s" | "45 s" | "45 s left" |
| Paused | a pause mark and "8 min" | the same | a pause mark and "8 min left · paused" |
| Done, for 10 minutes | "Done" | "Done · 2 min ago" | "Done · 2 min ago" |
| Display offline | keeps counting from the saved end | the same | adds " · offline" |

The name and the minute-rounded value change at most once a minute through
`TransitionText`; only the last minute counts every second, as plain tabular text, which
bounds the per-second refit (#99) to that minute. "ends" uses the cached `dateTimeFormat`,
so a running timer builds no `Intl` formatter on the tick. No sound and no flashing. At
1280 × 720 on the Balanced grid the large Clock measures 785 × 331 px with date-line text of
about 27.5 px (measured, #438), so "Pasta 8 min left · ends 6:51 PM" fits on one line; when a
long name and value do not both fit, the name gives way first (an ellipsis) and the time stays
whole on the same line. Edit display's canvas and Home's
preview show the slot live, and the Clock panel says "While a timer runs, the date line
shows it. Start timers from Home." The widgets suite's Clock sweep checks every phase,
offline included, in every family, style and density at 720p, 1080p and 4K with a
40-character name and "+5": fit 1 at Text 100%, nothing clipped, the readability floor
kept, Done in the status tone, and no `Intl` formatter per tick.
On a medium clock the slot sits after the room of the widest time
([digit spacing](#clock-digit-spacing)), so the name's room is the same at every minute
and a little smaller than before #717, when the digits overlapped: 231 px at 1080p
Balanced in 24-hour time (240 before), 215 px in 12-hour; 153 and 141 px on Fine (167);
102 and 94 px on Fine at 720p (112). A long name ends in its ellipsis that much sooner.
All families use the same renderer in ambient view, authored editor canvas and
synthetic picker preview. Picker fixtures never become user data.
The editor canvas renders inside `.studio`, so renderer class names must not reuse
a studio class name (such as `preview-frame` or `hint`; prefer `ambient-…` names):
`tests/ui/canvas-scope-browser.mjs` fails when a canvas element matches a
`.studio`-scoped rule (#313).

The selected grid controls snapping and capacity. Dragging and resize handles
snap to allowed cells and supported families through the shared helpers. Moving
or enlarging a widget gently reflows neighbors into valid space; the active
widget stays under the pointer. Reject an impossible placement with a clear
local response instead of covering another widget or discarding one. Density
changes fit every enabled module, reducing families only as necessary and
restoring the exact prior layout when switched back before another widget edit.
A visible grid, handles,
selection borders, labels and picker chrome belong to the editor only.

A free-size widget declares the optional catalog `freeSize` rule instead of its own
geometry (#73; currently Reminders). Besides its families it accepts any whole-cell
`span` from `min` (2 × 2) up to the full grid height and `maxColumnsFraction` (two
thirds) of the width, so even a full-height column leaves at least a third of the
board for relocation. `size` stays the largest family inside the span, which keeps
family-based renderers working and guarantees that deleting the span leaves a
collision-free board. Every helper reads cells through `placementSpan`, so the
editor, validation, density fitting and ambient composition share one collision
rule. A density change scales the span before its origin: full height stays full
height and an axis at its minimum stays at the minimum, so a Column (2 × full
height) stays a Column in every grid (#152); other extents scale with the grid and
clamp to the new limits. When the board still cannot fit, the span falls back to a
family and the editor names what it dropped (“Reminders 2 × 8 → small to fit”).
A free-size widget's module may add a one-line `sizeHint` under the custom size
controls; Reminders reads “Shows as many reminders as fit · soonest first”, which
its measured list delivers in any span.

Every widget is optional. The picker describes available widgets and sizes;
adding/removing/resizing/repositioning changes the settings draft. Provide direct
family controls usable by keyboard/touch as an alternative to handle resizing.
The focused canvas widget supports arrow-key movement and its selected/focused
resize handle supports arrow-key family changes; do not expose technical
coordinates/four-arrow Position controls in the primary inspector.
Cancel restores the saved configuration, including grid, styles and selected
images. Show Save/Cancel only while there are actual unsaved changes, preserving
the existing async race and concurrent-draft behavior. Reminder records retain
their documented independent immediate-save behavior.
The authored editor canvas stays still. Ambient movement (float, steps and swaps)
runs only in the display or an explicitly requested movement preview, so layout
editing never competes with the ambient scheduler.

Legacy backfill uses revision-one catalog origins before strict validation and
central migration. An absent additive module is different from an explicitly
invalid overlapping placement; the latter still rejects. Current saves use
geometry revision 2. Follow the [pre-upgrade data backup and rollback](install.md#widget-geometry-revision-2-update-and-rollback)
procedure; the previous app does not understand revision 2 even though the outer
settings version remains 1.

### Catalog decisions (#78)

Reviewed 2026-10-18 for [#78](https://github.com/8roundshock/living-room-display/issues/78).
The catalog has twelve active widgets now that Weather has absorbed Rain (#74), grouped
in the picker by `WIDGET_CATEGORIES`: **Time** (Clock, World clocks, Calendar),
**Weather & sky** (Weather, Forecast, Air quality, Sun & moon), **Personal**
(Reminders, Countdown, Note) and **Pictures** (Photo, Last screen). Every new widget
is optional, off in the catalog and appended after `photo`, so existing packing and
composition stay identical. Since #435 the default board for new installs shows
Calendar (large); older data still reads it as off.

- **Kept as is:** Clock, Forecast, Last screen and Photo. Weather and Rain belong to
  #74 and Reminders to #73.
- **Changed:** the picker is a grouped list with keyboard navigation; Forecast uses
  its own `forecast` glyph because Calendar now owns the calendar glyph.
- **Added here (PR #157):** Calendar (local date, week start Automatic/Sunday/Monday; no data
  dependency), Countdown (up to 12 dated events, optionally yearly; whole civil days
  with UTC-noon arithmetic so DST cannot shift a count; February 29 falls on
  February 28 in common years) and Note (up to 200 characters and 4 lines). An empty
  Countdown or Note is hidden on the display and shows a placeholder in the editor.
  World clocks, Sun & moon and Air quality shipped in the parallel unit of the same
  ticket (PR #171).
  The three use fixed families and sit beside a free-size Reminders span; with Swap
  places on, fuller boards keep relocating through the #93 reflection fallback
  described below.
- **Timers (#438):** silent, started from Home and shown in the Clock's date line
  ([timer slot](#clock-timer-slot)); a Timer widget or a spot the user chooses is #461.
  Alarms with sound stay rejected.
- **Rejected, with reasons:** alarms (they need audio); news, stocks and sports (noise, feeds and keys); commute (keys and
  personal addresses); account calendars, fitness and cloud smart home (accounts and
  privacy); quotes (licensing and novelty clutter); PC battery and stats (not useful
  ambiently); pollen (Open-Meteo coverage is Europe only); ticking seconds (OLED
  wear and constant motion).
- **Deferred, with tickets:** events from a local
  calendar file or subscription (#94), rotating local photos (#95), Now Playing
  (#96), several instances of one widget (#97) and reminder dots on the calendar
  (#98). The per-second re-fit cost (#99) is fixed: the shared fit no longer reruns
  on every render (see [Families and editing](#families-and-editing)).

### Dynamic (#437)

Decided 2026-10-20 on [#437](https://github.com/8roundshock/living-room-display/issues/437)
(the full spec and the three proposals it was chosen from are on the ticket). Dynamic is
optional, off by default and appended after Sun & moon in Weather & sky: "What matters now,
or a calm rotation", standard families, the sparkles icon and the sky tone. It shows one
card at a time from data the app already has (the forecast, CAMS air and UV, the sun and
moon calculated locally, reminders and countdowns) plus official alerts from Environment
and Climate Change Canada and the US National Weather Service, which adopts #106 for
Canada and the US through Dynamic ([API](api.md#official-weather-alerts)). It stays on
what matters most (an official warning, a storm or rain starting soon, a reminder due
within the hour) and otherwise rotates one calm card per wall-clock minute, skipping cards
another widget on the board already shows. The ranking, thresholds and honest states are
in [Dynamic signals](api.md#dynamic-signals).

- Its five sources (Weather, Official weather alerts, Air & UV, Sun & moon, Reminders &
  countdowns) are `widgetData.dynamic`, all on by default and omitted at rest then; at
  least one stays on. An enabled Dynamic is a documented d66832b rollback exception
  ([install](install.md#additive-data-and-rollback-compatibility-84)) until #130.
- Rotation uses wall-clock slots (`rotationSlot`, `DYNAMIC_ROTATE_MS` = 60 s) with no timer
  of its own: the display's one-second tick re-renders, and the editor canvas and picker
  samples hold slot 0. It touches neither `Display.tsx` nor `WidgetContentProps`, so it
  survives #436 removing black rests.
- Urgency is carried by words, rank and size, never by added light ([design](design.md#dynamic-emphasis)).
- News is still deferred, to #450, so the #78 rejection of news stands until then. Also
  deferred: MeteoAlarm for Europe (#451), hourly severe timing and gusts (#452), Canada's
  AQHI (#453), a "Change every" setting (#454), an alerts preview before Save (#455), the
  official line inside Weather (#456), the NWS key risk (#457), public holidays (#458) and
  "Hide when quiet" (#459). Home (#438) reuses the exported engine.

### Hourly forecast (#714)

Owner request, 2026-11-22: the hourly widget should "feel like the daily weather one, but
with more good information about the hourly", be "long like the forecast one (so i will
have them one over the other)" and not look cluttered; and "i want to see when
sunrise/sunset are as well, basically how the weather app on iphone does it". The widget
formerly named Hourly temperature keeps its stored id, `hourlyTemperature`, and is now
**Hourly forecast**, "The hours ahead", in Forecast's medium (4 × 2) and large (8 × 2)
families. Its tone is sky, like Forecast, so the two strips read as a pair.

- **Columns.** Medium has 6 and large 12, always (`hourlyForecastSlots`). The first reads
  "Now" and shows the current reading (temperature, condition and its own day flag), so it
  agrees with Weather; the rest are the hourly model instants after now, labelled with the
  hour in the weather city's zone: "5PM" on the 12-hour clock, with the day period as a
  smaller suffix and no space before it, as a phone's hourly row writes it (`labelParts`;
  like the Clock's period it never goes below the display's text floor, so it is never
  larger than the hour it follows), or the bare "17" on the 24-hour clock, so only a sun
  column shows minutes. Each hour has a `WeatherGlyph`
  that is day- or night-aware from the sun at the weather location (`sunIsUp`), the
  temperature, and the precipitation chance of the hour that starts there (the saved
  interval whose `intervalStart` is that instant), with the droplet, only from 10%. A dry
  stretch shows nothing in that row, which still keeps its line so nothing moves when a
  chance appears.
- **Sunrise and sunset.** An event after now and up to the last hour is a column of its own,
  in time order between the hours it falls between: its exact time as the label ("16:47";
  on the 12-hour clock with no day period, "4:47", because the word under it and the hour
  labels on either side, "4PM" and "5PM", already say which half of the day it is), the `sunrise` or `sunset` icon in the sun's sub-tone (`data-glyph="sun"`),
  and the word where a temperature would be. It has no temperature and no chance. The
  events are the instants at which `sunIsUp` changes (`sunEvents`), the same test the hours'
  day and night glyphs ask, so the two cannot disagree: the hours before a sunset draw day
  glyphs and the hours after it night glyphs, also on the nights at either end of the polar
  day, where the per-day sunrise and sunset of `sunDay` and the sun's altitude part ways.
  Elsewhere the two agree to well under a second, so the time is the one Sun & moon shows.
  An event exactly on an hour precedes that hour's column, whose glyph already shows the
  new sky. Now keeps the current reading's own day flag, as Weather shows it. A sun column
  takes one of the family's columns, so the last hour gives way and the strip never
  reflows when an event enters or leaves; that is why the heading reads "Hourly" and
  promises no hour count. Owner decision,
  2026-11-22: he picked this "entry between hours" layout from a mockup. The other option,
  always 12 hours plus up to two sun columns, would change every column's width whenever
  an event enters or leaves, or leave two columns empty most of the day. No sun column is
  drawn on a polar day or night or without a real place.
- **Trend.** The temperatures ride a thin accent line: each value sits just above its
  point at its column's centre, placed by the model's own value (not the rounded label)
  within a band that stands for at least 5 °C (9 °F), so a steady evening is a nearly flat
  line. The line is a monotone curve that never rises above or dips below the values it
  joins. An unknown temperature is a dash at mid height and ends the line there; the next
  known value starts a new one, so nothing is drawn across an unknown value. A sun column
  is not a missing value: the line runs straight through it between its neighbours. The
  row's height depends only on the box and Text size, never on the values: the line's
  travel is whatever height the other rows leave, up to 18% of the box. At Text 100% that
  is at least 7% (since the strips share Forecast's larger sizes, #720, about 12% on the
  Balanced grid and 7% on the Fine grid, where the text floors leave the least room). A
  larger Text size takes the travel first and then the air between the values and the
  line, down to a flat line, before the strip zooms out, so at Text 110% both strips stay
  at fit 1 on every grid at 720p, 1080p and 4K with every shared size equal in the System
  and Classic typefaces. Monospace is the exception: with a sun column in the strip,
  Hourly forecast zooms out to 0.893 to 0.988 at Text 110% while Forecast stays at 1. Above
  Text 110%, twelve columns can be too narrow for the larger text in any typeface ("Sunset"
  at Text 150% is about 100 px in an 84 px column at 1080p on the Balanced grid), and the
  strip zooms out further than the Forecast above it: up to about 8% on Balanced at 150%
  (#749). Because the widest column sets the strip's width, a sun column entering or
  leaving the window (about ten hours before a sunrise, and at the sunrise) can change the
  whole widget's zoom where a column is that tight: at Text 100% only Monospace on the Fine
  grid (about 2.6%); above Text 100% up to 6% at 125% and 14% at 150% (720p, large,
  Balanced, System).
- **Heading.** "Hourly" on the left. On the right at most two calm facts that the board
  does not already show: the next sunrise or sunset within a day, only when the strip does
  not show it ("Sunrise 07:21" on a winter evening), and peak gusts over the shown hours
  from 40 km/h or 25 mph ("Gusts 55 km/h"). No place, provider or update time for fresh
  data (#715).
- **States.** While the forecast is not fresh, the heading's right side shows Forecast's
  own status line instead of the facts (`ForecastStatusLine` in
  [`common.tsx`](../src/client/widgets/common.tsx), from the shared `weatherStatus`), with
  the same words, classes and status tone at full opacity: "Saved forecast · 5 hr ago",
  "Offline · Updated 12 min ago", "Saved forecast · Update time unknown". So the two strips
  stacked one above the other always say the same thing, and a refresh that is merely slow
  is not a saved forecast on either (`presentedStatus`, #715). The slot is always there (a
  no-break space when it has nothing to say) and stays one line up to the longest wording
  ("Offline · Updated 364 days ago"), so the heading has Forecast's height in every state
  and the strip never moves when a fact or a status comes or goes. A saved current reading
  older than three hours is never called Now (`lastKnownTime`, the rule Weather uses): the
  strip then starts at the next hour. An hour the saved forecast lacks keeps its column
  with dashes; the hours end where the forecast ends; with no upcoming hour the widget
  shows Forecast's unavailable treatment (`ForecastUnavailable`) with "Hourly forecast
  unavailable · retrying" ("· offline"), and the age of a saved forecast whose hours have
  all passed ("Updated 2 days ago") under it in the status tone.
- **Migration.** The 4 × 4 large family is gone. A `large` placement saved before #714
  that the 8 × 2 span puts outside the grid, or over another shown widget, becomes
  `medium` at the same origin, which lies inside the cells it had; one that fits stays
  large and reads as 8 × 2. A hidden placement only has to stay inside the grid. The rule
  (`fitReshapedFamilies`) runs before the grid check for current settings, saved styles
  and imports (`src/server/hourly-forecast-migration.test.ts`). Reading rewrites nothing.
  The frozen `d66832b` reader does not know this id, so nothing changes for it. The
  release installed now (`712ce80`) draws Large as 4 × 4 and rejects a Large placement
  saved by this build where that does not fit, so a rollback needs the step in the #714
  row of the [compatibility table](install.md#additive-data-and-rollback-compatibility-84).
- **Rendering.** The markup reuses Forecast's heading, strip, column, label, glyph,
  temperature and droplet classes, and the sizes are Forecast's own: one definition of the
  medium and large strips for both widgets, the `--strip-*` custom properties in
  [`widgets.css`](../src/client/widgets.css) (#720), for the heading and its gap, the hour
  or day label, the glyph, the temperature, the chance and its droplet, and the gaps between
  the rows. Changing one changes both; only the column widths differ (6 or 12 hours against
  5 or 7 days, with a narrower column gap here).
  [`hourly-forecast.css`](../src/client/widgets/hourly-forecast.css) adds only what an hour
  strip needs: the subgrid rows and the trend's travel worked out from those sizes. No size
  is ever computed below its floor: every label, sun word, temperature and chance takes its
  shared size, which holds the shared floors and grows with Text size (final recheck 2 of
  PR #730 removed earlier per-column caps that did not). Twelve hours are narrower than
  seven days, so a column holds less: the column gap is narrower, and on the 12-hour clock
  a sun column's time has no day period. Nothing a column draws may leave it, so the strip
  is as wide as the widget or as its columns' content, whichever is wider (`width:
  max-content; min-width: 100%`): sized to its content, the grid makes its equal columns
  each as wide as the widest column's content, and where that is wider than the widget
  the shared fit lays the widget out wider and zooms it out a little, as it does for any
  widget, rather than one text shrinking alone. At Text 100% that happens only for
  Monospace's "Sunrise" on the Fine grid: large at fit 0.973 to 0.976 and medium at 0.989
  to 0.990, at 720p, 1080p and 4K. Everywhere else, the owner's 24-hour System board on
  Balanced included, the strip is at fit 1. The widgets suite puts a Forecast of the same
  family above it in every state, family and density at 720p, 1080p and 4K and compares
  the two: the same sizes, heading height and rhythm from label to glyph to value, and the
  same status words, at Text 100% and 110%. On the 12-hour clock it renders every density
  at 720p, 1080p and 4K in every typeface with a sunrise as the last column and with two
  sun columns side by side ("12:29", "12:51" at the edge of the polar day), and at Text
  100%, 110%, 125% and 150% with those and "100%" in every hour: no label, value or
  chance leaves its column, no two labels touch, none is under its floor, no day period is
  larger than its hour, and none is smaller on screen at a larger Text size than at 100%.
  Both families render at fit 1 at Text 100% in every density at 720p, 1080p and 4K:
  fresh, saved, offline, while a refresh runs and with sun columns, on both clocks and in
  every typeface, but for Monospace's "Sunrise" on the Fine grid. The view is rebuilt once a minute (#99) and values change through
  `TransitionText`; the widget has no timer or animation loop of its own. At Lively the
  columns slide in one after another like Forecast's, and the trend line fades in with the
  last of them, never ahead of its values (opacity only, to its resting 0.8).
- **Follow-ups:** hourly feels-like (#718) and a small 2 × 2 family (#719).

## Ambient appearance and recurring exposure

Unused pixels remain true black. Reuse ambient brightness and type tokens; keep
fills small and dim. Avoid persistent card backgrounds, borders, dials, divider
lines, corner marks, logos and repeated decorative labels. All visible content,
including stale-state labels, belongs inside its movable group. A widget carries no
provider credit (#715).
The editor may be brighter and show controls; those styles must not leak into the
ambient view or its error/loading states.

Colour follows one rule in both accent modes (#75). Primary content always uses
the text colour: time digits, temperatures, condition text, reminder titles and
forecast highs. Accent content uses `--ambient-accent`: labels, place and units,
secondary metrics, weather glyphs, chart bars, dots and captions (“Forecast estimate”,
“Model est.”). An update age is never accent content: it appears only inside a status
line, in the status tone (#715).
In `color` mode that is the single accent; in `native` mode `src/client/palette.css`
redirects it to the section's catalog `tone`, so both modes colour exactly the same
elements and Native never lights more of the panel. Inside a widget, an icon marked
`data-glyph` (weather glyphs, World clocks' day/night icons, Sun & moon's sun dot,
label icon and moon) paints with its own sub-tone (`WEATHER_GLYPH_TONE`), a subtree
marked `tone-<role>` takes that role (Sun & moon's moon is `tone-time`), and
Weather's rain visuals use the `--weather-rain` hook (Sea glass). A two-tone weather
symbol paints each part with its own sub-tone: partly cloudy's sun is Gold and its moon
Lilac while its cloud is Stone (#251). A widget whose
face is only primary text (a Note, a "Today" countdown) has nothing to tint. Dynamic's card
carries its own role (`tone-water` for rain and storms, `sun` for heat, UV and sun moments,
`time` for the moon, `personal` for reminders and countdowns, `sky` for alerts, snow, cold,
wind and air), which reaches only its glyph and detail: its kicker, rows and footer keep
the catalog tone (sky), so the palette harness needs no exception. Status
cues never change: a stale or offline line uses the shared `.status-caution` class
(`widgets.css`), which paints the one amber status tone, `--ambient-caution`, at full
opacity, so a dimmed parent never fades the cue (#322; Weather's “Last known”,
Forecast's “Saved forecast”/“Offline”, Air quality's qualifier, “Saved reminders ·
offline”), and so does every line that carries an update age (#715). The Overdue word keeps its own rule in the same tone. There is no separate
offline colour (#223, #133).
Never hard-code a hue in widget CSS (Air
quality has no category colours), fill or frame anything new for colour, or tint
images; a new widget declares an existing palette role and uses `--ambient-accent`.
The [palette harness](../tests/ui/palette-browser.mjs) fails for a widget with no
accent element unless it is listed as text-only, and for any painted colour other
than the element's accent, the text colour or a status tone.
See [native palette](design.md#native-palette).

Large clock numerals should offer a tasteful outline treatment with sparse lit
area and sufficient stroke weight at real viewing distance. Other clock styles
remain subject to the same dimness and movement contract. Do not add a fixed
analog bezel, tick ring or always-lit colon merely because the hands or digits
change. Outlines still reuse pixels and must move with their group.

Readable strokes at couch distance (#222) are tied to the display height through the
shared text floor (`--min-text`, 1.4% of the height), so they scale from the owner's
1280×720 CSS TV to 1080p and 4K alike. The outline never thins below 1.2 px at 720p
(otherwise `0.35cqw`). Analog hands are two rounded bars in the text colour: the hour
hand reaches 30% of the drawn square and the minute hand 45%, with strokes of 2.4% and
1.6% of the square but never under 3 px and 2 px at 720p. The only other mark is a dim
accent pivot dot over the junction; it covers pixels the hands always light, so it adds
no new static area. A 12 o'clock mark was considered and rejected because it would be a
new always-lit point. Small and medium size the square to the cell height (90%) with the
date beside it; the square gives way when the date needs the width. Each hand is an
HTML bar on a full-square wrapper that turns with `rotate` around the centre, so the
minute ease runs on the compositor (#161), and the square clips so a turned wrapper
never adds overflow to the widget fit. At rest the geometry is the same at every
Animation level. The owner's couch check remains the acceptance gate for #222.

### Clock digit spacing

The clock's digits are spaced by what they paint, not by their advance boxes (#717). A
typeface spaces figures by their boxes, and tabular figures all share the widest box: a 1
sits in a hole and a 4 fills its box edge to edge. The clock used to pull every box
together with a fixed negative `letter-spacing` (-0.065em), and the Outline stroke
extends past the glyph, so 44, 04 and 54 overlapped (48 too at 4K) and 00, 34, 40 and 48
touched while 11 stood a fifth of the digit height apart: on the large 1080p clock the
painted gaps ran from -12 px to 65 px. They now run from 19 to 21 px.

**Even gaps.**

- [`src/client/clock-spacing.ts`](../src/client/clock-spacing.ts) measures, once per
  typeface, how far each glyph's ink starts and ends inside its advance box (canvas
  `measureText`, averaged over six sizes under 256 px, where the canvas reports whole
  pixels; above that it is far coarser). `Clock.tsx` gives each character those bearings
  as `--ink-left` and `--ink-right`, and `widgets.css` turns them into margins that
  leave one gap, `--clock-gap`, between the painted edges of every pair of neighbours:
  digits and colon alike, outline stroke included.
- The gap is 6% of the digit size and never under 42% of the shared text floor (4.2 px at
  720p), so the smallest clock keeps whole pixels between digits (2 to 3 px painted there).
- Never put a negative `letter-spacing` on the clock's digits or on any other tabular
  numeral. World clocks, Countdown and Sun & moon keep their typeface's own spacing for
  the same reason. `src/client/legacy-css.test.ts` fails for a rule that tracks a tabular
  numeral tighter (the numerals that still are appear there by name and in
  [#726](https://github.com/8roundshock/living-room-display/issues/726)), and the clock
  check fails when the page computes a negative `letter-spacing` for any of those four
  widgets' numerals, so a value that arrives through `var()` or `calc()` fails too.

**What moves when a minute changes.** A time is as wide as its digits (11:11 is much
narrower than 04:44), and re-placing everything by that width every minute is too
restless for an ambient display (owner-side decision on #717, 2026-11-22: at 1,295 of
1,440 minute changes the unchanged characters of a centred clock stepped sideways, 44 px
at most at 1080p). The rule: **within an hour, only the digits that change move.**

- The clock holds the room of the widest time of its format (04:44 in 24-hour and 10:44
  in 12-hour with Segoe UI). `clockPlacement` says where a time sits in that room, and
  two empty boxes (`.clock-room-start`, `.clock-room-end`) hold the rest of it. The
  shared fit and the float both measure those boxes, so the fit is 1 at every minute at
  Text 100%, a clock that zooms out at a larger Text size keeps its scale, and the
  float's range does not follow the minute.
- **Large (centred)** is placed once an hour. It is centred by the middle of that hour's
  narrowest and widest minute, so the hour, the colon and the left edge of the minutes
  stay where they are for the whole hour and the minutes grow and shrink to the right.
  The painted time is then off centre by 17 px at the median minute and 38 px at most
  at 1080p (a quarter of the minutes' range; the old tabular clock's ink sat -12 to
  +21 px off). An unchanged character moves at 22 of the day's 1,440 changes, all at
  the hour: 14 px at the median and 32 px at most in 24-hour; in 12-hour 16 px and 78 px,
  the largest when the hour gains or loses a digit.
- Held to a device pixel, not exactly: the hour is placed from a box summed from
  per-character margins, each rounded to 1/64 px, so its position wanders by up to
  0.03 px from minute to minute and the rasteriser sometimes snaps it to the next pixel.
  The held hour and colon flip by one device pixel within the hour about 16 to 40 times
  a day, and the minutes' left edge up to 52 times on a 720p-at-300% display (measured
  in the independent recheck of #736); invisible at couch distance (#727).
- **Small and medium (left-aligned)** keep every digit where it is until a digit to its
  left changes, which is the hour (18 to 22 changes a day).
- **AM/PM** stands after the widest minute's room, so it does not move within the hour
  either; before a narrow minute it is that much further from the last digit. On the
  large 1080p clock the painted gap runs from 27 px (12:44) to 186 px (1:11), 72 px at
  the median, against 19 to 21 px between digits: up to 0.83 of the painted digit
  height. The digits of a 12-hour large clock stand as they would with the period right
  beside the middle minute.
- **The date line beside a medium clock** (and the timer slot there) sits after the
  widest time's room and never moves. The cost: beside a narrow time it is further from
  the digits (painted, at 1080p: 32 to 148 px on Balanced, 24 to 113 px on Fine, 48 to
  210 px on Spacious), and the #332 rule (the date nearer its time than the cell's right
  edge, by text boxes) breaks for some minutes: on Fine at 16 minutes a day in 24-hour
  time (11:10 to 11:19 and the like) and 120 in 12-hour (1:00 to 1:59), on Balanced at
  1 (11:11) and 0, on Spacious never; at most 17 px over at 1080p (34 px at 4K), at most
  6 px in 12-hour. The #332 check reads 9:00; the date still stands beside the room of
  its own time (#727).
- When a digit changes, the other characters are already in place and the new one fades
  in. Nothing glides sideways: a character easing from its old place would cross the
  incoming digit. What still steps, at the hour, is in
  [#727](https://github.com/8roundshock/living-room-display/issues/727).
- "One scale" is to within the fit's own one-pixel measurement: the held room is the
  same to a hundredth of a pixel, and the fit rounds it to whole pixels, so a few
  minutes a day can read up to 0.2% apart at a larger Text size (under one pixel on
  screen). In 12-hour, AM and PM differ in width by a pixel or two (under 1%).

**Typefaces.** Canvas text cannot set `font-variant-numeric`, so a glyph is trusted only
when the page lays it out with the advance the canvas measured. The Classic clock
therefore draws its digits from `LRD Classic Figures`, an alias of Georgia with lining
figures turned on in the font face (`styles.css`); its digits are Georgia's lining
figures at their own widths, no longer tabular. A typeface that cannot be measured has
no `clock-ink` class (`clock-unmeasured` on the time) and takes the fallback: tabular
figures, tracked apart by the stroke and at least 30% of the text floor on top of the
glyphs' own bearings, drawn at 78% of the size so their wider boxes stay inside the
measured clock's room, with a one-digit hour holding the room of two. Nothing touches
(2 px and more on the smallest 720p clock) and the fit is 1 at every time in every
family, density, viewport and format, but the gaps are the typeface's own and uneven. A
failed measurement is tried again when the hour the clock shows changes, in local time
(`shownHour`; a UTC hour changes at :30 or :45 local in zones such as Asia/Kolkata and
Asia/Kathmandu, which would move the colon mid-hour), and on a later mount, at most once
a minute.

**Check.**
[`tests/ui/widget-checks/clock-spacing.mjs`](../tests/ui/widget-checks/clock-spacing.mjs)
(in the `widgets` suite) measures the painted pixels: each character paints one colour
channel, so one RAM screenshot tells neighbours apart. It fails on any overlap, on a gap
under the rule's (at least one unlit device pixel, and more on larger clocks: 70% of the
stylesheet's gap less 2 px), on gaps that differ by more than a few pixels, on a
negative computed `letter-spacing`, and on a character whose box moves while a digit
changes. It reads every minute of a day from layout boxes, for the large, medium and
small clock in 24- and 12-hour time, and fails when an unchanged character moves within
an hour, when more than 24 changes a day move one, when the time is further off centre
than the rule allows, and when AM/PM, the medium date line, the fit or the box the float
measures moves with the minute. With the display floating it fails when the float's
offset steps at a minute change. It also makes a typeface unmeasurable at 720p and 1080p,
12-hour included, checks the fallback, and checks in Asia/Kolkata that a failed
measurement waits for the shown hour. It sets the time of day and runs days of minutes,
so it runs on a page with a clock of its own (`withOwnClock`).

Not verified: Segoe UI Variable (Windows 11's `system-ui`) is not installed on the
development PC. It is measured the same way; a clock under 48 px there uses a smaller
optical size than the one measured, so its gaps may differ by a pixel
([#728](https://github.com/8roundshock/living-room-display/issues/728)).

The display never goes dark to move (#436, owner decision 2026-10-20; it replaces the
black rest of #357 and #395). By default the arrangement stays as placed and floats:
the centralized timer in `Display.tsx` moves the whole plane along low-discrepancy
waypoints (`src/shared/float.ts`, up to ±3.5% of the display, a new spot every
interval) one device pixel at a time, and floats each widget's content inside its
own slack by translating the section (`--float-x`/`--float-y`, the individual
`translate` property). A widget must therefore tolerate a translated section: lay
content out inside the content box, never depend on the section's screen position,
and let the shared fit measure the slack (what the content leaves free; horizontal
slack is to the right because content is left-anchored, vertical slack is centred).
When content grows, that measurement immediately clamps its existing translation
inside the new slack (#479); ordinary floating still advances one device pixel at a time.
The widget's cell is its section box without that translation. Without animation
(Float gently off or reduced motion) the same timer steps once per interval. Use the
centralized scheduler/wrapper, not a new per-widget motion loop, and avoid flashes or
synchronized bright accents. **Swap places** (opt-in, `appearance.rearrange`) also moves
the complete layout through substantially different valid locations each interval,
with module rectangles disjoint in every composition: moved widgets glide there
(opacity never below 0.4, never the whole board at once) or, without animation, dim
to 0.4 briefly while they move. The plane itself always stays at opacity 1. There is
no fully black state, so renderers get no `black` or `resting` flag: the analog
clock's hand angles accumulate for the whole session and never re-base (#174), so a
hand only ever turns forward.

With Swap places on, each composition moves every widget off at least half of its
previous cells where it can (#338): `composeWidgetGrid` treats a widget that covers more than half of its own
previous cells again (or more than the least any legal origin of its span allows) as
staying, and prefers compositions where none stays. The display also passes the
composition from two cycles back, and a composition that recreates it is used only
when nothing else qualifies (#317). The bounded search first places widget by widget,
distant cells first; boards with few or no spare cells, where that rarely completes,
are then packed cell by cell, which never leaves an unfillable hole.

Dense boards keep relocating when they swap (#93). When the search finds no such composition, the
previous composition is reflected horizontally, vertically or both (`displayPlacement`,
span-aware). The #182 choice comes first: reflections that tie for the most widgets
moved rotate with the cycle, and a unique best one (usually both at once, when a widget
is centred on one axis) alternates on odd cycles with the best of the others.
Reflections commute, so a board's reflected arrangements are A, hA, vA and hvA (one,
two or four of them distinct), and a run of reflections on a board with four visits
all four. A reflection cannot move a widget centred on its axis, and the board's
float (at most 3.5% of the display each way) cannot move a widget by a large share of
its size, so a widget that a reflection would leave in place trades places
with a same-size clean region elsewhere (its own cells, or the row or column band it
sits in, whose widgets all lie inside it), and widgets of the same span may exchange
cells. These moves keep the reflection's cells or swap whole clean regions, so every
result stays in bounds and collision-free. Measured on 36 generated dense boards
(`src/server/relocation.test.ts`): over 200 cycles, moves that left a widget on more
than half of its cells fell from 1,553 to 72 of 73,600, and compositions that repeat
the one from two cycles earlier from 85 to none of 7,164; on the suites' full 12-widget
board no widget keeps more than half of its cells between compositions (a 4 × 4 widget,
Sun & moon or Weather, used to stay put on 38 of 200). Only a board that every reflection maps onto itself
falls through to the search that allows widgets to stay. A full-height span can only travel
sideways; any span relocates as one whole group in one swap. Its
content therefore also alternates vertically: a full-height Reminders column
(`data-full-height`) anchors its list to the top on even compositions (the authored
layout included) and to the bottom on odd ones (`composition-1`/`composition-3`).
Only fitted rows take layout and measurement always runs top-anchored, so the
bottom-anchored group never clips the label or a row and “+N more” stays exact.
A tall span with little vertical travel alternates the same way (#175): when the grid's rows minus its
rows are fewer than a third of the grid's (5 or more rows in Spacious, 6 in Balanced, 7 in Fine), the
renderer marks its body `data-alternate-anchor` for the same `composition-N` rule.

Reduced motion removes travel, zoom and decorative animation while preserving
periodic movement: the board and widget content jump to the next spot each interval,
and swaps dim and move without a glide. It must not freeze the ambient display at one
permanent position. Missing or hidden widgets must not leave a fixed frame.

Motion inside widgets follows the Animation level (#76; Off, Subtle or Lively, see
[motion levels](design.md#motion-levels)), which `motionPlan()` in
[`src/shared/motion.ts`](../src/shared/motion.ts) turns into what may move on each
surface; a screen that prefers reduced motion is always Off, and picker samples and
Edit layout stay still. Renderers add no animation code of their own: use
`TransitionText` for a changing value (the new value fades in; numbers are never
tweened), `WeatherGlyph` with `hero` for a widget's main condition and `still` for
stale, offline or unavailable data, and stable React keys (by id or source) so a new
item or image is a new element. A new photo or snapshot holds its shell at opacity 0
until the image has loaded and decoded (or a 4 s fallback), so its fade never runs on an
empty box (#173). The shared CSS (`motion*.css`) then animates only
transform and opacity, never above resting opacity, with offsets from above or the
left that stay inside the widget rectangle and never change the fit scale. Content
first shown with its widget never animates; later insertions may transition in.
Reveal choreography uses `widgetRevealOrder()` and `--reveal-order`; only the hero
glyph loops, at Lively, and loops pause on black.

The merged renderers follow this through the same pieces (#162). Weather's rain
timing, detail, hint and hour labels, Forecast's values, Air quality's AQI and
category, Calendar's date, Countdown's count, Note's text, and the times in Sun &
moon and World clocks are `TransitionText` (Clock keeps its per-character digits). Chart bars inserted later (Weather's
`.rain-bar`, Air quality's `.air-bar`) fade in to their resting opacity, and existing
bars ease to new heights by `translate` alone: each bar is a full-height box moved
down from the baseline and clipped by its chart, so exactly `clamp(1px, share, 100%)`
of it shows at rest, as the former height-based bar did, and a change runs on the
compositor (#161). An unknown hour is a dotted baseline whose stroke scales with the
display's text floor (`max(1px, --min-text × 0.15)`: 2 px at 1080p and 4 px at 4K), so it
never reads as a 0% bar (#336). The stale or offline weather label takes the status tone
at once, with the words it gains (#161). A list that measures its own rows must keep that geometry
exact. Reminders marks only reminders that were not pending at the previous update
with `data-new`, and fades them by opacity alone. A re-sorted row, which React moves
with `insertBefore` and Chromium would otherwise restart from `@starting-style`
(#172), and a row that stops overflowing stay still. Lively reminder rows also fade
without moving. That is a design choice, no longer a constraint: the list (like the large
Countdown) measures layout boxes, which ignore transforms, so a row caught mid-transition
cannot change the count (#216). Its measuring pass hides the visible “+N more” with `visibility`
and `position: absolute`, never `display: none`, because a box that disappears and
returns replays its entrance and crossfade.

These are design requirements to reduce recurring exposure, not a measured
safety threshold. Finite screens and recurring content inevitably reuse pixels;
do not promise zero overlap over time or prevention of OLED burn-in. Browser
previews do not establish physical-TV brightness or long-term panel behavior.

## Data and image boundaries

Render content according to available space without changing its meaning. Keep
forecast estimates, stale/unknown states, place and units honest. For a
hide-when-empty option, distinguish confirmed empty from unavailable or failed.
Keep management available in the editor when the ambient widget is hidden.

**No source, no fresh age (#715).** Owner decision, 2026-11-22: on the display, the editor
canvas and the picker samples, a widget shows neither the name of a data provider nor,
while its data is fresh, when that data was updated or checked.

| State | What the widget says |
| --- | --- |
| Fresh | Nothing about source or age. Wording that is neither stays: the rain “Forecast estimate” confidence, Air quality's “Model est.”, category words, units and the place. A footer that held only the credit and age is not rendered, and its room goes to the content. |
| Saved (stale) | Its status label with the age, in the status tone: “Saved forecast · Updated 5 hr ago” (Weather medium and large; compact rows and Forecast's heading slot: “Saved forecast · 5 hr ago”), “Saved reading · 2 hr ago”, “Saved alerts · 2 hr ago”; Dynamic: “Saved alerts · checked 9 AM”. |
| Refresh in flight | Nothing: still fresh. The server calls a forecast `stale` the moment its 15-minute interval ends (air quality: 30) and answers after about a second with `refreshing: true` while the provider is slow (#351). That is not a saved forecast, so no status shows while the first refresh since the last good one is running and the data is at most 45 minutes old. Once a refresh has failed (`error` is set, and stays through the retries) it is saved, and a retry in flight does not blink it fresh. |
| Offline display | “Offline” first: “Offline · Updated 5 hr ago” (the age keeps its “Updated”, because a bare age could read as the outage's); Air quality “Offline · Model est. · 12 min ago”; Dynamic's alerts “Offline · checked 9 AM”. |
| Hours old | “Last known · Thu 2 AM” (Weather, the collection weather widgets) or “Saved estimate” (Air quality), as before. |
| Unavailable | The widget's own status line (“Weather unavailable · retrying”), with the age only when an update time is known; Weather alerts: “Updated 2 hr ago” under “Alerts unavailable”. |
| A claim that needs fresh data | Made only while it is confirmed. Dynamic's “No alerts” is said by a connected display with a fresh list, without a check time; an offline display (whose last status stays `fresh` for as long as the outage lasts) and a saved list never say it. What they do say about alerts carries its check time in the status tone (“Saved alerts · checked 9 AM”, an alert card's “Offline · checked 9 AM”). Weather alerts reads “Current alerts unknown” then. |

No state names a provider. `presentedStatus` in [`format.ts`](../src/client/format.ts) is
the one place that decides whether forecast or air data is presented as fresh (the
refresh-in-flight rule); Weather, Forecast, the collection footer, Air quality and
Dynamic's weather and air cards all read the status through it, so they change together.
`weatherStatus`, `weatherIsFresh` and `shortAge` build the weather wording on it,
`airAgeSegments` in [`airHourly.ts`](../src/client/airHourly.ts) Air quality's and Dynamic's
air cards', `alertsWidgetStatus` in [`collection.ts`](../src/client/collection.ts) Weather
alerts'; `DynamicCard.age` is null while fresh. A new weather widget must use
`presentedStatus` (or `weatherStatus`) rather than compare `weather.status` itself. The provider
credit lives in Settings (“Forecast estimates by Open-Meteo”, a link) and in the widget
settings hints (Air quality, Dynamic's Official weather alerts, Weather alerts), which may
name providers; a renderer may not (`src/client/model.test.ts` checks the sources).
Provider terms are part of the public-release decision (#114, which absorbed #168).

One widget's failure stays inside that widget (#318). The registry wraps every renderer
in its own error boundary ([`WidgetBoundary.tsx`](../src/client/widgets/WidgetBoundary.tsx)),
so the ambient display, the editor canvas and the picker samples are all covered. A
renderer that throws shows "<Widget> unavailable" in the status tone inside its own
footprint, keeps moving with the board (and swapping places when that is on), and is written to the console once per
widget and message; the rest of the board and the editor keep working. The boundary
tries the widget again with new state or settings, another family or the next minute,
so it recovers once the data that broke it changes. A `visible` rule that throws leaves
the widget visible (so it shows as unavailable), and a throwing picker `sample` falls
back to the shared sample. This containment is a safety net, not a substitute for
honest unavailable states in the renderer itself.

Saved weather keeps no age limit on the server, so the renderers judge its age (#243).
A forecast strip starts at the weather city's civil today and drops earlier saved days;
with none left it says “Forecast unavailable”, and Weather looks up today's high/low
by date, not list position. A saved current reading more than **3 hours** old while
the forecast is stale or the display is offline is no longer presented as current:
Weather shows “Last known · 9 AM” (with the weekday when not today, “Last known ·
Thu 9 AM”) in the status tone in place of the condition line (above the rain timing
where the family shows timing instead), and keeps the glyph still and the age line.
Three hours matches the hourly model: after that the saved temperature describes a
different part of the day. The age line exists only in these states (#715). Air quality applies the same threshold to its current values
(#188), whatever its status, because its saved hourly estimate can stand in for them.
Both widgets share one threshold, `LAST_KNOWN_AFTER_MS`, and one time label,
`lastKnownLabel` (weekday when not today, compact time with no-break spaces), in
[`format.ts`](../src/client/format.ts), and each keeps its own rule for when it applies
(#329). An unavailable forecast is never louder than the weather it replaces: a dim,
still cloud (the widget's icon, not a condition), a dim “—°” and one status-tone line at
the label size, with the age only when an update time is known (#362).

Timers (#438) are private, short-lived content kept in their own `timers.json` beside the
settings data, never in `state.json`, `state.backup.json` or exports, so the previous
release never meets them (see [API](api.md#timers)). Their labels are never logged or put in
diagnostics. The display counts from absolute instants, so a display that has lost the
computer keeps counting and says " · offline" in a large Clock.

A photo widget uses a user-selected local image, remains optional, and follows
the shared size/brightness/motion rules. Retain its image only in the documented
local user-data path and treat it as private user content; no external feed,
remote URL fetch, cloud upload, Git asset or diagnostics attachment is implied.
Validate supported image data and size limits at the ingestion boundary, handle
decode failure, and avoid preserving private source filenames or metadata unless
needed. The renderer cannot brighten the image beyond the ambient controls.
The editor checks declared dimensions before browser decode, downsamples and
re-encodes supported local rasters as PNG. The API validates the normalized PNG
again; see [limits and storage](api.md#local-photo). Replacing or clearing a photo
does not securely erase older bytes from the previous-state recovery backup.

This deliberate photo selection is separate from the last-desktop widget. A
desktop snapshot is captured only by the authorized native flow. Owner decision
2026-10-27 (#544) permits one canonical runtime PNG at
`InstallRoot/run/cache/last-screen.png`, atomically replaced on the eligible
five-minute cadence and shared by browser/native readers. Normal exit/input keeps
it; privacy/opt-out/configuration or safe-producer lease loss deletes it. It stays
outside Git, app/data and backups, is never exported or reused as a photo, and
has no history or `.bak`. Global agent/computer-use screenshots still stay in RAM.
Tests use synthetic images. Do not request GPS, screen capture or access
to personal photo folders merely to implement a widget.

## Verification for a widget change

- Check every supported family on every supported grid, smallest bounds and long
  content, a floating (translated) section and, with Swap places on, every swap.
  Inspect actual images for
  density, clipping, collisions and stale/error/empty states using synthetic data.
- Check that the widget names no data provider and shows no update age while fresh, and
  that a saved or offline state keeps its status label with the age in the status tone
  (#715). `assertNoSourceOrFreshAge` in
  [`tests/ui/lib/source-age.mjs`](../tests/ui/lib/source-age.mjs) does this for a rendered
  widget; the widgets, collection and catalog suites apply it to every family, state and
  picker sample.
- Exercise add/remove, drag/drop, resize, keyboard alternatives, invalid placement,
  grid changes, Save/Cancel, clean/dirty save-bar visibility, persistence,
  presets and legacy import/migration. Retain edits made while Save is pending.
- Check reduced motion still moves the board in steps, whole-group bounds remain valid, and
  pointer hiding stays limited to explicit native presentation. Browser display
  and browser fullscreen retain their pointer; unmodified F toggles fullscreen
  outside editable controls. Keep captures in
  RAM and test data outside the user's installed state.

Run the relevant commands in [development](development.md). Independent final
PR review must inspect rendering as well as code; record the exact reviewed SHA
and real checks. Physical-display acceptance and unobserved long-duration behavior
remain explicit limits, not implied passes. Update [UI contracts](ui.md),
[status](../STATUS.md) and the linked ticket with the actual resulting behavior.

## Apple inspiration and project adaptations

Live Markdown was read from Apple on 2026-10-18; the normal pages below are the
stable human-facing links. This is an original web implementation without Apple
assets, fonts, frameworks, platform integration or certification.

| Primary source | Applied principle and boundary |
| --- | --- |
| [HIG Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) | Focused glanceable content, family-specific detail and restrained color. StandBy enlarges widgets for distant use; this app has its own grid and does not copy iOS point sizes. |
| [WidgetFamily](https://developer.apple.com/documentation/widgetkit/widgetfamily) | Declare supported size/shape families and adapt content flexibly. WidgetKit APIs are inspiration, not app dependencies. |
| [HIG Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Dim secondary content and reduce visual noise. Apple's preference for stable layouts differs from this app's continuous float (and optional swaps) on a TV. |
| [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System type, clear size/weight hierarchy and viewing-distance checks. Small supporting text uses regular/medium weight; enlarged outlined time remains a deliberate sparse treatment. |
| [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Purposeful, brief editor feedback; the board floats slowly and never fades out to move (#436), and a swap glides with a brief dim. Reduced motion removes effects while the board still moves in steps. No audio or haptic feedback is introduced. |
| [Designing your app for the Always On state](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state) | The watchOS example replaces large numeral fills with outlines/dim interiors. It supports the clock treatment, not a claim that this TV inherits Apple luminance or panel controls. |

## Optional collection (#565)

Fifteen modules extend the thirteen existing active types. All are off by default;
the default board and older saved layouts are unchanged. They use the existing
catalog, per-module Settings/sample hooks, grid/fit, palette and movement. No
module starts an animation timer, adds an account or creates private content.

| Widget | Families | Purpose and source |
| --- | --- | --- |
| Timers | Small, medium, large | One, two or four silent timers from the existing private timer sidecar; running, paused, done and offline remain distinct. Manage on Home. |
| Agenda | Medium, large | Next two or four pending dated reminders; overdue stays explicit. Manage on Home. |
| Week ahead | Medium, large | Seven civil-day counts; large adds the first reminder per day. Empty days stay visible. |
| Day progress | Small, medium | Elapsed fraction and time until this computer's next midnight; medium adds discrete hour marks. DST days can be 23 or 25 hours. |
| Year progress | Small, medium | Day of year and days after today; medium adds month progression. Leap years use 366 days. |
| Time overlap | Medium, large | Earliest common weekday 09:00–17:00 reference window in the next 48 hours across this computer and saved World clocks cities; large lists the same instants in each city. Never claims actual availability. |
| Weather alerts | Medium, large | Existing official Canadian/US notices. Unsupported, unavailable, stale and confirmed quiet states stay distinct. |
| Hourly forecast (#714; formerly Hourly temperature, the id stays `hourlyTemperature`) | Medium, large (8 × 2) | Six or twelve columns in Forecast's strip: conditions, the temperature on a trend line, the precipitation chance, and sunrise or sunset in place ([Hourly forecast](#hourly-forecast-714)). |
| Wind | Small, medium | Model 10 m wind speed, origin direction and preceding-hour maximum gust; medium adds hourly speeds. |
| Humidity | Small, medium | Outdoor relative humidity and dew point; medium adds hourly percentages. It is not an indoor sensor. |
| Pressure | Small, medium | Model surface pressure in hPa; medium adds a numeric outlook, without inferred warnings. |
| Visibility | Small, medium | Model viewing distance in km/miles; medium adds an outlook. It does not assess travel safety. |
| Cloud cover | Small, medium | Total model cloud area fraction; medium adds hourly coverage. The still cloud glyph identifies the measurement. |
| Precipitation | Medium, large | Three or six hourly interval amounts and all-precipitation chances. Snow is water equivalent. Unknown never becomes zero. |
| Quiet scene | Medium, large | Original sparse landscape illustration, changing by this computer's time of day; no astronomical or local-weather claim. |

Weather details reuse the existing forecast request and cache. The server retains
at most 25 hourly detail instants separately from the existing preceding-hour
precipitation intervals. A missing field remains null. Forecast widgets filter
expired rows; current detail widgets never choose a future instant, identify
readings older than three hours as last known, and keep their stale/offline status
with the age only then. Fresh data shows the place as the widget's last line and
nothing about its source or age; Weather alerts has no footer while fresh (#715).
Official field/time/unit semantics were verified against
[Open-Meteo's forecast documentation](https://open-meteo.com/en/docs) on 2026-11-03.

Only the catalog's additive visibility/placement keys persist. Off defaults and
hidden placements are omitted by the existing compatibility layer, including
saved styles and exports; enabling an unknown widget remains an explicit
frozen-reader rollback exception. Existing local content remains in its original
stores. API-only weather details and timers never enter settings exports.

Browser coverage uses two non-overlapping synthetic Balanced boards because all
28 active types cannot share the old full board. Per-family sweeps still cover
every active ID and every supported family; production grid geometry is unchanged.
