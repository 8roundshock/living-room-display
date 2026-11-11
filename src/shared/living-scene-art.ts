/** Original connected scene geometry. Identity, palette and policy stay in theme-registry.ts.
 * Coordinates are authored SVG units; bounds include stroke and off-frame roots.
 * The renderer owns shared choreography, placement, reading masks and finite retreats. */
import type { ThemeTone } from './theme-registry.ts';
import { LIVING_CELEBRATION_ART } from './living-celebration-art.ts';

export interface ScenePath {
  d: string;
  tone: ThemeTone;
  /** Local fill opacity; omitted means no fill. */
  fill?: number;
  /** Stroke width in source SVG units; zero means no stroke. */
  stroke?: number;
  opacity?: number;
}
export interface SceneArtGroup {
  id: string;
  paths: readonly ScenePath[];
  motion: 'still' | 'grass' | 'branch' | 'hanging' | 'drift' | 'float';
  pivot: readonly [number, number];
  /** Conservative source geometry, including control points and stroke extent. */
  bounds: readonly [x: number, y: number, width: number, height: number];
  /** Complete lower growth for shallow reading clearance, sharing this group's root and wind. */
  compact?: { paths: readonly ScenePath[]; bounds: readonly [x: number, y: number, width: number, height: number] };
  phase?: number;
}
export interface ScenePatch {
  id: string;
  edge: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'left' | 'right';
  /** Fraction of viewport width. */
  width: number;
  /** Fraction of the viewport's shorter side. */
  height: number;
  viewBox: readonly [width: number, height: number];
  /** Top-left of the viewBox in authored units when a patch crops a larger drawing. */
  origin?: readonly [x: number, y: number];
  depth: 'far' | 'habitat';
  opacity?: number;
  groups: readonly SceneArtGroup[];
}
export interface ScenePassageArt {
  paths: readonly ScenePath[];
  viewBox: readonly [width: number, height: number];
  kind: 'seed' | 'petal' | 'leaf' | 'flake' | 'ribbon';
}
export interface LivingSceneArt {
  patches: readonly ScenePatch[];
  passage: ScenePassageArt;
  /** Authored seasonal air in place of detached drifting forms; not a weather claim. */
  air?: 'snow';
}

/** These are newly drawn low plants, not cropped or flattened tall plants. Their
 * wider curved leaves preserve a meadow silhouette when reading ink is nearby. */
const SUMMER_COMPACT = {
  rear: {
    bounds: [-8, 116, 1016, 87],
    paths: [
      { d: 'M12 198C30 165 62 148 96 145C63 158 47 180 42 199Z M63 198C71 160 59 137 42 123C75 138 94 170 88 200Z M112 199C133 169 162 161 189 167C155 172 144 186 139 200Z', tone: 0, fill: .54, stroke: 0 },
      { d: 'M214 198C229 170 252 155 287 150C254 167 245 184 241 200Z M270 199C282 157 276 133 257 119C290 132 308 163 301 200Z M311 200C332 175 350 170 377 174C351 181 344 192 341 200Z', tone: 0, fill: .43, stroke: 0 },
      { d: 'M407 199C417 165 451 143 483 143C449 156 436 181 434 200Z M460 200C472 162 462 139 442 126C476 136 495 168 487 201Z M506 199C528 171 559 166 587 171C554 177 542 192 539 200Z', tone: 0, fill: .58, stroke: 0 },
      { d: 'M617 200C630 164 654 141 689 134C657 153 645 178 643 201Z M675 200C687 170 684 145 668 127C697 145 711 172 702 201Z M725 200C747 175 771 171 799 176C765 184 756 195 754 201Z', tone: 0, fill: .48, stroke: 0 },
      { d: 'M824 199C839 168 870 150 900 151C867 163 854 184 850 201Z M883 200C897 163 889 136 874 120C906 141 922 171 914 201Z M938 200C956 178 976 173 1000 177C974 186 967 195 965 201Z', tone: 0, fill: .41, stroke: 0 },
      { d: 'M45 194Q63 171 85 167 M239 194Q256 175 278 168 M434 194Q451 171 474 162 M642 195Q661 170 680 162 M851 195Q869 173 891 167', tone: 1, stroke: 1.1, opacity: .39 },
    ],
  },
  west: {
    bounds: [-8, 104, 330, 99],
    paths: [
      { d: 'M31 198C43 168 71 153 104 152C73 162 58 183 55 200Z M67 198C72 164 54 142 26 132C62 134 87 165 83 200Z', tone: 0, fill: .79, stroke: .7 },
      { d: 'M107 199C121 156 145 135 181 129C146 145 132 178 131 201Z M144 200C151 168 143 148 122 136C151 142 170 169 167 201Z', tone: 0, fill: .67, stroke: .7 },
      { d: 'M190 200C203 164 231 147 265 149C232 159 219 183 216 201Z M244 199C259 178 285 170 315 176C287 180 274 191 272 201Z', tone: 0, fill: .83, stroke: .7 },
      { d: 'M5 198Q26 181 48 189L28 201Z M98 200C86 181 72 177 58 182C79 188 83 198 83 201Z M213 201Q238 183 259 191L240 202Z', tone: 2, fill: .34, stroke: 0 },
      { d: 'M53 195Q65 169 89 160 M81 196Q78 161 49 144 M128 195Q138 157 162 143 M214 197Q226 167 248 158', tone: 0, stroke: 1.25, opacity: .90 },
      { d: 'M158 198C177 165 206 145 215 111 M220 199C242 179 270 168 284 147', tone: 1, stroke: 1.45, opacity: .86 },
      { d: 'M215 111Q204 106 199 115Q204 123 213 122Z M211 128Q222 117 229 123Q227 133 215 137Z M204 144Q191 136 187 145Q193 153 201 153Z M284 147Q273 142 268 151Q273 159 281 157Z M275 164Q284 153 291 160Q289 169 279 172Z', tone: 1, fill: .76, stroke: .65 },
    ],
  },
  middle: {
    bounds: [315, 104, 328, 100],
    paths: [
      { d: 'M340 200C355 174 385 160 414 164C384 172 369 189 365 201Z M384 200C392 165 376 145 353 137C384 141 407 170 405 202Z', tone: 0, fill: .69, stroke: .7 },
      { d: 'M431 200C444 161 474 137 506 133C472 149 457 177 456 202Z M471 200C479 165 469 142 449 128C479 141 499 169 494 202Z', tone: 0, fill: .85, stroke: .65 },
      { d: 'M516 201C531 173 553 158 586 155C553 167 543 188 541 202Z M562 200C582 179 610 174 637 181C608 183 593 194 589 202Z', tone: 0, fill: .71, stroke: .75 },
      { d: 'M321 199Q342 184 365 191L345 202Z M437 201C421 183 403 180 386 185C407 191 414 199 414 203Z M543 201Q565 186 585 192L566 203Z', tone: 2, fill: .31, stroke: 0 },
      { d: 'M363 197Q380 178 399 172 M403 198Q401 164 375 151 M453 198Q466 161 490 146 M490 197Q493 166 472 148 M539 198Q551 175 571 165', tone: 0, stroke: 1.25, opacity: .91 },
      { d: 'M484 200C507 166 539 144 547 113 M536 199C548 179 545 163 534 151', tone: 1, stroke: 1.45, opacity: .86 },
      { d: 'M547 113Q536 107 531 116Q535 125 544 124Z M543 131Q554 120 561 127Q559 137 547 140Z M535 147Q523 139 519 149Q524 156 532 156Z M534 151Q523 146 520 154Q524 163 535 160Z M539 169Q529 164 528 172Q535 178 542 176Z', tone: 1, fill: .79, stroke: .7 },
    ],
  },
  east: {
    bounds: [659, 116, 342, 88],
    paths: [
      { d: 'M680 200C699 173 723 166 751 170C719 177 707 192 704 202Z M722 201C729 170 717 151 695 142C725 147 747 173 744 202Z', tone: 0, fill: .74, stroke: .75 },
      { d: 'M770 201C784 163 809 146 845 142C811 158 798 184 796 203Z M809 201C819 169 809 149 792 136C820 147 841 174 835 203Z', tone: 0, fill: .85, stroke: .65 },
      { d: 'M855 202C871 176 896 165 925 169C893 179 883 193 881 203Z M904 201C926 182 957 179 994 185C956 188 941 199 939 203Z', tone: 0, fill: .65, stroke: .75 },
      { d: 'M664 201Q689 187 711 195L693 203Z M801 202Q780 185 758 190Q780 196 781 203Z M884 202Q908 189 930 196L912 203Z', tone: 2, fill: .31, stroke: 0 },
      { d: 'M701 199Q718 180 740 177 M741 198Q739 170 717 155 M793 198Q805 167 830 153 M832 199Q838 173 815 150 M880 199Q894 180 912 176', tone: 0, stroke: 1.2, opacity: .88 },
      { d: 'M831 201C847 171 874 153 881 124', tone: 1, stroke: 1.45, opacity: .84 },
      { d: 'M881 124Q870 118 865 126Q869 135 878 134Z M877 141Q888 130 895 138Q892 148 881 151Z M870 157Q857 150 853 159Q858 168 867 167Z', tone: 1, fill: .71, stroke: .7 },
    ],
  },
  side: {
    bounds: [-7, 114, 455, 90],
    paths: [
      { d: 'M21 201C39 178 66 166 96 171C65 179 52 193 49 203Z M77 202C87 169 78 149 57 137C87 150 108 178 103 203Z M133 202C151 177 175 167 204 172C174 180 160 195 157 203Z', tone: 0, fill: .59, stroke: .7 },
      { d: 'M201 202C214 169 241 147 275 141C243 158 228 186 226 203Z M244 202C254 173 247 153 228 138C256 153 277 177 272 203Z', tone: 0, fill: .80, stroke: .7 },
      { d: 'M296 203C313 177 338 165 369 169C339 177 325 195 322 203Z M354 203C376 185 405 181 442 187C406 190 390 200 386 203Z', tone: 0, fill: .65, stroke: .7 },
      { d: 'M48 199Q65 181 84 177 M101 200Q102 173 80 152 M224 199Q237 169 260 152 M270 200Q272 175 250 154 M320 201Q336 182 355 176', tone: 0, stroke: 1.15, opacity: .90 },
      { d: 'M284 201C301 173 333 150 341 122', tone: 1, stroke: 1.35, opacity: .82 },
      { d: 'M341 122Q330 116 325 124Q329 133 338 132Z M337 139Q348 128 355 135Q352 146 342 148Z M330 155Q318 148 314 156Q318 165 327 165Z', tone: 1, fill: .69, stroke: .65 },
    ],
  },
} satisfies Record<string, NonNullable<SceneArtGroup['compact']>>;

