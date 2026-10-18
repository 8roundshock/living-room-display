# Widget contract

Reviewed 2026-10-18 against the owner's grid/widget requirements and the primary
Apple sources below. Recheck when the catalog, family geometry, rendering or
relocation changes, and when upstream guidance changes. This contract applies to
every ambient widget, including clocks, photos and last-desktop previews.

## Source map

| Authority | Responsibility |
| --- | --- |
| [`src/shared/widgets.ts`](../src/shared/widgets.ts) | The catalog, supported families, grid definitions, placement and layout helpers. |
| [`src/shared/contracts.ts`](../src/shared/contracts.ts) and [`defaults.ts`](../src/shared/defaults.ts) | Persisted types and catalog-derived initial settings. |
| [`src/server/validation.ts`](../src/server/validation.ts) and [`store.ts`](../src/server/store.ts) | Boundary validation, compatible legacy migration and atomic storage. |
| [`src/server/photo.ts`](../src/server/photo.ts) | Strict normalized PNG ingestion and private selected-image validation. |
| [`src/client/widgets/registry.tsx`](../src/client/widgets/registry.tsx) | Widget rendering by catalog type and family. |
| [`src/client/Display.tsx`](../src/client/Display.tsx) | Ambient state and the shared movement/composition boundary. |
| [`src/client/Editor.tsx`](../src/client/Editor.tsx) | Picker, grid interactions and settings draft integration. |

Read those files rather than copying type, size or default tables into another
module. A catalog entry must reach the picker and renderer through this shared
contract. The repo-local
[`living-room-widget` skill](../.agents/skills/living-room-widget/SKILL.md) is the
entrypoint for agents adding or changing a widget; it requires no global install.

Start with `WIDGET_CATALOG`, `GRID_DENSITIES` and `widgetSpan`; use
`reflowWidget`/`fitGridDensity` rather than implementing a second collision or
packing rule. `composeWidgetGrid` and `motionOffset` own ambient placement variation.
Schema/default changes belong at these authorities with their tests.
Legacy settings/presets without a grid receive the safe catalog default grid.
Their visibility/location choices survive; old offsets/scale and
`appearance.layout` are retained data, not converted or applied to the grid.
Grid revision 2 gives the large clock real height. Revision 1 is validated against
its original geometry before migration; enabled widgets remain present, with
family reduction only when needed to fit. Current invalid layouts are rejected.

## Families and editing

Use discrete supported families, with one focused piece of information in the
smallest useful family and additional relevant detail in larger families. A
larger family changes composition and information density; it is not merely a
scaled small widget. A widget need not support every family. Keep text real,
scalable and readable, with meaningful labels instead of relying on color.
Small labels, age, attribution, units and secondary values use the shared floors in
[`widgets.css`](../src/client/widgets.css): `var(--min-text)`/`var(--min-data)`,
inherited from `--ambient-min-text` (1.4% of the display or editor canvas height)
and `--ambient-min-data` (1.65%), times Text size. Wrap related values onto shared
rows before letting the fit scale shrink a family. Only a family that truly cannot
fit caps the floors by its own content height: small rain/forecast use 7.25% (text)
and 8.5% (data), which binds only when that height is under about 19.4% of the
display (about 1.07%/1.26% in the fine grid; Balanced sits at the threshold).
Overfull content is laid out proportionally wider before the fit scale shrinks it,
so a larger Text size never renders text smaller. The picker sample has no floor.

The renderer families have deliberate visual roles:

| Widget | Small | Medium | Large |
| --- | --- | --- | --- |
| Clock | Compact time and calendar | Time beside a calendar column | Centered monumental time with a quiet calendar line; outline, digital and hand-only analog styles share this composition |
| Weather | Temperature and conditions | Temperature beside conditions and feels-like | Adds wind and the available daily high/low |
| Rain | Peak hourly precipitation chance, estimated rain window and coverage | Adds rain amount and the shown interval | Adds the hourly probability plot; missing probabilities remain unknown |
| Forecast | Three days | Five days | Seven days; compact weekday labels preserve room for temperatures and chance |
| Reminders | One pending item | Two pending items | Four pending items; all show an honest remaining count |
| Photo | Center crop in a compact area | Wider landscape crop | Complete image fitted in the larger area |
| Last screen | Complete, faint captured desktop | Wider complete desktop | Larger complete desktop; no crop hides screen context |

The large clock requires actual vertical room in the central catalog; do not
recreate a giant option by scaling within the previous short large family.
All families use the same renderer in ambient view, authored editor canvas and
synthetic picker preview. Picker fixtures never become user data.

