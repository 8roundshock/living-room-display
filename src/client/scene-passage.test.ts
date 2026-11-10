import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSAGE_GLOBAL_COOLDOWN, PASSAGE_TARGET_COOLDOWN, PASSAGE_MAX_DURATION,
  PASSAGE_MAX_INTERSECTION, PASSAGE_MAX_FOOTPRINT, passagePathMetrics, planPassage,
  type PassageInput, type PassagePlan, type PassageRect,
} from './scene-passage.ts';

const rect = (left: number, top: number, right: number, bottom: number): PassageRect => ({ left, top, right, bottom });
const target = { id: 'large-reading-value', rect: rect(650, 760, 950, 860), swept: rect(635, 750, 965, 870) };
const input = (patch: Partial<PassageInput> = {}): PassageInput => ({
  width: 1920, height: 1080, targets: [target], protectedRects: [], now: 200_000,
  lastGlobal: null, lastByTarget: {}, ...patch,
});
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);

test('a feasible edge graze makes actual nonzero contact within all bounds', () => {
  const plan = planPassage(input());
  assert.ok(plan, 'a real contact must be feasible; skipping every target is not success');
  assert.equal(plan.targetId, target.id);
  assert.ok(plan.duration > 0 && plan.duration <= PASSAGE_MAX_DURATION);
  const actual = passagePathMetrics(plan, target.rect), swept = passagePathMetrics(plan, target.swept);
  assert.ok(actual && swept);
  assert.ok(actual.intersectionMs > 0 && actual.footprintRatio > 0);
  assert.ok(actual.intersectionMs <= PASSAGE_MAX_INTERSECTION && swept.intersectionMs <= PASSAGE_MAX_INTERSECTION);
  assert.ok(actual.footprintRatio <= PASSAGE_MAX_FOOTPRINT && swept.footprintRatio <= PASSAGE_MAX_FOOTPRINT);
  close(plan.intersectionMs, Math.max(actual.intersectionMs, swept.intersectionMs));
  close(plan.footprintRatio, Math.max(actual.footprintRatio, swept.footprintRatio));
  assert.ok(plan.width <= (target.rect.right - target.rect.left) * .13);
  for (const step of plan.steps) {
    assert.ok(step.x - plan.width / 2 >= 0 && step.x + plan.width / 2 <= 1920);
    assert.ok(step.y - plan.height / 2 >= 0 && step.y + plan.height / 2 <= 1080);
  }
  const start = plan.steps[0]!, finish = plan.steps.at(-1)!;
  assert.ok(start.x + plan.width / 2 < target.swept.left || start.x - plan.width / 2 > target.swept.right);
  close(start.x, finish.x); close(start.y, finish.y);
});

test('contact uses the complete segment, not merely endpoints', () => {
  const path = { width: 10, height: 10, duration: 1000,
    steps: [{ offset: 0, x: -10, y: 5 }, { offset: 1, x: 30, y: 5 }] };
  const measured = passagePathMetrics(path, rect(0, 0, 20, 10));
  assert.ok(measured);
  close(measured.intersectionMs, 750); close(measured.footprintRatio, .5);
  const diagonal = passagePathMetrics({ ...path, steps: [{ offset: 0, x: 0, y: 0 }, { offset: 1, x: 100, y: 100 }] }, rect(40, 40, 60, 60));
  assert.ok(diagonal);
  close(diagonal.intersectionMs, 300); close(diagonal.footprintRatio, .25);
});

test('maximum overlap includes an interior quadratic extremum at a corner', () => {
  const measured = passagePathMetrics({ width: 10, height: 10, duration: 1000,
    steps: [{ offset: 0, x: -5, y: 5 }, { offset: 1, x: 5, y: 15 }] }, rect(0, 0, 10, 10));
  assert.ok(measured);
  // Width grows from0 to10 while height shrinks from10 to0. Endpoints are
  // clear but the overlap area peaks at25 square pixels halfway through.
  close(measured.intersectionMs, 1000); close(measured.footprintRatio, .25);
});