/** A low meadow, not a row of tufts: roots share irregular banks below the frame,
 * foreground blades cross their darker neighbours, and open intervals separate
 * the three wind segments. Warm seedheads are attached to long curved stems. */
const SUMMER_MEADOW: LivingSceneArt = {
  patches: [
    {
      id: 'summer-distant-growth', edge: 'bottom-left', width: .74, height: .145,
      viewBox: [1000, 180], depth: 'far', opacity: .48,
      groups: [{
        id: 'summer-rear-bank', motion: 'grass', pivot: [410, 190], phase: .18,
        bounds: [-8, 30, 1016, 172],
        compact: SUMMER_COMPACT.rear,
        paths: [
          { d: 'M2 196C26 158 43 141 40 99C57 125 49 164 45 195Z M51 195C56 140 80 109 112 83C85 124 76 156 77 197Z M104 196C118 141 115 101 95 62C133 103 142 148 129 197Z', tone: 0, fill: .56, stroke: 0 },
          { d: 'M171 194C180 148 217 110 253 103C211 128 208 164 204 197Z M236 195C242 140 255 101 282 67C266 112 267 157 263 197Z M278 198C290 148 303 112 343 86C315 122 309 163 307 198Z', tone: 0, fill: .45, stroke: 0 },
          { d: 'M370 196C380 155 365 118 337 91C378 105 400 150 400 198Z M419 199C419 136 452 92 488 55C464 103 449 150 449 199Z M483 198C499 156 511 120 503 84C530 118 522 158 512 199Z', tone: 0, fill: .58, stroke: 0 },
          { d: 'M581 199C596 163 608 129 604 90C628 126 622 165 615 199Z M643 198C651 149 685 115 720 99C685 132 678 167 671 199Z M726 199C746 140 740 94 718 54C759 103 773 155 756 199Z', tone: 0, fill: .50, stroke: 0 },
          { d: 'M813 198C818 157 805 130 786 108C820 125 841 162 837 198Z M863 196C873 135 901 78 944 34C909 89 898 150 891 199Z M925 199C943 154 972 139 1000 141C965 151 955 172 951 198Z', tone: 0, fill: .42, stroke: 0 },
          { d: 'M52 193Q89 155 139 160 M251 192Q281 154 326 157 M451 193Q487 163 532 168 M745 193Q781 156 825 169 M890 192Q931 168 977 179', tone: 1, stroke: 1.1, opacity: .42 },
        ],
      }],
    },
    {
      id: 'summer-meadow', edge: 'bottom-left', width: .69, height: .18,
      viewBox: [1000, 180], depth: 'habitat',
      groups: [
        {
          id: 'summer-west-clump', motion: 'grass', pivot: [150, 190], phase: 0,
          bounds: [-8, 12, 330, 190],
          compact: SUMMER_COMPACT.west,
          paths: [
            // Broad blades taper to a single curved tip; their roots leave no straight baseline.
            { d: 'M48 196C52 153 43 127 19 110C53 121 69 152 66 198Z M74 197C80 146 105 112 136 95C108 123 97 162 96 198Z', tone: 0, fill: .78, stroke: .65 },
            { d: 'M106 197C111 139 101 102 78 74C115 100 132 145 127 199Z M145 198C141 143 156 91 183 55C166 100 163 155 166 199Z', tone: 0, fill: .66, stroke: .7 },
            { d: 'M172 197C184 145 216 116 257 103C216 129 203 163 198 199Z M213 197C222 160 246 144 280 140C249 151 240 176 238 198Z', tone: 0, fill: .83, stroke: .7 },
            { d: 'M13 198C35 170 49 160 69 157C45 174 39 187 35 199Z M116 196C98 169 77 162 60 165C84 175 91 187 92 198Z M269 198C280 172 295 163 316 164C296 174 290 187 289 200Z', tone: 2, fill: .34, stroke: 0 },
            { d: 'M63 193Q64 147 39 127 M93 193Q97 142 120 116 M123 195Q125 135 98 102 M162 194Q150 128 174 80 M194 195Q207 148 236 125', tone: 0, stroke: 1.25, opacity: .90 },
            // One tall panicle and one lower bent seedhead, attached to this root group.
            { d: 'M139 196C157 132 197 89 204 22 M180 194C201 159 236 143 263 115', tone: 1, stroke: 1.45, opacity: .86 },
            { d: 'M204 22C194 24 191 31 199 35C205 32 207 27 204 22Z M201 38C187 36 183 43 192 49C200 48 203 43 201 38Z M200 53C208 42 217 44 215 53C210 59 205 59 200 53Z M194 62C181 59 176 67 184 72C191 72 195 68 194 62Z M191 76C199 64 207 66 205 75C202 81 196 82 191 76Z', tone: 1, fill: .76, stroke: .65 },
            { d: 'M263 115Q256 109 250 116Q253 124 261 121Z M249 129Q249 117 240 119Q236 128 245 133Z M237 139Q249 135 247 128Q237 125 232 135Z', tone: 1, fill: .64, stroke: .6 },
            { d: 'M3 184Q25 172 44 181 M219 186Q245 171 264 180', tone: 2, stroke: 1.2, opacity: .55 },
          ],
        },
        {
          id: 'summer-middle-clump', motion: 'grass', pivot: [480, 191], phase: .34,
          bounds: [315, 16, 328, 188],
          compact: SUMMER_COMPACT.middle,
          paths: [
            { d: 'M352 199C357 163 345 139 321 128C354 134 375 163 372 200Z M389 200C393 152 413 116 441 93C419 128 414 164 411 201Z', tone: 0, fill: .68, stroke: .7 },
            { d: 'M438 199C450 127 444 80 422 48C457 81 471 138 461 201Z M474 200C482 141 508 94 541 70C512 111 500 159 498 202Z', tone: 0, fill: .85, stroke: .65 },
            { d: 'M515 199C521 145 543 118 573 110C548 129 539 166 536 201Z M555 201C561 174 582 150 613 143C582 165 579 185 578 201Z', tone: 0, fill: .70, stroke: .75 },
            { d: 'M337 199C363 177 383 178 398 185L372 201Z M459 201C440 175 418 170 400 177C425 183 435 192 439 202Z M587 201C602 178 618 172 639 178C616 184 610 195 608 202Z', tone: 2, fill: .30, stroke: 0 },
            { d: 'M371 197Q371 159 345 144 M409 195Q409 142 430 114 M456 196Q467 119 438 76 M493 196Q497 130 522 100 M532 194Q537 148 557 129', tone: 0, stroke: 1.25, opacity: .91 },
            { d: 'M468 200C488 145 532 101 542 24 M505 200C511 160 495 134 482 115', tone: 1, stroke: 1.45, opacity: .86 },
            { d: 'M542 24C532 22 528 30 536 37C544 34 545 29 542 24Z M539 43C547 30 556 35 551 44C548 49 542 49 539 43Z M535 52C520 48 516 57 525 63C533 63 536 58 535 52Z M530 70C539 57 549 62 543 70C540 75 534 76 530 70Z M525 80C512 76 507 85 517 90C523 89 526 86 525 80Z', tone: 1, fill: .80, stroke: .7 },
            { d: 'M482 115Q470 112 470 121Q476 128 485 124Z M488 131Q477 126 476 135Q483 142 491 139Z', tone: 1, fill: .54, stroke: .6 },
          ],
        },
        {
          id: 'summer-east-clump', motion: 'grass', pivot: [815, 191], phase: .68,
          bounds: [659, 35, 342, 169],
          compact: SUMMER_COMPACT.east,
          paths: [
            { d: 'M694 200C704 171 691 150 665 143C698 140 724 166 718 201Z M736 201C740 157 757 122 784 106C760 138 759 171 758 201Z', tone: 0, fill: .73, stroke: .75 },
            { d: 'M783 200C792 152 779 116 754 93C791 112 813 155 806 202Z M824 202C832 144 859 107 894 89C863 119 850 164 849 202Z', tone: 0, fill: .85, stroke: .65 },
            { d: 'M864 202C871 168 894 145 925 137C898 156 888 180 887 202Z M914 201C932 173 958 166 995 171C957 175 945 190 939 202Z', tone: 0, fill: .64, stroke: .75 },
            { d: 'M683 200Q707 183 731 190L711 202Z M816 202C795 181 774 179 756 184C782 189 791 198 791 203Z M891 201Q914 184 934 191L912 202Z', tone: 2, fill: .31, stroke: 0 },
            { d: 'M716 197Q721 168 692 153 M754 195Q751 148 772 125 M802 197Q808 145 776 116 M845 196Q850 139 878 108 M882 197Q890 162 909 151', tone: 0, stroke: 1.2, opacity: .88 },
            { d: 'M803 201C818 153 850 109 871 45', tone: 1, stroke: 1.45, opacity: .84 },
            { d: 'M871 45Q860 37 854 47Q857 55 867 55Z M865 62Q875 48 883 55Q883 65 870 69Z M858 76Q845 68 840 78Q845 87 855 86Z M850 91Q862 80 869 87Q866 97 854 98Z', tone: 1, fill: .70, stroke: .7 },
          ],
        },
      ],
    },
    {
      id: 'summer-opposite-bank', edge: 'bottom-right', width: .25, height: .12,
      viewBox: [440, 180], depth: 'habitat', opacity: .80,
      groups: [{
        id: 'summer-side-growth', motion: 'grass', pivot: [284, 190], phase: .88,
        bounds: [-7, 28, 455, 176],
        compact: SUMMER_COMPACT.side,
        paths: [
          { d: 'M24 201C37 167 63 151 92 148C62 161 53 182 51 202Z M79 200C88 153 110 126 141 114C116 136 105 171 103 202Z M136 202C151 160 150 124 132 98C163 125 175 165 162 203Z', tone: 0, fill: .58, stroke: .7 },
          { d: 'M201 201C210 146 238 101 273 80C244 116 232 163 226 203Z M247 202C252 145 241 104 219 75C253 101 277 153 272 203Z', tone: 0, fill: .80, stroke: .7 },
          { d: 'M297 203C309 164 342 140 378 135C344 151 326 179 324 203Z M354 202C367 175 398 161 442 164C400 175 384 193 382 203Z', tone: 0, fill: .64, stroke: .7 },
          { d: 'M103 199Q104 153 127 131 M160 199Q169 153 148 125 M224 199Q231 139 254 110 M269 198Q266 141 243 112 M321 198Q333 162 356 151', tone: 0, stroke: 1.15, opacity: .90 },
          { d: 'M280 201C292 149 335 104 351 37', tone: 1, stroke: 1.35, opacity: .82 },
          { d: 'M351 37Q341 30 335 39Q338 48 348 46Z M347 55Q355 44 365 49Q366 60 352 63Z M342 69Q329 61 323 70Q327 79 338 79Z M335 85Q347 72 355 80Q352 91 340 93Z', tone: 1, fill: .68, stroke: .65 },
          { d: 'M4 198Q29 181 55 189 M170 196Q191 179 213 188 M288 195Q309 183 331 192', tone: 2, stroke: 1.1, opacity: .57 },
        ],
      }],
    },
  ],
  passage: {
    kind: 'seed', viewBox: [72, 38],
    paths: [
      { d: 'M8 30Q30 20 62 7 M30 22Q26 8 16 8Q13 18 30 22 M40 17Q38 4 48 3Q55 10 40 17 M49 13Q61 15 65 24Q57 29 49 13', tone: 1, stroke: 1.25 },
      { d: 'M11 29L3 31 M61 8L69 4', tone: 0, stroke: .9, opacity: .74 },
    ],
  },
};

