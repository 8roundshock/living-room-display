# Using Living Room Display

## Use different styles through the week

Save the looks and widgets you want in **Edit display**,
then save those editor changes. In **Settings → Schedule → Edit schedule**, add a row, choose
a saved style, the days it starts, and its From/Until times. Choose a fallback
style (or your manual appearance) for the rest of the week, enable the schedule,
and choose **Save schedule**. Nothing is scheduled until you choose and save it.

Times follow this computer's local clock, shown beside the controls. An evening
range ending in the morning continues into the next day. Equal times mean until
that time the next day. During daylight-saving changes, skipped times never run
and repeated times follow the same schedule both times. If rows overlap, the first
matching row wins; move it Up or Down to choose priority.

Home names what's on the display and why.
The editor canvas continues to show your manual appearance. Applying or saving a
manual style does not pause the schedule: save any visual edits, then choose
Home's **Use manual style for 1 hour**. It resumes automatically at the time shown,
or choose **Return to schedule**. Scheduling never changes Windows lock settings.

Schedule editing has its own Save/Cancel in Settings. A deleted style stays marked
as missing and is skipped; choose
another style or remove that row. The next matching row, fallback, or manual
appearance keeps the display usable.

To back everything up, download your saved-data backup under **Data & recovery**
and **Download saved schedule** under Schedule. The schedule file refers to style
IDs but does not include the styles themselves. Restore saved data first, then
**Restore schedule…**. Restoring a schedule asks before replacing it and ends any
temporary override. Restoring saved data alone, Reset appearance and Reset layout
keep your local schedule. Disable scheduling and save to return to manual use.

This guide is for you if Living Room Display is already installed on your Windows
PC. It covers everyday use in plain words. For installing it, and for technical
details, see [installation](install.md).

Living Room Display turns a screen, such as a TV connected to your PC, into a calm,
mostly black display with large, dim information: the time, the weather, your
reminders and a few other things you choose. It makes no sound and needs no
account. Your settings and reminders stay on your PC. It goes online only for the
weather and air quality where you are, and for city names when you search.

The header has three destinations. The display opens separately:

- **Home**, for every day: start a timer, add a reminder or put something on a
  calendar, add a world clock, a countdown or a note, and see what is on the display;
- **Edit display**, where you choose what to show and how it looks;
- **Settings**, for your city, units, time format, screen preference, schedules and backups;
- the **display**, the black full-screen view you leave on the TV.

## Home

Home is the app's main page (`http://127.0.0.1:4318/`). It shows today's date and time,
six compact actions and a **Today** list, with a display summary and
**Edit display** one click away.

- **Timer**: pick 1, 3, 5, 10, 15 or 30 minutes or 1 hour and it starts at once, or set
  your own time and an optional name such as "Pasta". The timer counts down silently on
  the display, in the line under the Clock's time ("Pasta 8 min"), and in Today, where
  you can pause it, add a minute or cancel it (**Undo** brings it back). When it ends,
  the display shows **Done** for 10 minutes and Home says so; it never makes a sound. If
  the Clock is off, Home offers **Show the clock**.
- **Reminder**: what to remember, and when: anytime, today, tomorrow or a date you pick.
- **Calendar**: pick a day on the month and add a reminder for it (9:00 AM unless you
  choose another time). Days with reminders have a dot.
- **World clock**, **Countdown** and **Note**: add a city, a date to count down to or a
  short note.

Each one can also put its widget on the display (**Show on my display**). Home only
uses free space: when the display is full, it offers **Make room in Edit display**,
which opens the widget picker there. Today lists your timers, what is due today, the
reminders without a date and what is coming up in the next week; tick the circle when
something is done. **All reminders** opens the full list. Changes you make on Home
reach the display within a few seconds.

Closing a quick-action dialog keeps what you typed. Leaving Home warns about
unsaved choices; returning a field to its original value clears that draft.
Calendar browsing alone does not create a draft, while a time you explicitly
change is kept even before you type the reminder.

## Open Home and Edit display

Open the Start menu and choose **Living Room Display**. Home opens in your browser
(`http://127.0.0.1:4318/`); Setup also opens it once when it finishes installing.
Each time you choose it, it opens another browser tab, so close the ones you no longer
need. To choose what the display shows and how it looks, click **Edit display** at the
top (`http://127.0.0.1:4318/editor`). Use the **Home** and **Edit display** links at
the top to move between Home, Edit display and Settings. Unsaved changes ask before
you leave. **Settings** holds weather setup; reminders are managed from Home.

