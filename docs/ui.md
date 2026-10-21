# Display studio

Reviewed 2026-10-18 for [#56](https://github.com/8roundshock/living-room-display/issues/56)
and scoped [#58](https://github.com/8roundshock/living-room-display/issues/58),
[#59](https://github.com/8roundshock/living-room-display/issues/59),
[#60](https://github.com/8roundshock/living-room-display/issues/60),
[#61](https://github.com/8roundshock/living-room-display/issues/61) and
[#62](https://github.com/8roundshock/living-room-display/issues/62).
Browser checks establish source behavior; installation and native pointer/idle
acceptance are recorded separately in [STATUS](../STATUS.md).

## Pages

The app has three pages (#438), chosen by `pageForPath` in `src/client/route.ts`: **Home**
at `/` (and any other extension-less path), **Edit display** at `/editor` and the ambient
display at `/display`. Their titles are "Still · Home", "Still · Edit display" and
"Still · Display". Home and Edit display share one header (`StudioHeader`, 64 px from
701 CSS px, 72 px at 480 px and narrower): the brand goes to Home ("Still home"), a
**Pages** nav holds **Home** and **Edit display** with `aria-current="page"` on the
current one (at 480 px or narrower only the other page's link shows), and **Open
display** (icon-only at 480 px or narrower, still named "Open display") targets one
named window, `still-display`, shared with #436, so repeated clicks from the same tab
reuse that window rather than opening another tab each time. The browser finds a named
window only from the tab that opened it: a click from an unrelated tab (each Start menu
launch opens one) opens a second display tab, which #464 tracks. The link has no
`rel="noreferrer"`, which would sever the window name. All three are plain links, so Edit display's leave prompt
still guards an unsaved draft. Only `/editor` may ask for device location
(`Permissions-Policy: geolocation=(self)`); Home and the display send `geolocation=()`.

## Home

Home (`<div class="studio home-page">`, `src/client/Home.tsx`) is for day-to-day use
beside the display rather than for setting it up. It reuses the studio's tokens,
buttons, inputs, city search and Reminders panel; every rule of its own names a
`home-` class, and none reaches the embedded preview (#313). Base text is 16 px.

- **Layout at 1280 × 720:** the header, then a `minmax(0, 1fr) 400px` grid (gap 32,
  padding 24/32). The left column holds the date as the `h1` (with a screen-reader
  "Home · " before it) and the time beside it; world-clock chips ("London 11:42 PM ·
  +5 h"); while no city has been saved and the first-run tip was not hidden (the same
  `localStorage` key as Edit display's card) one line, "Weather shows Toronto until you
  choose your city. Choose your city", which opens `/editor?focus=city`; six quick
  actions in a 3 × 2 grid (each at least 88 px tall, named by its label and described
  by its line); and **Today**. The date, all six actions, the Today heading with its
  first row and **Edit display** are above the fold. The right column is **On your
  display**: the saved arrangement at 400 × 225 (`AmbientDisplay embedded`, still,
  inert and hidden from assistive technology; a click opens Edit display) captioned
  "Your saved arrangement. The display moves it around to protect the screen.",
  **Edit display** (primary) and **Open display**, "Showing: Calendar, Clock and
  Weather." and, when a widget Home feeds has content but is off, "Not on your display:
  World clocks and Countdown." with **Make room in Edit display** when one has no room.
- **At 390 px:** one column with a 16 px gutter (date, actions, Today, then the card);
  the actions stay 3 × 2 from 360 px and become 2 × 3 below; their descriptions are
  screen-reader only below 600 px; every target is at least 44 × 44 and nothing
  overflows sideways at 390 or 320 px.
- **Quick actions** each open a native `<dialog>` with `showModal()` (`aria-haspopup`):
  focus moves to its first field (Timer's first preset), Esc returns focus to the
  button that opened it, and after a create focus moves to the new row. Below 600 px a
  sheet is a bottom sheet (`max-height: calc(100dvh - 24px)`) with its own scroll and a
  sticky primary button. Typed values outlive a closed sheet for the page's life.
  - **Timer** ("Counts down on your display's clock"): presets 1, 3, 5, 10, 15 and 30
    minutes and 1 hour start at once (two activations from Home); **Custom** takes
    Hours, Minutes, Seconds and "Name (optional)", then **Start timer** ("Choose a time
    between 1 second and 24 hours."). With the Clock off: "Timers show in your
    display's Clock, which is off." with **Show the clock**, or **Make room in Edit
    display** when it has no room.
  - **Reminder** ("With or without a time"): What (1–240 characters), When (Anytime,
    Today, Tomorrow or Pick a date) and a time that defaults to the next whole hour for
    today (23:59 from 11 PM) and 9:00 AM otherwise. A missing date or time reads "Enter
    both a date and a time, or choose Anytime."; a time that has passed reads "That time
    has passed. Choose a later time." and keeps focus in the field.
  - **Calendar** ("Pick a day; it becomes a reminder", `HomeCalendar.tsx`): the month on
    the saved week start with Previous month, Today and Next month; neighbouring days are
    dim and clickable; days with pending dated reminders carry a dot (the caution tone
    when one is overdue) and are named "Friday, October 30, 2 reminders"; today has
    `aria-current="date"` and the selected day `aria-selected`. A roving-tabindex grid:
    arrows move by day or week across months, PageUp/PageDown by month (the day
    clamped, January 31 → February 28), Home/End to the week's edges, and Enter or Space
    selects the day and moves to What. The selected day lists its reminders, then "Add
    a reminder on Friday, October 30" with What, Time (9:00 AM; on today, the next whole
    hour once 9:00 AM has passed) and **Add to calendar**, which creates an ordinary
    dated reminder. A past day reads "This day has passed." with **Go to today**; a past
    time today is refused. A time that a spring-forward change skips is saved an hour
    later and named ("2:30 AM doesn't exist on Sun, Mar 14 (clocks spring forward).
    Saved for 3:30 AM."); the repeated autumn hour uses its first occurrence. Days are
    this computer's local days.
  - **World clock** ("Time in another city"): the cities with their time and **Remove**
    (with Undo), the city search with a Label and **Add clock** (disabled at four,
    "Up to 4 cities. Remove one to add another."), and "Rename or reorder in Edit
    display." (#463).
  - **Countdown** ("Days until a date"): the dates ("In 7 days", "Passed") with
    **Remove** (with Undo), then Title (1–60), Date (a week ahead), **Every year** and
    **Add countdown**.
  - **Note** ("A short message on your display"): 200 characters and 4 lines with a
    "37/200" counter; **Save note** and **Discard** appear only while the trimmed text
    differs from the saved note (and only then does leaving the page prompt); **Clear
    note** saves an empty note with Undo. Saving, discarding or undoing Clear removes
    the retained draft, so reopening reads a later saved edit from another page.
    Closing with unsaved text keeps that draft for this page's lifetime.
  - **Show on my display** (World clock, Countdown, Note, Reminder and Calendar, the
    latter two for Reminders): while that widget is off and has room, a switch, on by
    default, turns it on after the content saves (`POST /api/widgets/:id/show`, free
    cells only); with no room, "No room on your display · Make room in Edit display"
    links to `/editor?add=<id>`; while it is on, "World clocks is on your display".
- **Today** shows only groups with items. **Timers**: running ones count down live
  (m:ss or h:mm:ss, ticking in the row's own one-second interval so the page does not
  re-render) with "ends 6:51 PM" and **Pause/Resume**, **+1 min** and **Cancel** (with
  Undo); a paused one reads "· paused"; a finished one reads "Done · 2 min ago" in the
  caution tone for up to an hour with **Restart** and **Dismiss**. The digits are hidden
  from screen readers, which hear "about 8 minutes left" once a minute. Controls name
  their timer: "Pause Pasta timer", "Add 1 minute to Pasta timer". **Due today**:
  overdue first, then by time, each with a one-tap check ("Check off Call mom") that
  settles for 0.9 s, leaves and offers Undo; focus moves to the next check. **Anytime**:
  three, then "+N more". **Coming up**: dated reminders and countdowns in the next seven
  days, at most five. **All reminders · N** opens a sheet with the Reminders panel (its
  only instance on the page). With nothing to show: "Nothing on today. Start a timer or
  add a reminder."
- **Status:** one polite live region, always mounted, with Undo or Retry for 8 s:
  "10 min timer started · on your display's clock.", "10 min timer cancelled · Undo",
  "Added for Fri, Oct 30 at 9:00 AM · in Reminders on your display.", "Saved. No room
  for Countdown on your display · Make room in Edit display". While a sheet is open the
  line shows inside it, so nothing hides behind the backdrop. A finished timer is
  announced once ("Pasta timer is done.") and the tab reads "Done · Still · Home"
  until it is dismissed. A lost connection reads "Can't reach the display server on
  this computer. Your changes are kept — try again." with **Retry**, keeping typed
  values; while offline the forms are disabled, saved data stays visible and the line
  reads "Offline · showing saved reminders". The timers-file warning shows in the
  Timers group. Limits come from the server's messages.
- **Freshness:** Home and the display ask `GET /api/changes` every 5 s while visible
  and reload the state when it changed (and once when the server answers again after a
  lost connection); Edit display keeps its 30 s poll.
- **Motion:** Home follows the saved Animation level, Off when the screen prefers
  reduced motion; its transitions take 240 ms or less.
- **Tab order:** the header, the first-run line, the quick actions, Today, then the card.

`tests/ui/home-browser.mjs` covers the routes, the fold, both narrow widths, timers end to
end with the display (including Done, its title and a server restart), the calendar
(keyboard, the stored instant, the dot, the display's Reminders, refusals and the
spring-forward message), every other action, Show on my display and its Edit display
links, two pages at once and a Home add during an Edit display draft, one display
window and its keys, keyboard focus, a lost connection and silence (no `play()`, no
`AudioContext`, no media element, no notification request).

## Edit display

`/editor` opens Edit display (#438; it was the editor at `/` and `/editor`, and every flow
is unchanged): a large live appearance preview and a focused inspector.
Style, Widgets, Weather and Reminders share one settings draft. Desktop keeps the
preview beside a height-bounded inspector with fixed tabs and contained scrolling
above 700 CSS pixels. Canvas actions remain visible at compact desktop heights;
the 16:9 preview takes the height left after the heading, the canvas actions, one
reserved message line (layout messages and the weather note) and any alert, so none
of them reaches the Save bar's reserved space (#231). Narrow windows stack a normally scrolling
inspector below a nonsticky preview, leaving room for the keyboard.
Above 1050 CSS pixels the Save bar centers under the canvas, so the inspector always
uses the full height; at 1280×720 each tab's default, collapsed contents fit without
scrolling, including the Widgets tab with the first-run location card
([Weather and location](#weather-and-location)). Whenever settings
remain below, the inspector's bottom edge fades (scroll-linked, kept with reduced
motion). Focus scrolling reserves the measured Save bar height so fields and labels remain
visible above it, including narrow screens and compact keyboard-height windows.
Selecting a widget on the canvas or in the Widgets list, or adding one, scrolls its settings
into view (`block: 'nearest'`: the whole settings when they fit, else their top, above the
Save bar's reserved height) once: closing the picker or returning to the Widgets tab never
scrolls to it again (#339). Selecting never moves keyboard focus. Closing the picker moves focus
only when focus was in it: after an add to the new widget's row, shown with its settings, after
Escape or Close to **Add widget**; a canvas widget focused while the picker is open keeps focus,
so focus always stays in view. Desktop scrolls the
inspector panel. Stacked layouts scroll the page only after a list row click, an add or a
tap on the canvas, once the pointer is released and the tap's click has gone to the canvas
(a touch tap's click is aimed where the finger was, so an earlier scroll would send it to the
list control that moved there); a press that drags a widget and a canvas
widget focused from the keyboard keep the canvas in view. Scrolling is instant with reduced
motion or the Off animation level.

- **Save changes** atomically persists settings, appearance, location, widget
  options, selected local photo and saved styles. The bar exists only while
  effective saved values differ; reverting all edits hides it. Edits made while saving remain unsaved afterward.
  Failed saves preserve the draft and return keyboard focus to Save. Untouched fields refresh from server polling.
  Countdowns, world clocks and saved styles merge by item when another editor saved
  them meanwhile (#242): additions and removals from both are kept, an item changed
  on both keeps each side's changed fields (this editor wins only on a field both
  changed; a saved style's look counts as one field), and an item removed elsewhere
  but edited here stays. This editor's order wins only when it moved items; otherwise
  the saved order stays and its own additions follow. A layout edit keeps its whole
  arrangement, but widgets merge too (#350): one removed elsewhere and untouched here is
  removed, and one added elsewhere joins at its saved place when that is free on this
  board; otherwise it stays off and the layout message says “Note was added in another
  window; there is no room for it in this layout”. The merge happens at each 30-second
  poll, and when a Save sent before the next poll is refused as stale (#287): the editor
  sends the [settings revision](api.md#settings-revision) it last saw, merges what the
  other window saved and saves again by itself when that keeps all of it; otherwise it
  keeps the merged draft and says “Settings changed in another window. Review and save
  again.” A merged list over its limit blocks Save with the reason in the Save bar, for
  example “Up to 12 dates · remove one to save” (#288). Save keeps keyboard focus while it
  runs: it is `aria-disabled` and ignores a second activation (#289).
- After **Save** or **Cancel** keyboard focus returns to the last edited control while
  it is still shown, else to the active tab, and an always-mounted status region
  announces “Changes saved” or “Changes discarded” (#229). Removing a widget shows “Clock
  removed” at the top of the Widgets list and focuses the next row in the list's grouped
  order (else the previous one, else Add widget). Layout messages (moves, resizes, removals,
  adds, fixes and density changes) are spoken by one always-mounted status region, so the
  first one is announced, a repeated one (“No room to the left” twice) is announced again and
  none is announced twice; the list or the canvas line shows each one once (#311, #341).
- **Alerts** (a failed action, a lost connection with **Retry**, a storage warning) have
  their own row under the canvas actions and never cover them; the canvas shrinks while
  one shows (#227). One shows at a time with a dismiss (×) control. An action's error
  clears with the next successful action (an edit, Save, Cancel, Edit layout or Done,
  Preview movement or a reminder action); a dismissed connection or storage alert
  returns only after it has gone away and comes back. When the server cannot be
  reached, every message reads “Can't reach the display server on this computer. Your
  changes are kept — try again.”, never the browser's “Failed to fetch”. Drafts and
  open reminder forms are kept, and an error caused by the lost connection clears
  once a later poll or Retry reaches the server; a server's own error message stays
  until the next action (#232). The loading page explains the same failure beside
  **Try again**. On narrow layouts (700 CSS px or less) the canvas sits above the
  inspector, so while the row of an action's error has no room in view (above the Save
  bar) the same alert, with its dismiss control, floats at the top of the viewport and
  returns to its row once the canvas is scrolled back into view. Focus stays where it was,
  and the page scrolls just enough that the alert never covers the control that was used
  (#312). Connection and storage alerts keep their row.
- **Cancel** restores the latest saved settings across every section, resets the
  city query/style form, and invalidates pending device/photo callbacks. It does not
  undo saved reminders. Leaving with settings edits uses the browser's prompt.
- **Phone**, **Room** and **Night** are looks (#153, #110, #226): each sets the
  brightness, the accent (**Native** colours; Phone and Night also store a single colour
  of their own, which only older colour-mode data shows, #303), the text colour, the
  typeface and the retained legacy layout,
  and keeps everything else: the widgets and their layout, widget options (clock
  style, Hide when empty, Last screen), Text size, the Animation level, Drift and
  fade, the move interval and the fade length, as well as location, units,
  reminders and saved styles. Room brightness is 55%, Phone 70% and Night 28%.
  Phone no longer sets its own 2-minute interval, and no built-in style lowers Text
  size, so labels keep the readability floors. A style's card shows as chosen
  whenever its look is showing (also after an edit is reverted), and choosing a look
  is an ordinary draft change, so Save appears only for effective changes. Their
  miniatures show Lilac, Mist and Rose bars. New installs use the Room look. Up to
  twelve saved styles include visual/widget/empty-reminder settings, the accent mode
  and the Animation level; applying one restores its whole board. **Saved styles** opens
  with one hint (“Saves the current look and widgets so you can switch back later.”),
  prefixed with “Up to 12 styles.” once there are twelve (#344). **Style name** is only
  for a new name: choosing a style leaves it empty, **Add style** clears it, and
  **Update** keeps the chosen style's name unless another is typed. A name another style
  already uses, ignoring case and surrounding spaces, is refused inline (“A style named
  Evening already exists”). After Add style or **Delete selected style**, focus moves to
  the **Saved style** select (#343).
- The **Accent** row offers Native (a ring of palette tones named "Native colours":
  each widget uses its own colour, see [native palette](design.md#native-palette))
  and five colour swatches; a custom colour picker (**+**, named “Choose a custom
  colour”) sits on the heading line, which also names the current choice (Native, the
  swatch name or Custom). A swatch or custom colour selects one accent for every widget;
  Native keeps the last colour, so switching back restores it. A custom colour you chose
  appears as a swatch named with its value (“Custom colour #123456”), pressed while it is
  the accent, so after Native one activation restores it, and the saved one stays offered
  while a swatch is only a draft (#151). Phone's or Night's own single colour is offered
  there only while it is the accent: in the draft, or in saved older colour-mode data,
  where it stays one activation away (also after Native) until another colour is saved
  (#303). The row, the picker and Typography's **Text colour** use one spelling. Sand was retuned in
  #224; data saved with the earlier Sand reads as Sand and renders the new value
  without being rewritten. Every accent control keeps a 44 × 44 CSS px hit area
  (#137): seven fit one line in the 1280 × 720 inspector and at 390 px, and narrower
  panels (320 px, or 760 px with a kept custom colour) wrap without horizontal
  overflow. The live canvas, movement preview and picker samples show the draft's
  mode. The [palette harness](../tests/ui/palette-browser.mjs) covers these flows.
- The Style tab's **Motion** disclosure (its summary shows the level) starts with
  **Animation**: Off, Subtle or Lively as pressed buttons, then **Drift and fade
  between moves** (`motionEnabled`), **Move widgets every** (the interval) and Fade
  duration (#240). Its hint says that widgets always move to a new place through
  black, and that with Drift and fade off, or with Windows Settings › Accessibility
  › Visual effects › Animation effects off on the display PC, they appear without a
  fade and nothing drifts. Choosing a level is an ordinary draft change (the
  Save bar appears only while it differs from the saved level), does not mark the
  style Custom, and replays the canvas entrance once. When the editor's own screen
  prefers reduced motion, a hint explains that animation stays off there while the
  control still edits the saved value. Editor polish (tab indicator, disclosures,
  picker, drag settle, new-widget drop-in, Save bar entrance) follows the editor's
  effective level and stays within 240 ms; Off keeps the existing transitions. Every
  slider (Brightness, Text size, Move widgets every, Fade duration and Last screen's
  Snapshot opacity) speaks its value with the unit (“55%”, “3 minutes”, “2 seconds”);
  the value shown beside its label is not announced a second time (#342).
- **Data & recovery** (#234): **Export saved data** downloads a backup of the saved
  settings, styles and reminders (never the photo). **Restore from backup…** is
  refused while settings edits are unsaved ("Save or cancel your changes before
  restoring a backup."); otherwise it opens a file picker. The editor checks that
  the file is an export (version 1; a newer version asks to update the app first),
  then shows its date and contents, for example "2 reminders (1 completed) and 1
  saved style", with **Restore** and **Don't restore**; focus moves to the question's
  title when it appears (#302). Restore sends the file to `POST /api/import`, which
  validates it again. Nothing changes when a file is unreadable or refused, and the
  section's status line says why in plain words: a file the server refuses reads “This
  backup has settings this version can't read. It may come from a newer version of the
  app, or the file was changed.” with the server's own text under **Technical details**,
  and no answer reads “Couldn't reach the display server, so nothing was restored. Try
  again in a moment.” and keeps the question open. A restore replaces the saved
  settings, styles and reminders, keeps the current photo and refreshes the editor
  with a clean draft. Don't restore, a refused file and a finished restore return focus
  to **Restore from backup…**. The server keeps the replaced state as
  `state.backup.json` only until the next change (a settings save or any reminder
  change rewrites it), and reads it only to recover automatically when the saved data
  can't be read; the confirmation says so and suggests exporting first to keep a copy
  you can restore (#301). **Reset appearance…** asks inline and focuses **Keep my
  appearance**; Keep or Reset returns focus to Reset appearance… (#343). **Reset**
  returns every Style tab value to its default (the Room look, Text size 100%, Subtle,
  Drift and fade on, every 3 minutes, a 2 s fade) as an ordinary draft change, while
  widgets, their layout, the clock style and saved styles stay; the status line reads
  “Appearance reset. Save changes to keep it.” only while the reset is unsaved, clears
  on Cancel and reads “Appearance reset and saved.” after Save (#300). A link styled as
  a button (**Export saved data**) spaces its icon like the buttons beside it (#304). The
  [studio harness](../tests/ui/studio-browser.mjs) covers these flows.
- The authored canvas never relocates; outside Edit layout it shows value and glyph
  motion for the draft Animation level, and during Edit layout widgets stay still. **Edit layout** reveals a faint
  editor-only grid and whole-widget drag targets. While no message needs it, the reserved
  message line under the canvas reads “Drag a widget to move it · drag its corner to resize
  · arrow keys work too” (the keys part is left out on a touch screen); any layout message
  replaces it (#345). The density select carries a visible **Grid** label (its accessible
  name stays “Grid density”). Clicking/focusing selects a
  widget and exposes its resize handle, whose visible corner (30 × 36 px, 30 × 30 at
  phone width) has a 44 × 44 hit area that reaches inward at the canvas edges (#349).
  Arrow keys move the focused widget;
  Tab reaches its handle, where arrows change family. Results name the place or size,
  counted from 1 at the top left: “Last screen moved to column 7, row 5”, “Last screen
  resized to Small”, “Last screen cannot get any smaller”, and refusals name the direction
  (“No room to the left”, “No room above”). A move or resize that pushes neighbours names
  them (“Clock moved to column 2, row 1 · Weather moved down to make room”). Each move target
  and handle is described by its place and size (“Column 9, row 5 · Medium”) (#341). Family
  buttons are another
  alternative. No technical Position coordinates or four-arrow inspector exists.
  Pointer feedback is continuous while neighbors reflow into legal cells. Escape
  or pointer cancellation abandons the entire drag; impossible drops/resizes keep
  the prior board. Density changes immediately fit every enabled module, reducing
  families only when necessary; a round trip restores exact explored positions
  and families until another widget edit. A density that cannot hold the board is
  named with the widget count: “Spacious (8 × 6) can't fit these 12 widgets. Make some
  smaller or remove one, then try again.” Making one widget smaller never helps (the fit
  already tries every family), so when hiding one widget lets it fit, the smallest such
  widget is offered instead (“Spacious (8 × 6) can't fit these 11 widgets.” with **Make
  room: remove Last screen**), applied with the grid switch as one draft edit that Cancel
  restores; focus returns to the select. The offer belongs to that refusal: any later layout
  message, such as a refused move, replaces it. One live region speaks it (#346). On the full
  12-widget board no single removal helps: the shared packing search gives up on near-full
  boards (#403). Cancel restores the saved arrangement.
- **Free-size Reminders** (#73): its handle snaps to whole cells from 2 × 2 up to
  the full grid height and two-thirds of the width; neighbours reflow live, and an
  impossible size keeps the board with “No room for that size”. The default board's
  large Clock, Weather (#74) and Forecast leave no room for a Column, so its preset
  is `aria-disabled` (still focusable) with the reason “Column needs more room on
  this board.” Choosing a preset or stepper size that has no room changes nothing
  and names what takes the space in one live region beside the presets: “No room
  for a full-height Reminders column beside Clock, Weather and Forecast.” (#183).
  **Make room: Weather medium** applies the smallest single family reduction that
  fits, found with the shared reflow helpers (`src/client/make-room.ts`), together
  with the requested size as one draft edit; Cancel restores both. Keyboard focus then
  moves to the size control that shows the change (the pressed preset or the stepper used),
  never to the page (#310). Fixed-family
  size buttons explain a missing room the same way. A pointer drag on the canvas says “No
  room for that size” while it has none; when a drag or a handle arrow key ends without room,
  the same explanation and fix appear beside the widget's size controls, worked out once at
  that moment, and the canvas line hands over to that one live region (#285). An
  explanation belongs to the board it was shown on: any other layout change, density change
  or Cancel removes it, so it never comes back (#310). On the focused
  handle Right/Left change width and Down/Up change height by one cell, announced
  as “Reminders resized to 2 × 6”. The inspector offers Small, Medium, Large and
  Column (2 × full height) presets plus Width and Height steppers that stop at
  their limits; the list subtitle reads the family, Column or `C × R` (plus
  “· Hidden when empty” while the display hides an empty Reminders, #233), and a hint
  reads “Shows as many reminders as fit · soonest first”. Sizes join the draft.
  Consecutive resize steps of one widget (presets, steppers, the handle or a drag) are one
  exploration computed from the board before it began, so a neighbour pushed aside comes
  back when the widget shrinks again and resizing back to the saved shape is clean; the
  steps name it (“Forecast moved right to make room”, “Forecast moved back”). A move, another
  widget's edit, an add or removal, or a density change ends the exploration (#340).
  Density changes scale the span with
  full height and minimum width kept, so a Column stays a Column; a span dropped
  to fit is named (“Reminders 2 × 8 → small to fit. Switch back to restore.”). The
  picker still adds a family with a caption noting free resizing, qualified while
  the board has no room for a full-height column (“Resize freely after adding. Full
  height needs room first: make Clock, Weather or Forecast smaller.”). On the display a
  full-height Reminders column alternates top and bottom anchoring between
  arrangements while it relocates sideways.
- Density/family/position and visibility form one atomic local layout during a
  concurrent poll, preserving its validity while unrelated saved settings refresh.
  Adding a widget can seek nearby legal origins when its previous hidden origin
  cannot accommodate the board; it never silently removes existing content.
- **Widgets** lists the widgets on the display in the picker's groups (Time, Weather & sky,
  Personal, Pictures; catalog order inside each, #365) and selects inline size/position and
  per-widget controls. On a coarse pointer the size families and room fixes are 44 px tall,
  as is Note's **Clear** button everywhere (#349). **Add widget**
  opens a compact category rail and one actual renderer with synthetic family
  content, size choices and a reachable Add action. Every module can be removed, including clock
  and weather separately. Small/medium/large families adapt their content.
  The picker opens on the first widget not yet on the display in its grouped order,
  scrolled into view inside the rail (#154). Rail items already on the display are
  named with that state (“Preview Clock, on your display”); their Add button keeps
  its visible name as its accessible name (“Add Clock”, disabled) under “Clock is on
  your display” (#241). An add with no room is reported once, in the picker's own
  live region (“No room for Countdown at medium size.”), and cleared by another size
  or widget or by closing the picker. Up to two fixes apply as one draft edit that
  Cancel restores: **Try small** (a smaller family of the same widget), **Switch the
  grid to Fine** (a finer grid that changes no family) or **Make room: Weather
  medium** (#238). The Reminders tab is named with its count (“Reminders, 8
  pending”).
- **Preview movement** explicitly reveals numbered arrangements and **Automatic**
  ambient preview. Editing returns to authored placement. **Open display** opens
  the named `still-display` window (a new browser tab the first time, reused from
  the same originating tab after that); its pointer remains visible, including fullscreen.
  One dim line beside
  it (under the header on narrow windows) says where the full-screen display is: “For
  full screen on this PC: Start › Living Room Display - Show display, or press F on the
  display” (#360). Unmodified
  **F** toggles fullscreen without stealing typing, modifier shortcuts or repeats.
  Manual display controls (**Fullscreen · F**, **Home · Esc** and **Edit display · E**)
  appear on pointer movement or Tab and hide after 3.5 seconds without another
  supported interaction. Focused controls stay visible. Esc goes to Home and E to Edit
  display (#438); where #436 closes a display that Edit display opened, that rule wins.
- **Deep links** from Home (#438), read once and then cleared to `/editor`:
  `?add=<id>` (an active widget that is off) opens the Widgets tab with Edit layout on
  and the picker on that widget, with its Make-room fixes (`WidgetPicker`'s `initial`);
  `?focus=city` opens the Weather tab with City focused.

Only explicit `native=1` presentation hides the document cursor and omits browser
controls. Browser loading/failure/display and editor/embedded previews retain
normal pointers. The host URL flag selects that presentation; the native host's
own cursor surface and input lifecycle (PR #51, [Windows host](windows.md)) still
require combined-source acceptance. Appearance saves do not enable Windows idle.

## Calendar, Countdown and Note

**Add widget** groups the catalog by category in this order: **Time**, **Weather &
sky**, **Personal** and **Pictures**; groups without an available widget are not shown.
Desktop shows a narrow scrolling rail with each group label above its buttons (labels
and names at least 11 px, #195);
narrow screens show three buttons per row under each label. Up/Down move through the
whole list (across groups) and preview the focused widget (Left/Right do the same, matching
the narrow three-column layout); Home/End jump to the first or last. The rail is one tab
stop (#348): only the previewed widget takes Tab, so Tab goes from Close to the rail, then
the size buttons, Add and any room fixes (Add is at most five presses from Close). Samples are the
actual renderers with synthetic content (“Weekend trip”, “Birthday” and “Holiday”, “Dinner
at seven”); only the date and time are real, so the Clock shows this computer's time, the
Calendar marks today and Countdown's days count from today (#361). Each sample fills the
width of its area at up to twice the canvas scale, with a 9 px text floor (the display's
own floors scale with its screen; content that then overflows zooms out as a whole, as on
the display), a very wide family at most 2.5 times as wide as tall, and a small map of the
board under it shows the family's footprint (“4 × 2 cells of 12 × 8”).

- **Calendar** (Time, default medium) follows the computer's local date like the Clock
  and rolls over at midnight. **Week starts on** offers Automatic (labelled with the
  resolved day, for example “Automatic · Sunday”, from the browser locale with a Monday
  fallback), Sunday or Monday. It has no data dependency, so it is always shown when
  enabled.
- **Countdown** (Personal, default small) holds up to 12 rows: a title (1–60
  characters), a date, an **Every year** toggle and Remove. **Add date** adds a row
  dated one week ahead and focuses its title. An empty title shows an inline error and
  the Save bar reads “Countdown needs a title” until it is fixed; the server remains the
  authority; a year outside 1900–2200 shows “Use a date between 1900 and 2200”. Closing
  the panel (removing or collapsing the widget, or changing tab) gives an edited row back
  the last complete title or date it had (as saved, as it was when the panel opened, or as
  loaded by the editor's refresh) and drops a row that was never complete in any of those,
  so Save is never blocked by a field that is not on screen and closing never deletes a
  saved date (#191). Rows are read-only while a Save is running.
  Each row shows its count (“In 12 days · Fri, Oct 30”) or **Passed** for a
  past one-time date, which the display ignores until it is removed. Counts are whole
  days on this computer's calendar. The display shows the widget only while a date is
  upcoming; the editor canvas shows “Add a date to count down to” otherwise. The large
  family lists as many dates as fit its box, soonest first, then an exact “+N more”
  (#221).
- **Note** (Personal, default small) is a textarea limited to 200 characters and 4
  lines with a live “37/200” counter and **Clear**. Line breaks are kept. The display
  hides an empty note; the editor canvas shows “Write a note”.

All three panels join the shared settings draft: Save/Cancel appear only for effective
changes (trailing spaces trimmed on blur do not count), Cancel restores the saved values,
and built-in or saved styles never change the week start, countdowns or note (styles
do reset which widgets are shown). Countdowns and the note are private content stored
on this device and included in exports. `tests/ui/catalog-time-browser.mjs` checks the
picker groups and keyboard (Weather listed, no Rain; the free-size caption only for
Reminders, qualified on the default board), the initial selection, item and Add names,
the rail's single tab stop, sample text of at least 9 px in every family at 1280×720 and
today's date in the samples, the single “No room” region and its Fine/Small fixes, each
panel, Save/Cancel, reload,
styles, display hiding, a dense board where the three sit beside a full-height
Reminders column and keep relocating, 320/390 px reflow, Save-bar clearance and the
compact picker viewports with rail text of at least 11 px.

## Weather and location

Typing two characters starts debounced city search. Up/Down explores, Enter
selects, and Escape dismisses; focus stays in the input. Typing, blur or the first
result never selects. Region/country distinguishes namesakes. Older requests
cannot replace newer options. Selected location is separate from search text.
Long city names and region/country text wrap within each result. The focused
[#52](https://github.com/8roundshock/living-room-display/issues/52) regression
checks actual text bounds, normal short results, keyboard selection and Cancel
at 320px, 390px and desktop widths; synthetic visuals were inspected in RAM.

New installs use Toronto, labeled **Default location**, until an area/city is
saved. An editor with already-granted browser permission attempts one automatic
lookup; otherwise **Use device location** is the explicit permission action. All
results remain drafts until Save. Cancel
invalidates late callbacks. Only 0.1-degree coordinates leave the adapter; no raw
fix, accuracy, altitude or timestamp is stored. Failed lookup preserves a manual
city; automatic drafts cannot overwrite a manual city saved in another editor.
No background watch or IP lookup exists. `/display` never queries location or
permission, and its Permissions-Policy disables geolocation. The City field is named
by its visible label (“City”); “Type two or more letters to search for a city” is its
description (#241).

Until a location is saved, a small card above the inspector tabs reads “Showing
Toronto weather” while the default Widgets tab is open (#252). **Use my location** runs
the same permission-aware lookup and **Choose a city** opens the Weather tab with the
City field focused; both only change the draft, and the card names a pending choice
(“London is ready. Save changes to use it.”) or a blocked lookup. It steps aside on the
other tabs (Weather holds the same actions; Style has no spare height at 1280×720) and
while the picker is open, so every tab's default contents still fit at 1280×720, and it
is gone for good once a location is saved. **Hide location tip** dismisses it in this
browser only (`localStorage`); no key joins the saved data, so older releases still
read it. Its buttons are 44 px targets, **Hide location tip** 44 × 44 (#349); the card is
88 px tall and the default Widgets tab still fits beside it at 1280×720 and 1280×600. At
1024×600 and 760×600 the Widgets tab then scrolls by 58 px (Last screen below the fold,
cued by the panel's bottom fade) and fits again once the tip is hidden. That is a
deliberate trade-off (#310): only dropping the 44 px targets or one of the card's two
actions would make room, and the card is temporary. `tests/ui/first-run-browser.mjs`
covers the card.

**Time & units** in the Weather tab holds Units (°C · metric or °F · imperial) and
**Time format** (12-hour or 24-hour) side by side, so the format stays reachable with
the Clock removed (#235); the Clock panel keeps a mirrored Time format control. The
format drives every time shown on the display and in the editor, including the clock,
reminder times, World clocks, rain timing, Sun & moon, Air quality hours, the Last screen
caption, Weather's saved or offline “last known” time and the backup date in Style ›
Data & recovery (#310); the editor list and canvas follow an unsaved change. The status
line below shows the forecast's age (“Saved forecast · 2 hr ago” when stale, “Forecast
unavailable” when there is none, both with an amber dot) and, when an update failed,
the server's reason under it in the caution tone (“Weather update failed. Showing the
last successful forecast.”, “Weather is unavailable. Check the connection and location
settings.”, #347); **Location & forecast details** keeps only explanatory hints.

Preview weather retains its actual city/units while a selection is unsaved or
refreshing. Forecast dates/intervals use the weather city's timezone, or the computer's
while a device location's zone is still `auto` before its first forecast (Weather and
Forecast then read unavailable); the clock and reminder input use the computer timezone. Current conditions show age;
retained stale data is marked throughout, with Forecast's “Saved forecast” or
“Offline” prefix in the same amber status tone as Weather's age (#223). Missing values
stay unavailable. A retained forecast never shows past days, and a reading more than
3 hours old reads “Last known · 9 AM” (#243, [rule](widgets.md#data-and-image-boundaries)).
An update time in the future reads “Update time unknown” (#244). City search leaves
out a result it could not save (no valid timezone or coordinates) and keeps the rest
(#246).
Hourly chance covers precipitation including snow; rain estimates use rain plus
showers and label incomplete/gapped coverage. See [API semantics](api.md#weather-semantics).
Rain timing lives inside Weather (#74): it stays calm when the next 12 hours are
complete and dry, adds a hint line when rain is later, precipitation is possible or
the outlook is unknown, and leads with rain timing (large adds hourly chance bars)
when rain is current or starts within six hours. Wording says “likely” or
“possible”, never that it is raining; times use the weather city's timezone and the
12/24-hour setting, never leave AM/PM or “· 40%” alone on a line (#197), and
“Forecast estimate”/“Partial forecast” labels stay visible. The headline and the
detail describe the same spells (#167).
The footprint never changes, and the separate Rain widget is gone from the picker,
list and canvas; an enabled Rain from older data is merged into Weather
([upgrade](install.md#additive-data-and-rollback-compatibility-84)). There is no opt-out of
rain detail yet (#102). The [weather harness](../tests/ui/weather-browser.mjs) checks
every family × mode × density at 1280/1920/3840 widths at fit 1 (with stale, offline, last-known, long-place, sub-zero and unavailable states, #283, #362), CSS glyph boxes (#128), the
upgrade of a pre-#74 data folder, and a device location whose zone is still `auto`
while the provider is down (editor and display render, then recover).
Each weather module keeps its actual place and relevant units visible when used
alone; weather and forecast show the unit beside the place (“Toronto · °C”), and
elevated Weather keeps the rain amount unit (“0.16 in rain”). Forecast labels read
Today and then weekdays, tomorrow included (#256), while assistive text and hover
details keep the full relative label and civil date (“Tomorrow, 2026-10-19”). Ambient labels, age, attribution, units and secondary values
have a readability floor of 1.4% of the display height (1.65% for forecast
chance/temperatures, the Weather rain detail and reminder dates), multiplied by
**Text size**; very short compact widgets cap it by their own height. A larger
Text size never renders scaled ambient labels or values smaller: an overfull
widget zooms out as a whole (icons and the unavailable dash may still shrink). See the [widget contract](widgets.md#families-and-editing).

## Reminders and last screen

Reminder actions (add, edit, check off, restore, delete, clear history) save
immediately with a short status line and never join the settings draft. Items are
silent, dated or undated and one-time.
The Reminders tab has an **Up next (N)** / **History (M)** switch (`aria-pressed`).
Up next uses the display's order: overdue or due within seven days (soonest first),
then undated (newest first), then later dates. Each row has a 44 px check circle,
the title, a due line (`Overdue · Yesterday · 3:00 PM`, `Today · 6:00 PM` or
`Anytime`) and Edit and Delete side by side, so a one-line reminder takes about 60 px and
at least five fit the 1280×720 inspector (#366). Edit, Delete, Undo, **Clear history…** and
the Up next/History switch are at least 44 px. The rows and their labels are worked out
again only when the list, the minute or the time format changes, and the form renders on
its own, so typing stays responsive with hundreds of dated reminders (#354; in headless
Edge on the owner's PC about 8 ms a keystroke with 500, against 110–140 ms before).
One tap fills the circle and dims the title at once while
the completion saves; the circle reports `aria-pressed` until the row leaves or is
restored. After about 0.9 s the row collapses out of Up next (reduced motion keeps the
delay without the collapse). The status line offers **Undo** for about 8 s, until the
next message replaces it; Undo, or tapping the circle again during the settle, restores
the item (it shows unchecked at once and stays in Up next while the restore saves).
Deleting a pending reminder from Up next offers the same Undo, which re-creates it with
its text, exact due instant and creation time, so it returns to its sorted place. A
stored creation time later than the clock (the clock was set back, or the data came from
a computer whose clock ran ahead) is left out, and retried without when the server's
clock is behind, so the reminder still returns, perhaps a place away, and no schema text
shows (#296). Plain messages (“Reminder saved”, “Restored …”) also go after about 8 s,
even while another tab is open (#295). A focused Undo that expires, or gives way to a
plain message, hands focus to the Up next switch rather than the page (#297). A
shown message sticks to the bottom of the visible panel (above the Save bar on narrow
screens), and the focused row scrolls clear of it; with no message the empty line stays
at the end of the list and covers no row. The message, its Undo and any row
still settling survive switching editor tabs and back. So does an open form (#274): a new
or edit form keeps its typed text and date and comes back where it was (in place for an
edit) without taking focus from the tab; only an incomplete date, which has no value yet,
is lost with its message. **+** or another row's **Edit** never replaces a form with unsaved
typing: it stays, takes focus and reads “Save or discard this reminder first.” Leaving
the editor page while a form holds unsaved typed text shows the browser's leave prompt,
as unsaved settings do.
A check-off, edit, restore or delete of a reminder that another window already deleted
says “This reminder was deleted in another window.” and drops its row, never a false
“still in Up next” or the server's “Reminder not found” (#355). An open edit form keeps its
text and offers **Save as a new reminder**, with the same due instant unless the date was
changed; a poll that removes the reminder first shows the same offer before Save.
Focus moves to the next circle (else the previous one, else Add), so keyboard users can
tick off several in a row; after Undo, focus moves to the restored reminder's circle.
A failed save reverts the row: “Could not complete reminder. It is still in Up
next.” Deleting from Up next reads “Reminder deleted”, also while a row settles (a
checked-off row offers no delete Undo).
**+** opens a **New reminder** form at the top of Up next; **Edit** turns that row into
an **Edit reminder** form in place, so the row and its form stay in view. **Discard** or
Escape closes the form only (unlike the settings Cancel); Discard, Escape and Save
return focus to that row's Edit button, or to Add after a new reminder. An incomplete
date or time shows “Enter both a date and a time, or clear the field.” under the field
(`aria-invalid`, `aria-describedby`), keeps focus there and saves nothing; the
browser's own bubble is off. The edited row has no circle; if its reminder is checked
off anyway (for example in another tab), Save waits with “Checked off. Undo or restore
it to edit.” until it is restored, and the typed edit is kept.
History groups completed reminders under TODAY, YESTERDAY, `Mon, Oct 12` or
`Oct 12, 2025` by completion time in the computer timezone, newest first, 50 at a
time. A row shows `Completed 3:42 PM` (plus ` · was due …` when it was dated), and
offers Restore (the check or the undo icon, back to its sorted place in Up next) and
Delete. Completed reminders cannot be edited; an edit saved for a reminder completed
in another tab reports “This reminder was completed elsewhere. Restore it to edit.”
**Clear history…** asks inline before deleting every completed reminder and focuses
**Keep**; Keep or Escape returns focus to Clear history…, and Delete all moves it to the
History switch. The computer keeps the latest 500 completed reminders. Every reminder
time follows the 12/24-hour setting; like the canvas preview, the editor list follows an unsaved
change to it, while the display keeps the saved setting until Save.
The ambient widget shows as many pending reminders as fit its box, soonest first,
never a partially visible row, then an exact “+N more”. Rows are measured from layout
boxes, so an entrance or transition on a row never changes the count (#216). Titles use
up to two lines (four when only one reminder is pending) and scale with the widget
width, capped near 3.2% of the display height. When every pending reminder fits with
room to spare, a cut-off title may use up to four lines, and titles that all show in
full grow toward that cap while everything still fits (#254), so a tall column shows
whole titles instead of “…” beside empty space. When not every pending reminder fits,
more rows win over bigger titles (#359): the rows after the first may clamp to one line
with an ellipsis, then titles, with the label, dates and “+N more”, step down to about the
small family's width-based size (or the data floor), keeping the most whole rows at the
largest step that shows them. A medium box therefore shows at least as many reminders as a
small one, and a wider span never fewer than a narrower one of the same height. A tall span
with little vertical travel alternates its anchor between arrangements like a full-height
column (#175). If even the first row overflows at the smallest step, that row
stays and the widget zooms out as a whole; any resize remeasures against the widget's
fixed box, so the count and that state never flip on a remeasure. Dated rows add
`Today · 6:00 PM`, `Tomorrow · 9:00 AM`, `Oct 24 · 3:00 PM` or
`Overdue · Yesterday · 3:00 PM` (the word Overdue in the dim caution tone). Completed
reminders never appear; the display reflects a check-off within its 30 s refresh.
**Widgets → Reminders → Hide when empty** defaults on. A confirmed list with no
pending reminders (history only) hides the widget on the display, or shows “All clear”
when the option is off; the editor canvas keeps a hidden widget at its real span as a
dim “Hidden when empty · Add a reminder” placeholder, so adding and resizing it stay
visible (#233); the Widgets list subtitle uses the same phrase. A missing list or a disconnected display with nothing saved shows
“Reminders unavailable”, and saved items stay listed with “Saved reminders · offline”
in the status tone (#223). Disabling the widget always hides it.
An unchanged due-date input is omitted from an edit, preserving its exact saved
instant (including repeated daylight-saving hours and imported seconds/offsets)
and any concurrent date update. Explicitly changing or clearing the date still
saves that selection in the computer's local timezone.

Last screen is a dim optional pre-activation snapshot with capture time, size and
opacity controls. The UI does not capture. Native/server RAM lifecycle clears it
on dismissal; live preview/image history is not implemented. Export includes saved
settings/reminders only, excluding drafts, images and tokens.
New defaults use 24% snapshot opacity, multiplied by the ambient brightness cap.
Saved custom values, including the former 8% default, are preserved. A presentation
filter lifts midtones while preserving exact black/white endpoints; it changes
neither the RAM PNG nor its alpha. Grid families determine the usable image size;
the retained legacy `preview.widthPercent` field no longer shrinks that region.
The image takes the snapshot's own shape at the largest size that fits above one
caption line, centred in the cell, and "Last screen · 8:40 AM" starts on the image's
left edge a few pixels below it in every family and density (#225; under 6 px even at
4K). Under a narrower portrait image the caption keeps one line, running past the
image's right edge within the cell, with image and caption centred together; the time
never breaks from its AM/PM (#308). The same holds on the editor canvas at 1280×720 and 390 px: the widget's own frame
class is distinct from the studio's canvas frame, so it takes none of that frame's border,
radius or sizing. A newer snapshot that arrives while the display is shown stays hidden until it has
loaded and decoded, then fades in at Subtle and Lively; Off and reduced motion show it
as soon as it is ready (#173). The caption's time is formatted once per capture, not on
every one-second tick (#99).

Clock styles are Outline (default), Digital and Analog. Analog has hands without
a fixed face/tick ring (#222): two rounded text-colour hands (the hour hand at 30% of
the drawn square, the minute hand at 45%, never thinner than 3 px and 2 px at 720p,
scaled with the display) and a small dim pivot dot. Small and medium size the hands
to the cell height with the weekday and date beside them; large keeps the centred
hands over a quiet calendar line. The Outline stroke never thins below 1.2 px at 720p.
The clock's labels are built once per minute (#99), and the analog minute ease runs on
the compositor (#161). While a timer started from Home is visible, the date line shows it
(see [the Clock timer slot](widgets.md#clock-timer-slot)); the Clock panel says "While a
timer runs, the date line shows it. Start timers from Home." Photo starts disabled; choose a JPEG/PNG/WebP on this
device, then Save or Cancel with the rest of the draft. It is dimmed and moves
as one widget; a newly chosen photo fades in only after it has loaded (#173). It never uses the desktop snapshot or a remote feed. The private
recovery backup may retain an older selected image after replacement or clearing.

## World clocks, Sun & moon and Air quality

All three start disabled and are added from the picker; their panels sit under the
Size control and join the normal draft (Save/Cancel, no autosave).

- **World clocks:** up to four cities added with the same keyboard city search as
  the Weather tab (debounced combobox, `GET /api/locations`). Each row has an
  editable label (1–40 characters, defaulting to the city name), the region (the
  search result's region in this session, otherwise the time-zone name), the
  city's current time, and Move up, Move down and Remove buttons; focus stays with
  the moved city. Each label field is named by its row (“City 1 label”), so the name
  stays the same while typing or empty, and is described by the region and time
  (#192). The add field is disabled at four cities. An empty label blocks
  Save with "Each world clock needs a label". Hint: "Times follow each city's time
  zone and daylight saving." Coordinates are used only for the day/night icon. With
  no cities the widget is hidden on the display and shows "Add a city" on the canvas.
- **Sun & moon:** no settings. Hint: "Uses your weather location ({name}); times are
  calculated on this computer." Times use the weather location's resolved timezone,
  or this computer's while it is still `auto`.
- **Air quality:** scale US AQI (default) or European AQI. Hint: "Model estimate from
  Copernicus CAMS via Open-Meteo for your weather location. Canada's AQHI and local
  sensors are not available." While the draft enables the widget or changes its
  scale and the saved state has no reading for it, the canvas previews
  `GET /api/air-quality` (refreshed every 5 minutes). Cancel drops the preview at
  once; after Save it is kept until the next state poll carries the saved reading.

On the display: World clocks shows the first city (small), two side by side
(medium) or four rows (large) in regular-weight numerals, with "Tomorrow · +13 h",
"Today · −1 h" or "Same time", a sun or moon icon for daylight there, and "+N" for
cities that do not fit. Sun & moon shows the next sunrise or sunset (small), adds
both times, daylight length, its change from yesterday and the moon phase (medium),
and a dim dotted day arc with the sun's position, illumination and the next full
(or new) moon (large); polar days read "Sun up all day" / "Sun stays down today".
Air quality shows the AQI and its category word (no category colours), adds the
main pollutant and UV (medium), and up to 24 hourly bars with unknown hours dotted
and the UV peak (large). Bars, hour labels and the peak use only the current and
later hours, so a saved reading never shows a past hour or a peak that has already
happened; with fewer than two upcoming hours the line reads "Hourly estimate
unavailable". The chart is named for screen readers ("US AQI estimate for the next
24 hours: 40 to 45"); its axis reads "Now" and the last hour's end, like Weather's (#261).
The footer (#221) always shows the age and the short credit "CAMS · Open-Meteo", on one
row in medium and large and on two short rows where small is narrow (#309): "Model est.
· 12 min ago" with a reading, "Saved reading · 2 hr ago" in the caution tone when stale,
and "Offline · …" first while the display cannot reach the computer. Phrases never break
inside, so "12 min ago", "12 µg/m³" and "Open-Meteo" stay whole, and small and medium keep
fit 1 at Text 100% in every density, fresh, stale or offline, and for a three-digit or
long-category AQI (US 128, 156, 301, European 105) with either qualifier, which small sets
on its own line under the reading, at 720p, 1080p and 4K (#309). Saved current values stand for 3 hours
after the update, like Weather's temperature (#243). After that (#188) the reading
shows the saved hourly estimate for the current hour, labelled "Saved estimate" in the
caution tone, with its UV; without an estimate for this hour the old AQI reads "Last
known · 9 AM" ("Sat 9 AM" when not today) and UV is hidden. The fetch-time main
pollutant is hidden in both cases. Age and credit always stay. A failure reads "Air
quality unavailable" (age only, caution tone), never clean air. Calculations are cached
per minute (no `Intl` formatter is built while the minute holds, #185); values change on
the shared one-second tick without their own animation.
Browser suite: `tests/ui/catalog-sky-browser.mjs`.

## Movement and verification

The edited layout is the first composition. Later collision-free compositions
vary legal widget origins and whole-plane offsets, with a fully black rest before
revealing each replacement (default three minutes/two-second fade). Black remains
`#000`; brightness affects content only. Reduced motion or Drift and fade off removes
drift/travel and reveal effects while discrete relocation continues through black.
The separate **Animation** setting (Off, Subtle by default, Lively) governs motion
inside widgets: Subtle animates only changes and the reveal after each black rest,
Lively adds reveal choreography and slow loops on the current-weather glyph only
(see [motion levels](design.md#motion-levels)). Each screen shows its effective
level as `data-animation` on the ambient root: Off whenever that screen prefers
reduced motion, so turning off Windows Settings → Accessibility → Visual effects →
Animation effects makes the TV show Off. Relocation through black continues either
way. The [motion harness](../tests/ui/motion-browser.mjs) checks levels, reduced
motion, the reveal sequence, entrance geometry (every family of every active widget,
a full-height free-size Reminders span, the default board and a full board of every
widget at 1080p and 4K), loop inventory, adaptive Weather (real-size hero glyph,
calm → elevated fades and Lively bar growth), the measured Reminders list (only a
newly pending row fades; re-sorts, completions and remeasurements replay nothing and
the measured rows match at every level), value crossfades in the #78 widgets, editor
flows and a CDP performance budget for the default and full boards at 1280×720; TV
smoothness and comfort remain owner acceptance (#111).
Motion/dimness do not guarantee protection from image retention. No audio, external
fonts, telemetry, cloud accounts or LAN exposure is added.

The reusable
[Edge harness](../tests/ui/studio-browser.mjs) owns an ephemeral loopback server,
temporary data and synthetic provider/device responses. It checks global Cancel,
city keyboard/debounce/races, failed/in-flight saves, polling rebase, saved styles,
reminders, device cancellation/rounding/manual protection, all four timed 1080p/4K
bounds, true black, silence, reduced motion and 390px/320px reflow. Regressions also
cover failed explicit-location fallback races and focused-field clearance at
390px/320px with 844px/480px heights. The [grid harness](../tests/ui/grid-browser.mjs)
adds actual pointer/touch/keyboard moves/resizes, effective dirty-bar reverts,
density fitting/round-trip restoration, optional modules/styles, local canvas PNG/Cancel/atomic save
and pairwise rendered bounds, the spoken keyboard results (three moves give three
announcements naming the column and row, two refusals are both announced, a family resize
names the family) and a refused density on the full 12-widget board and its removal fix,
which a later refused move replaces (#341, #346). The [free-size harness](../tests/ui/freesize-browser.mjs) covers resize
explorations (#340), canvas no-room explanations (#285) and focus after a keyboard
Make room (#310). Images stay in RAM. Current verified counts and
review/installation limits are recorded in [STATUS](../STATUS.md).

The [workspace harness](../tests/ui/workspace-browser.mjs) checks bounded desktop
tabs/canvas/actions, unchanged canvas bounds when Save appears, selected/focused
resize handles, every active family picker action, Escape/focus return, private-data
separation, successful large Photo Add, explicit icon dimensions and focus clear
of Save. At every viewport a storage warning, a lost connection and a rejected photo
show in their own row clear of every canvas action (each still the topmost element at
its centre), and dismiss, recovery and next-action clearing work; at 1280×720/600 the
weather note is not covered by the Save bar (`elementFromPoint` sampling), and at
1280×720 keyboard focus after Save, Cancel and Remove widget plus the announcements are
asserted, including the layout status region that exists before the first removal (#311).
On the full 12-widget board at 1280×720, 1024×600 and 390×844 it checks that each canvas
selection and a list row bring the inspector's first control fully into view (#339), the
Edit layout how-to and Grid label (#345), the resize handle's 44 × 44 hit area by
`elementFromPoint` (also at the canvas corner) and Note's 44 px Clear (#349), and at
1280×720 the grouped list order and removal focus (#365); at the same three viewports, focus
fully in view (inside the panel and clear of the Save bar) after Escape from the picker with the
last row selected and after a keyboard add, canvas focus kept while the picker closes, and no
replayed scroll on returning to the Widgets tab (#339); a coarse pointer gets 44 px size
families. The [editor sync harness](../tests/ui/editor-sync-browser.mjs) aborts
`/api/*` for the loading page, Save, Add reminder and a poll, checks the clear message
and its clearing after recovery, recognises a reminder 409 by status and ends a
two-tab countdown edit with both countdowns. Verified logical viewports are 1280×720, 1280×600, 1024×600, 760×600,
390×700, 390×480 and 640×300 (the CSS viewport equivalent of 1280×600 at 200% zoom).
The actual browser-chrome zoom setting was not changed. Final-source compact
picker screenshots were inspected in RAM at 1280×600, 760×600 and 390×480.
The [widget harness](../tests/ui/widgets-browser.mjs) checks every active family at
three densities and 720p/1080p/4K, meaningful descendant bounds, fit 1 at Text 100% (#283),
unknown/partial/stale/image failures, browser F/cursor behavior and native-only
document styling. Physical TV brightness/comfort remains a separate gate.
The [palette harness](../tests/ui/palette-browser.mjs) renders every active widget in
every family, the default composition and a full board of all active widgets at
1280×720, 1080p and 4K in Native and colour modes. Each section must resolve its
catalog tone (or the one accent), tint its accent element and paint nothing but that
accent, the text colour or a status tone. It also checks the sub-tones inside the
merged renderers (Weather's rain hook, Sun & moon's moon, World clocks' day/night
icons, Air quality bars), picker samples in every family and the editor canvas.

After `npm ci` and `npm run build`, run every `tests/ui/*-browser.mjs` suite with
`node tests/ui/lib/run-suites.mjs --playwright '<Playwright module path>' --edge '<browser executable>' --sharp '<Sharp module path>'`,
or one suite as `node tests/ui/<name>-browser.mjs --playwright '<Playwright module path>' --edge '<browser executable>'`
(the preview suite also takes `--sharp`). The pinned Playwright and sharp versions
and their install are in [browser suites](development.md#browser-suites). CI runs
the pull-request set on every pull request and push to `main`, and every suite
weekly and on manual dispatch, headless in the runner's Edge
(`.github/workflows/browser-suites.yml`, #323). The runner has no GPU, so CI runs
the motion suite with `--no-gpu`; its resting glyph pixel parity and frame budget
stay local checks. The
[canvas scope harness](../tests/ui/canvas-scope-browser.mjs) fails when an element
on the editor canvas matches a `.studio`-scoped rule (#313). The cursor check runs
separately against an isolated production server:

```powershell
node windows/tests/Test-CursorBrowser.mjs --base-url 'http://127.0.0.1:<isolated QA port>' --playwright '<Playwright module path>' --edge '<browser executable>'
```

The UI harnesses own their test servers and never use the installed app. The
preview harness uses an existing Sharp module to measure RAM screenshot pixels;
it checks exact black, capped highlights, lifted midtones, all families/densities,
saved-opacity preservation and byte-for-byte raw snapshot/privacy behavior.
These checks do not establish recognizable content in an actual native capture.
Cursor checks
require a separate isolated production server and mock state without saved-data
changes. These are development tools, not runtime dependencies. Final source
visuals also require independent RAM inspection. Native cursor proof, fresh-account
installation, media/game inhibition and viewing-distance comfort remain separate.