/** New drawings use absolute M/L/C/Q/H/V/Z commands. Their control hull is a
 * conservative bound for the shared fitter, including every stroke and root. */
function drawing(paths: readonly ScenePath[]) {
  const xs: number[] = [], ys: number[] = [];
  for (const path of paths) {
    const inset = (path.stroke ?? 1.5) / 2;
    let x = 0, y = 0, startX = 0, startY = 0;
    const include = (px: number, py: number) => { xs.push(px - inset, px + inset); ys.push(py - inset, py + inset); };
    for (const segment of path.d.match(/[MLCQHVZ][^MLCQHVZ]*/g) ?? []) {
      const command = segment[0], points = segment.slice(1).match(/-?(?:\d*\.)?\d+/g)?.map(Number) ?? [];
      if (command === 'Z') { x = startX; y = startY; continue; }
      if (command === 'H' || command === 'V') {
        for (const point of points) { if (command === 'H') x = point; else y = point; include(x, y); }
      } else {
        for (let index = 0; index < points.length; index += 2) {
          x = points[index]!; y = points[index + 1]!; include(x, y);
          if (command === 'M' && index === 0) { startX = x; startY = y; }
        }
      }
    }
  }
  const left = Math.min(...xs), top = Math.min(...ys);
  return { paths, bounds: [left, top, Math.max(...xs) - left, Math.max(...ys) - top] as const };
}
const form = (id: string, motion: SceneArtGroup['motion'], pivot: SceneArtGroup['pivot'], paths: readonly ScenePath[], phase = 0, compact?: readonly ScenePath[]): SceneArtGroup =>
  ({ id, motion, pivot, ...drawing(paths), phase, ...(compact ? { compact: drawing(compact) } : {}) });
