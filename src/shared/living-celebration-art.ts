/** Original celebration edge habitats for #586. Palette roles, identity and date
 * policy remain in the registry. Each attachment moves with its parent group;
 * compact drawings are complete lower/wider forms, never clipped tall art. */
import type { LivingSceneArt, SceneArtGroup, ScenePath, ScenePassageArt } from './living-scene-art.ts';

/** Expand smooth authored curves once, so reflected control points are explicit
 * in both rendered geometry and the conservative hull. No per-frame path work. */
function explicitCurves(source: string): string {
  const tokens = source.match(/[MLHVCQSTZ]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let i = 0, command = '', previous = '', x = 0, y = 0, startX = 0, startY = 0;
  let cubicX = 0, cubicY = 0, quadraticX = 0, quadraticY = 0;
  while (i < tokens.length) {
    if (/^[MLHVCQSTZ]$/.test(tokens[i] ?? '')) command = tokens[i++] ?? '';
    if (command === 'Z') {
      out.push('Z'); x = startX; y = startY; previous = 'Z'; command = ''; continue;
    }
    const count = command === 'C' ? 6 : command === 'S' || command === 'Q' ? 4 : command === 'M' || command === 'L' || command === 'T' ? 2 : command === 'H' || command === 'V' ? 1 : 0;
    const values = tokens.slice(i, i + count).map(Number);
    if (!count || values.length !== count || values.some(value => !Number.isFinite(value)))
      throw new Error('A celebration path needs valid absolute SVG coordinates');
    i += count;
    // The checked arity above guarantees every argument used by its command.
    const v = (index: number): number => values[index]!;
    if (command === 'H' || command === 'V') {
      if (command === 'H') x = v(0); else y = v(0);
      out.push(`L${x} ${y}`);
    } else if (command === 'S') {
      const reflect = previous === 'C' || previous === 'S';
      out.push(`C${reflect ? 2 * x - cubicX : x} ${reflect ? 2 * y - cubicY : y} ${values.join(' ')}`);
      cubicX = v(0); cubicY = v(1); x = v(2); y = v(3);
    } else if (command === 'T') {
      const reflect = previous === 'Q' || previous === 'T';
      quadraticX = reflect ? 2 * x - quadraticX : x;
      quadraticY = reflect ? 2 * y - quadraticY : y;
      out.push(`Q${quadraticX} ${quadraticY} ${values.join(' ')}`);
      x = v(0); y = v(1);
    } else {
      out.push(`${command}${values.join(' ')}`);
      x = v(count - 2); y = v(count - 1);
      if (command === 'M') { startX = x; startY = y; }
      if (command === 'C') { cubicX = v(2); cubicY = v(3); }
      if (command === 'Q') { quadraticX = v(0); quadraticY = v(1); }
    }
    previous = command;
    if (command === 'M') command = 'L';
  }
  return out.join(' ');
}
const p = (d: string, tone: ScenePath['tone'], fill?: number, stroke = 2, opacity = 1): ScenePath =>
  ({ d: explicitCurves(d), tone, ...(fill === undefined ? {} : { fill }), stroke, opacity });
/** All habitat commands below use absolute coordinate pairs (M/L/C/Q/Z). The
 * control hull plus half-stroke also reserves curved excursions outside endpoints. */
function hull(paths: readonly ScenePath[], reserve: SceneArtGroup['bounds']): SceneArtGroup['bounds'] {
  let left = reserve[0], top = reserve[1], right = left + reserve[2], bottom = top + reserve[3];
  for (const path of paths) {
    const points = (path.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const pad = (path.stroke ?? 0) / 2;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i], y = points[i + 1];
      if (x === undefined || y === undefined) throw new Error('A celebration path needs complete absolute coordinate pairs');
      left = Math.min(left, x - pad); right = Math.max(right, x + pad);
      top = Math.min(top, y - pad); bottom = Math.max(bottom, y + pad);
    }
  }
  return [left, top, right - left, bottom - top];
}
const compact = (bounds: SceneArtGroup['bounds'], paths: readonly ScenePath[]): NonNullable<SceneArtGroup['compact']> => ({ bounds: hull(paths, bounds), paths });
const group = (id: string, bounds: SceneArtGroup['bounds'], pivot: SceneArtGroup['pivot'], motion: SceneArtGroup['motion'], paths: readonly ScenePath[], lower?: SceneArtGroup['compact'], phase = 0): SceneArtGroup =>
  ({ id, bounds: hull(paths, bounds), pivot, motion, paths, ...(lower ? { compact: lower } : {}), phase });

const ribbonPassage: ScenePassageArt = {
  kind: 'ribbon', viewBox: [96, 48], paths: [
    p('M4 32C21 9 40 7 56 20S80 34 92 8L88 20C75 42 59 30 48 22S20 16 8 36Z', 1, undefined, 2),
    p('M8 31Q27 10 48 20T88 17', 2, undefined, 1.6),
  ],
};
const leafPassage: ScenePassageArt = {
  kind: 'leaf', viewBox: [82, 48], paths: [
    p('M9 39C7 17 31 4 68 9C58 36 38 44 9 39Z', 0, undefined, 2),
    p('M3 44Q31 23 68 9M26 29L25 15M40 21L53 28', 2, undefined, 1.5),
  ],
};
const petalPassage: ScenePassageArt = {
  kind: 'petal', viewBox: [70, 44], paths: [
    p('M8 31C6 10 22 2 36 17C53 6 64 13 59 28C44 42 25 40 8 31Z', 1, undefined, 2),
    p('M13 29Q35 33 53 23', 2, undefined, 1.3),
  ],
};
const huskPassage: ScenePassageArt = {
  kind: 'seed', viewBox: [86, 46], paths: [
    p('M7 39Q38 20 77 7M27 27Q13 9 24 6Q36 12 34 24M43 20Q42 3 53 4Q61 13 50 17M54 16Q67 20 72 32Q58 35 54 16', 0, undefined, 2),
    p('M10 36L3 43M74 9L82 4', 2, undefined, 1.2),
  ],
};

/** Fir enters from the upper left; ornaments hang from actual branch forks. The
 * shorter opposite bough never completes a rectangular frame. */
const CHRISTMAS: LivingSceneArt = {
  patches: [
    { id: 'christmas-distant-fir', edge: 'bottom-left', width: .56, height: .085, viewBox: [1000, 140], depth: 'far', opacity: .46,
      groups: [group('christmas-low-needles', [-12, 50, 1024, 103], [160, 150], 'branch', [
        p('M-8 150Q125 88 262 126T522 127M602 145Q758 91 1003 141', 0, undefined, 3),
        p('M38 137L91 81L77 120L139 65L124 114L205 75L182 122L261 99L236 133 M658 135L706 79L695 117L766 59L748 114L820 79L799 125L884 101L862 138', 0, .56, 1.5),
      ], compact([-12, 100, 1024, 53], [
        p('M-8 149Q133 113 310 142M635 148Q816 109 1003 144', 0, undefined, 2.4),
        p('M37 143L94 112L79 138L155 104L139 139L229 121L207 145M683 141L738 109L727 138L813 102L791 140L908 128L879 146', 0, .52, 1.2),
      ]))] },
    { id: 'christmas-garland', edge: 'top-left', width: .44, height: .30, viewBox: [720, 330], depth: 'habitat',
      groups: [group('christmas-linked-bough', [-20, -18, 735, 338], [-12, 5], 'branch', [
        p('M-12 5C111 10 153 57 258 85S437 113 536 167Q619 208 702 204', 0, undefined, 6),
        p('M36 19L106 3L91 27L162 16L137 46L210 40L174 70L246 64L220 89L293 79L268 101L339 96L317 119L384 109L358 132L432 125L408 147L486 139L461 165L532 154L514 177L585 176L569 195L636 189L618 207L698 204L670 220Q568 211 485 185T282 118T36 19Z', 0, .63, 1.5),
        p('M40 21L85 57L77 32L132 83L125 49L177 108L178 72L230 131L225 97L284 143L276 113L346 163L331 134L393 178L388 152L454 194L447 169L516 217L502 190L566 231L557 208L626 244L607 217L685 243', 0, undefined, 2.3),
        p('M111 31L103 72M186 73L176 109M267 102L260 141M350 126L340 161M438 156L428 193M526 184L520 223M612 215L606 247', 2, undefined, 1.5, .75),
        p('M176 105L173 157M430 188L427 237M606 239L606 267', 2, undefined, 2),
        p('M164 158L181 158L183 167L162 167ZM416 236L438 236L440 246L415 246ZM597 266L615 266L615 275L597 275Z', 2, .55, 1.3),
        p('M173 166C136 169 132 213 157 230C181 245 208 219 203 195C200 179 190 169 173 166Z', 1, .5, 2.6),
        p('M427 245C396 247 393 279 416 292C438 305 459 282 453 263C449 252 439 246 427 245Z', 1, .53, 2.4),
        p('M606 274C586 275 578 297 595 308C611 320 632 304 626 289C623 281 616 275 606 274Z', 2, .47, 2),
        p('M148 197Q169 209 198 198M153 214Q172 225 193 213M407 267Q427 277 450 267M598 290Q608 299 619 291', 2, undefined, 1.7),
      ], compact([-20, -18, 735, 207], [
        p('M-12 5C142 19 229 61 355 92S552 139 702 146', 0, undefined, 5),
        p('M38 16L112 1L96 26L176 16L147 42L230 34L202 62L295 57L264 80L360 73L334 99L420 88L400 112L489 105L465 127L557 118L531 143L623 130L603 154L703 145L670 171Q533 155 357 112T38 16Z', 0, .65, 1.5),
        p('M83 32L116 65M188 57L222 90M311 85L339 122M441 113L474 149M564 140L591 170', 0, undefined, 2),
        p('M218 87L217 128M472 139L472 155', 2, undefined, 1.8),
        p('M216 128C191 126 184 152 203 164C221 177 243 159 235 142Q230 130 216 128Z', 1, .55, 2),
        p('M471 154C454 154 447 174 461 182C478 194 495 176 484 163Z', 2, .5, 1.7),
        p('M199 146Q216 157 234 146', 2, undefined, 1.5),
      ]))] },
    { id: 'christmas-answer-bough', edge: 'top-right', width: .22, height: .135, viewBox: [470, 190], depth: 'habitat', opacity: .85,
      groups: [group('christmas-right-fork', [-10, -15, 493, 207], [480, 0], 'branch', [
        p('M480 0C363 18 312 62 225 81Q116 101 4 133', 0, undefined, 4),
        p('M423 13L376 1L387 28L322 8L339 46L273 25L290 64L217 45L244 80L170 66L185 95L105 87L128 111L50 108L78 131L2 134L41 154L145 125L243 102L348 59Z', 0, .6, 1.4),
        p('M350 58L347 104M121 119L119 143', 2, undefined, 1.6),
        p('M347 104C324 103 315 129 334 143C355 155 374 131 362 116Z', 1, .48, 2),
        p('M119 142L128 156L120 177L110 156Z', 2, .45, 1.7),
      ], compact([-10, -15, 493, 112], [
        p('M480 0Q295 23 4 78', 0, undefined, 3.8),
        p('M423 7L365 2L379 25L312 13L326 36L244 27L262 50L179 44L196 64L96 58L123 80L4 79L45 96Q248 60 423 7Z', 0, .58, 1.3),
      ]), .42)] },
  ], passage: ribbonPassage, weather: ['snow', 'wind', 'fog'], air: 'snow',
};