The selected grid controls snapping and capacity. Dragging and resize handles
snap to allowed cells and supported families through the shared helpers. Moving
or enlarging a widget gently reflows neighbors into valid space; the active
widget stays under the pointer. Reject an impossible placement with a clear
local response instead of covering another widget or discarding one. Density
changes fit every enabled module, reducing families only as necessary and
restoring the exact prior layout when switched back before another widget edit.
A visible grid, handles,
selection borders, labels and picker chrome belong to the editor only.

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
The authored editor canvas stays still. Ambient relocation runs only in the
display or an explicitly requested movement preview, so layout editing never
competes with the ambient scheduler.

Legacy backfill uses revision-one catalog origins before strict validation and
central migration. An absent additive module is different from an explicitly
invalid overlapping placement; the latter still rejects. Current saves use
geometry revision 2. Follow the [pre-upgrade data backup and rollback](install.md#widget-geometry-revision-2-update-and-rollback)
procedure; the previous app does not understand revision 2 even though the outer
settings version remains 1.

## Ambient appearance and recurring exposure

Unused pixels remain true black. Reuse ambient brightness and type tokens; keep
fills small and dim. Avoid persistent card backgrounds, borders, dials, divider
lines, corner marks, logos and repeated decorative labels. All visible content,
including attribution and stale-state labels, belongs inside its movable group.
The editor may be brighter and show controls; those styles must not leak into the
ambient view or its error/loading states.

Large clock numerals should offer a tasteful outline treatment with sparse lit
area and sufficient stroke weight at real viewing distance. Other clock styles
remain subject to the same dimness and movement contract. Do not add a fixed
analog bezel, tick ring or always-lit colon merely because the hands or digits
change. Outlines still reuse pixels and must move with their group.

Move the complete layout through substantially different valid locations, with
varying offsets or routes over time instead of forever repeating identical
anchors. Small jitter inside fixed widget bounds is insufficient. Keep module
rectangles disjoint at each visible phase; fade the old composition fully to
black before revealing a new one, so crossfades cannot overlay bright layouts.
Include a black rest interval and avoid flashes or synchronized bright accents.
Use the centralized scheduler/wrapper, not a new per-widget motion loop.

Reduced motion removes travel, zoom and decorative animation while preserving
periodic spatial relocation through a black interval and an instant reveal (or a
brief opacity transition when permitted). It must not freeze the ambient display
at one permanent position. Missing or hidden widgets must not leave a fixed frame.

These are design requirements to reduce recurring exposure, not a measured
safety threshold. Finite screens and recurring content inevitably reuse pixels;
do not promise zero overlap over time or prevention of OLED burn-in. Browser
previews do not establish physical-TV brightness or long-term panel behavior.

## Data and image boundaries

Render content according to available space without changing its meaning. Keep
forecast estimates, age, stale/unknown states, place and units honest. For a
hide-when-empty option, distinguish confirmed empty from unavailable or failed.
Keep management available in the editor when the ambient widget is hidden.

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
desktop snapshot is captured only by the authorized native flow, stays in RAM,
expires on exit/session lock, and is never persisted, exported or reused as a
photo. Tests use synthetic images. Do not request GPS, screen capture or access
to personal photo folders merely to implement a widget.

## Verification for a widget change

- Check every supported family on every supported grid, smallest bounds and long
  content, all relocation phases and black intervals. Inspect actual images for
  density, clipping, collisions and stale/error/empty states using synthetic data.
- Exercise add/remove, drag/drop, resize, keyboard alternatives, invalid placement,
  grid changes, Save/Cancel, clean/dirty save-bar visibility, persistence,
  presets and legacy import/migration. Retain edits made while Save is pending.
- Check reduced motion still relocates, whole-group bounds remain valid, and
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
| [HIG Always On](https://developer.apple.com/design/human-interface-guidelines/always-on) | Dim secondary content and reduce visual noise. Apple's preference for stable layouts differs from this app's required periodic relocation on a TV. |
| [HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | System type, clear size/weight hierarchy and viewing-distance checks. Small supporting text uses regular/medium weight; enlarged outlined time remains a deliberate sparse treatment. |
| [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Purposeful, brief editor feedback; fade before relocation when travel conveys no useful information. Reduced motion removes effects while the ambient relocation contract still applies. No audio or haptic feedback is introduced. |
| [Designing your app for the Always On state](https://developer.apple.com/documentation/watchos-apps/designing-your-app-for-the-always-on-state) | The watchOS example replaces large numeral fills with outlines/dim interiors. It supports the clock treatment, not a claim that this TV inherits Apple luminance or panel controls. |