const line = (d: string, tone: ThemeTone, stroke = 1.6, opacity = .85): ScenePath => ({ d, tone, stroke, opacity });
const filled = (d: string, tone: ThemeTone, fill = .48, stroke = .8): ScenePath => ({ d, tone, fill, stroke });
const FLAKE_PASSAGE: ScenePassageArt = { kind: 'flake', viewBox: [60, 60], paths: [
  line('M30 4V56 M7 17L53 43 M7 43L53 17', 0),
  line('M22 11L30 19L38 11 M22 49L30 41L38 49 M12 29L20 25L19 16 M41 44L40 35L48 31', 2, 1.1),
] };
const RIBBON_PASSAGE: ScenePassageArt = { kind: 'ribbon', viewBox: [100, 50], paths: [
  line('M4 39C27 44 15 3 40 8C64 12 41 44 67 39Q83 37 96 13', 1, 1.5),
  line('M7 44C31 48 20 9 42 14 M66 45Q86 44 99 19', 2, .9),
] };
const WINTER_SCENE: LivingSceneArt = {
  patches: [
    { id: 'winter-distant-shoulder', edge: 'bottom-right', width: .62, height: .26, viewBox: [900, 214], depth: 'far', opacity: .43, groups: [form('winter-distant-drift', 'drift', [570, 205], [
      filled('M2 216C92 180 128 131 233 143C308 148 359 183 442 172C534 160 572 113 653 124C744 135 810 185 898 216L2 216Z', 0, .30, 0),
      line('M75 180C141 155 185 143 241 150 M505 164Q583 129 650 134 M718 150Q786 180 862 179', 2, 1.25, .55),
    ], .44)] },
    { id: 'winter-snow-shoulders', edge: 'bottom-left', width: .62, height: .27, viewBox: [900, 212], depth: 'habitat', groups: [form('winter-near-drift', 'drift', [310, 208], [
      filled('M4 214C60 200 85 139 151 137C218 135 254 182 318 183C385 184 421 159 475 164C522 169 559 194 640 214L640 222L4 222Z', 0, .34, 0),
      filled('M6 214C74 190 108 166 178 174C244 182 265 205 345 214L345 226L6 226Z', 2, .18, 0),
      line('M22 203Q72 180 108 149Q147 126 190 146 M230 167Q267 186 318 184 M379 178Q427 157 473 166', 0, 1.8, .82),
      line('M72 193Q120 175 165 182 M478 185Q519 189 550 201', 1, 1.2, .55),
    ], .12, [
      filled('M4 214C61 192 92 162 155 164C219 167 256 192 322 194C383 196 419 179 471 182C522 187 561 204 624 214L624 225L4 225Z', 0, .34, 0),
      line('M26 202Q84 166 151 168 M224 182Q275 197 322 196 M383 190Q432 179 475 186', 0, 1.8, .82),
      line('M68 207Q115 189 164 194 M471 201Q511 199 545 211', 2, 1.2, .55),
    ])] },
    { id: 'winter-twig-counterweight', edge: 'bottom-right', width: .23, height: .21, viewBox: [430, 260], depth: 'habitat', groups: [form('winter-frost-twigs', 'branch', [365, 280], [
      line('M369 281C334 209 285 157 219 97Q187 66 151 46 M304 184Q340 128 341 72 M260 139Q230 130 194 138 M221 99Q235 66 229 35', 1, 2.7),
      line('M340 110L318 89 M335 134L361 114 M284 162L292 123 M199 91L166 90 M184 74L181 49 M211 136L185 121 M229 57L247 40', 0, 1.4, .79),
      filled('M149 41L157 50L149 62L142 50Z M339 67L346 75L339 88L333 76Z M226 29L233 36L227 47L220 37Z', 2, .40, .9),
      line('M315 232Q344 222 368 231 M352 253Q381 237 412 248', 0, 1.5, .64),
    ], .65, [
      line('M369 280C333 229 279 200 215 184Q178 176 148 154 M289 221Q310 191 315 162 M242 197Q207 198 181 209', 1, 2.5),
      line('M203 181L190 160 M225 190L233 170 M307 180L291 169 M202 204L183 190', 0, 1.3),
      filled('M146 149L154 157L147 169L140 158Z M314 157L321 165L315 177L308 165Z', 2, .4, .9),
    ])] },
  ], passage: FLAKE_PASSAGE, air: 'snow',
};
const SNOW_SCENE: LivingSceneArt = {
  patches: [
    { id: 'snow-wind-piled-bank', edge: 'bottom-left', width: .73, height: .30, viewBox: [1000, 226], depth: 'habitat', groups: [form('snow-soft-bank', 'drift', [490, 215], [
      filled('M2 228C52 202 67 155 120 153C182 148 202 185 254 180C306 174 320 126 371 133C418 138 431 178 490 179C550 178 570 151 619 160C665 170 682 201 743 199C810 199 847 174 907 181Q963 185 998 228L2 228Z', 0, .33, 0),
      line('M9 195Q72 151 121 158 M263 179Q324 126 372 139 M441 174Q491 190 536 178 M780 199Q843 178 903 187', 0, 1.7, .81),
      filled('M136 207Q194 180 254 199Q287 208 317 220L98 224Z M568 211Q613 181 666 204L711 225L528 226Z', 1, .18, 0),
      line('M343 166L354 175L367 166 M349 170L349 183 M614 184L621 192L629 184', 2, 1, .70),
    ], .22, [
      filled('M2 228C54 200 92 176 136 177C183 176 209 201 254 198C308 192 334 167 376 172C425 179 451 202 494 202C550 198 581 181 623 188C684 197 700 219 760 215Q894 185 998 228L2 228Z', 0, .33, 0),
      line('M10 211Q83 175 137 181 M270 198Q331 169 377 177 M521 200Q579 180 627 193 M796 213Q882 194 945 210', 0, 1.7, .81),
    ])] },
    { id: 'snow-cropped-evergreen', edge: 'bottom-right', width: .28, height: .22, viewBox: [520, 270], depth: 'habitat', groups: [form('snow-needle-bough', 'branch', [540, 285], [
      line('M541 286C454 251 371 198 302 141Q242 93 164 64', 2, 2.8),
      filled('M438 237L405 178L437 203L459 174L454 220Z M370 193L336 133L366 159L386 130L385 181Z M301 142L261 89L295 111L309 82L318 146Z M233 101L196 54L229 78L240 53L252 115Z', 2, .39, .9),
      line('M397 210L358 183 M409 217L378 168 M342 169L303 148 M347 172L327 128 M268 121L233 111 M277 126L259 87 M211 89L173 77', 2, 1.3),
      filled('M400 178Q416 184 436 201L459 174L456 191Q438 216 412 194Z M335 133Q351 139 366 157L386 130L384 146Q371 171 347 151Z M261 89Q278 95 293 108L310 82L309 98Q296 121 273 107Z', 0, .43, .8),
      line('M474 258Q499 248 521 256 M445 269Q474 255 495 267', 1, 1.4, .67),
    ], .62, [
      line('M540 287C454 255 366 231 293 205Q239 187 191 160', 2, 2.8),
      filled('M440 250L405 212L437 226L455 201L456 249Z M365 230L331 191L364 208L381 184L382 229Z M290 205L258 169L290 184L302 161L308 211Z', 2, .40, .9),
      line('M406 214Q419 218 437 228L455 204 M331 194Q346 198 364 209L381 187 M258 172Q275 178 289 186L302 164', 0, 2, .83),
    ])] },
  ], passage: FLAKE_PASSAGE,
};