const NEW_YEAR: LivingSceneArt = {
  patches: [
    { id: 'new-year-far-fold', edge: 'bottom-left', width: .61, height: .075, viewBox: [1000, 120], depth: 'far', opacity: .43,
      groups: [group('new-year-rear-silk', [-12, 26, 1024, 111], [90, 130], 'drift', [
        p('M-8 128C160 38 274 36 385 91S613 133 694 80Q838 17 1005 70L1005 90C834 39 746 65 668 112Q529 155 368 111T-8 136Z', 1, .42, 1.8),
      ], compact([-12, 74, 1024, 63], [
        p('M-8 129Q185 78 371 114T699 111Q868 70 1005 99L1005 111Q846 87 702 127T367 128T-8 136Z', 1, .45, 1.5),
      ]))] },
    { id: 'new-year-open-ribbon', edge: 'bottom-left', width: .59, height: .22, viewBox: [940, 280], depth: 'habitat',
      groups: [group('new-year-loop-and-fold', [-14, 12, 960, 284], [50, 286], 'hanging', [
        p('M-10 283C94 197 127 10 259 27C408 45 328 207 199 206C113 206 104 157 151 122C215 76 337 102 413 172S587 273 709 228Q800 193 943 237L939 254C790 208 725 244 650 262C526 292 469 233 396 187S233 90 164 135C118 166 137 193 201 191C314 188 376 61 259 43C149 25 111 216 -5 296Z', 0, .52, 2.8),
        p('M-9 282C91 217 165 66 241 59M307 142Q263 190 197 191M419 174Q511 263 608 256M729 236Q813 213 936 246', 2, undefined, 2.1),
        p('M39 272Q67 229 105 225L90 262L130 280L69 287ZM365 228L412 200L445 235L406 252ZM587 271L621 252L649 272L620 287Z', 1, .47, 1.7),
        p('M101 221L120 202L130 221L110 239M421 198L443 185L451 206M741 213L751 196L766 209', 2, undefined, 3),
      ], compact([-14, 147, 960, 150], [
        p('M-10 283C99 258 107 161 223 161C320 161 331 230 242 248C161 264 136 226 188 210C268 182 360 220 436 247S610 295 731 263Q837 225 943 253L942 268Q838 244 735 278C604 314 497 284 426 261S271 196 195 223C165 235 191 248 237 235C303 218 293 175 222 177C125 177 115 273 -10 296Z', 0, .55, 2.4),
        p('M394 258L421 241L448 265L425 280ZM652 277L675 264L699 282L674 294Z', 1, .5, 1.5),
        p('M99 247L116 232M817 246L832 230', 2, undefined, 2.8),
      ]))] },
    { id: 'new-year-upper-return', edge: 'top-right', width: .25, height: .18, viewBox: [480, 260], depth: 'habitat', opacity: .85,
      groups: [group('new-year-suspended-return', [-10, -18, 504, 276], [490, -6], 'hanging', [
        p('M490 -8C376 6 332 21 322 81C313 146 423 138 403 71C381 2 219 79 194 171C183 213 128 241 6 239L8 253C134 263 194 228 211 177C247 84 375 32 389 75C401 115 330 125 337 83C345 39 393 18 490 8Z', 1, .5, 2.2),
        p('M485 1Q358 20 339 73M384 120Q307 123 247 169M7 246Q108 249 171 209', 0, undefined, 1.6),
        p('M294 160L307 145L319 165M119 220L128 208L140 221', 2, undefined, 3),
      ], compact([-10, -18, 504, 141], [
        p('M490 -8C336 5 319 94 194 88Q95 60 5 108L8 122Q97 75 194 103C328 115 357 18 490 8Z', 1, .5, 2),
        p('M78 96L90 83M270 88L285 71', 2, undefined, 2.8),
      ]), .38)] },
  ], passage: ribbonPassage, weather: ['wind', 'snow', 'fog'],
};

const NEW_YEAR_TREE: LivingSceneArt = {
  patches: [
    { id: 'new-year-tree-rear', edge: 'bottom-left', width: .48, height: .11, viewBox: [900, 160], depth: 'far', opacity: .42,
      groups: [group('new-year-tree-shadow-needles', [-15, 46, 930, 132], [110, 170], 'branch', [
        p('M-10 167Q193 73 396 143M501 161Q659 93 903 149', 0, undefined, 3.5),
        p('M20 150L87 75L75 132L155 49L134 114L237 73L207 135L306 99L280 153M547 149L618 75L599 136L696 67L673 128L780 101L748 153', 0, .53, 1.3),
      ], compact([-15, 108, 930, 70], [
        p('M-10 169Q200 113 403 155M530 164Q724 118 903 152', 0, undefined, 3),
        p('M47 155L112 116L95 150L180 110L162 153L266 128L238 164M590 155L658 113L640 153L750 121L719 160', 0, .5, 1),
      ]))] },
    { id: 'new-year-tree-side', edge: 'bottom-left', width: .33, height: .48, viewBox: [500, 600], depth: 'habitat',
      groups: [group('new-year-evergreen', [-24, 6, 536, 615], [36, 608], 'branch', [
        p('M43 613C60 436 115 238 171 20L178 21C145 252 98 453 78 614Z', 0, .72, 2),
        p('M172 16Q159 74 91 127L127 117Q100 169 31 211L79 197Q46 252 -14 293L33 285Q10 331 -17 359L52 339Q20 409 -18 442L60 415Q29 481 -12 524L43 514Q10 560 -17 584C105 573 299 592 489 554L414 530L475 516Q383 491 323 437L400 458Q319 394 281 352L349 371Q263 297 235 263L289 277Q226 212 207 170L246 181Q199 122 188 79L208 83Z', 0, .64, 2.3),
        p('M171 59Q149 113 113 141M161 127Q116 201 52 221M142 209Q86 296 13 324M119 300Q72 393 10 425M98 397Q51 491 12 519M80 477Q55 546 20 568', 2, undefined, 2, .72),
        p('M177 87Q189 140 219 170M164 161Q191 231 254 273M146 249Q182 327 312 362M128 337Q201 436 365 452M101 442Q202 543 452 553', 0, undefined, 3),
        p('M118 190Q169 212 216 190M79 302Q166 332 288 298M43 419Q184 463 375 425', 1, undefined, 2.7),
        p('M118 207L118 229M218 263L218 283M67 350L67 370M313 410L313 432M196 480L196 500', 1, undefined, 1.5),
        p('M118 230C96 229 88 257 107 269C129 284 151 258 136 240ZM218 284C202 280 189 302 203 315C219 329 242 310 232 295ZM67 371C49 371 44 393 59 402C78 413 96 392 85 380Z', 2, .59, 2),
        p('M313 432C290 431 280 456 300 472C324 489 346 463 333 445ZM196 500L212 522L198 547L181 524Z', 1, .58, 2),
        p('M108 249Q117 256 131 250M301 452Q313 463 329 453M203 302Q217 311 229 302', 1, undefined, 1.6),
      ], compact([-24, 326, 536, 295], [
        p('M35 613Q135 424 282 344M80 579Q218 519 475 552', 0, undefined, 5),
        p('M50 596L68 507L94 541L114 447L137 488L170 397L187 449L235 350L249 405L299 331L296 396L364 364L337 431L424 425L383 469L485 506L425 520L499 555Q270 587 50 610Z', 0, .64, 2),
        p('M116 514Q252 549 392 507M202 431Q272 460 346 425', 1, undefined, 2.2),
        p('M181 540L181 560M350 526L350 547', 1, undefined, 1.6),
        p('M181 560C164 559 156 580 171 591C188 602 208 582 196 568ZM350 548L364 567L349 586L335 566Z', 2, .55, 1.8),
      ]))] },
    { id: 'new-year-tree-fallen-bough', edge: 'bottom-right', width: .29, height: .13, viewBox: [620, 240], depth: 'habitat', opacity: .82,
      groups: [group('new-year-opposite-needle-fork', [-10, 38, 645, 222], [628, 250], 'branch', [
        p('M629 249C485 210 381 106 200 92Q103 80 0 45', 0, undefined, 4),
        p('M599 236L526 157L528 199L445 129L456 175L371 102L389 148L305 69L330 117L233 50L264 93L168 39L197 81L78 38L118 76L0 44L61 98L151 102L130 129L236 129L215 154L323 155L306 183L424 188L408 212L521 230Z', 0, .63, 1.6),
        p('M431 180L427 212M214 119L211 152', 1, undefined, 1.7),
        p('M427 211C407 209 398 234 415 246C434 259 455 238 445 223ZM210 152L224 170L208 192L194 171Z', 2, .54, 2),
      ], compact([-10, 127, 645, 133], [
        p('M629 248Q342 158 2 170', 0, undefined, 3.6),
        p('M575 231L497 178L504 210L398 153L423 194L295 137L326 180L196 130L232 173L104 147L139 180L2 169L56 202Q348 181 575 245Z', 0, .61, 1.4),
      ]), .45)] },
  ], passage: ribbonPassage, weather: ['snow', 'wind', 'fog'], air: 'snow',
};

