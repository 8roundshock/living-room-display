# Product brief

## Backlog decisions (2026-11-04)

The ambient display stays passive. Home already provides quick reminder capture,
completion and Undo, so the separate browser-display reminder overlay proposed
in #92 is declined rather than described as implemented. The optional Hourly
temperature widget from #568 satisfies the information need behind #107; a second
temperature strip inside Weather is not planned. The dated #447 rollout umbrella
is retired; unfinished acceptance in #7, #532, #156 and #446 remains open.

Whole-screen weather, seasonal/holiday and combined atmosphere is tracked in #575,
with accurate hourly forecast timing (#452) and optional holiday cards (#458).
See [theme design and compatibility](ambient-themes.md).
In Combined the season, holiday or birthday scene always stays and the real weather
(rain, snow, storm, fog or wind, now or forecast within three hours) is drawn over it,
lightly; a weather scene on its own is the Weather mode (#655, owner direction 2026-11-10).
The #579 refinement separates major visual celebrations from factual holiday
cards, uses larger sparse original contours, and makes the normal editor's
enabled atmosphere visible as a still sample. Try a scene is a labelled local
illustration; it never changes the saved display, information time or weather.
Owner direction, 2026-11-04 (#582): keep the cultural identity and controls, but
make every scene materially richer in colour, visible forms and characteristic
motion. Judge the default at 26% brightness as well as 36%; this is an aesthetic
target, not permission to change saved brightness. Dominant black, readable
widgets, quiet dates and reduced-motion behavior remain constraints.

Source: owner's project brief and preview request, reviewed 2026-10-18. These
requirements describe the intended product; [STATUS.md](../STATUS.md) records
what actually exists.

## Setting and experience

The display runs on a Windows 10 leisure PC connected to a living-room Samsung
S90F OLED TV. The TV stays powered on. An all-black screensaver currently serves
as the visual off state. The proposed replacement should feel like enlarged
phone widgets designed to be readable across the room.

Use a true black background, sparse content, attractive dim colors, generous
spacing, and large type. Avoid bright panels, persistent decorative chrome, and
busy dashboards. The application must produce no audio.

## Content and editing

| Area | Intended behavior |
| --- | --- |
| Home | The main page (`/`, #438/#517): date/time, six compact daily actions (Timer, Reminder, Calendar, World clock, Countdown, Note), Today and full reminder management. A compact display summary offers **Edit display** and **Open display** without a second ambient preview. Loopback only; phone or LAN access is separate (#465). |
| Edit display | The visual editor at `/editor` (#517): layout, widgets, appearance and a local movement preview. Create new style starts an independent Blank or starter draft; Save new style publishes it. Duplicate current separately copies the current look/layout. Save changes updates the selected saved style. Switching with unsaved visual changes or a new-style draft requires an explicit decision. |
| Settings | `/settings` owns weather city/device-area lookup, units/time format, screen-awake preference, scheduled styles and data recovery. Saves are field-scoped and revision-guarded; failed/conflicting requests retain drafts. Dirty navigation warns before leaving. |
| Timers | Silent countdown timers started from Home (presets or a custom time, an optional name): pause, add a minute, cancel with Undo, restart and dismiss. While one runs, the display Clock's date line shows it ("Pasta 8 min"); a finished one reads Done in the status colour for 10 minutes. No sound, no flashing (#438). |
| Time and date | Optional clock with outline numerals by default, solid digital or minimal analog hands, and 12/24-hour format. |
| Weather | Conditions with a clear place label, units, and update age; when rain is near it adds the chance and estimated timing of upcoming rain inside the same widget, with uncertainty visible (#74). |
| Forecast | Readable seven-day outlook. |
| Reminders | Home owns adding, editing, deleting and checking off one-time/undated reminders, with Undo and local history (restore, delete, clear; the latest 500 kept locally). Its calendar turns a chosen day into a dated reminder. The editor retains widget size and hide-empty appearance options. The display fits pending reminders soonest first with honest “+N more”. The widget supports whole-cell sizes from 2 × 2 to full grid height and two-thirds width (#73, #203, #517). |
| Appearance | User-editable layout, colors, typography, motion, brightness (one fixed level, or following daylight between a chosen dimmest and brightest level: brightest while it is light outside, an evening level until a chosen dim time, 11 PM by default, then dimmest until dawn, #439 and #591), and saved presets. The accent is one colour or Native, where each widget uses its own tone from one harmonious dim palette (default for new installs and built-in styles). |
| Scheduled styles | Optional local weekday/time ranges select saved visual styles, with explicit overlap priority, overnight rules and fallback. Home offers a temporary manual override. Missing styles are repairable and skipped; scheduling does not rewrite canonical settings (#514). |
| Movement preview | One slider over an hour (0:00 to 60:00, #686) in the editor. Each moment shows where the board, every widget's content and the 3D scene (#678) would be at that time with the draft's motion settings (interval, Float gently, Swap places and its fade, reduced motion); a settings change keeps the moment. It never changes the running display or saved configuration, and live data keeps updating (#515). |
| Screen preview | Small, dim, nearly transparent last-desktop snapshot captured before activation; visibility is toggleable. |
| Photo | Optional user-selected local image, dimmed and relocated with other widgets; excluded from exports. |
| World clocks | Time in up to four other cities. |
| Calendar | This month at a glance; on the default board (#435). |
| Countdown | Days until dates you choose. |
| Note | A short message on screen. |
| Air quality | Air quality and UV index. |
| Sun & moon | Daylight and moon phase. |
| Dynamic | What matters now (an official weather warning for Canada or the US, a storm or rain starting soon, a reminder due within the hour), or else one calm card each minute; its sources are chosen in the editor (#437). |

Distinguish forecast probability, expected precipitation amount, and estimated
rain windows. Label times and intervals correctly. Show stale or unavailable
weather instead of silently retaining an apparently fresh forecast. Version one
uses Open-Meteo and an editable Toronto city default selected by the coordinator;
the default is not a claim about the user's location. Probability covers all
precipitation; rain amount is separate so snow does not become a false rain warning.

Editing should not require changing source code. Keep Home and Edit display (the editor) separate from
the sparse display experience. Personal reminders and settings persist in a local
per-user store with a previous-state backup and export/import
([persistence and recovery](api.md#persistence-and-recovery)); private user content
does not belong in Git. A local editor does not imply public or LAN exposure.
Every information module is independently optional, including clock and weather.
New installs start on the owner's board (#435): a large Calendar and Clock across
the top, a large Weather and Forecast below, and a medium Last screen and Reminders,
filling the Balanced grid with every other widget off. **Reset layout** returns to
it; older saved boards are never changed by it.
Use a shared catalog and supported small/medium/large content families. The live
canvas offers direct drag, selected/focused resize handles, reversible fitted
grid density choices and keyboard alternatives. Reflow neighbors when possible;
reject impossible overlapping or out-of-bounds placements. Keep the authored
editor stable, with ambient movement available as an explicit preview. A picker previews
synthetic examples without exposing private data. Global Save/Cancel appears only
while effective settings or a photo differ from the saved baseline; reverting all
edits hides it again. Reminder actions remain independently saved.

## Screen preview

The owner wants to recognize what was happening on the PC without leaving the
ambient display. Provide a small, very dim translucent thumbnail with adjustable
size/opacity, a hide toggle, and placement that moves with the other widgets.
It should remain useful to read while fitting the sparse, mostly black display.

Owner decision, 2026-10-27 (#544): browser and native displays read one canonical
private file, `InstallRoot/run/cache/last-screen.png`. With idle display and Last
screen enabled, the owned producer captures the full primary desktop at its first
safe opportunity, then every five minutes, downscaling to at most 640 by 360.
Only the backend writes the file: successful refresh atomically replaces it,
with the capture time set as its modification time before replacement. Readers
obtain bytes, dimensions and capture time from the same open file handle.
Ordinary input, native handshake and normal display exit retain the latest file;
automatic startup only reads it, without another capture or private claim.
Failed capture/write retains the previous success and its original time.

Actual saver/ambient surfaces and the nominal idle-transition band pause capture.
A visible browser display establishes a capture pause before painting; hiding or
closing it releases that pause. Missing release fails closed; Home's explicit
resume action requires closing previews first. Unknown/locked/session/configuration/
disabled contexts or loss of the safe producer delete the cache. The known native
screensaver input desktop may retain the previous image only while the producer
independently verifies the unlocked session and exact own native process; it
never grants capture there. During the known unlocked transition before process
proof, the backend may keep that one file hidden for a fixed maximum of five
seconds. All image/state readers report it unavailable and uploads are fenced.
Only fresh proof for the same configuration, session, actual timeout and producer
episode reveals it; failure, expiry or changed context deletes it. Cold backend
startup removes a prior unvalidated file and orphan replacement temp, then the
next eligible observation captures immediately. Keep the file outside Git, app,
data and backups; never truncate it in place or create capture history or `.bak`
copies. Agent/computer-use screenshots remain RAM-only; this exception is solely
the app's one runtime cache. Selected photos and exports are unchanged.

Owner decision, 2026-11-03 (#563): show only the Last screen image, with responsive
rounded and subtly feathered edges and no visible timestamp. Keep the capture time
as image/version metadata and preserve honest missing/error placeholders.
Early sign-in lifecycle is #540; #544 replaces the earlier RAM-only handoff.
Live selected-app preview remains future work. Source/CI checks do not establish
installed capture or native acceptance. The successful ordinary-cycle result for
#519 is recorded in [STATUS](../STATUS.md); broader recovery checks remain separate.

## Movement and OLED considerations

Owner decision, 2026-10-20 (#436): "i want this to just always be on when the
computer is in screen saver mode" and "i want the actual widgets to move around
(like the text kinda float around, in order to avoid burn in), not for the widgets
to swap spaces". The screen never goes dark or fades out to move. By default the
user's arrangement stays as placed: the whole board floats slowly and continuously
(up to ±3.5% of the display on each axis, reaching a new spot every interval) and
each widget's content floats inside its own box, so edges keep moving across
nearby pixels. **Swap places** is opt-in: widgets then also trade cells every
interval, gliding to their new places with a brief dim, never through black.
**Float gently** off (called Drift and fade between moves from #240 until #436, and
Soft motion before that), or a reduced-motion preference, moves the board and the
content in one step each interval instead, without animation. Motion style and
cadence remain user-editable choices. No fixed decorative frame, footer or source
credit remains.

The 3D scene behind the widgets floats too (#675, owner direction 2026-11-12: "the
elements in the scenes need to move and shift as well, so they don't burn in over a long
time, same as the other elements"). It follows the same motion interval and Float gently
setting on its own track, independent of the board's and the widgets', up to ±2% of the
display on each axis, and it keeps floating on a quiet date. The scene is drawn 4.3% larger
than the screen so that whatever enters from a side or top edge still crosses it at the far
end of the travel; things that must stay whole keep clear of the band that crops. Pieces
resting on the bottom (a cake, fallen leaves) sit on the visible bottom edge at the centre
position and, like the board, rise or are cut by up to the vertical travel at the extremes;
small flat litter may be cut further at the low extreme (coordinator decision on #675,
2026-11-12). Tests check every scene against these rules and against what it drew before.

The editor's **Preview movement** (#686, owner direction 2026-11-12: "no need for the
intervals, can just be a preset slider with an hour and the person can scrub through, and
just matches to your settings to show what it would look like") is one slider over an hour.
At each moment the board, each widget's content and the 3D scene are where the display would
put them with the settings being edited; the scene's own life (sway, falling leaves) shows
that moment too (#678, owner report 2026-11-12: "does preview movement work for the scenes?
from my testing they stay still while all other elements move"). Changing a setting keeps the
moment. The preview never changes the display or the saved settings.

Floating in place smears edges across about 270 × 150 device pixels at 4K, but it
does not even out wear between screen regions the way swapping does: a bright
widget keeps lighting roughly the same area. Swap places spreads it further for
those who want it. Keep the screen on (#436) holds the screen awake only while the
display is full screen or running as the screensaver.

Keep transitions calm, avoid flashes, and provide a reduced-motion option in the
design. Dim colors, black backgrounds, and movement do not guarantee protection
against OLED burn-in. Do not claim a measured or guaranteed safety benefit.

## Activation and optional integrations

Manual fullscreen use and automatic idle activation are distinct capabilities.
The selected Windows helper ([architecture](architecture.md)) must be verified for
activation and dismissal around movies, games, fullscreen applications, and
ordinary input before idle activation is enabled. A lack of keyboard or mouse
activity alone does not mean the leisure PC is unused.

TV off/on, wake, input switching, and remote control are optional later work.
The dashboard must be useful without them. Do not change TV connections or
settings while exploring architecture, and do not repeatedly suggest turning
the TV off instead of meeting the ambient-display requirement.

## Integrated acceptance criteria

- Demonstrate readability and brightness on the actual viewing setup, with
  verified viewport/resolution rather than an assumed TV mode.
- Verify true black unused areas, movement across distinct areas, calm transitions,
  and no audio. Include the preview in movement/brightness checks if enabled.
- Exercise fresh, stale, failed, and missing weather states using explicit test
  data; distinguish simulations from live provider results.
- Demonstrate reminder add/edit/complete and persistence through restart, with an
  export or recovery path.
- For the chosen preview mode, verify source selection, freshness labeling,
  toggle/hide behavior, no recursive capture, and only the one owned runtime cache
  with no capture history or diagnostic screenshot files.
- Verify the chosen start/exit behavior without interrupting movies or games.

These are the integrated acceptance targets. [STATUS.md](../STATUS.md) records
which have been checked and which remain owner- or TV-gated. There are no external
calendar, cloud hosting, or smart-home platform requirements.

## Installation and sharing

A future usable release should be installable and operable by another user's
agent from repository instructions, with that user's own configuration and no
dependency on the owner's accounts, absolute paths, or private memory. See the
[installation contract](install.md). The repository is public (owner decision,
2026-10-20, [#441](https://github.com/8roundshock/living-room-display/issues/441));
publishing a release is a separate reviewed step. Stars and feedback are optional
and require the end user's permission before an agent acts on their behalf.

The optional #565 collection adds fifteen widgets (see the collection table in
[the widget contract](widgets.md)). All remain off on the existing default board.
They read existing local planning data or the same bounded weather service; no
new account, permission or external personal-data source is required. Quiet scene
is a sparse local illustration. Settings and the picker explain sources while the
ambient face stays passive. Timers work on a board without Clock when its dedicated
widget is enabled.

### Annual birthday content (#584)

Settings includes optional private month/day birthdays with Classic, Russian
accents or Korean accents. These global entries survive style changes and use
ordinary Save/Cancel. Seasonal/Combined show birthday atmosphere on the exact
annual civil day (February 29 only in leap years), except on a selected quiet date;
in Combined the weather is drawn over the birthday scene, never in place of it. No age, year, public built-in personal dates or new
widget is introduced. See the theme contract for researched accent sources,
same-day collision policy and rollback behavior.
