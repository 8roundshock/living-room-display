# Display calendar

The calendar behind Dynamic holiday cards and whole-screen themes is offline and
curated. Choose Canada, Korea and/or Russia independently; no city coordinates or
calendar preferences go to a holiday service. Holiday cards are separately opted
in under Dynamic and share the theme calendar selections even with themes off.
Dates follow the display computer's civil date. This is a decorative observance
calendar, **not a statutory employment, school, tax or bank-closure schedule**.
Canadian provincial/territorial coverage is tracked separately in #578.

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

Christmas begins November 15 and runs through Christmas; Canada's Boxing Day keeps
that mood on December 26. Halloween begins October 15 and ends after October 31.
New Year begins December 27 and runs through January 1, or January 8 for Russia.
Orthodox Christmas takes priority on January 7. Easter, Thanksgiving, Seollal and
Chuseok have a seven-day approach; Canada Day has two days. Seollal and Chuseok
include the ordinary day before and after their central dates. Buddha's Birthday
has a three-day approach and Women's Day two days. These are authored display
windows, not official celebration seasons. November 15 is a balanced product
default; Canadian museum Christmas programs have varied starts and ends.
No theme lingers indefinitely after its window.

Orthodox Easter uses the Julian ecclesiastical calculation converted to the
Gregorian civil date, including the changing century offset (14 days from 2100,
not a hardcoded 13). Its seven-day approach uses restrained spring scenery.
Maslenitsa uses that same date authority: the Monday 55 days before Pascha through
the Sunday 49 days before it, with no extra approach or trailing days.

`HOLIDAY_SCENE_POLICY` in `src/shared/theme-registry.ts` explicitly selects major,
card-only and quiet roles; a new/unlisted record defaults to card-only. Canada
has Christmas, New Year, Halloween, Thanksgiving, Canada Day and Easter scenes;
Korea additionally has Seollal, Chuseok and Buddha's Birthday; Russia has its
evergreen New Year, Orthodox Christmas, Maslenitsa, Pascha and Women's Day.
Other dates retain accurate cards without replacing the seasonal scene. This
presentation tier is not a judgment of cultural importance.

The selected calendars' exact quiet dates are Canada's Good Friday, September
30 and November 11, Korea's June 6 and Russia's May 9. They remove festive
geometry and use subdued seasonal or factual weather geometry. They do not add
candles, poppy particles, national symbols or sound. March 1 and February 23
retain their existing factual card classification but are card-only visually.
Quiet comes first; a major holiday on its central date then beats an ongoing
major window, followed by anticipation. Explicit priority, distance and stable
id resolve remaining ties independent of checkbox ordering. Shared Christmas
and New Year choices produce one scene. Dynamic says Today/Tomorrow with a country label and never calls these
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
  provides an astronomical cross-check and labels its data preliminary. The
  [Korea AeroSpace Administration 2027 release](https://m.korea.kr/briefing/pressReleaseView.do?newsId=156768474)
  is the published-calendar reference. It includes the 2026 Labour Day and
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

## Cultural art references

Reviewed 2026-11-04 by separate cultural research workers. Recheck when adding a
scene, changing a date/window, or disputing a label or motif. These sources
support cultural associations; palettes and anticipation windows are design
choices. All shipped vectors are original; no source prose or museum images ship.

- Canada: [McCord Stewart Christmas windows](https://www.musee-mccord-stewart.ca/en/exhibitions/christmas-mechanical-window-displays/)
  demonstrates varied institution-specific seasons; [Ingenium autumn weekends](https://ingenium.ca/agriculture/en/events/amazing-autumn-weekends/)
  supports pumpkins/leaves; [official Canadian symbols](https://www.canada.ca/en/canadian-heritage/services/official-symbols-canada.html)
  supports the botanical maple leaf. [Veterans Affairs remembrance](https://www.veterans.gc.ca/en/remembrance/commemorative-events)
  and [Truth and Reconciliation](https://www.canada.ca/en/canadian-heritage/campaigns/national-day-truth-reconciliation.html)
  inform respectful exact-day constraints. Avoid generic Indigenous art or
  borrowed Ukrainian pysanky patterns in a pan-Canadian scene.
- Korea: [KTO Seollal customs](https://english.visitkorea.or.kr/svc/contents/contentsView.do?menuSn=219&vcontsId=220321)
  and [National Folk Museum games](https://www.nfm.go.kr/kids/user/content.do?pageId=PAGE_000000000000051)
  support the open-centred rectangular bangpae kite;
  [KTO Chuseok](https://english.visitkorea.or.kr/svc/contents/contentsView.do?menuSn=219&vcontsId=1593350)
  supports the full harvest moon and half-moon songpyeon;
  [UNESCO Yeondeunghoe](https://ich.unesco.org/en/RL/yeondeunghoe-lantern-lighting-festival-in-the-republic-of-korea-00882)
  supports lotus lanterns. The holiday scene does not claim a live parade date
  or depict flying sky-lantern releases.
- Russia: [State Archive tree history](https://statearchive.ru/1485) distinguishes
  secular New Year evergreens from Christmas; [Ethnographic Museum Christmas](https://ethnomuseum.ru/collections/ethnocalendar/january/sukkot6/)
  supports the star; [Pascha](https://ethnomuseum.ru/collections/ethnocalendar/april/pasha-svetloe-hristovo-voskresenie/)
  supports eggs; [Leningradsky museum](https://lenmuseum.len-kultura.ru/item/712823)
  supports mimosa for March 8. Maslenitsa uses original warm rings/ribbon curves,
  without fire/effigies. Customs vary; no scene implies universal participation.