test('piecewise contacts add exact intervals and tangency remains zero area', () => {
  const path = { width: 10, height: 10, duration: 1000,
    steps: [{ offset: 0, x: -10, y: 5 }, { offset: .5, x: 30, y: 5 }, { offset: 1, x: -10, y: 5 }] };
  const measured = passagePathMetrics(path, rect(0, 0, 20, 10));
  assert.ok(measured); close(measured.intersectionMs, 750); close(measured.footprintRatio, .5);
  const tangent = passagePathMetrics({ ...path, steps: [{ offset: 0, x: -5, y: 0 }, { offset: 1, x: -5, y: 10 }] }, rect(0, 0, 20, 10));
  assert.deepEqual(tangent, { intersectionMs: 0, footprintRatio: 0 });
  const stationary = passagePathMetrics({ ...path, steps: [{ offset: 0, x: 10, y: 5 }, { offset: 1, x: 10, y: 5 }] }, rect(0, 0, 20, 10));
  assert.deepEqual(stationary, { intersectionMs: 1000, footprintRatio: .5 });
});

test('a protected corridor blocks the swept actor including corners and can force the other side', () => {
  const clear = planPassage(input()); assert.ok(clear);
  const protectedLeft = rect(560, 730, 645, 930);
  const leftMetrics = passagePathMetrics(clear, protectedLeft); assert.ok(leftMetrics && leftMetrics.intersectionMs > 0);
  const right = planPassage(input({ protectedRects: [protectedLeft] })); assert.ok(right);
  assert.ok(right.steps[0]!.x > target.swept.right);
  assert.deepEqual(passagePathMetrics(right, protectedLeft), { intersectionMs: 0, footprintRatio: 0 });
  assert.equal(planPassage(input({ protectedRects: [protectedLeft, rect(955, 730, 1040, 930)] })), null);
  assert.equal(planPassage(input({ protectedRects: [rect(0, 0, 1920, 1080)] })), null);
});

test('protected geometry inside a path remains detectable when both endpoints are clear', () => {
  const crossing = { width: 12, height: 8, duration: 4000,
    steps: [{ offset: 0, x: 100, y: 200 }, { offset: 1, x: 500, y: 200 }] };
  const label = rect(295, 198, 305, 202);
  const measured = passagePathMetrics(crossing, label);
  assert.ok(measured && measured.intersectionMs > 0 && measured.footprintRatio === 1);
  // Negative control: an endpoint-only validator would approve this unsafe path.
  assert.ok(crossing.steps.every(step => step.x + 6 < label.left || step.x - 6 > label.right));
});

test('global and per-target cooldowns include exact boundaries and future timestamps', () => {
  assert.equal(PASSAGE_GLOBAL_COOLDOWN, 60_000); assert.equal(PASSAGE_TARGET_COOLDOWN, 180_000);
  assert.equal(planPassage(input({ lastGlobal: 140_001 })), null);
  assert.ok(planPassage(input({ lastGlobal: 140_000 })));
  assert.equal(planPassage(input({ lastByTarget: { [target.id]: 20_001 } })), null);
  assert.ok(planPassage(input({ lastByTarget: { [target.id]: 20_000 } })));
  assert.equal(planPassage(input({ lastGlobal: 210_000 })), null);
  assert.equal(planPassage(input({ lastByTarget: { [target.id]: 210_000 } })), null);
  assert.ok(planPassage(input({ now: 0, lastGlobal: null })));
});

test('target selection is deterministic and skips a cooling target', () => {
  const other = { id: 'another-reading-value', rect: rect(1100, 500, 1400, 610), swept: rect(1090, 490, 1410, 620) };
  const one = planPassage(input({ targets: [target, other] }));
  const two = planPassage(input({ targets: [other, target] }));
  assert.deepEqual(one, two); assert.equal(one?.targetId, other.id);
  assert.equal(planPassage(input({ targets: [other, target], lastByTarget: { [other.id]: 199_000 } }))?.targetId, target.id);
});

