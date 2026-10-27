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

The manual display/editor and an older native snapshot have dated verification;
current shared-file capture, automatic activation and native compatibility remain
separate acceptance gates in [STATUS.md](../STATUS.md).
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
| Last-state snapshot, selected for version one | Shows the latest safely captured desktop with its capture time. | Older RAM-only evidence is dated below; current shared-file source and installed/native acceptance remain separate (#544, #519). |
| Live selected-app thumbnail, future work | Shows changing state from an explicitly chosen application. | Capture support, minimized/occluded app behavior, permissions, performance, and avoiding dashboard recursion. |

Owner decision, 2026-10-27 (#544): one private canonical PNG at
`InstallRoot/run/cache/last-screen.png` replaces the RAM-only handoff. The owned
producer captures the full primary desktop at first safe eligibility and every
five minutes, downscaling to at most 640 by 360; only the backend atomically
replaces the file. Its capture-time modification stamp is set before rename;
each reader uses the same open handle for metadata, dimensions and bytes.
Browser/native state and image routes use this same file, with no automatic
capture or private claim during screensaver startup. Normal input/handshake/exit
and failed refresh retain the latest success. Privacy/disable/configuration or
safe-producer lease loss deletes it; cold startup removes a prior unknown file
and fixed orphan temp before the next eligible capture. There is no truncation,
history or `.bak`, and the cache is outside app/data/backups/Git.

A browser display pauses capture before painting to avoid recursion; an
unconfirmed close remains paused until explicit recovery after previews close.
Child-only publication and existing local HTTP security boundaries remain.
The general RAM-only rule for agent screenshots is unchanged. An owned per-user
sign-in entry supports an opted-in install (#540); source/test servers stay inert.
Keep the thumbnail dim, adjustable, movable and toggleable. Current source/CI
evidence is not installed/native acceptance; #519 remains unresolved.

Historical evidence for the previous RAM-only implementation: native capture and
rendered preview were inspected in RAM on a 3840x2160 Windows 10 setup on 2026-10-18;
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
| Weather/defaults | Open-Meteo; editable Toronto default, metric, 12-hour clock. This is a product default, not inferred user location. The server requests forecasts when the effective manual/scheduled widgets need them, Settings asks, or an editor visual draft previews such a widget (#352/#514/#517). Requests wait at most about a second for a due refresh, then the client asks again shortly (#351). Settings alone permits explicit browser location lookup. |
| Air quality data | Keyless Open-Meteo air-quality API (Copernicus CAMS model, US or European AQI), requested by the local server only while a saved widget shows it (Air quality, or Dynamic with Air & UV, #437) or the editor previews it (#78). Open-Meteo's free tier is for non-commercial use; revisit the provider and terms before any commercial use. Sun & moon is calculated locally and works offline. |
| Official weather alerts | Decided 2026-10-20 on #437, adopting #106 for Canada and the US through the Dynamic widget: Environment and Climate Change Canada (MSC GeoMet, matched to the place's public forecast zones; "Data Source: Environment and Climate Change Canada", names kept verbatim apart from the first capital) and the US National Weather Service (by point, with a User-Agent). Requested by the local server only while Dynamic and its alerts are saved on, with the location rounded to 0.01° sent only to the provider whose region contains it; API-only, never stored. Elsewhere it reads as not covered, never "no alerts". Remaining: the official line inside the Weather widget (#456), MeteoAlarm for Europe (#451) and the NWS possibly requiring a key (#457). See [API](api.md#official-weather-alerts). |
| Data | Per-user JSON with serialized atomic writes, prior backup, and export/import; no kiosk-storage dependency. |
| Application destinations | Home owns daily content/reminders; Edit display owns visual canvas/styles/widgets; Settings owns weather, app preferences, schedule and recovery. Normal navigation guards dirty drafts. Open/Show display is a distinct action (#517). |
| Scheduled visuals | A local schedule sidecar selects saved visual settings without mutating canonical data. Ordered civil-time ranges support overnight spans, fallback and temporary manual overrides. Separate schedule backup references saved-style IDs; complete directory recovery retains both data and sidecars (#514). |
| Motion preview | Shared deterministic float/relocation timeline, embedded-editor only; explicit finite windows, play/pause/seek, no mutation of live settings or display (#515). |
| Visual controls | Reviewed Studio/grid, optional modules, outline/digital/analog clocks, Native colours, animation levels and presets are installed on the owner's PC (revision and evidence in [STATUS.md](../STATUS.md)); actual 4K preview is accepted, while across-room comfort and compatibility gates remain. |
| Preview | One private atomically replaced runtime desktop PNG shared by browser/native (#544, 2026-10-27); live app preview deferred. |
| Local photo | Explicit selected raster is normalized in-browser, validated and atomically saved with settings in private local state; exports/imports exclude its bytes. Prior recovery backup may retain an older image. |
| Activation | Manual use first; Windows idle activation remains off until verification and explicit enablement. |
| Installer | Per-user Inno Setup 6 wrapper (`LivingRoomDisplaySetup-<version>.exe`, no admin) around one checksummed payload of the prebuilt app and pinned Node 24 runtime; the control script's `InstallPackage` owns the transaction (verification, data snapshot, swap, health check, automatic rollback). Rejected: MSIX (virtualized AppData/registry conflict with per-user `.scr` registration), WiX/MSI, a custom bootstrapper and a portable ZIP. See [installation](install.md#install-with-setup-recommended). |
| Pages | `/` is Home for day-to-day use (timers, reminders, a calendar that makes dated reminders, world clocks, countdowns and the note), `/editor` is Edit display (the editor) and `/display` the ambient view, chosen by `pageForPath` (#438). Home and the display poll `GET /api/changes` every 5 s while visible; timers live in a `timers.json` sidecar the previous release never opens, and show in the display Clock's date line. |
| Editor access | Loopback only, no LAN/public hosting or account system; Home likewise (phone or LAN access is #465). |

When a decision is made, replace its pending entry with the choice, source/date,
rationale, and remaining constraints. Use a separate decision note only when the
detail no longer fits here. Update [STATUS.md](../STATUS.md) and actual commands
in [development.md](development.md) at the same time.
