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
and New Year choices produce one scene. When Russia is selected, its evergreen
New Year scene has a one-point product priority over the CA/KR arc scene; this
is a visual choice, not a ranking of cultures. Orthodox Christmas still wins on
January 7. Dynamic says Today/Tomorrow with a country label and never calls these
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
  - Korean 3D scenes (reviewed 2026-11-10 for
    [#628](https://github.com/8roundshock/living-room-display/issues/628) to
    [#631](https://github.com/8roundshock/living-room-display/issues/631); the
    tickets carry the full notes and the avoid lists). Placement, palette, counts
    and the absence of lettering are design choices.
  - Seollal: kites are flown from the twelfth lunar month to the first full moon
    ([folk encyclopedia, kite flying](https://folkency.nfm.go.kr/topic/detail/4466));
    the bangpae-yeon is a rectangle of hanji with a round hole about a third of
    its length, five spars with none along the foot, a bow string and no tail
    ([National Folk Museum webzine](https://webzine.nfm.go.kr/2025/12/27/%ED%95%9C%EA%B5%AD%EC%9D%98-%EC%97%B0-%EA%B7%B8-%EB%8F%85%ED%8A%B9%ED%95%9C-%EB%B0%A9%ED%8C%A8%EC%97%B0/),
    [Encyclopedia of Korean Culture, 연](https://encykorea.aks.ac.kr/Article/E0036663));
    the gaori-yeon is the diamond kite with a tail
    ([folk encyclopedia](https://folkency.nfm.go.kr/topic/detail/10088)). Lucky
    pouches come round (duru-jumeoni) and eared (gwi-jumeoni)
    ([folk encyclopedia](https://folkency.nfm.go.kr/topic/detail/4023),
    [Encyclopedia of Korean Culture](https://encykorea.aks.ac.kr/Article/E0053228)).
    Yut sticks are rounded on the back and flat on the belly
    ([folk encyclopedia](https://folkency.nfm.go.kr/topic/detail/1595),
    [Encyclopedia of Korean Culture](https://encykorea.aks.ac.kr/Article/E0042794));
    no fixed mark is sourced, so the backs are plain. Red envelopes are described
    as the Chinese custom ([korea.kr](https://www.korea.kr/news/issueQAView.do?newsId=148809200))
    and are not drawn.
  - Chuseok: the full-moon harvest festival
    ([Encyclopedia of Korean Culture, 추석](https://encykorea.aks.ac.kr/Article/E0057862)).
    Songpyeon are half-moon rice cakes steamed on pine needles
    ([National Folk Museum](https://www.nfm.go.kr/kids/elecontents/view.do?topic=84),
    [Korean Food Promotion Institute](https://hansik.or.kr/magazines/list/magazineDetail/15/2763?menuSn=));
    they are steamed in a siru or on a chaeban, then picked clean and oiled
    ([Gimje](https://gimje.grandculture.net/gimje/toc/GC02601558),
    [Gumi](https://gumi.grandculture.net/gumi/toc/GC01202611)); the chaeban is a
    flat rimless woven tray ([Encyclopedia of Korean Culture](https://encykorea.aks.ac.kr/Article/E0055596)).
    Showing them on their needles on the tray joins the two methods and is a
    design choice. Persimmon, chestnut and jujube are the autumn fruits named for
    the day; persimmons are still turning colour on a leafy branch
    ([Encyclopedia of Korean Culture, 감나무](https://encykorea.aks.ac.kr/Article/E0000705),
    [Rural Development Administration](https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=2020)),
    and rice is ripening, not yet cut
    ([RDA rice harvest guide](https://nongsaro.go.kr/portal/ps/psz/psza/contentSub.ps?cntntsNo=207071&menuId=PS00078)).
    Mooncakes and pampas grass with dumplings belong to the Chinese and Japanese
    festivals and are not drawn; neither is a rabbit in the moon.
  - Buddha's Birthday: lanterns are made from bamboo and hanji
    ([Korea Heritage Service](https://www.heritage.go.kr/heri/html/HtmlPage.do?pg=%2Funesco%2FCulHeritage%2FCulHeritage_21.jsp&pageNo=1_3_2_0));
    the lotus lantern is an eight-sided frame covered in white paper, then rows of
    creased dyed petals with hand-twisted tips, and green leaves at the bottom
    ([Dongguk University Buddhist culture portal](https://buddhaland.dongguk.edu/article?dataId=KBA0001251),
    [KTO](https://korean.visitkorea.or.kr/detail/rem_detail.do?cotid=9411b811-4fe9-4831-9869-554491e40d82));
    Korean lanterns took many shapes, the eight-sided palmo-deung among them
    ([Encyclopedia of Korean Culture, 관등놀이](http://encykorea.aks.ac.kr/Contents/Item/E0004800)).
    Hanging the blank tag beneath a lantern follows common practice and is not
    separately sourced. The red-and-blue cheongsa-chorong is a wedding lantern
    ([Encyclopedia of Korean Culture](https://encykorea.aks.ac.kr/Article/E0056464))
    and is not drawn; lotus blooms in July and August
    ([Encyclopedia of Korean Culture, 연꽃](https://encykorea.aks.ac.kr/Article/E0036723)),
    so no living lotus is drawn either.
  - Birthday with Korean accents: seaweed soup is the birthday food
    ([Encyclopedia of Korean Culture, 미역국](https://encykorea.aks.ac.kr/Article/E0019982),
    [생일](https://encykorea.aks.ac.kr/Article/E0027532)); the soban is the small
    lacquered table of the home and the Naju type has a rimmed rectangular top,
    an apron, slender legs and a rail at mid-leg
    ([소반](https://encykorea.aks.ac.kr/Article/E0030068),
    [나주반](https://encykorea.aks.ac.kr/Article/E0011478)); soup bowls are brass
    in the cold months and the spoon has a long straight handle
    ([대접](https://encykorea.aks.ac.kr/Article/E0032543),
    [숟가락](https://encykorea.aks.ac.kr/Article/E0031662)). A bojagi is the cloth
    made to wrap and carry, tied by its own corners
    ([보자기](https://encykorea.aks.ac.kr/Article/E0023523),
    [Asian Art Museum](https://education.asianart.org/resources/making-bojagi-with-artist-youngmin-lee/));
    jogakbo is pieced from scraps with flat sealed seams
    ([조각보](https://encykorea.aks.ac.kr/Article/E0079777),
    [V&A](https://www.vam.ac.uk/articles/jogakbo-traditional-korean-patchwork));
    saekdong is the stripe of children's festive sleeves
    ([folk encyclopedia](https://folkency.nfm.go.kr/topic/detail/12028),
    [색동](https://encykorea.aks.ac.kr/Article/E0027478)) and appears only as one
    lining. Serving the cake on a soban is a design choice, not a claimed custom;
    nothing of a first birthday, a wedding or a rite is drawn.
- Russia: [State Archive tree history](https://statearchive.ru/1485) distinguishes
  secular New Year evergreens from Christmas; [Ethnographic Museum Christmas](https://ethnomuseum.ru/collections/ethnocalendar/january/sukkot6/)
  supports the star; [Pascha](https://ethnomuseum.ru/collections/ethnocalendar/april/pasha-svetloe-hristovo-voskresenie/)
  supports eggs; [Leningradsky museum](https://lenmuseum.len-kultura.ru/item/712823)
  supports mimosa for March 8. Maslenitsa uses original warm rings/ribbon curves,
  without fire/effigies. Customs vary; no scene implies universal participation.