const PETAL_PASSAGE: ScenePassageArt = { kind: 'petal', viewBox: [80, 48], paths: [
  line('M8 34C19 7 47 4 65 13C63 35 38 47 8 34Z M9 34Q35 19 59 15', 1, 1.3),
  line('M27 29Q31 18 44 13', 2, .8, .72),
] };
const LEAF_PASSAGE: ScenePassageArt = { kind: 'leaf', viewBox: [92, 56], paths: [
  line('M8 43C19 12 43 1 78 8C74 36 46 54 8 43Z M3 48Q37 25 78 8 M31 32L30 19 M47 23L61 26', 0, 1.4),
] };
const SPRING_SCENE: LivingSceneArt = {
  patches: [
    { id: 'spring-distant-leaf-arc', edge: 'bottom-left', width: .72, height: .13, viewBox: [1000, 170], depth: 'far', opacity: .43, groups: [form('spring-rear-growth', 'branch', [-20, 197], [
      line('M-25 198C171 188 302 172 456 128Q623 82 815 112', 0, 2.1, .63),
      filled('M173 182Q182 151 222 144Q220 174 173 182Z M306 161Q343 123 391 125Q375 157 306 161Z M462 128Q471 97 513 88Q511 116 462 128Z M611 103Q652 77 687 89Q658 113 611 103Z M742 104Q767 123 804 126Q789 103 742 104Z', 0, .31, 0),
    ], .12)] },
    { id: 'spring-flowering-branch', edge: 'bottom-left', width: .67, height: .20, viewBox: [1000, 230], depth: 'habitat', groups: [form('spring-main-branch', 'branch', [-25, 260], [
      filled('M-30 260C116 208 265 188 416 124C509 85 597 68 708 72L709 76C589 72 512 92 419 131C264 196 118 214-30 269Z', 2, .50, 1.4),
      line('M209 207Q251 160 262 111 M367 150Q362 102 334 70 M493 101Q541 123 591 123 M617 75Q634 47 630 22', 2, 2.1),
      filled('M247 154Q210 153 203 126Q237 126 247 154Z M293 175Q303 140 343 130Q340 162 293 175Z M378 121Q408 93 440 103Q425 128 378 121Z M528 115Q544 144 576 146Q566 118 528 115Z M636 59Q664 35 692 44Q679 65 636 59Z', 0, .54, .8),
      filled('M262 111C245 104 241 87 253 84Q263 83 266 94C273 77 289 85 281 100Q291 105 282 117Q271 121 262 111Z M334 70C319 66 314 52 323 46Q333 43 338 55C347 42 361 53 350 64Q362 74 349 82Q339 84 334 70Z', 1, .67, 1),
      filled('M590 123C573 118 570 106 581 101Q591 97 596 109C605 96 618 107 607 119Q617 131 603 136Q591 138 590 123Z M630 24C620 14 624 5 635 8Q646 13 641 25Q639 32 630 24Z M707 74C696 66 698 54 710 54Q723 57 719 71Q716 81 707 74Z', 1, .61, .9),
      line('M260 104L272 103 M333 64L343 66 M590 117L601 120 M635 20L635 14', 2, 1.4),
      line('M86 234Q141 221 190 222 M737 95Q780 96 818 111', 0, 1.3, .57),
    ], .36, [
      filled('M-25 265C128 231 268 208 421 183Q568 157 708 163L708 168C560 163 421 190 272 215Q122 240-25 273Z', 2, .49, 1.3),
      line('M208 225Q240 199 249 172 M365 194Q364 167 341 148 M513 169Q547 194 588 194', 2, 1.9),
      filled('M263 214Q280 184 312 181Q308 207 263 214Z M402 187Q423 162 457 165Q443 190 402 187Z M598 165Q625 145 656 151Q639 173 598 165Z', 0, .54, .8),
      filled('M249 172C235 168 233 154 243 151Q253 149 257 159Q267 148 277 157Q279 169 266 173Q259 184 249 172Z M341 148Q320 144 325 132Q335 125 343 137Q356 126 363 138Q358 153 341 148Z M587 194Q570 187 578 176Q590 169 598 181Q611 176 613 187Q606 201 587 194Z', 1, .65, .9),
    ])] },
    { id: 'spring-right-buds', edge: 'bottom-right', width: .27, height: .15, viewBox: [500, 190], depth: 'habitat', opacity: .83, groups: [form('spring-right-spray', 'branch', [520, 225], [
      line('M520 226C403 201 325 151 255 124Q199 103 133 111 M341 173Q324 130 337 92 M236 118Q227 83 203 62', 2, 2.4),
      filled('M390 192Q361 161 367 140Q399 153 404 197Z M294 142Q265 151 247 173Q281 175 303 148Z M195 107Q163 80 137 87Q155 111 195 107Z', 0, .52, .8),
      filled('M337 92Q320 85 325 72Q337 64 343 80Q355 72 361 84Q355 99 337 92Z M203 62Q190 51 197 40Q209 35 214 49Q225 52 218 64Q213 70 203 62Z M133 111Q119 103 122 92Q137 83 144 98Q146 111 133 111Z', 1, .63, 1),
      line('M413 205Q449 195 483 206', 0, 1.2, .59),
    ], .71, [
      line('M520 228C402 211 303 184 208 164Q169 155 135 162 M340 195Q326 171 333 149', 2, 2.3),
      filled('M391 207Q368 181 369 169Q396 178 407 211Z M254 175Q231 194 205 192Q223 173 254 175Z', 0, .52, .8),
      filled('M333 149Q318 144 321 132Q332 126 340 137Q352 130 356 141Q348 155 333 149Z M135 162Q118 159 121 147Q134 139 142 151Q152 160 135 162Z', 1, .63, .9),
    ])] },
  ], passage: PETAL_PASSAGE,
};
const AUTUMN_SCENE: LivingSceneArt = {
  patches: [
    { id: 'autumn-rear-litter', edge: 'bottom-right', width: .70, height: .13, viewBox: [1000, 180], depth: 'far', opacity: .45, groups: [form('autumn-low-shadow', 'drift', [560, 205], [
      filled('M-18 207Q37 161 104 175Q79 204 17 213Z M160 207Q205 169 261 187Q221 217 160 207Z M327 213Q364 159 422 171Q414 204 327 213Z M482 215Q549 178 601 195Q559 223 482 215Z M688 210Q715 163 773 169Q760 205 688 210Z M829 213Q889 179 956 199L917 219Z', 1, .38, 0),
      line('M29 202Q57 186 84 183 M353 202Q380 182 406 181 M708 201Q730 182 752 178', 0, 1.1, .55),
    ], .10)] },
    { id: 'autumn-branch-leaf-bed', edge: 'bottom-left', width: .70, height: .19, viewBox: [1000, 220], depth: 'habitat', groups: [form('autumn-low-branch', 'branch', [-25, 255], [
      line('M-26 258C127 222 258 205 390 168Q518 132 679 131 M222 213Q248 177 251 142 M398 167Q424 195 472 204 M545 137Q565 103 554 77', 1, 2.7),
      filled('M248 142C216 141 195 118 196 88C230 93 256 109 248 142Z M246 140Q223 116 209 103 M550 80C550 48 577 27 610 29C606 60 586 82 550 80Z M556 76L596 41', 0, .58, 1),
      filled('M430 188C457 158 495 157 524 173C504 201 464 211 430 188Z M435 188L511 177 M326 191C303 164 309 138 338 120Q357 150 326 191Z M328 183L337 135', 2, .54, .9),
      filled('M66 228C95 196 130 196 157 213C137 239 101 248 66 228Z M69 228L142 217 M172 231C158 208 175 183 202 174Q217 207 172 231Z M177 223L199 188', 0, .56, 1),
      filled('M366 227C397 200 432 201 464 218C440 241 403 247 366 227Z M374 227L449 220 M548 215Q575 181 611 188Q602 218 548 215Z M550 215L598 195', 1, .61, .9),
      line('M480 225Q520 208 550 222 M674 153Q730 153 776 171 M114 244Q148 237 169 246', 2, 1.5, .67),
    ], .32, [
      line('M-25 258C123 230 262 216 402 197Q539 178 681 185 M227 221Q250 204 259 184 M405 198Q435 220 473 222', 1, 2.4),
      filled('M257 185Q218 185 204 159Q239 151 257 185Z M259 184L219 164 M400 199Q424 166 459 169Q450 198 400 199Z M405 197L445 177', 0, .58, 1),
      filled('M69 230Q104 205 147 215Q132 243 69 230Z M74 230L133 219 M174 229Q182 198 212 187Q222 219 174 229Z M380 225Q423 207 457 224Q431 243 380 225Z', 2, .54, .9),
      filled('M523 207Q558 180 592 193Q575 221 523 207Z M527 207L580 198', 1, .60, .9),
    ])] },
    { id: 'autumn-dry-grass-counterweight', edge: 'bottom-right', width: .23, height: .18, viewBox: [430, 230], depth: 'habitat', groups: [form('autumn-grass-seed', 'grass', [390, 254], [
      line('M392 255Q329 168 246 126 M392 255Q360 150 362 71 M391 256Q300 212 214 217', 2, 2.2),
      filled('M347 204Q315 164 276 168Q298 200 347 204Z M365 191Q383 159 411 150Q410 182 365 191Z M286 145Q270 113 237 105Q239 132 286 145Z', 0, .52, .9),
      filled('M362 73Q347 71 343 84Q354 95 363 86Z M361 96Q376 80 384 92Q381 109 363 111Z M357 122Q343 106 335 119Q340 133 355 135Z M245 126Q226 109 217 121Q227 139 245 137Z', 2, .63, .8),
      line('M213 215Q245 201 273 213 M394 233Q415 217 438 221', 1, 1.6, .64),
    ], .64, [
      line('M393 256Q327 212 246 194 M392 255Q357 206 359 167 M392 257Q298 233 215 236', 2, 2.1),
      filled('M339 229Q310 201 279 203Q300 229 339 229Z M366 222Q384 197 410 190Q405 219 366 222Z', 0, .53, .9),
      filled('M358 166Q346 162 341 173Q352 183 361 179Z M358 186Q373 175 380 184Q375 198 359 198Z M245 195Q231 181 219 190Q227 204 245 205Z', 2, .63, .8),
    ])] },
  ], passage: LEAF_PASSAGE,
};