const ORTHODOX_CHRISTMAS: LivingSceneArt = {
  patches: [
    { id: 'orthodox-winter-distance', edge: 'bottom-right', width: .49, height: .075, viewBox: [900, 110], depth: 'far', opacity: .4,
      groups: [group('orthodox-snow-shoulder', [-10, 30, 923, 98], [820, 120], 'drift', [
        p('M-6 124C72 88 123 104 198 96S304 52 392 62S509 113 600 83S772 33 904 42L904 125Z', 0, .39, 1.5),
        p('M12 115Q108 89 177 98M411 68Q461 68 509 92M683 62Q788 30 900 45', 0, undefined, 1.3),
      ], compact([-10, 79, 923, 49], [p('M-6 124Q153 94 274 111T537 108Q738 73 904 90L904 125Z', 0, .38, 1.3)]))] },
    { id: 'orthodox-quiet-bough', edge: 'bottom-left', width: .47, height: .18, viewBox: [920, 270], depth: 'habitat',
      groups: [group('orthodox-winter-branch', [-18, 9, 951, 284], [4, 281], 'branch', [
        p('M-9 281C98 202 202 122 364 113S650 157 920 55M175 171Q174 83 224 18M378 115Q424 56 494 23M632 115Q688 68 742 13', 2, undefined, 4),
        p('M19 259L88 172L81 215L156 131L143 185L222 104L205 155L280 98L272 134L349 93L329 123L416 106L392 128L486 111L458 138L565 127L537 148L642 120L624 143L730 102L704 128L827 78L801 105L919 55L884 89Q669 176 527 157T231 156T19 277Z', 2, .6, 1.5),
        p('M176 137L153 105M184 110L217 86M196 81L178 59M213 45L242 42M416 73L408 47M447 46L474 47M686 68L674 42M714 36L739 39', 0, undefined, 2.2),
        p('M51 226Q97 191 135 170M255 129Q306 103 356 110M497 139Q557 151 614 136M746 111Q794 88 841 86', 0, undefined, 3, .75),
        p('M193 80Q197 62 206 67Q211 78 201 88M446 43Q451 29 460 34Q465 45 453 51M707 36Q712 22 721 27Q724 40 713 43', 1, .45, 1.3),
      ], compact([-18, 145, 951, 148], [
        p('M-9 281C202 205 321 187 465 217S719 237 920 152', 2, undefined, 4),
        p('M29 268L97 216L85 252L172 192L155 234L264 180L238 220L345 181L320 210L432 199L402 220L518 218L495 236L610 221L583 243L709 205L682 231L803 178L782 206L921 151L883 188Q700 275 490 242T29 283Z', 2, .58, 1.4),
        p('M157 244Q220 216 278 209M527 236Q611 248 676 228', 0, undefined, 2.5),
      ]))] },
    { id: 'orthodox-celestial-arc', edge: 'top-right', width: .26, height: .19, viewBox: [500, 300], depth: 'habitat', opacity: .83,
      groups: [group('orthodox-star-and-arc', [13, -20, 509, 319], [510, -8], 'drift', [
        p('M510 -8C374 15 265 63 229 132Q199 197 25 229', 0, undefined, 2.2, .65),
        p('M281 58L293 100L325 106L297 120L299 155L278 133L247 149L258 119L234 102L267 98Z', 1, .34, 2.6),
        p('M280 79L282 114L267 132M260 111L307 110', 1, undefined, 1.5),
        p('M61 211L65 225L80 228L67 234L65 250L57 237L43 237L53 227L49 214Z', 0, .25, 1.7),
        p('M171 168Q150 194 112 203M368 33Q343 39 325 48', 2, undefined, 1.8),
      ], compact([13, -20, 509, 179], [
        p('M510 -8Q286 21 25 127', 0, undefined, 2.1, .66),
        p('M302 29L310 52L335 57L313 68L313 92L298 74L276 84L283 62L265 49L290 49Z', 1, .32, 2.2),
        p('M69 107L76 120L91 121L79 132L79 146L67 138L54 142L59 128L50 118L64 119Z', 0, .25, 1.5),
      ]), .35)] },
  ], passage: { kind: 'flake', viewBox: [62, 62], paths: [p('M31 5V57M9 18L53 44M9 44L53 18M22 12L31 20L40 12M14 28L23 25L22 15M40 48L31 40L22 48', 0, undefined, 1.5)] },
  weather: ['snow', 'wind', 'fog'], air: 'snow',
};

const HALLOWEEN: LivingSceneArt = {
  patches: [
    { id: 'halloween-vine-shadow', edge: 'bottom-left', width: .62, height: .095, viewBox: [1000, 150], depth: 'far', opacity: .45,
      groups: [group('halloween-rear-leaf-bed', [-15, 34, 1030, 132], [70, 158], 'branch', [
        p('M-8 158Q160 73 335 127T604 132Q783 82 1007 136', 2, undefined, 3),
        p('M65 131Q69 75 131 69Q134 119 65 131ZM218 118Q263 52 313 79Q284 124 218 118ZM465 144Q450 91 498 75Q538 122 465 144ZM709 119Q746 52 799 58Q796 111 709 119ZM875 126Q899 78 944 93Q932 135 875 126Z', 1, .47, 1.6),
      ], compact([-15, 94, 1030, 72], [
        p('M-8 158Q182 121 350 145M617 151Q817 111 1007 142', 2, undefined, 2.5),
        p('M88 146Q116 109 154 113Q149 145 88 146ZM247 139Q278 99 322 109Q310 140 247 139ZM704 141Q734 98 777 104Q767 140 704 141ZM866 143Q896 111 934 119Q924 145 866 143Z', 1, .45, 1.3),
      ]))] },
    { id: 'halloween-pumpkin-garden', edge: 'bottom-left', width: .59, height: .205, viewBox: [1000, 300], depth: 'habitat',
      groups: [
        group('halloween-rooted-pumpkins', [-18, 18, 675, 303], [215, 309], 'branch', [
          p('M-9 302C84 260 211 289 306 269S489 239 643 286M107 278C87 234 96 196 131 180Q159 170 164 188Q159 207 142 202M333 272C385 226 424 229 439 197Q451 174 434 167Q414 169 427 185', 2, undefined, 3),
          p('M227 114C160 76 110 136 119 209C126 274 173 287 229 280C289 293 339 260 340 204C343 137 285 83 227 114Z', 0, .65, 3),
          p('M227 113Q191 166 198 270M229 117Q259 170 251 277M224 125Q154 156 154 228M232 125Q306 153 305 225M223 129L222 272', 1, undefined, 2.3),
          p('M224 114Q211 78 237 65L252 68Q228 81 237 113Z', 2, .6, 1.8),
          p('M450 197C413 173 379 202 383 242C386 278 420 295 451 286C483 298 521 280 524 244C528 205 489 173 450 197Z', 0, .58, 2.4),
          p('M450 198Q431 228 434 281M451 200Q472 231 468 284M447 207Q403 224 406 258M451 196Q443 175 461 165L471 168Q455 181 461 198', 1, undefined, 1.9),
          p('M74 284Q34 244 16 265Q17 293 74 284ZM339 278Q338 243 373 238Q391 264 339 278ZM550 281Q576 239 613 246Q614 278 550 281Z', 2, .5, 1.8),
        ], compact([-18, 148, 675, 173], [
          p('M-9 302Q162 267 327 292T642 289', 2, undefined, 2.8),
          p('M219 206C165 177 111 208 117 250C124 290 165 302 219 294C280 304 330 281 329 248C330 211 277 177 219 206Z', 0, .65, 2.7),
          p('M218 206Q197 243 201 291M220 207Q244 243 241 293M218 207Q210 180 234 166M148 230Q147 263 164 281M292 230Q299 260 278 284', 1, undefined, 2),
          p('M450 245C416 223 378 244 383 267C389 293 418 307 451 297C486 308 522 289 518 266C515 242 483 221 450 245Z', 0, .56, 2.3),
          p('M450 244Q444 222 465 214M449 247Q436 270 437 296M452 247Q468 269 467 297', 2, undefined, 1.8),
          p('M33 295Q47 262 80 275Q77 298 33 295ZM552 294Q577 264 612 275Q607 296 552 294Z', 2, .48, 1.5),
        ])),
        group('halloween-trailing-vine', [626, 97, 388, 221], [1002, 304], 'branch', [
          p('M1005 301C908 254 834 258 785 217S743 155 685 150Q631 144 642 112Q656 94 671 110Q675 128 659 129', 2, undefined, 3),
          p('M883 261Q867 209 903 189Q938 216 883 261ZM790 225Q804 167 849 174Q855 212 790 225ZM719 164Q698 124 725 104Q767 129 719 164Z', 2, .58, 1.8),
          p('M875 257Q904 284 942 271Q938 235 875 257ZM762 196Q736 217 707 197Q717 168 762 196Z', 1, .43, 1.6),
        ], compact([626, 217, 388, 101], [
          p('M1005 301Q850 241 721 269Q646 284 641 245Q648 221 670 235Q686 252 663 256', 2, undefined, 2.5),
          p('M896 280Q900 240 937 242Q949 273 896 280ZM782 266Q793 228 826 232Q834 259 782 266ZM716 276Q690 247 668 267Q674 288 716 276Z', 2, .52, 1.5),
        ]), .3),
      ] },
    { id: 'halloween-side-vine', edge: 'top-right', width: .19, height: .22, viewBox: [360, 350], depth: 'habitat', opacity: .8,
      groups: [group('halloween-upper-rooted-curl', [31, -15, 343, 360], [365, -4], 'branch', [
        p('M366 -4C226 42 308 104 199 146S173 220 109 249Q35 284 42 328Q57 349 75 330', 2, undefined, 3),
        p('M263 64Q211 57 214 101Q245 122 263 64ZM211 145Q244 164 227 197Q192 203 211 145ZM136 238Q94 199 72 236Q81 270 136 238Z', 1, .5, 1.8),
      ], compact([34, -15, 340, 175], [
        p('M366 -4Q217 32 194 98Q177 132 41 144', 2, undefined, 2.7),
        p('M248 50Q219 27 198 58Q205 87 248 50ZM147 126Q113 93 86 126Q96 152 147 126Z', 1, .46, 1.6),
      ]), .5)] },
  ], passage: leafPassage, weather: ['wind', 'rain', 'fog'],
};

