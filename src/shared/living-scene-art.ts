/** Original connected scene geometry. Identity, palette and policy stay in theme-registry.ts.
 * Coordinates are authored SVG units; bounds include stroke and off-frame roots.
 * The renderer owns shared choreography, placement, reading masks and finite retreats. */
import type { ThemeTone } from './theme-registry.ts';

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
  motion: 'still' | 'grass' | 'branch' | 'hanging' | 'drift';
  pivot: readonly [number, number];
  /** Conservative source geometry, including control points and stroke extent. */
  bounds: readonly [x: number, y: number, width: number, height: number];
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
  weather: readonly ('rain' | 'snow' | 'storm' | 'fog' | 'wind')[];
}

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
  weather: ['rain', 'wind', 'storm'],
};

/** Deliberately partial during the reviewed vertical slice. The registry selects
 * an approved asset; this is not a second picker, identity or date-policy list. */
export const LIVING_SCENE_ART: Readonly<Record<string, LivingSceneArt | undefined>> = {
  summer: SUMMER_MEADOW,
};
