---
name: living-room-theme
description: Add or refine Living Room Display whole-screen seasonal, cultural holiday, birthday or weather scenes, their date policy, artwork, motion or editor demonstrations. Use for this repository’s atmosphere layer, not individual widget implementation.
---

# Living Room Display themes

Read the repository's `AGENTS.md`, [theme contract](../../../docs/ambient-themes.md)
and [calendar facts and cultural sources](../../../docs/holiday-calendar.md).
The registry is executable authority; inspect its current types instead of
inventing another scene list or copying an old schema from documentation.

- `src/shared/holidays.ts` owns factual observance dates, names and ordinary
  holiday spans. Preserve verified Dangi and Julian/Gregorian arithmetic.
- `src/shared/theme-registry.ts` owns scene identity, palettes, the living-scene
  budget and explicit major/card/quiet eligibility. Both renderer and Try a
  scene consume it. Adding an observance must not automatically create a scene.
- `src/shared/living-scene-art.ts` and `living-celebration-art.ts` own each
  scene's authored composition: edge patches of rooted groups with complete and
  compact drawings, a passage form and supported weather. Bounds are derived
  from the path control hull; the art test verifies them.
- `src/client/ambient-theme.ts` resolves current scenes and fresh noteworthy
  weather. An illustration uses `previewTheme`, never a fake clock or forecast.
- `LivingTheme.tsx` with `living-scene.ts` fits and animates the composition
  behind widgets under one reading mask; `SceneForeground.tsx` with
  `scene-passage.ts` runs the opt-in foreground passage. `Display.tsx` supplies
  widget reading areas and effective brightness.
- `src/client/living-scene-principals.ts` names each scene's principal
  silhouette for the unit and browser retention checks.

For a cultural change, establish the date/custom from primary sources and record
URLs, review date and factual-versus-product distinctions in the calendar doc.
Compose one connected edge scene: a principal habitat patch, a far silhouette and
one or two counterweights (at most four patches, six groups, 240 paths in all).
Draw a patch as one complete picture; the fitter moves the whole patch along its
edge before it shortens or omits anything, so art that bleeds off a side must
taper below the frame rather than end in a cut edge. Give tall groups a complete
compact drawing. Register the principal group ids for a new scene.
Do not substitute one generic lantern/star for different cultures. Choose one
scene at a time; selected exact quiet dates constrain festive shapes and palette,
while factual weather retains priority. Minor cards leave the season intact.

To add a researched major scene, add one `THEME_SCENES` entry (label, group,
palette) and its composition in the art module, then an explicit observance policy such as
`major('new-scene-id', 65, 3)`. The final argument is anticipation days, a product
choice; the factual central date remains in the calendar. A card-only addition
needs no art. Update sources and test start/day/end, overlap, deselection and the
return to the season. CA/KR share Christmas/New Year art; a selected Russian
calendar can supply its distinct New Year tree. Resolve one scene at a time.

Keep dominant true black, no full-screen tint/blur, no flashes/audio, clear widget
text and bounded SVG nodes. Tune from real RAM images at low brightness and
1080p/4K; increasing size alone does not ensure readability. Never weaken reading
protection to keep a form: relocate the whole patch, then compact, then omit.
Keep finite transform/opacity animation and staggered local patch renewal; no
per-frame JavaScript or fixed bright frame. Off, Animation Off
and system reduced motion retain their explicit behavior. No burn-in guarantee.

Owner preference (#582, 2026-11-04): atmosphere should look visibly colourful,
populated and alive at 26% brightness. Use distinct palette roles, multi-scale
feature/companion forms and characteristic finite motion; a tiny opacity/count
increase is insufficient. Keep black dominant and text clear. Compare affected
scenes at 26%/36% in RAM, with default/dense/empty boards and 1080p/4K samples;
complete styling passes compare every registered scene.
Owner direction (#586, 2026-11-04): scenes must read as composed whole-screen or
edge scenery (grass along the bottom, boughs, drifts), never floating stickers;
an occasional brief overlap of a widget is acceptable when it is rare. Judge the
populated default board first: a scene that is only good on an empty board fails.
A group's rotation sweep is part of its fitted bounds; do not add unreserved transforms.

Editor demonstrations remain local state with a visible Preview/display-unchanged
label and Automatic return. They must not produce a dirty Save bar, requests,
persisted fields or altered dates/weather. Reset them on Cancel, theme/calendar
or style changes, layout editing and leaving the editor. Preserve global drafts
and concurrent changes. Keep 44px targets and the default 720px Style fit.

Follow `docs/development.md` for builds and isolated synthetic browser QA; inspect
actual dense/empty-board images and narrow/short controls in RAM. Update the
themes suite and focused calendar/resolver regressions. Canvas preview control
changes must also run `workspace` for alerts, dirty state and scroll interactions.
Installation, desktop capture, native acceptance and physical-TV viewing are
separate scopes. Obtain
independent concept and visual critique, refine the result, then independently
review the exact final pushed head under the normal repository workflow.

Birthdays (#584) are global private annual content in Settings, never saved-style
appearance. The central registry supplies three generic birthday previews;
shared/birthdays.ts supplies exact-day and same-day collision policy. Keep real
names/dates out of code, fixtures, diagnostics, tickets and PRs. Use invented
examples in source checks. Preserve field-scoped Save/Cancel, concurrent ID-list
rebase, default omission and frozen-reader rollback tests. Run Settings, themes
and Workspace for birthday control changes. Cultural textile accents must remain
secondary to the birthday silhouette; cite primary sources and distinguish art
choices from birthday-custom claims in the theme contract.