test('future target envelopes constrain the whole path, while impossible swap ranges omit it', () => {
  const plan = planPassage(input()); assert.ok(plan);
  const actual = passagePathMetrics(plan, target.rect), swept = passagePathMetrics(plan, target.swept);
  assert.ok(actual && swept && swept.intersectionMs > actual.intersectionMs);
  assert.equal(planPassage(input({ targets: [{ ...target, swept: rect(0, 0, 1920, 1080) }] })), null);
  assert.equal(planPassage(input({ targets: [{ ...target, swept: rect(660, 770, 940, 850) }] })), null, 'undersized future bounds are invalid');
});

test('viewport-edge targets use the available side and never place actor corners offscreen', () => {
  const edge = { id: 'edge-value', rect: rect(3, 840, 240, 940), swept: rect(0, 830, 250, 950) };
  const plan = planPassage(input({ targets: [edge] })); assert.ok(plan);
  assert.ok(plan.steps.every(step => step.x - plan.width / 2 >= 0 && step.x + plan.width / 2 <= 1920));
  assert.ok(plan.steps[0]!.x > edge.swept.right);
  assert.equal(planPassage(input({ targets: [{ ...edge, rect: rect(-1, 840, 240, 940) }] })), null);
  assert.equal(planPassage(input({ targets: [{ id: 'small-label', rect: rect(20, 20, 60, 28), swept: rect(20, 20, 60, 28) }] })), null);
});

test('newly protected or growing text can invalidate a previously feasible plan', () => {
  const plan = planPassage(input()); assert.ok(plan);
  const formerlyEmpty = rect(plan.steps[2]!.x - 2, plan.steps[2]!.y - 2, plan.steps[2]!.x + 2, plan.steps[2]!.y + 2);
  const metrics = passagePathMetrics(plan, formerlyEmpty);
  assert.ok(metrics && metrics.intersectionMs > 0 && metrics.footprintRatio > 0);
  const old = passagePathMetrics(plan, rect(0, 0, 100, 100));
  assert.deepEqual(old, { intersectionMs: 0, footprintRatio: 0 });
});

test('negative controls exceed the exposure limits instead of silently reporting a safe passage', () => {
  const plan = planPassage(input()); assert.ok(plan);
  const slow = passagePathMetrics({ ...plan, duration: 20_000 }, target.rect);
  assert.ok(slow && slow.intersectionMs > PASSAGE_MAX_INTERSECTION);
  const cover = passagePathMetrics({ width: 300, height: 100, duration: 6000,
    steps: [{ offset: 0, x: 800, y: 810 }, { offset: 1, x: 800, y: 810 }] }, target.rect);
  assert.ok(cover && cover.footprintRatio > PASSAGE_MAX_FOOTPRINT && cover.intersectionMs > PASSAGE_MAX_INTERSECTION);
});

test('invalid geometry fails closed for planning and revalidation', () => {
  for (const patch of [{ width: 0 }, { height: Infinity }, { now: NaN }, { lastGlobal: NaN },
    { lastByTarget: { [target.id]: NaN } }, { protectedRects: [rect(0, 0, 0, 1)] }]) {
    assert.equal(planPassage(input(patch)), null);
  }
  const plan = planPassage(input()); assert.ok(plan);
  for (const path of [{ ...plan, duration: 0 }, { ...plan, width: -1 }, { ...plan, height: Infinity },
    { ...plan, steps: [] }, { ...plan, steps: [{ offset: 0, x: 1, y: 2 }, { offset: 0, x: 3, y: 4 }] },
    { ...plan, steps: [{ offset: .1, x: 1, y: 2 }, { offset: 1, x: 3, y: 4 }] },
    { ...plan, steps: [{ offset: 0, x: NaN, y: 2 }, { offset: 1, x: 3, y: 4 }] }]) {
    assert.equal(passagePathMetrics(path, target.rect), null);
  }
  assert.equal(passagePathMetrics(plan, rect(0, 0, 1, 0)), null);
});