const THANKSGIVING: LivingSceneArt = {
  patches: [
    { id: 'thanksgiving-far-harvest', edge: 'bottom-left', width: .65, height: .09, viewBox: [1100, 150], depth: 'far', opacity: .42,
      groups: [group('thanksgiving-stubble-distance', [-10, 20, 1125, 147], [150, 160], 'grass', [
        p('M-4 160Q97 132 171 152M301 156Q422 109 529 143M700 159Q879 122 1105 147', 2, undefined, 2.2),
        p('M72 150Q104 95 93 40M126 156Q160 96 182 30M366 144Q399 103 397 49M443 140Q476 80 509 26M803 147Q839 102 828 55M907 145Q938 83 977 28', 0, undefined, 2.5),
        p('M93 40Q66 47 79 66Q99 65 93 40ZM182 30Q154 39 166 57Q187 52 182 30ZM397 49Q370 55 380 75Q401 74 397 49ZM509 26Q482 36 492 56Q515 49 509 26ZM828 55Q802 63 813 84Q833 81 828 55ZM977 28Q949 37 960 59Q982 51 977 28Z', 0, .45, 1.3),
      ], compact([-10, 90, 1125, 77], [
        p('M-4 160Q112 131 217 153M400 159Q537 120 640 150M792 157Q936 129 1105 147', 2, undefined, 2),
        p('M91 153Q130 119 158 112M478 150Q514 114 544 102M867 150Q905 117 949 99', 0, undefined, 2.1),
        p('M158 112Q129 98 121 117Q132 136 158 112ZM544 102Q516 93 506 113Q519 129 544 102ZM949 99Q921 92 910 113Q923 128 949 99Z', 0, .45, 1.2),
      ]))] },
    { id: 'thanksgiving-grain-bed', edge: 'bottom-left', width: .57, height: .225, viewBox: [1000, 330], depth: 'habitat',
      groups: [
        group('thanksgiving-bound-grain', [-10, 6, 635, 342], [180, 336], 'grass', [
          p('M113 333Q186 188 190 38M142 332Q216 202 275 77M184 333Q280 207 365 46M211 333Q309 233 441 147M88 334Q91 209 54 118M251 332Q410 241 570 225', 0, undefined, 3.2),
          p('M191 41Q164 30 154 49Q158 71 188 68ZM188 68Q211 43 224 61Q225 82 187 91ZM184 95Q151 78 148 102Q163 119 181 120ZM179 123Q208 103 217 123Q214 146 174 148Z', 0, .68, 1.6),
          p('M275 78Q250 58 237 77Q237 98 264 104ZM261 105Q292 87 299 108Q293 127 248 132ZM246 135Q220 112 208 132Q211 151 232 159Z', 0, .62, 1.6),
          p('M365 47Q344 20 327 37Q326 60 349 74ZM346 78Q382 64 387 86Q377 107 331 105ZM328 111Q305 86 291 106Q290 127 311 138ZM310 143Q348 125 353 149Q340 167 292 170Z', 0, .69, 1.7),
          p('M440 149Q424 122 402 134Q394 154 418 170ZM414 172Q450 162 449 186Q436 204 393 191ZM54 118Q26 116 27 140Q42 155 62 146ZM570 225Q552 200 530 213Q525 232 545 243Z', 1, .53, 1.7),
          p('M89 334C46 307 16 283 5 245C48 251 83 273 89 334ZM204 333C218 284 243 261 288 258C275 298 242 324 204 333ZM306 332Q323 290 370 285Q389 321 306 332Z', 2, .63, 2),
          p('M134 293Q165 309 200 313M129 305Q159 319 192 323', 1, undefined, 3),
        ], compact([-10, 177, 635, 165], [
          p('M101 334Q202 254 319 218M147 334Q268 272 419 260M199 334Q362 318 569 310', 0, undefined, 3),
          p('M318 218Q293 190 268 207Q266 232 298 233ZM290 240Q265 219 245 236Q244 257 271 256ZM417 259Q394 232 372 248Q367 272 398 275ZM570 310Q549 284 528 297Q525 320 550 326Z', 0, .68, 1.6),
          p('M103 334Q57 279 20 289Q24 326 103 334ZM224 334Q263 282 300 294Q305 326 224 334ZM382 334Q410 302 452 308Q456 334 382 334Z', 2, .6, 1.7),
          p('M135 315Q161 328 188 329', 1, undefined, 3),
        ])),
        group('thanksgiving-ground-leaves', [609, 161, 405, 181], [1000, 336], 'branch', [
          p('M1007 335Q816 246 627 300M800 279Q776 218 723 180M881 306Q934 248 971 246', 2, undefined, 3),
          p('M721 181Q666 172 661 217Q692 249 742 219ZM801 282Q817 210 866 218Q882 262 801 282ZM881 308Q900 264 941 278Q951 311 881 308ZM675 293Q638 248 616 278Q619 305 675 293Z', 1, .59, 1.9),
          p('M669 215L722 183M818 255L855 229M902 299L933 285', 0, undefined, 1.5),
        ], compact([609, 257, 405, 85], [
          p('M1007 335Q821 283 616 320', 2, undefined, 2.8),
          p('M680 314Q647 276 618 296Q620 323 680 314ZM789 314Q812 270 851 281Q862 313 789 314ZM909 326Q939 288 970 301Q970 327 909 326Z', 1, .57, 1.5),
        ]), .32),
      ] },
    { id: 'thanksgiving-open-side', edge: 'bottom-right', width: .22, height: .15, viewBox: [450, 290], depth: 'habitat', opacity: .78,
      groups: [group('thanksgiving-side-grain', [-10, 11, 475, 297], [452, 300], 'grass', [
        p('M455 301Q297 233 235 108Q191 41 68 22M348 271Q273 211 145 197', 0, undefined, 2.9),
        p('M67 23Q39 13 29 36Q44 57 77 47ZM96 31Q116 14 129 30Q133 51 108 53ZM143 52Q119 39 110 60Q117 80 163 76ZM228 111Q201 105 197 128Q211 149 242 135ZM148 197Q118 174 105 196Q113 217 164 216Z', 0, .62, 1.5),
        p('M407 287Q389 237 354 235Q329 270 407 287Z', 2, .48, 1.6),
      ], compact([-10, 174, 475, 134], [
        p('M455 301Q244 226 11 224', 0, undefined, 2.6),
        p('M56 226Q22 199 8 220Q16 246 56 226ZM154 240Q129 211 113 233Q120 256 154 240ZM270 266Q248 235 230 253Q229 273 270 266Z', 0, .58, 1.4),
      ]), .5)] },
  ], passage: huskPassage, weather: ['rain', 'wind', 'fog'],
};

const CANADA_DAY: LivingSceneArt = {
  patches: [
    { id: 'canada-maple-distance', edge: 'bottom-left', width: .58, height: .09, viewBox: [1000, 160], depth: 'far', opacity: .42,
      groups: [group('canada-rear-maple-arc', [-12, 28, 1024, 145], [70, 165], 'branch', [
        p('M-8 164C221 83 420 167 623 115Q778 64 1004 95', 2, undefined, 3),
        p('M165 119L134 98L152 92L144 69L172 82L179 41L192 70L209 52L207 88L236 72L225 103L241 110L200 127ZM669 104L640 80L659 77L650 51L677 66L685 34L699 61L721 43L712 78L744 69L729 96L745 106L703 119Z', 2, .46, 1.4),
      ], compact([-12, 91, 1024, 82], [
        p('M-8 165Q238 115 453 153T1004 129', 2, undefined, 2.6),
        p('M202 141L174 123L191 117L185 100L206 110L215 94L223 113L243 104L240 122L259 126L234 140ZM710 145L689 129L704 124L700 105L722 116L732 97L740 117L761 110L755 132L770 136L741 147Z', 2, .43, 1.3),
      ]))] },
    { id: 'canada-maple-branch', edge: 'bottom-left', width: .58, height: .225, viewBox: [1020, 340], depth: 'habitat',
      groups: [group('canada-connected-maple', [-18, 12, 1055, 344], [0, 348], 'branch', [
        p('M-10 350C98 277 231 254 381 228S692 183 1008 257M185 269Q171 176 138 116M347 235Q354 145 410 83M527 208Q520 134 570 68M709 212Q742 130 789 114M860 229Q905 201 950 170', 0, undefined, 4.2),
        p('M137 121L91 112L100 92L66 62L101 66L89 33L121 48L133 18L148 49L177 28L169 68L202 58L187 87L205 98L162 113L152 138Z', 0, .64, 2.3),
        p('M407 89L360 72L373 58L346 27L380 36L386 16L406 37L430 13L438 47L471 41L456 64L479 82L436 91L417 116Z', 1, .48, 2.2),
        p('M571 74L528 65L540 45L522 22L552 29L570 12L580 38L610 24L605 53L638 53L619 74L630 90L588 91L570 116Z', 0, .61, 2.2),
        p('M788 120L752 99L766 82L743 59L772 66L787 41L801 67L826 52L822 81L853 79L835 101L850 113L809 127L788 150Z', 0, .7, 2.4),
        p('M949 177L919 159L934 146L916 127L943 133L957 115L968 139L993 127L985 153L1015 160L989 175L992 192L964 194Z', 1, .46, 2),
        p('M140 122L133 63M138 100L109 82M143 99L174 80M411 88L410 44M571 77L571 43M790 123L789 75M789 105L769 89M793 106L822 94M950 176L956 145', 2, undefined, 1.6),
        p('M28 335C155 296 258 327 381 292L394 304Q222 348 28 346Z', 1, .42, 1.6),
      ], compact([-18, 172, 1055, 184], [
        p('M-10 350Q229 255 451 293T1008 304M202 304L184 247M451 292L493 233M707 307L750 255', 0, undefined, 3.8),
        p('M185 250L149 239L159 224L138 206L164 211L176 185L189 207L215 194L209 221L235 221L220 243L226 254L197 264Z', 0, .65, 2.1),
        p('M494 237L460 220L474 207L456 186L482 192L496 174L509 197L534 188L526 214L552 221L529 237L532 253L506 253Z', 1, .47, 2),
        p('M750 259L718 246L727 231L711 211L737 219L749 197L762 219L790 208L784 235L809 238L791 259L766 275Z', 0, .63, 2.1),
        p('M185 251L181 217M497 237L497 207M751 260L750 229', 2, undefined, 1.5),
      ]))] },
    { id: 'canada-open-ribbon', edge: 'top-right', width: .27, height: .145, viewBox: [620, 240], depth: 'habitat', opacity: .8,
      groups: [group('canada-side-ribbon', [-10, -15, 645, 263], [630, -6], 'hanging', [
        p('M630 -8C522 13 490 107 384 117C285 130 240 54 128 92Q60 116 0 206L11 223C68 144 112 113 159 108C246 98 293 153 387 137C509 117 532 36 630 9Z', 1, .49, 2.3),
        p('M625 1Q526 21 481 83M412 123Q312 148 232 110M6 214Q61 139 127 111', 0, undefined, 1.8),
        p('M129 96L141 117L125 140L112 116M493 80L504 91L492 110', 2, undefined, 2),
      ], compact([-10, -15, 645, 143], [
        p('M630 -8Q480 79 350 64T1 100L6 117Q195 64 347 81T630 8Z', 1, .48, 2),
        p('M626 0Q481 83 348 74T5 108', 0, undefined, 1.4),
      ]), .4)] },
  ], passage: leafPassage, weather: ['wind', 'rain', 'fog'],
};

