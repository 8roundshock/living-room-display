# Architecture

**Selected: B, a custom local web dashboard with a Windows idle/screensaver helper.**
On 2026-10-18 the owner authorized implementation and delegated practical choices
to the coordinating agent. The stack is Node 24 LTS, TypeScript, React, Vite, a
small native Node HTTP server, and Zod validation. No database/cloud account is
required. The original alternatives remain below for context.

| Option | Strengths | Tradeoffs |
| --- | --- | --- |
| A. Browser-only local dashboard | Full visual control; simplest path to a manually opened fullscreen display and local editor. | Automatic Windows screensaver behavior is separate; persistence and local hosting still need a design. |
| B. Local web dashboard plus a thin Windows idle/screensaver host | Same custom display, with an optional route to automatic activation and dismissal. | Adds Windows-specific lifecycle, fullscreen, and media/game compatibility work. |
| C. Home Assistant dashboard | Existing dashboard editor, widgets, local to-do integration, and a path to wider smart-home use. | Additional platform to operate; the sparse, moving ambient composition still needs custom work. |

The manual display/editor and current-PC native snapshot are verified; automatic
activation and native cursor compatibility remain separate acceptance gates.
Keep the display useful without TV control. Home Assistant is not a
dependency. Node 24 is an active LTS line; existing system runtimes are not replaced.
[Node release status](https://nodejs.org/en/about/previous-releases).

## Findings that constrain the choices

- Edge supports fullscreen kiosk mode on Windows 10 and uses InPrivate sessions
  for kiosk experiences. A kiosk browser's storage must not be the only durable
  store for reminders/settings. The selected app-owned local JSON store uses
  atomic saves, a previous-state backup, and export/import.
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
- Open-Meteo supplies current, daily, and hourly forecast data. Version one uses
  hourly rain/precipitation intervals; it does not claim minute rain nowcasting.
  The local noncommercial endpoint needs no account. Keep attribution visible,
  refresh conservatively, and revisit provider terms before commercial use.
  [Forecast API](https://open-meteo.com/en/docs).
- Samsung TV control is optional. General integrations do not prove support for
  this particular S90F setup, wake behavior, or keys. Verify the device only when
  that integration is requested.
  [Home Assistant Samsung TV integration](https://www.home-assistant.io/integrations/samsungtv/).

## Preview decision

| Mode | Intended benefit | Open work |
| --- | --- | --- |
| Last-state snapshot, selected for version one | Shows the screen immediately before ambient activation. | Actual current-PC 4K source/content/readability, label and RAM clear are accepted; other-account, real-lock and room-comfort checks remain. |
| Live selected-app thumbnail, future work | Shows changing state from an explicitly chosen application. | Capture support, minimized/occluded app behavior, permissions, performance, and avoiding dashboard recursion. |

The native Windows host captures before activating the display and transfers a
small PNG to the backend's RAM-only endpoint. A normal web page has no silent
desktop capture permission. Keep the thumbnail dim, adjustable, movable, and
toggleable. Do not save screenshots. Actual native capture and rendered preview
were inspected in RAM on the current 3840x2160 Windows 10 setup on 2026-10-18;
normal exit cleared the image to 404 without capture files. Reviewed Studio/grid,
preview, reminder and city-wrapping changes were installed in the last verified
baseline on 2026-10-18, clean source `2e010f0`; the latest CLI-only update performed
no native probe/display launch. See [rollout evidence](https://github.com/8roundshock/living-room-display/pull/54#issuecomment-6249798540).
Recheck current provenance through installed CLI
`Status` or `installation.json`; see [installation](install.md). This does
not establish live capture, locked/protected desktop access, another account or
across-room comfort. The cursor replacement in
[draft PR51](https://github.com/8roundshock/living-room-display/pull/51) remains
candidate-only and uninstalled despite code review/CI success. See [API](api.md)
and [Windows evidence](windows.md#actual-current-pc-runtime-evidence).

## Current decisions

| Decision | Current state |
| --- | --- |
| Architecture | B: custom local dashboard plus Windows helper. |
| Initial feature slice | Time, weather/rain, reminders, visual editor/presets, last-state preview. |
| Language/framework and host | Node 24/TypeScript, React/Vite, native Node HTTP server, Windows helper. |
| Weather/defaults | Open-Meteo; editable Toronto city default, metric, 12-hour clock. This is a product default, not inferred user location. |
| Data | Per-user JSON with serialized atomic writes, prior backup, and export/import; no kiosk-storage dependency. |
| Visual controls | Reviewed Studio/grid, optional modules, outline/digital/analog clocks and presets were installed in the last verified 2026-10-18 baseline; actual 4K preview is accepted, while across-room comfort and compatibility gates remain. |
| Preview | Last-desktop snapshot in RAM only; live app preview deferred. |
| Local photo | Explicit selected raster is normalized in-browser, validated and atomically saved with settings in private local state; exports/imports exclude its bytes. Prior recovery backup may retain an older image. |
| Activation | Manual use first; Windows idle activation remains off until verification and explicit enablement. |
| Editor access | Loopback only, no LAN/public hosting or account system. |

When a decision is made, replace its pending entry with the choice, source/date,
rationale, and remaining constraints. Use a separate decision note only when the
detail no longer fits here. Update [STATUS.md](../STATUS.md) and actual commands
in [development.md](development.md) at the same time.
