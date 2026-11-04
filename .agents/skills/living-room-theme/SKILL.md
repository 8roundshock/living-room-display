---
name: living-room-theme
description: Add or refine Living Room Display whole-screen seasonal, cultural holiday or weather scenes, their date policy, artwork, motion or editor demonstrations. Use for this repository’s atmosphere layer, not individual widget implementation.
---

# Living Room Display themes

Read the repository's `AGENTS.md`, [theme contract](../../../docs/ambient-themes.md)
and [calendar facts and cultural sources](../../../docs/holiday-calendar.md).
The registry is executable authority; inspect its current types instead of
inventing another scene list or copying an old schema from documentation.

- `src/shared/holidays.ts` owns factual observance dates, names and ordinary
  holiday spans. Preserve verified Dangi and Julian/Gregorian arithmetic.
- `src/shared/theme-registry.ts` owns original path art, palettes, size/motion
  budgets and explicit major/card/quiet eligibility. Both renderer and Try a
  scene consume it. Adding an observance must not automatically create a scene.
- `src/client/ambient-theme.ts` resolves current scenes and fresh noteworthy
  weather. An illustration uses `previewTheme`, never a fake clock or forecast.
- `AmbientTheme.tsx` places a bounded sequence in measured negative space;
  `Display.tsx` supplies widget reading areas and effective brightness.

For a cultural change, establish the date/custom from primary sources and record
URLs, review date and factual-versus-product distinctions in the calendar doc.
Use original recognizable contours, with a principal form and simpler companions.
Do not substitute one generic lantern/star for different cultures. Choose one
scene at a time; selected exact quiet dates constrain festive shapes and palette,
while factual weather retains priority. Minor cards leave the season intact.

To add a researched major scene, add one `THEME_SCENES` entry (original art,
palette, size, finite motion budget), then an explicit observance policy such as
`major('new-scene-id', 65, 3)`. The final argument is anticipation days, a product
choice; the factual central date remains in the calendar. A card-only addition
needs no art. Update sources and test start/day/end, overlap, deselection and the
return to the season. CA/KR share Christmas/New Year art; a selected Russian
calendar can supply its distinct New Year tree. Resolve one scene at a time.

Keep dominant true black, no full-screen tint/blur, no flashes/audio, clear widget
text and bounded SVG nodes. Tune from real RAM images at low brightness and
1080p/4K; increasing size alone does not ensure readability. Omit a mark when no
safe reading-space gap exists. Keep finite transform/opacity animation and expired
slot renewal; no per-frame JavaScript or fixed bright frame. Off, Animation Off
and system reduced motion retain their explicit behavior. No burn-in guarantee.

Editor demonstrations remain local state with a visible Preview/display-unchanged
label and Automatic return. They must not produce a dirty Save bar, requests,
persisted fields or altered dates/weather. Reset them on Cancel, theme/calendar
or style changes, layout editing and leaving the editor. Preserve global drafts
and concurrent changes. Keep 44px targets and the default 720px Style fit.

Follow `docs/development.md` for builds and isolated synthetic browser QA; inspect
actual dense/empty-board images and narrow/short controls in RAM. Update the
themes suite and focused calendar/resolver regressions. Installation, desktop
capture, native acceptance and physical-TV viewing are separate scopes. Obtain
independent concept and visual critique, refine the result, then independently
review the exact final pushed head under the normal repository workflow.
