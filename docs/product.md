# Product brief

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
| Home | The main page (`/`, #438) for day-to-day use beside the display rather than setting it up: the date and time, six quick actions (Timer, Reminder, Calendar, World clock, Countdown, Note) that feed the display, a Today list (timers, reminders due today, anytime and coming up) and the saved arrangement with **Edit display** one click away. Loopback only; phone or LAN access is a separate decision (#465). |
| Edit display | The editor at `/editor` (#438): layout, widgets, looks, weather and reminders, every flow as before. |
| Timers | Silent countdown timers started from Home (presets or a custom time, an optional name): pause, add a minute, cancel with Undo, restart and dismiss. While one runs, the display Clock's date line shows it ("Pasta 8 min"); a finished one reads Done in the status colour for 10 minutes. No sound, no flashing (#438). |
| Time and date | Optional clock with outline numerals by default, solid digital or minimal analog hands, and 12/24-hour format. |
| Weather | Conditions with a clear place label, units, and update age; when rain is near it adds the chance and estimated timing of upcoming rain inside the same widget, with uncertainty visible (#74). |
| Forecast | Readable seven-day outlook. |
| Reminders | Add, edit, delete and one-tap check off one-time/undated reminders in the local editor (and add and check off from Home, whose calendar turns a picked day into a dated reminder, #438), with Undo and a local history (restore, delete, clear; the latest 500 kept on this computer). The display shows as many pending reminders as fit, soonest first, with an honest “+N more”. The widget can be any whole-cell size from 2 × 2 up to the full grid height and two-thirds of the width; a taller box lists more (#73, #203). |
| Appearance | User-editable layout, colors, typography, motion, brightness (one fixed level, or following daylight between a chosen dimmest and brightest level and peaking at local solar noon, #439), and saved presets. The accent is one colour or Native, where each widget uses its own tone from one harmonious dim palette (default for new installs and built-in styles). |
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

A last-state snapshot is selected for version one. Manual display captures before
its own overlay; automatic activation uses one private pre-idle frame, attempted
30 seconds before the configured threshold and eligible for at most 90 seconds
(#525). It supplies a recent earlier state or unavailable, never a replacement
capture after automatic startup. A live preview of an explicitly selected app remains future work.
Label the snapshot as last state with capture time so it cannot be mistaken for
a live view.

Keep snapshot pixels in RAM only; do not accumulate screenshot files. A live
source needs explicit selection and testing to avoid capturing the dashboard
itself or creating recursive previews. Do not promise whole-desktop live capture
works. The backend implements the RAM-only handoff; actual capture is verified
separately with the Windows host.

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
  toggle/hide behavior, no recursive capture, and no screenshot files left behind.
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