const EASTER: LivingSceneArt = {
  patches: [
    { id: 'easter-soft-branch-distance', edge: 'bottom-left', width: .63, height: .09, viewBox: [1000, 150], depth: 'far', opacity: .42,
      groups: [group('easter-rear-spring', [-12, 31, 1025, 136], [70, 160], 'branch', [
        p('M-8 160Q180 77 363 136M540 152Q754 80 1005 142M224 108L239 45M752 115L797 42', 0, undefined, 2.7),
        p('M239 46C216 31 212 57 236 64C262 60 261 39 239 46ZM796 44C770 37 768 61 790 65C814 66 820 43 796 44Z', 1, .43, 1.4),
      ], compact([-12, 91, 1025, 76], [
        p('M-8 160Q184 119 361 149M579 155Q816 111 1005 148', 0, undefined, 2.4),
        p('M204 139Q213 108 238 113Q244 139 204 139ZM734 140Q750 110 780 114Q780 141 734 140Z', 0, .45, 1.2),
      ]))] },
    { id: 'easter-spring-ground', edge: 'bottom-left', width: .56, height: .215, viewBox: [960, 330], depth: 'habitat',
      groups: [
        group('easter-flowering-arc', [-15, 6, 975, 340], [5, 338], 'branch', [
          p('M-9 339C145 236 137 132 267 70Q338 35 430 38M125 210Q244 207 323 124M250 78Q233 41 244 16M342 46Q378 98 435 100M569 317Q744 269 951 292', 0, undefined, 3.6),
          p('M248 19C234 2 221 14 232 31C213 40 226 55 244 39C259 57 277 43 257 30C278 18 266 3 248 19ZM326 126C307 107 292 123 307 139C287 154 306 167 324 150C345 166 359 149 340 137C361 120 343 110 326 126Z', 1, .65, 1.7),
          p('M430 39C414 20 398 33 414 51C392 62 408 81 427 63C444 83 464 65 444 53C463 38 449 24 430 39ZM432 99C416 82 405 95 417 110C402 123 418 136 431 122C448 137 462 123 446 111C461 95 447 84 432 99Z', 1, .61, 1.6),
          p('M242 32L249 34M323 138L329 141M426 52L434 54M429 111L435 113', 2, undefined, 4),
          p('M123 218Q76 162 49 180Q52 215 123 218ZM198 147Q223 94 253 111Q260 142 198 147ZM614 305Q639 263 681 270Q686 300 614 305ZM822 288Q845 248 879 260Q887 290 822 288Z', 0, .57, 1.7),
        ], compact([-15, 177, 975, 169], [
          p('M-9 339Q105 240 235 235Q321 233 404 198M534 326Q748 285 951 311', 0, undefined, 3.1),
          p('M233 236C212 218 201 233 215 248C197 260 211 276 230 260C249 278 266 262 248 249C267 235 251 219 233 236ZM402 199C386 181 371 195 384 211C365 222 381 238 400 224C416 240 432 226 416 212C435 198 419 184 402 199Z', 1, .64, 1.6),
          p('M110 278Q70 243 48 263Q61 291 110 278ZM618 312Q652 285 680 298Q675 320 618 312Z', 0, .54, 1.4),
          p('M228 248L236 250M398 211L405 213', 2, undefined, 4),
        ])),
        group('easter-grounded-floral-eggs', [191, 124, 480, 218], [404, 336], 'drift', [
          p('M220 324Q409 285 655 329L635 339Q417 320 220 340Z', 0, .41, 1.7),
          p('M366 315C304 315 305 247 335 194C358 154 377 160 399 200C430 254 433 314 366 315Z', 2, .47, 2.5),
          p('M490 325C441 326 442 277 460 240C480 201 500 205 519 243C542 286 539 325 490 325Z', 1, .46, 2.2),
          p('M282 330C242 330 241 296 254 264C268 234 283 231 300 262C317 293 323 330 282 330Z', 1, .5, 2),
          p('M324 261Q365 234 411 263M320 275Q367 254 416 278M337 228C351 212 359 222 366 234C376 218 389 217 396 233M451 283Q487 259 529 287M449 297Q488 276 531 301M251 295Q280 277 308 300', 0, undefined, 2),
          p('M357 276C340 263 334 283 350 289C339 304 357 311 365 295C380 307 391 291 375 285C387 270 369 264 364 278Z', 1, .42, 1.4),
        ], compact([191, 216, 480, 126], [
          p('M219 335Q434 305 655 332L635 340Q429 325 219 344Z', 0, .4, 1.5),
          p('M365 327C323 327 325 289 343 257C360 229 375 231 393 261C414 297 411 327 365 327ZM491 335C455 335 455 305 468 280C482 254 499 258 512 283C529 313 528 335 491 335Z', 2, .46, 2.2),
          p('M276 338C247 338 247 315 258 293C270 272 284 277 295 297C309 321 306 338 276 338Z', 1, .48, 1.8),
          p('M333 293Q367 274 401 297M459 308Q489 290 521 312M254 316Q278 304 301 320', 0, undefined, 1.8),
          p('M357 307Q362 297 368 309Q378 303 379 313Q371 323 364 315Q351 318 357 307Z', 1, .5, 1.4),
        ]), .25),
      ] },
    { id: 'easter-top-blossom-answer', edge: 'top-right', width: .23, height: .17, viewBox: [500, 290], depth: 'habitat', opacity: .82,
      groups: [group('easter-upper-blossom-fork', [18, -15, 500, 314], [510, 0], 'branch', [
        p('M510 -4C347 44 281 119 178 154Q72 187 26 280M282 107Q233 73 177 86', 0, undefined, 3.4),
        p('M175 86C155 68 143 85 159 101C138 114 155 132 173 113C191 134 209 115 191 103C211 87 194 72 175 86ZM119 190C103 172 89 186 103 202C85 215 101 231 118 213C137 229 151 212 134 201C151 185 137 174 119 190Z', 1, .6, 1.6),
        p('M316 84Q333 42 366 49Q370 81 316 84ZM58 246Q53 211 27 209Q13 237 58 246Z', 0, .54, 1.6),
      ], compact([18, -15, 500, 173], [
        p('M510 -4Q297 72 27 139', 0, undefined, 3),
        p('M164 103C146 89 134 104 148 116C132 129 147 142 162 128C178 143 191 129 176 117C194 103 179 92 164 103Z', 1, .57, 1.5),
      ]), .45)] },
  ], passage: petalPassage, weather: ['rain', 'wind', 'fog'],
};

/** The bangpae kite has a black circular opening, four asymmetric cloth panels,
 * a connected tail and one long tether that leads back out through the frame. */
const SEOLLAL: LivingSceneArt = {
  patches: [
    { id: 'seollal-far-cloth', edge: 'bottom-right', width: .52, height: .07, viewBox: [900, 130], depth: 'far', opacity: .42,
      groups: [group('seollal-rear-fabric-fold', [-12, 38, 925, 111], [850, 140], 'hanging', [
        p('M-6 139Q169 61 332 104T598 103Q760 44 905 66L904 91Q766 64 601 124T329 122T-6 148Z', 0, .42, 1.6),
        p('M73 119Q187 83 288 103M622 117Q780 70 883 79', 2, undefined, 1.4),
      ], compact([-12, 88, 925, 61], [p('M-6 140Q184 106 332 130M577 141Q766 93 905 113L904 128Q756 107 581 148M-6 148Q184 120 332 141', 0, undefined, 2.7)]))] },
    { id: 'seollal-kite-tether', edge: 'bottom-left', width: .39, height: .35, viewBox: [720, 460], depth: 'habitat',
      groups: [group('seollal-kite-tail-and-string', [-16, 12, 750, 466], [18, 468], 'hanging', [
        p('M-8 468C49 378 92 366 125 302Q146 260 157 201', 2, undefined, 1.9),
        p('M105 36L313 57L287 276L76 249Z', 0, undefined, 3.8),
        p('M112 45L191 53L181 119Q153 116 145 143L96 131ZM202 54L305 65L293 158L233 151Q225 125 194 120Z', 0, .53, 1.5),
        p('M95 143L143 155Q144 183 172 191L164 251L85 242ZM233 163L292 172L280 266L177 252L184 191Q218 193 230 164Z', 1, .48, 1.5),
        p('M188 119C151 113 137 145 147 168C156 195 193 199 215 179C240 157 222 122 188 119Z', 2, undefined, 2.1),
        p('M107 38L145 130M313 58L225 134M287 275L217 180M76 249L153 181', 2, undefined, 1.4, .78),
        p('M180 262C215 302 293 287 334 330S427 407 514 390Q615 370 726 447L718 462C616 390 558 409 512 406C425 423 367 382 326 344S216 317 170 273Z', 1, .53, 2.2),
        p('M256 306L268 324L289 319M375 370L384 392L407 390M562 399L574 384L591 401', 2, undefined, 2.6),
        p('M300 58Q284 34 269 48M90 248Q53 264 42 246', 0, undefined, 1.5),
      ], compact([-16, 241, 750, 237], [
        p('M-8 468Q59 414 128 401', 2, undefined, 1.8),
        p('M108 266L270 278L257 429L95 417Z', 0, undefined, 3),
        p('M115 274L181 279L177 327Q155 327 150 346L106 340ZM191 280L262 286L256 350L219 348Q214 328 187 326Z', 0, .54, 1.3),
        p('M106 351L149 357Q154 379 172 381L169 417L104 409ZM220 359L255 362L249 421L180 417L183 382Q210 382 220 359Z', 1, .49, 1.3),
        p('M183 327C155 323 145 345 153 363C162 384 189 388 206 371C224 352 210 330 183 327Z', 2, undefined, 1.8),
        p('M188 425Q305 381 427 433T726 446L721 461Q576 481 424 447T183 436Z', 1, .53, 2),
        p('M360 420L371 436M609 459L622 445', 2, undefined, 2.5),
      ]))] },
    { id: 'seollal-pouch-counterweight', edge: 'bottom-right', width: .28, height: .17, viewBox: [580, 330], depth: 'habitat', opacity: .87,
      groups: [group('seollal-pouch-on-cloth', [-10, 67, 605, 279], [580, 340], 'hanging', [
        p('M-7 326Q151 264 290 298T589 317L589 338Q421 324 287 318T-7 343Z', 0, .4, 1.8),
        p('M278 139L304 161L353 154L373 126L390 132L374 168C420 206 447 288 375 310C330 325 275 313 263 277C247 230 272 191 304 161Z', 1, .57, 2.5),
        p('M306 160Q331 171 371 165M294 183Q335 195 381 184M320 186L323 243M350 186L346 237', 2, undefined, 2),
        p('M318 237L333 255L348 237M333 253L334 279M333 269L323 283L335 294L345 281Z', 2, .42, 1.5),
        p('M274 263Q332 291 404 260M271 274Q333 302 397 278', 0, undefined, 2.1),
        p('M444 319C442 246 500 217 590 195M483 247Q455 230 466 208Q497 212 502 235', 0, undefined, 2.8),
      ], compact([-10, 198, 605, 148], [
        p('M-7 331Q174 292 324 318T589 327L589 341Q424 335 323 332T-7 344Z', 0, .4, 1.6),
        p('M294 231L313 246L351 240L368 219L380 225L365 254C402 276 416 316 367 327Q307 344 288 310C271 281 290 261 313 246Z', 1, .56, 2.1),
        p('M306 259Q336 270 368 260M330 266L329 299L339 310L347 298M295 302Q334 319 386 300', 2, undefined, 1.7),
      ]), .36)] },
  ], passage: ribbonPassage, weather: ['wind', 'snow', 'fog'],
};

