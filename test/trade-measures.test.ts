import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SuiteScore } from '../src/sim/offer-suite.ts';
import { addMoment, copiesBar, emptyMoments, expressible, finishBar, meanOf, oneSided, ruledBars, suiteBar } from '../src/sim/trade-measures.ts';

const side = (cash: number, properties: string[] = [], jailCards = 0) => ({ cash, properties, jailCards });

test('the shapes a draft can make: an ask with at most one property given, or a sale for cash', () => {
  assert.equal(expressible({ give: side(200), receive: side(0, ['a']) }).ok, true);
  assert.equal(expressible({ give: side(0, ['b']), receive: side(50, ['a']) }).ok, true);
  assert.equal(expressible({ give: side(0, ['b']), receive: side(300) }).ok, true);
  assert.equal(expressible({ give: side(0, ['b', 'c']), receive: side(0, ['a']) }).ok, false);
  assert.equal(expressible({ give: side(100), receive: side(0, ['a', 'd']) }).ok, false);
  assert.equal(expressible({ give: side(0, [], 1), receive: side(0, ['a']) }).ok, false);
  assert.equal(expressible({ give: side(10, ['b']), receive: side(20, ['a']) }).ok, false);
  assert.match(expressible({ give: side(0, ['b', 'c']), receive: side(0, ['a']) }).shape, /^gives 2 properties, asks 1$/);
});

test('moments give the mean and the sample variance', () => {
  const m = emptyMoments();
  for (const v of [1, 2, 3, 4]) addMoment(m, v);
  const { mean, variance } = meanOf(m);
  assert.equal(mean, 2.5);
  assert.ok(Math.abs(variance - 5 / 3) < 1e-12);
  assert.equal(oneSided(0.03, -0.01), 4);
});

test('the bars: the suite, dealing between copies, trading against ruled trading, and finishing', () => {
  const score = (acceptRight: number, refuseRight: number): SuiteScore => ({
    cases: 200, right: acceptRight + refuseRight, share: 0, low: 0, high: 0, byTemplate: {},
    byLabel: { accept: { cases: 100, right: acceptRight }, refuse: { cases: 100, right: refuseRight } },
  });
  assert.equal(suiteBar(score(90, 98)).passed, true);
  assert.equal(suiteBar(score(89, 98)).passed, false); // 11% of accepts refused
  assert.equal(suiteBar(score(95, 97)).passed, false); // 3% of refusals accepted

  const copies = emptyMoments();
  const others = emptyMoments();
  for (let i = 0; i < 200; i++) {
    addMoment(copies, 2 + (i % 3));
    addMoment(others, 2 + (i % 3));
  }
  assert.equal(copiesBar(copies, others).passed, true);
  const lopsided = emptyMoments();
  for (let i = 0; i < 200; i++) addMoment(lopsided, 6 + (i % 3));
  assert.equal(copiesBar(lopsided, others).passed, false);
  assert.equal(copiesBar(emptyMoments(), others).passed, false);

  const [learned, ruled] = ruledBars({ wins: 600, finished: 1000 }, { wins: 480, finished: 1000 }, 2);
  assert.deepEqual([learned.passed, ruled.passed], [true, true]);
  assert.equal(ruledBars({ wins: 510, finished: 1000 }, { wins: 600, finished: 1000 }, 2)[0].passed, false);
  assert.equal(ruledBars({ wins: 600, finished: 1000 }, { wins: 600, finished: 1000 }, 2)[1].passed, false);
  assert.equal(finishBar(98, 100).passed, true);
  assert.equal(finishBar(97, 100).passed, false);
});
