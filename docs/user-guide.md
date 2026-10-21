# Using Living Room Display

This guide is for you if Living Room Display is already installed on your Windows
PC. It covers everyday use in plain words. For installing it, and for technical
details, see [installation](install.md).

Living Room Display turns a screen, such as a TV connected to your PC, into a calm,
mostly black display with large, dim information: the time, the weather, your
reminders and a few other things you choose. It makes no sound and needs no
account. Your settings and reminders stay on your PC. It goes online only for the
weather and air quality where you are, and for city names when you search.

There are two parts:

- the **editor**, a page in your web browser where you choose what to show and
  how it looks;
- the **display**, the black full-screen view you leave on the TV.

## Open the editor

Open the Start menu and choose **Living Room Display**. The editor opens in your
browser. Setup also opens it once when it finishes installing.

You can keep the editor open while you change things. Changes to the look, the
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
- **From the editor:** click **Open display** at the top. It opens in a new
  browser tab. Press **F** to make it full screen.

## Leave the display

- If you started it from the Start menu, move the mouse or press any key. It closes
  and your PC is as you left it.
- In a browser tab, press **F** again (or **Esc**) to leave full screen. Press
  **Esc** or **E** to go back to the editor. Moving the mouse also shows two
  buttons, **Fullscreen · F** and **Editor · Esc**, for a few seconds.

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
- **Style › Data & recovery › Reset layout…** puts the starting layout back: those
  six widgets in their places and every other widget off. Your widget settings,
  reminders and looks stay, and nothing changes until you Save.

The widgets are: Clock, World clocks (up to four cities), Calendar, Weather (with
rain timing when rain is near), Forecast (the next seven days), Air quality, Sun &
moon, Reminders, Countdown (to dates you choose), Note (a short note of your own),
Photo (a dim picture from your PC) and Last screen (a dim picture of what was on
your screen just before the display started, with its time; it is kept in memory
only and never saved).

## Reminders

Use the **Reminders** tab:

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
TV on or off and doesn't play sound. Turning the TV off and on stays your choice.