const CHUSEOK: LivingSceneArt = {
  patches: [
    { id: 'chuseok-full-moon', edge: 'top-right', width: .3, height: .3, viewBox: [450, 330], depth: 'far', opacity: 1,
      groups: [group('chuseok-moon-air', [6, 8, 452, 330], [450, 20], 'drift', [
        p('M340 142C340 208 291 253 228 253C165 253 116 204 116 142C116 79 167 30 228 30C291 30 340 79 340 142Z', 0, .92, 2.3),
        p('M135 127Q158 82 199 73M273 214Q300 198 309 167', 0, undefined, 1.6, .62),
        p('M11 292C112 241 172 298 265 280Q365 260 452 298M55 319Q139 286 199 308', 2, undefined, 2, .6),
      ], compact([6, 8, 452, 211], [
        p('M322 96C322 137 290 168 250 168C210 168 178 137 178 96C178 56 210 24 250 24C290 24 322 56 322 96Z', 0, .92, 2),
        p('M10 198Q145 154 273 185T452 187', 2, undefined, 1.8, .65),
      ]))] },
    { id: 'chuseok-grain-and-table', edge: 'bottom-left', width: .59, height: .22, viewBox: [1050, 320], depth: 'habitat',
      groups: [
        group('chuseok-harvest-spray', [-16, 6, 679, 334], [140, 326], 'grass', [
          p('M-9 326Q154 295 282 309M96 325C176 232 191 108 242 25M130 325Q253 174 335 78M155 326Q293 225 429 174M73 325Q71 233 35 156M210 326Q385 278 610 299', 1, undefined, 3),
          p('M242 26Q216 8 204 30Q208 52 231 51ZM229 55Q261 43 264 64Q254 83 214 79ZM211 84Q186 60 174 82Q177 102 198 108ZM195 113Q228 95 233 118Q221 141 179 139Z', 0, .63, 1.7),
          p('M336 79Q314 53 294 68Q294 90 320 99ZM317 104Q352 95 354 119Q339 138 299 128ZM297 133Q273 110 257 130Q259 151 282 156Z', 0, .57, 1.6),
          p('M430 175Q415 150 393 164Q389 184 414 193ZM411 199Q446 191 448 214Q428 230 391 222ZM36 157Q14 150 9 173Q21 190 44 182Z', 0, .58, 1.5),
          p('M88 326C39 310 14 286 7 252Q57 252 88 326ZM202 325Q218 270 263 268Q285 311 202 325ZM332 320Q365 270 404 288Q409 320 332 320Z', 1, .58, 1.8),
          p('M76 317Q153 296 221 309M102 325Q163 309 209 320', 2, undefined, 2.3),
        ], compact([-16, 166, 679, 174], [
          p('M-9 327Q161 299 303 323M84 327Q199 241 314 203M139 328Q276 284 427 271M236 328Q407 292 610 311', 1, undefined, 2.8),
          p('M314 203Q294 175 271 189Q269 211 297 221ZM288 226Q262 204 246 226Q252 247 275 245ZM429 271Q410 245 387 257Q383 278 410 286Z', 0, .64, 1.7),
          p('M86 328Q49 281 14 295Q21 324 86 328ZM245 328Q281 291 316 306Q314 329 245 328Z', 1, .59, 1.6),
        ])),
        group('chuseok-grounded-songpyeon', [598, 197, 467, 139], [1002, 326], 'drift', [
          p('M604 326C688 286 871 287 1045 322L1038 335Q813 309 604 336Z', 2, .32, 1.8),
          p('M658 297Q692 231 734 294Q703 325 658 297ZM743 297Q783 222 829 292Q796 326 743 297ZM846 303Q886 245 928 304Q890 329 846 303Z', 2, .5, 2.3),
          p('M669 293Q696 278 724 294M755 292Q784 274 818 291M856 300Q887 286 918 302', 0, undefined, 1.6),
          p('M936 320Q934 270 975 251Q988 290 936 320ZM981 322Q1010 282 1043 293Q1047 323 981 322Z', 1, .54, 1.7),
        ], compact([598, 256, 467, 80], [
          p('M604 331Q824 300 1045 327L1038 337Q814 321 604 341Z', 2, .3, 1.6),
          p('M659 318Q692 276 726 316Q697 338 659 318ZM745 319Q783 267 825 318Q791 341 745 319ZM851 324Q883 282 921 324Q887 344 851 324Z', 2, .5, 2),
          p('M670 316Q694 305 717 317M756 316Q783 301 814 317M862 322Q887 311 911 323', 0, undefined, 1.4),
        ]), .28),
      ] },
    { id: 'chuseok-distant-grass', edge: 'bottom-right', width: .29, height: .105, viewBox: [640, 200], depth: 'far', opacity: .5,
      groups: [group('chuseok-other-bank', [-10, 18, 665, 200], [642, 209], 'grass', [
        p('M647 210Q396 105 3 185M515 168Q464 80 391 32M339 151Q277 75 207 27M140 165Q100 115 28 100', 1, undefined, 2.7),
        p('M391 32Q365 20 357 41Q366 62 408 54ZM207 27Q181 19 176 42Q187 59 226 49ZM28 100Q3 90 0 114Q12 133 46 119Z', 0, .5, 1.3),
      ], compact([-10, 122, 665, 96], [
        p('M647 210Q366 149 3 190M407 174L351 142M201 175L143 144', 1, undefined, 2.3),
        p('M351 142Q322 124 311 145Q319 163 351 155ZM143 144Q115 127 105 148Q114 164 143 157Z', 0, .45, 1.2),
      ]), .46)] },
  ], passage: huskPassage, weather: ['wind', 'rain', 'fog'],
};

/** Petal shells are attached to the sag of an open festival garland. These are
 * suspended lotus lanterns, not released sky lanterns or religious symbols. */
const LOTUS_LANTERNS: LivingSceneArt = {
  patches: [
    { id: 'lotus-rear-garland', edge: 'top-left', width: .57, height: .09, viewBox: [1000, 150], depth: 'far', opacity: .43,
      groups: [group('lotus-far-suspended-arc', [-15, -15, 1030, 176], [0, 0], 'hanging', [
        p('M-8 -5C254 143 398 48 563 78Q823 146 1007 22', 2, undefined, 2.3),
        p('M233 80L233 105M572 82L572 105M828 92L828 116', 1, undefined, 1.5),
        p('M233 105Q212 88 202 110Q206 137 232 146Q260 134 265 108Q254 92 233 105ZM572 106Q551 89 543 110Q547 139 573 147Q599 132 603 110Q592 93 572 106ZM829 116Q811 103 803 121Q808 145 829 152Q852 139 856 120Q845 106 829 116Z', 0, .45, 1.5),
      ], compact([-15, -15, 1030, 113], [
        p('M-8 -5Q224 73 472 40T1007 17', 2, undefined, 2),
        p('M237 46L237 62M237 62Q218 50 212 67Q217 88 237 94Q258 85 264 66Q255 52 237 62ZM730 35L730 52M730 52Q713 39 706 56Q710 77 731 84Q753 73 756 54Q747 40 730 52Z', 0, .46, 1.4),
      ]))] },
    { id: 'lotus-main-garland', edge: 'top-left', width: .52, height: .27, viewBox: [1000, 360], depth: 'habitat',
      groups: [group('lotus-attached-lantern-arc', [-15, -16, 1030, 391], [0, 0], 'hanging', [
        p('M-8 -6C152 147 361 130 482 93Q716 12 1005 99', 2, undefined, 3.5),
        p('M161 88L161 146M411 111L411 197M754 51L754 112', 1, undefined, 2.2),
        p('M160 151Q111 118 100 169Q100 226 159 250Q219 228 225 173Q216 125 160 151Z', 0, .6, 2.5),
        p('M160 247C123 213 127 168 160 141C194 167 197 213 160 247ZM156 246C97 232 74 199 83 171Q124 171 156 246ZM165 246Q214 233 240 185Q205 166 165 246Z', 0, .42, 2),
        p('M107 217Q159 239 216 215M151 251L151 264L170 264L170 251M160 265L160 284', 1, undefined, 2.1),
        p('M411 201Q348 159 335 224Q335 291 410 321Q489 294 493 227Q478 166 411 201Z', 1, .55, 2.6),
        p('M410 317C365 274 369 224 410 188C452 225 457 275 410 317ZM405 316Q331 298 315 230Q367 223 405 316ZM416 316Q489 296 510 240Q464 220 416 316Z', 0, .46, 2.3),
        p('M347 278Q410 308 482 276M399 322L399 338L421 338L421 322M411 339L411 364', 2, undefined, 2),
        p('M754 116Q715 90 704 132Q704 178 753 200Q805 181 809 135Q798 95 754 116Z', 0, .6, 2.3),
        p('M754 198Q710 145 754 108Q799 145 754 198ZM748 196Q703 186 689 145Q722 140 748 196ZM760 196Q810 183 821 144Q793 135 760 196Z', 1, .42, 1.9),
        p('M714 173Q754 190 803 171M746 202L746 214L762 214L762 202M754 215L754 235', 2, undefined, 1.8),
      ], compact([-15, -16, 1030, 227], [
        p('M-8 -6Q239 101 480 57T1005 56', 2, undefined, 3),
        p('M169 51L169 79M444 62L444 111M758 31L758 59', 1, undefined, 1.8),
        p('M169 82Q132 55 125 94Q127 133 168 150Q214 132 217 95Q205 61 169 82ZM168 148Q137 110 169 73Q201 107 168 148ZM163 146Q123 141 111 108Q141 98 163 146ZM174 146Q216 138 228 107Q202 97 174 146Z', 0, .56, 2),
        p('M444 115Q403 84 393 128Q396 173 443 191Q494 174 499 129Q486 89 444 115ZM443 188Q407 142 443 105Q484 142 443 188ZM437 187Q392 178 381 139Q414 130 437 187ZM450 187Q495 178 509 139Q478 129 450 187Z', 1, .5, 2),
        p('M758 61Q731 42 725 72Q729 102 758 114Q791 102 793 72Q784 45 758 61ZM758 112Q733 82 758 54Q785 80 758 112Z', 0, .56, 1.8),
        p('M169 151L169 173M444 192L444 217M758 115L758 132', 2, undefined, 1.8),
      ]))] },
    { id: 'lotus-opposite-fragment', edge: 'top-right', width: .20, height: .19, viewBox: [400, 310], depth: 'habitat', opacity: .83,
      groups: [group('lotus-answer-lantern', [-10, -15, 425, 341], [408, -5], 'hanging', [
        p('M408 -6Q275 77 93 71Q48 73 1 110M165 70L165 138', 2, undefined, 2.8),
        p('M165 143Q119 112 109 161Q109 214 164 237Q220 216 225 164Q212 118 165 143ZM164 234Q125 186 165 132Q206 181 164 234ZM159 233Q107 222 91 176Q130 167 159 233ZM171 232Q225 221 240 176Q206 167 171 232Z', 0, .56, 2.2),
        p('M117 205Q164 228 216 203M155 239L155 253L174 253L174 239M165 254L165 284M157 284L157 300M172 281L172 296', 1, undefined, 1.8),
      ], compact([-10, -15, 425, 163], [
        p('M408 -6Q237 54 1 72M168 49L168 67', 2, undefined, 2.4),
        p('M169 69Q138 49 130 82Q131 116 167 130Q204 114 209 84Q200 51 169 69ZM167 128Q139 94 168 61Q197 94 167 128ZM167 132L167 148', 0, .55, 1.8),
      ]), .42)] },
  ], passage: petalPassage, weather: ['wind', 'rain', 'fog'],
};

