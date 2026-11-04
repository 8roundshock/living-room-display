# Display calendar

The calendar behind Dynamic holiday cards and whole-screen themes is offline and
curated. Choose Canada, Korea and/or Russia independently; no city coordinates or
calendar preferences go to a holiday service. Holiday cards are separately opted
in under Dynamic and share the theme calendar selections even with themes off.
Dates follow the display computer's civil date. This is a decorative observance
calendar, **not a statutory employment, school, tax or bank-closure schedule**.

`src/shared/holidays.ts` is the authority. It computes recurring dates for
1900–2199 and retains at most twelve calculated years in memory. Gregorian rules
do not need a yearly data download. Future legal changes can require a source
update; the app never invents replacement days or claims an official feed.

## Coverage

The bundled set contains 43 national, cultural and commemorative observances.

| Calendar | Public dates and selected observances |
| --- | --- |
| Canada | New Year, Good Friday, Easter Monday, Victoria Day, Canada Day, Labour Day, Truth and Reconciliation, Thanksgiving, Remembrance Day, Christmas and Boxing Day; selected cultural/commemorative dates are Valentine's Day, Flag Day, National Indigenous Peoples Day, Easter and Halloween. |
| Korea | New Year, Independence Movement Day, Labour Day, Children's Day, Memorial Day, Constitution Day, Liberation Day, National Foundation Day, Hangeul Day and Christmas; lunar Seollal, Buddha's Birthday and Chuseok; selected traditional dates Jeongwol Daeboreum, Dano and Chilseok. |
| Russia | New Year holidays, Orthodox Christmas, Defender of the Fatherland Day, International Women's Day, Spring and Labour Day, Victory Day, Russia Day and Unity Day; selected cultural observances are Old New Year, Orthodox Easter (Pascha) and Maslenitsa. |

Canadian provincial/territorial dates, substitute weekdays, one-off election or
government holidays and other regional or religious calendars are not included.
Calendar selections describe culture and
observances; they do not infer a person's religion, nationality or location.
Observance records distinguish public, cultural and commemorative dates.

Korean lunar conversion uses the runtime's **Dangi** calendar, checked explicitly
against a known Korean date. It must never substitute the Chinese calendar:
Seollal 2027 is February 7, while the calendars can disagree. A bounded year scan
uses `Asia/Seoul` and regular lunar months only, skipping leap-month suffixes.
If the runtime lacks verified Dangi support, lunar events are omitted and Dynamic
reports that limitation; fixed Korean dates remain available. Node and actual
browser tests cover the independently published 2026/2027 dates. Later years are
computed, not copied from a short table that eventually expires.

## Timing and priorities

Seasons are meteorological: March/June/September/December boundaries in the
northern hemisphere, reversed in the southern hemisphere. The theme uses the
weather location's latitude; missing/invalid latitude falls back to north.
Seasonal scenery supplies the year-round base, including when no holiday is near.

Christmas begins December 1 and runs through Christmas; Canada's Boxing Day keeps
that mood on December 26. Halloween begins October 15 and ends after October 31.
New Year begins December 27 and runs through January 1, or January 8 for Russia.
Orthodox Christmas takes priority on January 7. Easter, Thanksgiving, Seollal and
Chuseok have a seven-day approach; Canada Day has two days. Seollal and Chuseok
include the ordinary day before and after their central dates. Other observances
appear on their day. No theme lingers indefinitely after its window.

Orthodox Easter uses the Julian ecclesiastical calculation converted to the
Gregorian civil date, including the changing century offset (14 days from 2100,
not a hardcoded 13). Its seven-day approach uses restrained spring scenery.
Maslenitsa uses that same date authority: the Monday 55 days before Pascha through
the Sunday 49 days before it, with no extra approach or trailing days.

An actual observance beats an approaching one. An actual quiet commemoration
comes first, then a holiday on its central day beats a generic ongoing festival
window (for example Women's Day during Maslenitsa). Explicit priority, distance
from the central date and stable id then
resolve overlaps, independent of checkbox ordering. Remembrance, Truth and
Reconciliation and memorial dates use quiet remembrance treatment, never party
effects. Dynamic says Today/Tomorrow with a country label and never calls these
official alerts or promises a long weekend. Weather theme precedence is decided
by the separate theme resolver, using fresh, relevant forecast data.

## Sources and reuse

Reviewed November 4, 2026. Bundled names and date rules are factual calendar data;
no source prose, images, live scraping or remote asset dependency is bundled.

- [Canada Revenue Agency public holidays](https://www.canada.ca/en/revenue-agency/services/tax/public-holidays.html)
  supplies the federal/CRA date reference, including movable 2026 examples.
- [Canadian Heritage commemorative dates](https://www.canada.ca/en/canadian-heritage/services/important-commemorative-days.html)
  identifies the selected national commemorations.
- [Korea Astronomy and Space Science Institute 2026 calendar](https://astro.kasi.re.kr/kor/life/post/calendarData?year=2026)
  and the [Korea AeroSpace Administration 2027 release](https://m.korea.kr/briefing/pressReleaseView.do?newsId=156768474)
  establish the Korean fixtures. The 2027 release includes the 2026 Labour Day and
  Constitution Day additions; its factual text is attributed under Korea Open
  Government License Type 1. Lunar reference dates are February 17/May 24/September
  25 in 2026 and February 7/May 13/September 15 in 2027.
- [Bank of Russia holiday list](https://www.cbr.ru/other/holidays/)
  identifies the recurring national dates. Its annual transferred days are not
  reproduced or predicted.
- [US Naval Observatory Easter algorithm](https://aa.usno.navy.mil/faq/easter)
  documents the Oudin Gregorian calculation used for Canada's Easter-related dates.
- [Orthodox Church in America Paschal cycle](https://www.oca.org/fs/paschal-cycle)
  supplies independent Pascha and Cheesefare Sunday reference dates for 2026–2030.
  [dateutil's Easter documentation](https://dateutil.readthedocs.io/en/stable/easter.html)
  describes the Julian calculation with conversion to Gregorian dates; this
  application implements the short calendar arithmetic without a new dependency.
- [Russian Ethnographic Museum Maslenitsa entry](https://ethnomuseum.ru/collections/ethnocalendar/february/maslenica-maslenichnaya-nedelya-syrnaya-nedelya/)
  identifies the cultural festival and its February 16–22, 2026 week, used as an
  independent full-window fixture.

This calendar adds no capture, installed-app, network or native-lifecycle behavior.
