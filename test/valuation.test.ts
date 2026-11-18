import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext } from '../src/context.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { StreetSquare } from '../src/index.ts';
import { groupIncome, marginalReturn, staticIncome } from '../src/sim/valuation.ts';

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);
const near = (actual: number, expected: number, places: number) =>
  assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -places, `${actual} is not ${expected}`);

test('V0 reproduces the static-return figures of docs/statistics.md', () => {
  near(groupIncome(ctx, 'wei', 3), 56.3, 1);
  near(groupIncome(ctx, 'han', 3), 6.3, 1);
  near(groupIncome(ctx, 'conquest', 5), 110.9, 1);
  const passes = ctx.transit.reduce((sum, sq) => sum + staticIncome(ctx, sq, { held: 4 }), 0);
  near(passes, 25.2, 1);
  const works = ctx.utilities.reduce((sum, sq) => sum + staticIncome(ctx, sq, { held: 2 }), 0);
  near(works, 4.4, 1);
  // The third building on Cao Wei: 11.91 more per 100 coins spent on the whole group.
  const wei = ctx.groups.get('wei') as readonly StreetSquare[];
  const cost = wei.reduce((sum, sq) => sum + sq.buildingCost, 0);
  near(((groupIncome(ctx, 'wei', 3) - groupIncome(ctx, 'wei', 2)) / cost) * 100, 11.91, 2);
});

test('the marginal return of a building is its extra rent times the landing rate, per coin', () => {
  const xunYu = ctx.properties.get('xun-yu') as StreetSquare;
  const rate = staticIncome(ctx, xunYu) / xunYu.rents[0];
  near(marginalReturn(ctx, xunYu, 2), (rate * (600 - 220)) / 100, 9);
  // From four farmsteads the next building is a fortress.
  near(marginalReturn(ctx, xunYu, 4), (rate * (1000 - 800)) / 100, 9);
  // Bare in a complete group means double rent.
  near(staticIncome(ctx, xunYu, { level: 0 }), rate * 16 * 2, 9);
});

import { chances as logitChances } from '../src/sim/logit.ts';
import { V1_MODELS } from '../src/sim/valuation-v1.ts';
import { priceOf, roundOf, v1, v1Chances, v1Features } from '../src/sim/valuation.ts';
import { seatIds, stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';

/** A mid-game position: seat 0 holds Cao Cao and Cao Pi, the bank holds Xun Yu. */
function midGame(n: number): ReturnType<typeof stateOf> {
  const own = [...'.'.repeat(ctx.propertyOrder.length)];
  const at = (id: string) => ctx.propertyOrder.findIndex((sq) => sq.id === id);
  own[at('cao-cao')] = '0';
  own[at('cao-pi')] = '0';
  own[at('wang-yun')] = '1';
  own[at('hulao-pass')] = String(n - 1);
  const row: SnapshotRow = {
    v: 1, table: `full-${n}`, seed: 3, round: 15, n, turn: 0,
    cash: Array.from({ length: n }, (_, i) => 900 - 100 * i), pos: Array.from({ length: n }, (_, i) => 5 * i), jail: Array(n).fill(0),
    own: own.join(''), lvl: '0'.repeat(own.length), mort: '0'.repeat(own.length),
    bank: [32, 12], win: 0, gone: Array(n).fill(0), turns: 0,
  };
  return stateOf(ctx, row);
}

test('V1 has a model for every table size, and its chances sum to one', () => {
  for (const n of [2, 3, 4]) {
    assert.ok(V1_MODELS[n], `${n} players`);
    const p = v1(n).chances(ctx, midGame(n));
    assert.equal(p.length, n);
    near(p.reduce((a, b) => a + b, 0), 1, 9);
  }
});

test('a bankrupt seat has no chance, and renaming the seats changes nothing', () => {
  const state = midGame(4);
  state.players[2].bankrupt = true;
  state.players[2].cash = 0;
  const p = v1(4).chances(ctx, state);
  assert.equal(p[2], 0);
  near(p.reduce((a, b) => a + b, 0), 1, 9);
  const renamed = structuredClone(state);
  const names = ['w', 'x', 'y', 'z'];
  const map = new Map(seatIds(4).map((id, i) => [id, names[i]]));
  renamed.players.forEach((player) => {
    player.id = map.get(player.id) as string;
  });
  for (const property of Object.values(renamed.properties)) if (property.owner) property.owner = map.get(property.owner) as string;
  renamed.turn.player = map.get(renamed.turn.player) as string;
  v1(4).chances(ctx, renamed).forEach((value, i) => near(value, p[i], 12));
});

test('the library interpolates the knots as the fit does', () => {
  for (const n of [2, 3, 4]) {
    const model = V1_MODELS[n];
    const state = midGame(n);
    const { x } = v1Features(ctx, state);
    const fw = model.features.length;
    const values = Float32Array.from(x.flat());
    const flat = Float64Array.from(model.weights.flat());
    const grouped = {
      start: Int32Array.of(0),
      count: Int8Array.of(x.length),
      winner: Int8Array.of(0),
      round: Int16Array.of(roundOf(state)),
      seatRows: x.length,
    };
    const fromFit = logitChances(model.knots, grouped, { values, width: fw, offset: 0 }, fw, Int32Array.of(0), flat);
    v1Chances(model, ctx, state).forEach((value, i) => near(value, fromFit[i], 5));
  }
});

test('priceOf: nothing for no change, more for a street that completes a group, never past its bound', () => {
  const valuation = v1(2);
  const state = midGame(2);
  near(priceOf(valuation, ctx, state, state, 'p1', 1000), 0, 0);
  const completes = structuredClone(state);
  completes.properties['xun-yu'].owner = 'p1';
  const lone = structuredClone(state);
  lone.properties['zhou-yu'].owner = 'p1';
  const whole = priceOf(valuation, ctx, state, completes, 'p1', 1000);
  const single = priceOf(valuation, ctx, state, lone, 'p1', 1000);
  assert.ok(whole > single, `${whole} should exceed ${single}`);
  assert.ok(Math.abs(priceOf(valuation, ctx, state, completes, 'p1', 50)) <= 50);
});