const RAIN_SCENE: LivingSceneArt = {
  patches: [
    { id: 'rain-distant-water', edge: 'bottom-right', width: .63, height: .12, viewBox: [1000, 180], depth: 'far', opacity: .44, groups: [form('rain-low-ripples', 'drift', [590, 207], [
      line('M12 176C61 159 124 164 155 177 M28 187Q90 205 163 185 M270 153C316 138 375 144 406 157 M284 168Q349 185 417 166 M565 184Q619 163 685 180 M589 193Q644 211 710 191 M807 157Q865 142 924 161 M824 173Q881 189 945 171', 0, 1.6, .65),
      line('M65 178Q96 172 126 179 M317 157Q349 151 381 161 M625 183Q650 178 675 186 M862 163Q887 157 915 166', 1, 1.1, .51),
    ], .15)] },
    { id: 'rain-wet-reed-bank', edge: 'bottom-left', width: .56, height: .18, viewBox: [830, 220], depth: 'habitat', groups: [form('rain-reeds', 'grass', [255, 246], [
      filled('M46 248C68 186 103 142 151 101C109 155 93 204 88 250Z M116 250C130 179 160 135 206 105C166 150 152 200 148 251Z M221 249C245 188 294 150 352 141C302 163 273 212 261 251Z', 2, .49, .8),
      filled('M287 250C305 207 343 176 388 169C345 187 328 223 324 251Z M431 250C462 208 498 187 547 183C502 200 485 228 476 251Z M538 250C561 189 590 160 632 147C592 171 580 219 575 251Z', 0, .40, .8),
      line('M101 250C129 167 188 112 215 60 M257 250C299 194 357 176 385 125 M575 252Q611 198 669 175', 2, 1.8),
      filled('M215 60Q207 50 202 61L199 78Q205 86 212 77Z M385 126Q376 115 371 126L367 143Q375 151 381 140Z', 1, .45, .8),
      line('M9 212Q54 197 98 211 M17 225Q65 241 113 221 M362 224Q413 209 459 223 M379 238Q423 250 471 232 M654 211Q710 195 760 212', 0, 1.5, .75),
    ], .41, [
      filled('M47 249Q86 190 147 182Q104 204 89 251Z M119 250Q153 202 207 194Q164 216 151 251Z M223 250Q269 207 329 205Q286 219 261 252Z M435 250Q473 218 527 218Q492 233 477 252Z M540 250Q575 202 626 196Q591 217 576 252Z', 2, .49, .8),
      line('M101 250Q160 207 214 178 M256 251Q319 222 384 190 M574 252Q615 218 669 208', 2, 1.7),
      filled('M215 178Q204 170 199 180Q201 191 210 189Z M383 190Q371 183 367 194Q375 203 382 200Z', 1, .45, .8),
      line('M9 222Q58 208 103 223 M373 236Q420 222 464 238 M655 223Q710 211 760 226', 0, 1.5, .75),
    ])] },
    { id: 'rain-overhanging-leaves', edge: 'top-right', width: .26, height: .16, viewBox: [500, 210], depth: 'habitat', opacity: .72, groups: [form('rain-dripping-branch', 'branch', [524, -25], [
      line('M526-25C437 18 361 58 276 76Q223 87 160 78 M363 52Q352 91 325 119 M278 76Q259 45 227 35', 2, 2.2),
      filled('M326 118C330 139 309 166 282 172Q278 140 326 118Z M227 35Q195 26 173 45Q194 66 227 35Z M163 79Q139 95 103 87Q120 63 163 79Z', 2, .43, .9),
      line('M287 179L282 190 M108 94L103 105 M184 52L179 63', 0, 1.3, .78),
    ], .67)] },
  ], passage: SUMMER_MEADOW.passage,
};
const STORM_SCENE: LivingSceneArt = {
  patches: [
    { id: 'storm-partial-cloud', edge: 'top-left', width: .66, height: .13, viewBox: [1000, 190], depth: 'far', opacity: .42, groups: [form('storm-low-cloud-contours', 'drift', [250, -30], [
      filled('M-20-30H690C680 13 651 39 607 37C576 73 530 79 490 60C461 99 400 105 360 75C317 114 265 108 236 79C189 109 144 96 123 64C64 95 15 80-20 54Z', 0, .18, 0),
      line('M-14 57Q55 88 121 62C147 94 190 104 235 77 M356 75Q423 112 488 60 M603 40Q649 40 679 11', 0, 1.7, .60),
      line('M103 30Q152 42 188 28 M312 52Q365 65 413 41 M497 18Q545 35 589 23', 2, 1.1, .42),
    ], .18)] },
    { id: 'storm-bent-branch', edge: 'bottom-left', width: .65, height: .19, viewBox: [1000, 230], depth: 'habitat', groups: [form('storm-wind-bent-bough', 'branch', [84, 270], [
      filled('M75 271C148 201 222 152 319 138C419 122 502 157 597 143Q691 128 775 78L778 82Q691 138 599 151C496 167 417 132 321 146C229 161 152 208 88 275Z', 1, .50, 1.8),
      line('M249 161Q320 185 385 179 M425 139Q463 102 508 83 M594 146Q652 172 711 156 M696 118Q716 76 756 53', 1, 2),
      filled('M386 179Q409 164 457 173Q435 203 386 179Z M505 83Q531 55 576 61Q549 92 505 83Z M709 156Q749 134 786 148Q761 179 709 156Z M752 54Q772 29 814 34Q792 64 752 54Z', 1, .48, .9),
      line('M112 247Q158 226 199 239 M328 219Q382 200 423 218 M610 214Q661 192 712 213', 0, 1.5, .68),
      filled('M169 248Q216 210 270 215Q228 241 205 251Z M468 253Q514 220 565 224Q526 246 500 255Z', 2, .29, .7),
    ], .48, [
      filled('M75 270C176 229 266 207 367 205Q517 205 665 179L666 184Q514 214 367 213Q220 217 87 277Z', 1, .50, 1.7),
      line('M268 215Q327 238 383 226 M453 206Q490 184 529 176 M588 197Q638 213 685 202', 1, 1.9),
      filled('M384 225Q418 207 450 219Q427 242 384 225Z M527 177Q554 157 589 166Q563 187 527 177Z M683 202Q715 184 751 194Q720 216 683 202Z', 1, .48, .9),
      line('M117 251Q162 239 199 250 M468 244Q524 231 565 247', 0, 1.5, .68),
    ])] },
    { id: 'storm-ripple-counterweight', edge: 'bottom-right', width: .28, height: .11, viewBox: [560, 180], depth: 'habitat', opacity: .74, groups: [form('storm-water-response', 'drift', [380, 207], [
      line('M16 159Q76 141 139 158 M28 174Q89 195 158 170 M215 123Q267 106 324 125 M235 140Q289 157 345 138 M388 177Q451 155 518 177 M406 192Q465 209 540 188', 0, 1.8),
      line('M74 159L67 173 M270 122L264 139 M458 177L450 192', 1, 1.4),
    ], .79)] },
  ], passage: LEAF_PASSAGE,
};
const FOG_SCENE: LivingSceneArt = {
  patches: [
    { id: 'fog-distant-contours', edge: 'top-right', width: .62, height: .14, viewBox: [1000, 190], depth: 'far', opacity: .42, groups: [form('fog-separated-ribbons', 'drift', [630, 0], [
      filled('M60 49C187 9 240 71 366 49C483 29 564 51 670 70C794 91 859 30 1017 48L1017 55C861 39 794 100 669 79C557 60 480 39 367 58C242 81 189 20 60 56Z', 0, .13, 0),
      line('M47 113C176 72 258 131 377 111 M481 104Q589 83 690 120 M777 128Q889 97 1019 109', 1, 1.7, .51),
      line('M175 28Q242 48 313 31 M563 157Q645 139 734 162', 2, 1.1, .39),
    ], .17)] },
    { id: 'fog-reed-silhouette', edge: 'bottom-left', width: .54, height: .19, viewBox: [850, 230], depth: 'habitat', groups: [form('fog-sharp-reeds', 'grass', [340, 260], [
      line('M78 261C89 182 77 129 55 86 M155 261C177 180 206 132 246 99 M288 262C310 188 306 130 288 71 M399 261C410 204 446 167 489 143 M555 263C570 196 592 148 628 118', 2, 2),
      filled('M111 263C120 208 101 174 72 156Q117 177 136 265Z M203 264Q220 194 264 171Q235 215 227 265Z M326 264Q352 203 404 186Q358 222 351 265Z M477 266Q489 220 527 197Q508 235 505 266Z', 2, .38, .7),
      line('M52 86L43 67 M246 100L256 81 M287 72L281 49 M628 119L641 98', 1, 3.1, .63),
      line('M-15 220C96 192 149 237 255 218 M354 232Q438 203 522 224 M592 213Q681 190 763 213', 0, 1.6, .54),
    ], .47, [
      line('M78 262Q89 220 56 192 M155 263Q189 214 246 191 M288 263Q317 214 289 178 M400 264Q443 228 489 220 M555 264Q587 222 628 205', 2, 1.9),
      filled('M111 263Q110 222 73 210Q116 214 137 265Z M203 264Q228 222 266 213Q238 236 228 265Z M326 264Q359 226 404 219Q370 241 351 266Z', 2, .38, .7),
      line('M-15 231Q102 208 207 235 M358 242Q440 224 522 240', 0, 1.6, .54),
    ])] },
    { id: 'fog-near-open-contour', edge: 'bottom-right', width: .36, height: .13, viewBox: [700, 180], depth: 'habitat', opacity: .65, groups: [form('fog-low-current', 'drift', [500, 206], [
      line('M-18 133C91 98 152 156 255 139C352 121 403 117 496 146Q582 176 724 136 M93 173Q177 152 258 174 M396 183Q475 164 553 186', 0, 1.9, .66),
      filled('M16 137Q97 117 173 142L170 147Q95 123 16 142Z M420 138Q472 137 525 156L522 161Q469 143 420 144Z', 1, .13, 0),
    ], .81)] },
  ], passage: SUMMER_MEADOW.passage,
};
const WIND_SCENE: LivingSceneArt = {
  patches: [
    { id: 'wind-rear-swept-bank', edge: 'bottom-left', width: .72, height: .13, viewBox: [1000, 180], depth: 'far', opacity: .43, groups: [form('wind-rear-growth', 'grass', [320, 209], [
      filled('M24 212Q126 126 233 142Q109 157 69 214Z M198 213Q312 137 413 151Q297 166 246 215Z M468 213Q574 144 693 160Q563 176 516 216Z M729 214Q836 153 967 174Q826 185 778 216Z', 0, .38, 0),
      line('M141 172Q232 147 299 163 M567 180Q657 156 737 177', 2, 1.2, .53),
    ], .12)] },
    { id: 'wind-long-grass-arc', edge: 'bottom-left', width: .67, height: .18, viewBox: [1000, 220], depth: 'habitat', groups: [
      form('wind-west-bent-stems', 'grass', [140, 250], [
        filled('M81 252C124 182 182 135 260 122C184 153 146 205 119 254Z M143 253C193 185 258 153 340 152C257 171 214 218 184 255Z M202 254Q299 196 386 208Q298 220 243 256Z', 0, .64, .8),
        line('M120 253C183 153 280 111 385 95 M181 253Q279 183 403 172', 1, 1.9),
        filled('M383 96Q373 81 363 90Q364 103 378 105Z M366 106Q352 91 344 102Q349 116 362 116Z M346 116Q331 105 324 116Q332 129 344 126Z M402 173Q387 161 377 172Q386 186 399 183Z', 1, .66, .8),
        line('M87 247Q152 200 211 180 M179 247Q241 200 290 180', 2, 1.1, .68),
      ], .25, [
        filled('M81 253Q151 201 243 197Q167 215 120 256Z M143 254Q230 210 320 220Q239 230 184 257Z M205 255Q292 228 379 236Q291 243 244 257Z', 0, .64, .8),
        line('M121 254Q241 184 383 181 M183 255Q290 217 403 216', 1, 1.8),
        filled('M383 181Q369 171 360 180Q369 191 383 190Z M356 188Q343 178 334 187Q342 199 355 198Z M403 216Q390 204 379 215Q386 228 400 225Z', 1, .66, .8),
      ]),
      form('wind-east-recovery', 'grass', [635, 252], [
        filled('M536 256C574 206 630 170 709 160Q626 193 575 258Z M616 257C665 189 724 159 805 157Q718 180 655 259Z M710 258Q793 211 879 216Q790 230 748 260Z', 0, .59, .8),
        line('M575 258C649 162 753 131 871 128 M654 258Q770 193 925 201', 1, 1.8),
        filled('M869 128Q857 114 847 123Q853 138 868 137Z M846 137Q831 125 823 137Q832 149 845 147Z M923 201Q909 186 897 198Q904 213 921 211Z', 1, .62, .8),
        line('M545 247Q611 213 665 204 M727 248Q796 222 851 233', 2, 1.2, .65),
      ], .61, [
        filled('M538 257Q606 220 695 220Q622 234 577 259Z M616 258Q704 211 792 220Q719 234 656 260Z M712 260Q795 235 873 242Q789 252 749 261Z', 0, .59, .8),
        line('M578 258Q721 193 870 196 M655 260Q793 228 924 239', 1, 1.8),
        filled('M868 197Q853 186 845 195Q853 207 867 206Z M923 239Q907 226 897 238Q905 250 921 249Z', 1, .62, .8),
      ]),
    ] },
    { id: 'wind-leaf-bough-counterweight', edge: 'top-right', width: .25, height: .14, viewBox: [500, 210], depth: 'habitat', opacity: .73, groups: [form('wind-swept-canopy', 'branch', [520, -25], [
      line('M521-26C439 18 348 30 253 27Q173 24 92 56 M333 29Q295 63 260 77 M223 31Q207 62 181 80', 2, 2),
      filled('M259 77Q219 69 178 95Q219 109 259 77Z M180 80Q145 76 110 103Q148 114 180 80Z M94 55Q52 48 14 78Q57 87 94 55Z', 0, .48, .8),
      line('M260 77L193 93 M181 80L124 100', 1, 1.1, .70),
    ], .87)] },
  ], passage: LEAF_PASSAGE,
};

