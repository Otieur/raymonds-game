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
