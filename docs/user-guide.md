# Using Living Room Display

This guide is for you if Living Room Display is already installed on your Windows
PC. It covers everyday use in plain words. For installing it, and for technical
details, see [installation](install.md).

Living Room Display turns a screen, such as a TV connected to your PC, into a calm,
mostly black display with large, dim information: the time, the weather, your
reminders and a few other things you choose. It makes no sound and needs no
account. Your settings and reminders stay on your PC. It goes online only for the
weather and air quality where you are, and for city names when you search.

There are three parts, each a page in your web browser except the last one on the TV:

- **Home**, for every day: start a timer, add a reminder or put something on a
  calendar, add a world clock, a countdown or a note, and see what is on the display;
- **Edit display**, where you choose what to show and how it looks;
- the **display**, the black full-screen view you leave on the TV.

## Home

Home is the app's main page (`http://127.0.0.1:4318/`). It shows today's date and time,
six quick actions and a **Today** list, with your saved display on the right and
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

## Open Edit display

Open the Start menu and choose **Living Room Display**. Edit display opens in your
browser (`http://127.0.0.1:4318/editor`); Setup also opens it once when it finishes
installing. Use the **Home** and **Edit display** links at the top to move between the
two pages.

You can keep Edit display open while you change things. Changes to the look, the
widgets and the weather settings are a draft: they show at once in the preview on
the left (**Your display**), and a bar with **Save changes** and **Cancel** appears
at the bottom. Nothing changes on the display until you click **Save changes**.
**Cancel** puts everything back the way it was saved. Reminders are different:
they save as soon as you add, change or tick one.

## First run: choose your city

The weather starts with Toronto until you choose a place. A card at the top of the
**Widgets** tab says so (for example "Showing Toronto weather") and offers two
choices:

- **Use my location**: your browser asks once whether the app may use your
  location. The app keeps only a rounded position, enough for local weather.
- **Choose a city**: opens the **Weather** tab with the **City** box ready. Type
  two or more letters, then pick your city from the list.

Then click **Save changes**. You can change the city at any time in the **Weather**
tab, where you also choose **Units** (°C or °F) and **Time format** (12-hour or
24-hour). A city you chose yourself is never replaced by an automatic location.

## Show the display on the TV

Make sure the TV shows your PC's screen.

- **From the Start menu:** choose **Living Room Display - Show display**. It fills
  the whole screen straight away. If the PC has more than one screen, it uses the
  main one.
- **From Home or Edit display:** click **Open display** at the top. It opens in a new
  browser tab the first time and reuses that tab after that. Press **F** to make it
  full screen.

## Leave the display

- If you started it from the Start menu, move the mouse or press any key. It closes
  and your PC is as you left it.
- In a browser tab, press **F** again (or **Esc**) to leave full screen. Press
  **Esc** to go to Home or **E** to go to Edit display. Moving the mouse also shows
  three buttons, **Fullscreen · F**, **Home · Esc** and **Edit display · E**, for a few
  seconds.

## Choose widgets

Each piece of information is a widget, and every widget is optional. In the
**Widgets** tab you can add, resize or remove them:

- **Add widget** (the **+** on the preview) opens a list grouped as Time, Weather
  & sky, Personal and Pictures. Pick a widget, pick a size (small, medium or
  large) and click **Add**.
- **Edit layout** lets you drag widgets around the grid and resize them from their
  corner. Click **Done** when you're finished.
- Select a widget in the list to change its options or remove it.

The widgets are: Clock, World clocks (up to four cities), Calendar, Weather (with
rain timing when rain is near), Forecast (the next seven days), Air quality, Sun &
moon, Reminders, Countdown (to dates you choose), Note (a short note of your own),
Photo (a dim picture from your PC) and Last screen (a dim picture of what was on
your screen just before the display started, with its time; it is kept in memory
only and never saved).

## Reminders

Add and tick off reminders on Home, or use the **Reminders** tab in Edit display:

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
- **Saved styles**: keep a combination you like and switch back to it later.

## Why things move

The display moves your widgets as whole groups to a new arrangement every few
minutes (every 3 minutes unless you change it), fading through black in between.
Between moves the whole board drifts very slowly. Bright things that never move
can leave a faint lasting image on OLED and some other TVs. Moving helps to spread
the wear, but no setting can promise to prevent it.

In **Style › Motion** you can change **Move widgets every** and the fade length. If
you turn off **Drift and fade between moves**, widgets still move, but jump to
their new place through black without fading or drifting.

## Animation levels

Also in **Style › Motion**, **Animation** controls small movements inside the
widgets:

- **Off**: widgets stay still.
- **Subtle** (the default): only changes animate, such as a new time or
  temperature, and widgets fade in after each move.
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

- **Style › Data & recovery › Export saved data** saves a backup file of your
  settings, styles and reminders (not the photo). Keep it somewhere safe.
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