const MASLENITSA: LivingSceneArt = {
  patches: [
    { id: 'maslenitsa-distant-cloth', edge: 'bottom-left', width: .67, height: .075, viewBox: [1100, 130], depth: 'far', opacity: .4,
      groups: [group('maslenitsa-rear-folds', [-12, 31, 1130, 118], [120, 141], 'hanging', [
        p('M-8 139C152 51 285 67 444 113Q618 164 785 93Q965 33 1105 72L1105 93Q954 53 791 113T439 132T-8 148Z', 1, .44, 1.6),
        p('M117 103Q230 76 327 100M832 94Q933 54 1041 74', 2, undefined, 1.4),
      ], compact([-12, 86, 1130, 63], [p('M-8 141Q187 93 413 129M659 144Q902 83 1105 114M-8 149Q187 107 413 141M659 149Q907 100 1105 126', 1, undefined, 2.4)]))] },
    { id: 'maslenitsa-table-edge', edge: 'bottom-left', width: .59, height: .20, viewBox: [1000, 320], depth: 'habitat',
      groups: [
        group('maslenitsa-grounded-pancakes', [-16, 45, 751, 297], [280, 334], 'drift', [
          p('M-8 300C103 240 194 261 305 288Q480 334 731 278L718 311Q527 367 300 317T-8 334Z', 1, .53, 2.2),
          p('M82 295Q227 268 380 311M459 324Q582 321 707 292M37 316L53 337M86 311L99 338M140 311L150 340M193 317L202 341M564 331L570 344M628 318L639 337', 2, undefined, 1.7),
          p('M214 239C211 265 260 287 335 286C411 286 462 265 458 238L455 256C455 278 404 301 336 300C265 300 216 281 215 261Z', 0, .52, 2.2),
          p('M211 216C211 245 261 264 334 265C407 266 461 245 460 216L458 235C455 258 407 279 335 278C264 278 213 257 213 237Z', 0, .55, 2.3),
          p('M209 193C208 222 258 242 333 242C410 243 461 220 461 192L460 211C456 233 404 255 334 255C262 255 212 234 211 214Z', 0, .57, 2.4),
          p('M207 168C208 139 258 119 332 119C408 119 460 140 461 167C461 197 408 220 334 218C259 218 208 198 207 168Z', 0, .61, 2.7),
          p('M226 165C247 139 396 136 440 165M227 177Q335 214 440 176M233 200Q335 235 437 198M234 224Q332 257 437 222M236 248Q337 280 436 245', 2, undefined, 1.8),
          p('M316 151L344 141L364 157L336 171Z', 2, .54, 1.5),
          p('M566 294Q584 247 639 228Q646 269 566 294ZM644 303Q670 266 718 278Q718 308 644 303Z', 2, .39, 1.6),
        ], compact([-16, 171, 751, 174], [
          p('M-8 320Q134 286 286 319T731 305L716 331Q517 361 283 339T-8 342Z', 1, .51, 1.9),
          p('M214 274Q334 326 458 273L456 287Q335 340 215 289ZM211 255Q335 308 461 254L458 270Q335 323 213 271Z', 0, .55, 2.1),
          p('M209 233C210 211 263 196 334 196C406 196 460 212 462 233C460 258 405 276 335 276C261 276 209 257 209 233Z', 0, .61, 2.4),
          p('M228 230Q333 197 441 232M228 245Q334 272 441 244M315 225L338 217L357 228L335 238Z', 2, undefined, 1.8),
          p('M53 329L62 344M117 324L125 345M620 331L628 345', 2, undefined, 1.6),
        ])),
        group('maslenitsa-cloth-return', [699, 134, 320, 209], [1007, 334], 'hanging', [
          p('M1007 215C919 165 855 153 780 186Q724 216 711 282L728 306C743 238 790 211 838 209Q920 210 1007 250Z', 1, .56, 2.3),
          p('M1004 230Q871 171 791 209Q749 230 727 288M983 251Q884 202 819 220M794 220L783 267L803 278L786 301', 2, undefined, 1.7),
          p('M733 295L743 318M760 274L772 292M814 258L825 277M870 259L880 280', 0, undefined, 2),
        ], compact([699, 257, 320, 86], [
          p('M1007 289Q843 242 710 302L720 323Q859 269 1007 315Z', 1, .54, 2),
          p('M1004 300Q844 257 722 312M746 312L757 334M802 294L813 314M863 291L874 312', 2, undefined, 1.6),
        ]), .32),
      ] },
    { id: 'maslenitsa-open-hem', edge: 'bottom-right', width: .24, height: .13, viewBox: [520, 240], depth: 'habitat', opacity: .78,
      groups: [group('maslenitsa-counter-fold', [-10, 21, 545, 237], [530, 250], 'hanging', [
        p('M530 231Q415 195 350 109Q271 11 159 51Q62 79 0 153L12 171Q97 78 167 73C248 54 290 102 337 128Q408 225 530 252Z', 2, .44, 2),
        p('M528 241Q407 208 342 120M162 62Q83 75 9 164', 0, undefined, 1.5),
        p('M230 77L218 105M265 92L252 117M305 115L291 140', 1, undefined, 2),
      ], compact([-10, 133, 545, 125], [
        p('M530 233Q345 164 187 172Q96 168 0 213L8 231Q105 189 187 189Q346 180 530 251Z', 2, .42, 1.8),
        p('M530 242Q344 173 188 181M33 217L41 236M83 201L93 223', 1, undefined, 1.6),
      ]), .48)] },
  ], passage: ribbonPassage, weather: ['snow', 'wind', 'fog'],
};

/** Canadian Easter uses floral curves; Pascha's eggs use small original geometric
 * bands and sit on a folded cloth beside a sparse spring twig. */
const PASCHA: LivingSceneArt = {
  patches: [
    { id: 'pascha-rear-cloth', edge: 'bottom-right', width: .62, height: .07, viewBox: [1050, 130], depth: 'far', opacity: .41,
      groups: [group('pascha-distant-hem', [-12, 34, 1080, 114], [1020, 140], 'hanging', [
        p('M-7 139C176 60 349 107 474 123Q683 150 839 80Q934 44 1055 71L1055 89Q933 63 844 101T470 140T-7 148Z', 1, .43, 1.5),
        p('M119 112Q248 78 371 110M865 87Q952 56 1041 78', 2, undefined, 1.4),
      ], compact([-12, 85, 1080, 63], [p('M-7 141Q225 96 467 134M658 141Q882 92 1055 111M-7 148Q225 111 467 145M658 148Q882 107 1055 125', 1, undefined, 2.5)]))] },
    { id: 'pascha-eggs-and-spring', edge: 'bottom-right', width: .59, height: .23, viewBox: [1000, 350], depth: 'habitat',
      groups: [
        group('pascha-geometric-eggs-on-cloth', [-15, 97, 730, 275], [365, 360], 'drift', [
          p('M-8 329C112 282 240 295 355 323Q517 364 697 305L687 339Q532 390 350 348T-8 356Z', 1, .48, 2),
          p('M90 329Q225 308 340 339M437 348Q550 359 666 324M82 339L92 360M140 337L151 362M597 348L608 367M644 333L653 353', 2, undefined, 1.6),
          p('M342 325C275 325 276 255 307 192C329 146 351 143 376 191C412 257 415 325 342 325Z', 0, .62, 2.8),
          p('M480 337C429 338 429 282 452 235C470 197 489 198 509 235C534 284 537 337 480 337Z', 2, .47, 2.4),
          p('M231 337C190 337 191 292 207 256C222 225 238 224 253 255C275 295 276 337 231 337Z', 0, .51, 2.2),
          p('M290 254L307 237L326 253L344 234L363 253L382 236L398 252M284 276L307 259L326 277L345 258L364 278L386 259L405 275M303 308L324 293L343 308L365 293L386 307', 2, undefined, 2),
          p('M444 283L461 267L479 283L497 267L521 284M441 302L460 289L480 303L499 288L527 305M202 290L216 277L232 291L249 277L265 290M200 309L217 296L233 309L252 297L269 311', 1, undefined, 1.8),
          p('M331 195L343 182L356 195L343 209ZM468 239L478 226L489 239L478 252Z', 2, .42, 1.4),
        ], compact([-15, 201, 730, 171], [
          p('M-8 343Q156 304 350 346T697 326L687 352Q529 388 350 365T-8 364Z', 1, .46, 1.8),
          p('M342 338C292 338 292 295 316 250C333 217 350 217 370 251C396 297 395 338 342 338ZM482 347C443 347 445 313 459 282C472 255 491 255 506 286C524 319 523 347 482 347Z', 0, .61, 2.4),
          p('M230 348C197 348 197 320 210 292C222 271 237 272 249 296C265 325 262 348 230 348Z', 2, .48, 2),
          p('M301 296L321 280L342 297L362 281L384 297M298 315L320 300L342 316L364 301L388 316M451 316L466 302L482 317L499 302L516 318M205 322L218 312L232 323L247 313L260 324', 2, undefined, 1.8),
          p('M92 350L102 368M604 357L616 371', 2, undefined, 1.5),
        ])),
        group('pascha-spring-twig', [671, 9, 346, 357], [1004, 360], 'branch', [
          p('M1005 358C919 304 899 214 861 154Q817 86 722 32M862 155Q898 114 901 38M909 242Q793 207 717 213M814 94Q790 43 804 13', 1, undefined, 3.4),
          p('M723 33Q695 20 687 44Q697 63 735 55ZM902 39Q920 15 937 33Q934 55 906 59ZM805 14Q782 3 775 24Q786 45 812 36ZM719 213Q692 196 679 220Q688 242 730 236Z', 1, .57, 1.6),
          p('M780 73Q753 71 749 90Q759 109 796 96ZM852 140Q877 121 891 138Q889 159 863 160ZM889 204Q862 186 848 208Q852 230 900 229ZM941 299Q968 281 980 302Q971 322 951 319Z', 2, .39, 1.6),
        ], compact([671, 211, 346, 155], [
          p('M1005 359Q888 276 681 251M867 291Q891 257 886 225', 1, undefined, 3),
          p('M682 251Q657 233 646 253Q653 277 697 274ZM887 225Q903 209 917 225Q914 246 891 247ZM782 272Q758 253 746 273Q753 294 795 294Z', 1, .54, 1.5),
        ]), .3),
      ] },
    { id: 'pascha-upper-twig', edge: 'top-left', width: .23, height: .18, viewBox: [500, 310], depth: 'habitat', opacity: .77,
      groups: [group('pascha-open-bud-arc', [-15, -15, 530, 342], [-5, 0], 'branch', [
        p('M-8 -5Q130 24 178 127Q221 218 339 238Q439 247 504 308M179 126Q247 112 273 57M339 238Q359 193 399 182', 1, undefined, 3),
        p('M272 57Q255 34 239 52Q241 73 278 78ZM400 183Q421 162 434 183Q428 205 399 203ZM150 79Q135 54 115 66Q109 87 158 98ZM224 195Q247 179 261 197Q252 219 233 217Z', 2, .4, 1.5),
      ], compact([-15, -15, 530, 171], [
        p('M-8 -5Q145 71 293 75Q425 81 504 144', 1, undefined, 2.7),
        p('M183 71Q182 44 157 46Q145 64 183 71ZM325 80Q342 60 360 75Q356 96 331 99ZM439 116Q443 88 463 93Q476 113 439 116Z', 2, .38, 1.4),
      ]), .48)] },
  ], passage: leafPassage, weather: ['rain', 'wind', 'fog'],
};