You can keep Edit display open while you change things. Visual changes are drafts
in the canvas; **Save changes** and **Cancel** appear in the top Style toolbar only
when needed. Save changes updates the selected saved style; **Save as new…** keeps
it and creates a separate style. Reminders save as soon as you change them on Home.
Settings has its own Save/Cancel for app preferences and a separate schedule draft.

## First run: choose your city

Weather starts with Toronto until you choose a place. Home's **Choose your city**
link opens **Settings** with **City** focused. Type two letters and choose a city
from the dropdown, or choose **Use device location** for one browser lookup. Only
a rounded weather area is kept. The app never requests location automatically.

Choose **Save changes** to use the draft city. Settings also holds **Units** and
**Time format**. Cancel keeps the saved preferences. A failed save keeps your edits;
a conflict asks you to review before saving again.
## Show the display on the TV

Make sure the TV shows your PC's screen.

- **From the Start menu:** choose **Living Room Display - Show display**. It fills
  the whole screen straight away. If the PC has more than one screen, it uses the
  main one.
- **From Home or Edit display:** click **Open display** at the top. It opens in a new
  browser tab the first time; clicking it again from the same tab goes back to that
  display tab. Another Home or Edit display tab, such as one a later Start menu launch
  opened, opens its own display tab, so close any extra ones. Press **F** to make it
  full screen.

## Leave the display

- If you started it from the Start menu, move the mouse or press any key. It closes
  and your PC is as you left it.
- In a browser tab, press **F** again (or **Esc**) to leave full screen. Press
  **Esc** to go to Home or **E** to go to Edit display. Moving the mouse also shows
  three buttons, **Fullscreen · F**, **Home · Esc** and **Edit display · E**, for a few
  seconds.

## Choose widgets

Each piece of information is a widget, and every widget is optional. The display
starts with a large Calendar and Clock across the top, a large Weather and Forecast
below them, and a smaller Last screen and Reminders, filling the whole grid. In the
**Widgets** tab you can add, resize or remove them:

- **Add widget** (the **+** on the preview) opens a list grouped as Time, Weather
  & sky, Personal and Pictures. Pick a widget, pick a size (small, medium or
  large) and click **Add**. While the grid is full, the editor says there is no
  room and offers a fix, such as a finer grid or making one widget smaller; your
  choice is a change you can still Save or Cancel.
- **Edit layout** lets you drag widgets around the grid and resize them from their
  corner. Click **Done** when you're finished.
- Select a widget in the list to change its options or remove it.
- **Style › Reset appearance & layout › Reset layout…** puts the starting layout back: those
  six widgets in their places and every other widget off. Your widget settings,
  reminders and looks stay, and nothing changes until you Save.

The widgets are: Clock, World clocks (up to four cities), Calendar, Weather (with
rain timing when rain is near), Forecast (the next seven days), Air quality, Sun &
moon, Dynamic (what matters now, or a calm rotation), Reminders, Countdown (to dates you choose), Note (a short note of your own),
Photo (a dim picture from your PC) and Last screen (a dim picture of what was on
your screen just before the display started, with its time; it is kept in memory
only and never saved).

**Dynamic** stays on what matters most: an official weather warning (from Environment
and Climate Change Canada or the US National Weather Service, for Canada and the US
only), a storm or rain starting soon, a reminder due within the hour. Otherwise it shows
one calm card each minute, such as the conditions, sunset or the next full moon, skipping
what another widget on your display already shows. In its options, choose what it may
show: Weather, Official weather alerts, Air & UV, Sun & moon, and Reminders & countdowns
(their titles appear on the display). It uses your weather location; forecasts and model
estimates are never shown as official warnings. Official alerts are checked after you save.

## Reminders

Add and tick off reminders on Home. **All reminders** opens the full list:

- Click **Add reminder** (**+**), type what you want to remember and, if you like,
  add a date and time. Reminders without a date stay until you tick them off.
- Tick the circle next to a reminder when it's done. It fades and leaves the list.
  **Undo** appears for a few seconds if you ticked the wrong one.
- **History** lists finished reminders; you can put one back from there.

