# Architecture choices

**Decision: pending.** No stack, framework, weather provider, or host has been
selected. The options below are proposals researched on 2026-10-18.

| Option | Strengths | Tradeoffs |
| --- | --- | --- |
| A. Browser-only local dashboard | Full visual control; simplest path to a manually opened fullscreen display and local editor. | Automatic Windows screensaver behavior is separate; persistence and local hosting still need a design. |
| B. Local web dashboard plus a thin Windows idle/screensaver host | Same custom display, with an optional route to automatic activation and dismissal. | Adds Windows-specific lifecycle, fullscreen, and media/game compatibility work. |
| C. Home Assistant dashboard | Existing dashboard editor, widgets, local to-do integration, and a path to wider smart-home use. | Additional platform to operate; the sparse, moving ambient composition still needs custom work. |

The recommendation for discussion is B as a possible destination, beginning with
a manually launched custom display. A is sufficient if manual activation is
acceptable. C is more compelling if broader smart-home use is a priority.
**The recommendation is not the owner's choice or permission to implement it.**

## Findings that constrain the choices

- Edge supports fullscreen kiosk mode on Windows 10 and uses InPrivate sessions
  for kiosk experiences. A kiosk browser's storage must not be the only durable
  store for reminders/settings. An app-owned local store plus export is a candidate
  design, not a selected implementation.
  [Microsoft Edge kiosk documentation](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode).
- Windows provides a native screensaver interface and session-specific idle
  information. Those APIs do not establish that films or games may be interrupted;
  activation policy and compatibility require explicit testing.
  [Screen Saver Library](https://learn.microsoft.com/en-us/windows/win32/lwef/screen-saver-library),
  [GetLastInputInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo).
- Home Assistant provides visual dashboard editing and local to-do entities.
  Its documented Windows installation uses a virtual machine. The desired
  moving ambient layout is additional design and implementation work.
  [Dashboards](https://www.home-assistant.io/dashboards/),
  [Local to-do](https://www.home-assistant.io/integrations/local_todo/),
  [Windows installation](https://www.home-assistant.io/installation/windows/).
- Open-Meteo is one weather candidate with current, hourly, daily, and relevant
  subhourly forecast data. Coverage and model intervals need checking for the
  selected location. Model output is not guaranteed minute-by-minute rain
  nowcasting. Include attribution, licensing, and refresh limits in the eventual
  integration design. [Forecast API](https://open-meteo.com/en/docs).
- Samsung TV control is optional. General integrations do not prove support for
  this particular S90F setup, wake behavior, or keys. Verify the device only when
  that integration is requested.
  [Home Assistant Samsung TV integration](https://www.home-assistant.io/integrations/samsungtv/).

## Preview choices

| Mode | Intended benefit | Open work |
| --- | --- | --- |
| Last-state snapshot | Shows the screen immediately before ambient activation; recommended first option. | Capture timing/source, RAM-only lifetime, timestamp label, and Windows/browser permission path. |
| Live selected-app thumbnail | Shows changing state from an explicitly chosen application. | Capture support, minimized/occluded app behavior, permissions, performance, and avoiding dashboard recursion. |

Neither mode is selected. All architecture options require an explicit capture
design; a normal web page must not be assumed to have silent desktop capture
access. Keep the thumbnail dim, adjustable, movable, and optional. Do not save
screenshots. No whole-desktop live-capture guarantee or working capture exists.

## Decisions before dependent implementation

| Decision | Current state |
| --- | --- |
| Architecture A, B, or C | Awaiting owner selection. |
| Initial feature slice | Pending; agree whether reminders/preview belong in version one. |
| Language/framework and host | Pending architecture choice. |
| Weather location, units, time format, provider | Pending; do not infer location from timezone. |
| Reminder/settings persistence and export | Pending; keep private data outside tracked files. |
| Layout presets, motion cadence, dimness | Pending visual exploration and actual TV review. |
| Snapshot versus live preview | Pending; snapshot recommended, source/lifecycle unchosen. |
| Startup, idle policy, dismissal, recovery | Pending; a Windows helper is optional. |
| Editor access | Local use proposed; LAN or remote exposure requires explicit scope. |

When a decision is made, replace its pending entry with the choice, source/date,
rationale, and remaining constraints. Use a separate decision note only when the
detail no longer fits here. Update [STATUS.md](../STATUS.md) and actual commands
in [development.md](development.md) at the same time.