const MIMOSA: LivingSceneArt = {
  patches: [
    { id: 'mimosa-rear-foliage', edge: 'bottom-left', width: .62, height: .095, viewBox: [1050, 160], depth: 'far', opacity: .43,
      groups: [group('mimosa-dark-leaf-arc', [-12, 27, 1075, 150], [80, 169], 'branch', [
        p('M-8 170Q173 89 341 142M528 161Q740 75 1054 120', 0, undefined, 2.8),
        p('M79 141Q76 81 131 65Q151 104 79 141ZM170 126Q185 67 227 77Q236 110 170 126ZM277 136Q302 92 340 108Q341 143 277 136ZM663 131Q668 73 713 57Q739 99 663 131ZM783 115Q811 62 854 75Q861 111 783 115ZM916 114Q953 80 992 98Q976 128 916 114Z', 0, .47, 1.3),
      ], compact([-12, 96, 1075, 81], [
        p('M-8 170Q200 124 359 157M566 169Q814 114 1054 142', 0, undefined, 2.5),
        p('M99 150Q126 112 162 121Q166 147 99 150ZM260 149Q291 114 326 126Q327 152 260 149ZM718 145Q751 109 788 121Q787 146 718 145ZM914 142Q943 113 981 126Q978 148 914 142Z', 0, .45, 1.2),
      ]))] },
    { id: 'mimosa-connected-spray', edge: 'bottom-left', width: .54, height: .25, viewBox: [940, 390], depth: 'habitat',
      groups: [
        group('mimosa-principal-spray', [-15, 9, 690, 397], [16, 398], 'branch', [
          p('M-8 399C146 302 254 222 425 132Q524 80 655 43M147 291Q148 218 193 143M266 219Q273 150 333 88M394 151Q415 83 478 42M494 101Q558 125 617 105', 0, undefined, 4),
          p('M77 343C48 302 36 271 48 246C90 257 106 292 77 343ZM146 292Q91 254 98 211Q144 208 160 259ZM221 252Q190 200 218 173Q252 190 241 232ZM311 197Q339 227 380 215Q376 181 311 197ZM414 141Q451 173 500 151Q489 118 414 141Z', 0, .62, 1.8),
          p('M64 270L82 319M107 226L148 276M217 189L231 224M337 202L370 208M439 145L483 148', 2, undefined, 1.2, .55),
          p('M188 137C176 136 171 151 181 157C192 164 205 152 199 143ZM208 116C196 115 190 130 201 137C213 145 226 131 219 121ZM180 108C168 108 162 121 171 129C184 139 198 123 190 114ZM216 150C203 149 198 164 209 170C222 179 235 164 227 156Z', 1, .81, 1.5),
          p('M328 81C314 80 310 95 320 103C334 112 347 96 338 87ZM352 62C340 60 333 76 344 84C357 93 371 79 363 69ZM322 50C309 48 303 64 314 72C327 80 340 66 332 57ZM363 91C350 90 345 106 356 113C368 122 382 107 374 98Z', 1, .8, 1.5),
          p('M473 34C460 32 454 48 465 56C478 64 491 49 483 41ZM499 21C486 20 481 36 492 43C505 52 518 36 510 28ZM505 56C492 55 488 71 499 78C513 86 526 71 516 63ZM452 65C439 63 434 79 445 87C459 95 472 79 463 72Z', 1, .85, 1.5),
          p('M646 37C633 35 628 51 639 59C652 67 666 51 657 44ZM622 57C609 55 603 71 614 79C627 87 641 71 632 63ZM661 72C648 71 643 86 654 94C668 101 681 87 672 78ZM619 100C607 98 602 113 612 121C625 130 639 114 630 106Z', 1, .76, 1.5),
          p('M192 145L207 127M331 90L353 74M478 45L498 32M614 104L646 50', 0, undefined, 1.8),
        ], compact([-15, 202, 690, 204], [
          p('M-8 399Q232 273 434 276Q556 271 657 230M165 320L190 267M345 283L365 239', 0, undefined, 3.5),
          p('M103 353Q62 321 73 292Q108 291 132 329ZM238 299Q236 333 283 340Q299 313 238 299ZM460 272Q493 303 535 286Q522 258 460 272Z', 0, .6, 1.7),
          p('M188 260C175 258 170 273 181 280C195 289 208 274 199 267ZM208 242C196 240 190 254 200 262C213 272 227 257 219 249ZM360 234C347 232 342 247 353 255C366 264 380 248 371 241ZM382 219C369 217 364 232 374 240C388 248 402 234 393 225Z', 1, .82, 1.4),
          p('M629 240C616 238 611 253 622 261C636 269 649 254 640 247ZM654 221C641 219 635 235 646 243C660 251 673 235 664 228ZM607 265C594 263 589 279 600 286C614 295 627 279 618 272Z', 1, .8, 1.4),
        ])),
        group('mimosa-low-companion', [646, 158, 308, 248], [944, 398], 'branch', [
          p('M947 397Q817 291 660 227M836 315Q850 245 819 197', 0, undefined, 3),
          p('M899 355Q903 311 941 293Q963 322 899 355ZM756 275Q770 232 808 231Q822 263 756 275Z', 0, .59, 1.7),
          p('M662 220C649 218 644 234 654 242C668 250 682 235 673 227ZM684 205C671 203 666 218 677 226C691 235 704 219 695 211ZM817 190C804 188 799 204 810 211C823 220 837 205 828 196ZM831 171C819 168 812 184 823 192C836 201 850 186 841 177Z', 1, .8, 1.5),
        ], compact([646, 294, 308, 112], [
          p('M947 397Q798 331 661 328', 0, undefined, 2.6),
          p('M839 364Q857 329 888 334Q896 360 839 364Z', 0, .58, 1.5),
          p('M662 321C649 319 644 334 655 342C668 350 681 335 672 328ZM686 309C673 307 668 323 679 330C693 339 706 323 697 316Z', 1, .8, 1.4),
        ]), .28),
      ] },
    { id: 'mimosa-upper-answer', edge: 'top-right', width: .24, height: .18, viewBox: [500, 320], depth: 'habitat', opacity: .81,
      groups: [group('mimosa-hanging-branch', [8, -15, 510, 343], [510, -7], 'branch', [
        p('M511 -7C353 45 296 112 194 175Q102 216 20 309M289 116Q224 86 170 102M196 176Q173 232 134 258', 0, undefined, 3.4),
        p('M351 65Q355 108 303 118Q290 90 351 65ZM221 163Q243 210 203 233Q179 214 221 163ZM77 255Q70 213 35 210Q19 243 77 255Z', 0, .58, 1.7),
        p('M167 96C155 94 150 110 161 117C174 126 188 111 179 102ZM142 111C129 109 124 125 134 132C148 142 162 126 153 118ZM127 251C114 249 108 264 119 272C132 281 147 265 137 258ZM102 270C89 268 84 284 94 291C107 300 121 285 112 277Z', 1, .8, 1.5),
      ], compact([8, -15, 510, 167], [
        p('M511 -7Q321 74 20 139', 0, undefined, 2.8),
        p('M282 76Q294 113 337 100Q333 72 282 76Z', 0, .55, 1.5),
        p('M134 105C122 103 116 119 127 126C140 135 154 119 145 111ZM107 116C94 114 89 129 100 137C113 146 127 131 118 123Z', 1, .78, 1.4),
      ]), .44)] },
  ], passage: { kind: 'seed', viewBox: [80, 48], paths: [
    p('M5 36Q29 19 69 7M31 22Q29 10 41 9M50 14Q58 17 65 28', 0, undefined, 1.4),
    p('M42 5C33 3 29 13 36 18C45 24 53 14 47 9ZM65 24C56 22 52 33 59 38C68 43 76 34 71 28Z', 1, undefined, 1.8),
  ] }, weather: ['rain', 'wind', 'fog'],
};

export const LIVING_CELEBRATION_ART: Readonly<Record<string, LivingSceneArt | undefined>> = {
  christmas: CHRISTMAS,
  'new-year': NEW_YEAR,
  'new-year-tree': NEW_YEAR_TREE,
  'orthodox-christmas': ORTHODOX_CHRISTMAS,
  halloween: HALLOWEEN,
  thanksgiving: THANKSGIVING,
  'canada-day': CANADA_DAY,
  easter: EASTER,
  seollal: SEOLLAL,
  chuseok: CHUSEOK,
  'lotus-lanterns': LOTUS_LANTERNS,
  maslenitsa: MASLENITSA,
  pascha: PASCHA,
  mimosa: MIMOSA,
};