The Reminders widget shows as many upcoming reminders as fit, soonest first, then
"+N more". With **Hide when empty** on (in the widget's options), it disappears
from the display when no reminders are left.

## Looks

The **Style** tab sets how everything looks:

- **Room**, **Phone** and **Night** are ready-made looks. Room is the default;
  Night is the dimmest, for a dark room. A look changes brightness, colours and the
  typeface, and keeps your widgets where they are.
- **Accent**: **Native colours** gives each widget its own soft colour; or pick one
  colour for everything.
- **Brightness** and **Text size**: if the text is hard to read from the couch,
  raise Text size before brightness.
- **Brightness › Follow daylight** makes the display brighter by day and dimmer at
  night on its own: choose the **Dimmest** and **Brightest** it may be. It is
  brightest when the sun is highest at your weather location (around midday) and
  stays at Dimmest from sunset to sunrise, changing slowly enough that you will not
  see it step. The editor shows the level now and when it peaks. **Fixed** keeps one
  level all day. A look such as Night changes the colours and the Fixed level, and
  keeps Follow daylight on.
- **Saved styles**: keep a combination you like and switch back to it later.

## Why things move

Your widgets stay where you put them. The whole board floats slowly, reaching a new
spot every few minutes (every 3 minutes unless you change it), and the text inside
each widget floats a little within its own space. The screen never goes dark to
move. Bright things that never move can leave a faint lasting image on OLED and
some other TVs. Moving helps to spread the wear, but no setting can promise to
prevent it.

In **Style › Motion** you can change **Move every**. If you turn off **Float
gently**, the board still moves, but shifts a little once each interval without
animation. Turn on **Swap places** if you would also like widgets to trade places
every interval: they glide to their new places without going dark, and your saved
arrangement stays as it is. **Swap glide** sets how long that glide takes.

## Keeping the screen on

**Style › Motion › Keep the screen on while the display shows** is on by default.
While the display is full screen or running as your screensaver, Windows won't turn
the screen off; the rest of the time Windows' own power settings apply. On Windows,
the same section shows when Windows turns the screen off and sleeps, and warns if
that would happen before your screensaver starts.

## One display window

**Open display** on Home or Edit display opens one display window and brings it back to the
front when you click it again (it then reads **Show display**, with **Close
display** beside it). Press **Esc** on that display to return to its opener and
close it, even if that opener has since closed. A directly opened display uses
**Esc** for Home and **E** for Edit display. If you open the display another way, older display tabs close themselves
or ask you to close them.

## Animation levels

Also in **Style › Motion**, **Animation** controls small movements inside the
widgets:

- **Off**: widgets stay still.
- **Subtle** (the default): only changes animate, such as a new time or
  temperature, and widgets fade in when the display opens.
- **Lively**: a little more movement, including gentle weather motion.

If Windows is set to show fewer animations, the display treats the level as Off.
That setting is **Settings › Accessibility › Visual effects › Animation effects**
on Windows 11, and **Settings › Ease of Access › Display › Show animations in
Windows** on Windows 10.

## About the weather

The weather comes from Open-Meteo, a free forecast service. The display always says
how old it is. If the PC can't reach the service, you see the last saved forecast,
labelled as saved, or a plain "unavailable" message, never made-up weather. When
rain is near, Weather adds its chance and rough timing: that is a forecast
estimate, not a promise.

## Backups

Your settings, reminders and photo are stored only on this PC.

- **Settings › Data & recovery › Export saved data** saves a backup file of your
  settings, styles and reminders (not photos or schedules). Download the schedule
  separately in Schedule and keep both files.
- **Restore from backup…** in the same place reads such a file back. It shows what
  the file contains and asks before it replaces anything.
- When you install a newer version, Setup first makes its own copy of your data.

## Updating

When you have a newer version's Setup file, save any unsaved changes in the editor,
then run it. It says **Update Living Room Display to version …**; click
**Install**. Your settings, reminders and photo stay, and a
backup copy is made first. The display closes during the update; start it again
afterwards.

## Uninstalling

Open **Settings › Apps** (Apps & Features), find **Living Room Display** and choose
**Uninstall**, or right-click the Start menu entry and choose **Uninstall**. You
are asked whether to **Keep my data** (the default, so a later reinstall picks up
where you left off) or **Delete my data**.

## What it doesn't do

It doesn't start with Windows, doesn't change your screen saver, doesn't turn the
TV on or off and doesn't play sound, not even when a timer ends. Turning the TV off and on stays your choice.
