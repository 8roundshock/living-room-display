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
| Time and date | Optional clock with outline numerals by default, solid digital or minimal analog hands, and 12/24-hour format. |
| Weather | Conditions with a clear place label, units, and update age; when rain is near it adds the chance and estimated timing of upcoming rain inside the same widget, with uncertainty visible (#74). |
| Forecast | Readable seven-day outlook. |
| Reminders | Add, edit, delete and one-tap check off one-time/undated reminders in the local editor, with Undo and a local history (restore, delete, clear; the latest 500 kept on this computer). The display shows as many pending reminders as fit, soonest first, with an honest “+N more”. The widget can be any whole-cell size from 2 × 2 up to the full grid height and two-thirds of the width; a taller box lists more (#73, #203). |
| Appearance | User-editable layout, colors, typography, motion, and saved presets. The accent is one colour or Native, where each widget uses its own tone from one harmonious dim palette (default for new installs and built-in styles). |
| Screen preview | Small, dim, nearly transparent last-desktop snapshot captured before activation; visibility is toggleable. |
| Photo | Optional user-selected local image, dimmed and relocated with other widgets; excluded from exports. |
| World clocks | Time in up to four other cities. |
| Calendar | This month at a glance. |
| Countdown | Days until dates you choose. |
| Note | A short message on screen. |
| Air quality | Air quality and UV index. |
| Sun & moon | Daylight and moon phase. |

Distinguish forecast probability, expected precipitation amount, and estimated
rain windows. Label times and intervals correctly. Show stale or unavailable
weather instead of silently retaining an apparently fresh forecast. Version one
uses Open-Meteo and an editable Toronto city default selected by the coordinator;
the default is not a claim about the user's location. Probability covers all
precipitation; rain amount is separate so snow does not become a false rain warning.

Editing should not require changing source code. Keep the editor separate from
the sparse display experience. Personal reminders and settings persist in a local
per-user store with a previous-state backup and export/import
([persistence and recovery](api.md#persistence-and-recovery)); private user content
does not belong in Git. A local editor does not imply public or LAN exposure.
Every information module is independently optional, including clock and weather.
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

A last-state snapshot immediately before ambient activation is selected for
version one. A live preview of an explicitly selected app remains future work.
Label the snapshot as last state with capture time so it cannot be mistaken for
a live view.

Keep snapshot pixels in RAM only; do not accumulate screenshot files. A live
source needs explicit selection and testing to avoid capturing the dashboard
itself or creating recursive previews. Do not promise whole-desktop live capture
works. The backend implements the RAM-only handoff; actual capture is verified
separately with the Windows host.

## Movement and OLED considerations

Move whole widget groups through substantially different screen areas. Allow
periodic recomposition and gentle fades so content does not remain anchored to
one location. Motion inside an otherwise fixed widget is insufficient. Motion
style and cadence remain user-editable choices. Recompose collision-free layouts
with varied legal origins and offsets, fully black between compositions. Turning
off Drift and fade between moves (called Soft motion before #240), or a
reduced-motion preference, removes travel/effects while protective discrete
relocation continues. No fixed decorative frame, footer or source credit remains.

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
[installation contract](install.md). Keep the repository private until a usable
release; publication is a separate reviewed step. Stars and feedback are optional
and require the end user's permission before an agent acts on their behalf.
