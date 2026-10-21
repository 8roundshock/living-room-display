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
normal exit cleared the image to 404 without capture files. That native preview
evidence predates every later web rollout, from clean `7e654fd` (PR #57 studio
refinement) on 2026-10-18 to the installed revision that [STATUS.md](../STATUS.md)
records. Those rollouts, such as the `7e654fd` one
([evidence](https://github.com/8roundshock/living-room-display/pull/57#issuecomment-6253029701)),
verify served assets and unchanged private data without a new native launch.
Recheck current provenance through installed CLI
`Status` or `installation.json`; see [installation](install.md). This does
not establish live capture, locked/protected desktop access, another account or
across-room comfort. The cursor replacement from
[PR51](https://github.com/8roundshock/living-room-display/pull/51) still needs
native acceptance on an installed helper; code review and CI do not establish it.
See [API](api.md)
and [Windows evidence](windows.md#actual-current-pc-runtime-evidence).

## Current decisions

| Decision | Current state |
| --- | --- |
| Architecture | B: custom local dashboard plus Windows helper. |
| Initial feature slice | Time, adaptive weather with rain timing inside it (#74), reminders, visual editor/presets, last-state preview. |
| Language/framework and host | Node 24/TypeScript, React/Vite, native Node HTTP server, Windows helper. |
| Weather/defaults | Open-Meteo; editable Toronto city default, metric, 12-hour clock. This is a product default, not inferred user location. The local server requests the forecast only while a saved widget needs it (Weather or Forecast, or Sun & moon or Air quality while a device location's timezone is unresolved) or the editor asks for it (its Weather tab, or a draft showing such a widget) (#352). Requests wait for a due forecast or air-quality refresh at most about a second and the browser asks again shortly (#351). |
| Air quality data | Keyless Open-Meteo air-quality API (Copernicus CAMS model, US or European AQI), requested by the local server only while the widget is saved enabled or previewed (#78). Open-Meteo's free tier is for non-commercial use; revisit the provider and terms before any commercial use. Sun & moon is calculated locally and works offline. |
| Data | Per-user JSON with serialized atomic writes, prior backup, and export/import; no kiosk-storage dependency. |
| Visual controls | Reviewed Studio/grid, optional modules, outline/digital/analog clocks, Native colours, animation levels and presets are installed on the owner's PC (revision and evidence in [STATUS.md](../STATUS.md)); actual 4K preview is accepted, while across-room comfort and compatibility gates remain. |
| Preview | Last-desktop snapshot in RAM only; live app preview deferred. |
| Local photo | Explicit selected raster is normalized in-browser, validated and atomically saved with settings in private local state; exports/imports exclude its bytes. Prior recovery backup may retain an older image. |
| Activation | Manual use first; Windows idle activation remains off until verification and explicit enablement. |
| Installer | Per-user Inno Setup 6 wrapper (`LivingRoomDisplaySetup-<version>.exe`, no admin) around one checksummed payload of the prebuilt app and pinned Node 24 runtime; the control script's `InstallPackage` owns the transaction (verification, data snapshot, swap, health check, automatic rollback). Rejected: MSIX (virtualized AppData/registry conflict with per-user `.scr` registration), WiX/MSI, a custom bootstrapper and a portable ZIP. See [installation](install.md#install-with-setup-recommended). |
| Pages | `/` is Home for day-to-day use (timers, reminders, a calendar that makes dated reminders, world clocks, countdowns and the note), `/editor` is Edit display (the editor) and `/display` the ambient view, chosen by `pageForPath` (#438). Home and the display poll `GET /api/changes` every 5 s while visible; timers live in a `timers.json` sidecar the previous release never opens, and show in the display Clock's date line. |
| Editor access | Loopback only, no LAN/public hosting or account system; Home likewise (phone or LAN access is #465). |

When a decision is made, replace its pending entry with the choice, source/date,
rationale, and remaining constraints. Use a separate decision note only when the
detail no longer fits here. Update [STATUS.md](../STATUS.md) and actual commands
in [development.md](development.md) at the same time.