test('feasible HD, 4K and editor-sized plans retain the same actual exposure bounds', () => {
  for (const scale of [.4, 1, 2]) {
    const scaledRect = (r: PassageRect) => rect(r.left * scale, r.top * scale, r.right * scale, r.bottom * scale);
    const scaled = { ...target, rect: scaledRect(target.rect), swept: scaledRect(target.swept) };
    const plan = planPassage(input({ width: 1920 * scale, height: 1080 * scale, targets: [scaled] }));
    assert.ok(plan, `feasible at scale${scale}`);
    const actual = passagePathMetrics(plan, scaled.rect); assert.ok(actual);
    assert.ok(actual.intersectionMs > 0 && actual.intersectionMs <= PASSAGE_MAX_INTERSECTION);
    assert.ok(plan.intersectionMs <= PASSAGE_MAX_INTERSECTION && plan.footprintRatio <= PASSAGE_MAX_FOOTPRINT);
  }
});

test('a scene-bound incursion starts and ends at a visible habitat and keeps every limit', async () => {
  const { planScenePassage } = await import('./scene-passage.ts');
  const origin = { id: 'near-habitat', x: 560, y: 1040, edge: 'bottom' as const };
  const plan = planScenePassage({ ...input(), origins: [origin] });
  assert.ok(plan); assert.equal(plan.kind, 'incursion');
  assert.deepEqual([plan.steps[0]!.x, plan.steps[0]!.y, plan.steps.at(-1)!.x, plan.steps.at(-1)!.y], [origin.x, origin.y, origin.x, origin.y]);
  for (const area of [target.rect, target.swept]) {
    const metrics = passagePathMetrics(plan, area)!;
    assert.ok(metrics.intersectionMs <= PASSAGE_MAX_INTERSECTION && metrics.footprintRatio <= PASSAGE_MAX_FOOTPRINT);
  }
  assert.ok(passagePathMetrics(plan, target.rect)!.intersectionMs > 0);
});

test('without a reachable target the passage stays in whitespace beside its habitat', async () => {
  const { planScenePassage } = await import('./scene-passage.ts');
  const far = { id: 'far-habitat', x: 1500, y: 1040, edge: 'bottom' as const };
  const reading = rect(1300, 600, 1460, 990);
  const plan = planScenePassage({ ...input({ protectedRects: [reading] }), origins: [far] });
  assert.ok(plan); assert.equal(plan.kind, 'near'); assert.equal(plan.targetId, 'habitat:far-habitat');
  assert.equal(plan.intersectionMs, 0); assert.equal(plan.footprintRatio, 0);
  for (const area of [reading, target.rect, target.swept]) assert.deepEqual(passagePathMetrics(plan, area), { intersectionMs: 0, footprintRatio: 0 }, 'a near passage never touches reading space or a movement envelope');
  for (const step of plan.steps) assert.ok(step.x - plan.width / 2 >= 0 && step.x + plan.width / 2 <= 1920 && step.y - plan.height / 2 >= 0 && step.y + plan.height / 2 <= 1080);
  assert.ok(plan.duration <= PASSAGE_MAX_DURATION && plan.width >= 40 && plan.width <= 1080 * .08);
  assert.equal(planScenePassage({ ...input({ protectedRects: [reading], lastGlobal: 200_000 - PASSAGE_GLOBAL_COOLDOWN + 1 }), origins: [far] }), null, 'one passage per minute across the display');
  assert.equal(planScenePassage({ ...input({ protectedRects: [reading], lastByTarget: { 'habitat:far-habitat': 200_000 - PASSAGE_TARGET_COOLDOWN + 1 } }), origins: [far] }), null, 'the same habitat waits three minutes');
  assert.equal(planScenePassage({ ...input({ protectedRects: [rect(0, 0, 1920, 1080)], targets: [] }), origins: [far] }), null, 'no whitespace means no passage');
  assert.equal(planScenePassage({ ...input({ targets: [] }), origins: [] }), null, 'no visible habitat means no passage');
});