function birthdayScene(treatment: 'classic' | 'russian' | 'korean'): LivingSceneArt {
  const cakeAccent: readonly ScenePath[] = treatment === 'russian' ? [
    filled('M180 184L192 173L204 184L192 195Z M211 185L223 174L235 185L223 196Z M242 184L254 173L266 184L254 195Z', 2, .58, .9),
    line('M356 179L370 165L384 179L370 193Z M390 179L404 165L418 179L404 193Z', 0, 1.3),
  ] : treatment === 'korean' ? [
    filled('M166 171Q183 175 203 177L203 199Q181 197 166 192Z M236 179L267 173L267 191L236 198Z', 2, .45, .7),
    line('M203 177V201 M235 179V202 M355 161L379 161L379 187L416 187 M395 161V187 M355 187L379 178', 1, 1.3),
    filled('M355 162L378 162L378 183L355 190Z M382 190H416V212H382Z', 0, .35, .7),
  ] : [line('M171 185Q219 200 265 184 M357 177Q387 192 417 176', 2, 1.8), line('M181 190L184 193 M215 196L219 199 M249 190L253 193', 1, 1.1)];
  return {
    patches: [
      { id: `birthday-${treatment}-ribbon-depth`, edge: 'bottom-left', width: .70, height: .13, viewBox: [1000, 180], depth: 'far', opacity: .46, groups: [form('birthday-low-cloth', 'drift', [450, 215], [
        filled('M-20 196C112 136 180 174 308 162C434 148 500 169 597 197C685 221 778 156 889 171Q949 177 1020 199L1020 211C897 179 822 220 730 221C607 230 554 190 455 190C284 190 133 166-20 214Z', 1, .22, 0),
        line('M6 192C128 152 186 178 309 169 M589 199Q661 224 738 199 M815 181Q898 165 989 195', 2, 1.1, .60),
      ], .25)] },
      // Cake with gifts and the balloon bunch are separate complete drawings, so each can stand
      // at hero size where a populated board leaves only a narrow free column.
      { id: `birthday-${treatment}-celebration`, edge: 'bottom-left', width: .40, height: .30, viewBox: [430, 205], origin: [60, 62], depth: 'habitat', groups: [
        form('birthday-grounded-cake-gifts', 'still', [290, 268], [
          filled('M155 150Q220 129 283 150L283 201Q220 226 155 201Z', 0, .44, 1.8),
          filled('M155 150Q220 130 283 150Q278 170 264 162Q253 179 239 166Q223 182 208 168Q193 180 181 165Q164 175 155 150Z', 1, .53, 1.4),
          line('M143 209Q218 237 296 207 M164 218Q220 233 278 219', 2, 1.7),
          filled('M214 139L214 111L224 111L224 139Z M219 104C207 96 218 79 220 78C231 91 230 99 219 104Z', 2, .61, 1.0),
          filled('M341 151L426 151L426 217L341 217Z M334 140L433 140L433 156L334 156Z', 2, .34, 1.5),
          line('M377 140V217 M390 140V217 M383 139C346 137 349 113 367 120Q379 126 383 139C416 137 420 115 402 118Q391 122 383 139', 1, 1.7),
          ...cakeAccent,
          line('M80 246C125 224 156 243 180 239 M291 236Q344 225 383 241Q415 252 463 232', 0, 1.6, .65),
        ], .05, [
          filled('M155 187Q218 170 282 187L282 218Q219 235 155 218Z', 0, .45, 1.7),
          filled('M155 187Q219 170 282 187Q273 202 260 195Q247 208 235 198Q222 211 207 199Q194 209 181 198Q166 206 155 187Z', 1, .52, 1.3),
          filled('M215 180V161H224V180Z M219 155C210 149 219 138 220 138C228 146 228 153 219 155Z', 2, .61, 1),
          filled('M341 182H425V224H341Z M334 173H433V185H334Z', 2, .34, 1.4),
          line('M378 173V224 M389 173V224 M383 172C359 168 359 152 373 159L383 172Q408 165 403 155Q390 152 383 172 M146 226Q216 244 290 226', 1, 1.7),
          ...(treatment === 'russian' ? [line('M174 212L187 201L200 212L187 223Z M214 213L226 202L238 213L226 224Z M369 205L382 194L395 205L382 216Z', 2, 1.2)] : treatment === 'korean' ? [filled('M160 205L193 209V225L160 219Z M235 208L277 202V216L235 226Z', 2, .42, .6), line('M193 209V228 M368 187V224 M368 205H425 M395 205V224', 1, 1.3)] : [line('M168 213Q218 226 270 212', 2, 1.5)]),
        ]),
      ] },
      { id: `birthday-${treatment}-balloons`, edge: 'right', width: .20, height: .34, viewBox: [290, 285], origin: [540, 0], depth: 'habitat', groups: [
        form('birthday-tethered-balloons', 'float', [690, 265], [
          filled('M572 75C554 33 580 11 604 20C631 31 641 75 625 102Q615 121 608 124C590 115 578 98 572 75Z', 1, .43, 1.6),
          filled('M664 64C664 26 700 14 723 37C749 64 735 109 711 126C687 119 665 93 664 64Z', 0, .42, 1.7),
          filled('M755 105C748 74 770 53 792 66C815 82 814 118 798 137Q789 149 782 151C767 140 758 123 755 105Z', 2, .40, 1.5),
          line('M606 126L612 132L605 133Z M710 128L716 136L706 135Z M783 153L788 159L779 158Z M608 133C622 166 664 175 690 265 M711 136C699 179 680 202 690 265 M784 159C769 191 716 204 690 265', 1, 1.5),
          line('M583 55Q579 35 594 31 M678 55Q684 38 699 38 M765 96Q763 80 777 77', 2, 1.3, .72),
          line('M688 248C659 226 636 233 644 245Q658 257 688 248C723 224 739 236 726 248Q711 257 688 248 M684 250Q659 262 650 277 M694 250Q709 269 731 276', 0, 1.8),
        ], .56, [
          filled('M572 166C564 139 584 125 602 133C624 144 629 169 618 189Q610 199 605 202C589 194 577 181 572 166Z', 1, .43, 1.5),
          filled('M662 153C665 123 693 118 711 136C731 158 718 187 700 203C681 198 664 177 662 153Z', 0, .42, 1.6),
          filled('M750 181C746 159 764 144 780 153C801 165 798 193 782 207C764 202 753 192 750 181Z', 2, .40, 1.4),
          line('M605 203L610 210L602 210Z M700 204L705 212L696 211Z M781 209L786 215L777 215Z M606 210Q647 221 690 265 M700 212Q684 237 690 265 M781 215Q724 234 690 265', 1, 1.4),
          line('M688 249Q656 234 649 247Q663 260 688 249Q719 232 729 245Q716 257 688 249', 0, 1.7),
        ]),
      ] },
    ], passage: RIBBON_PASSAGE,
  };
}

/** The registry selects these authored assets; this map is not a second picker,
 * identity or date-policy list. Coverage is checked against the registry. */
export const LIVING_SCENE_ART: Readonly<Record<string, LivingSceneArt | undefined>> = {
  summer: SUMMER_MEADOW,
  spring: SPRING_SCENE,
  autumn: AUTUMN_SCENE,
  winter: WINTER_SCENE,
  snow: SNOW_SCENE,
  rain: RAIN_SCENE,
  storm: STORM_SCENE,
  fog: FOG_SCENE,
  wind: WIND_SCENE,
  birthday: birthdayScene('classic'),
  'birthday-russian': birthdayScene('russian'),
  'birthday-korean': birthdayScene('korean'),
  ...LIVING_CELEBRATION_ART,
};
