import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState } from '../src/index.ts';
import { memberAgent } from '../src/sim/league.ts';
import { answerCase, describeScore, isValidOffer, offerCandidates, scoreSuite, TEMPLATES } from '../src/sim/offer-suite.ts';
import type { SuiteCase } from '../src/sim/offer-suite.ts';
import { snapshotOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = contextOf(engine);

/** Three seats: p1 holds two streets of one group and p2 the third; p2 holds two of another and p1 the third; p3 holds a pass. */
function position(): { state: GameState; row: SnapshotRow; g: string[]; h: string[] } {
  const state = engine.newGame({ players: ['p1', 'p2', 'p3'], seed: 1, startingPlayer: 'p1' });
  const threes = [...ctx.groups.values()].filter((streets) => streets.length === 3).map((streets) => streets.map((sq) => sq.id));
  const [g, h] = threes;
  for (const [id, holder] of [[g[0], 'p1'], [g[1], 'p1'], [g[2], 'p2'], [h[0], 'p2'], [h[1], 'p2'], [h[2], 'p1']] as const) state.properties[id].owner = holder;
  const pass = ctx.propertyOrder.find((sq) => sq.kind === 'transit');
  if (pass) state.properties[pass.id].owner = 'p3';
  const row: SnapshotRow = { ...snapshotOf(ctx, state, { table: 'test-3', seed: 1, round: 10, n: 3 }), win: 0, gone: [0, 0, 0], turns: 100 };
  return { state, row, g, h };
}

test('the candidates of a position: every one is an offer the engine accepts from the proposer', () => {
  const { state, row } = position();
  const candidates = offerCandidates(ctx, state, 10, v1(3));
  const templates = new Set(candidates.map((c) => c.template));
  for (const t of ['complete-cash', 'blocking', 'swap-both', 'swap-short', 'partner-swap', 'useless-sale', 'free-street', 'pass'] as const) assert.ok(templates.has(t), t);
  for (const t of templates) assert.ok((TEMPLATES as readonly string[]).includes(t));
  for (const c of candidates) assert.ok(isValidOffer(engine, ctx, row, c.deal), `${c.cell}: ${JSON.stringify(c.deal)}`);
});

test('answering and scoring: the refuser refuses every case, the baseline takes a street that completes its group for one coin', () => {
  const { state, row, h } = position();
  const candidates = offerCandidates(ctx, state, 10, v1(3));
  const gift = candidates.find((c) => c.template === 'free-street' && c.deal.give.properties[0] === h[2]);
  const cheap = candidates.find((c) => c.cell === 'complete-cash|0.5');
  assert.ok(gift && cheap);
  assert.equal(answerCase(engine, ctx, memberAgent('baseline'), { row, deal: gift.deal }), 'accept');
  const cases: SuiteCase[] = [
    { template: gift.template, cell: gift.cell, row, deal: gift.deal, label: 'accept', receiver: 0.3, half: 0.05, proposer: -0.3, other: 0 },
    { template: cheap.template, cell: cheap.cell, row, deal: cheap.deal, label: 'refuse', receiver: -0.2, half: 0.05, proposer: 0.2, other: 0 },
  ];
  const score = scoreSuite(engine, ctx, { cases }, () => memberAgent('refuser'));
  assert.deepEqual([score.cases, score.right, score.share], [2, 1, 0.5]);
  assert.deepEqual(score.byTemplate, { 'free-street': { cases: 1, right: 0 }, 'complete-cash': { cases: 1, right: 1 } });
  assert.match(describeScore('test', score), /^suite test: 50\.0% \(\d+\.\d to \d+\.\d\) of 2 cases answered as measured; free-street 0\/1, complete-cash 1\/1$/);
});
