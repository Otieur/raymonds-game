/**
 * "Who is ahead" (M10): each seat's chance of winning by the valuation, as whole percentages that add up
 * to exactly 100 at every moment. Shown under the roster only when the player turns it on, and only in the
 * full game, whose games the valuation was fitted on.
 *
 * Kept free of the browser so that the tests can run it.
 */
import type { Engine, GameState } from '../../../src/index.ts';
import { contextOf } from '../../../src/sim/style-agent.ts';
import { v1 } from '../../../src/sim/valuation.ts';

/** Shares that sum to 1, as whole percentages that sum to exactly 100 (largest remainders get the leftover points). */
export function percentages(shares: number[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return shares.map(() => 0);
  const exact = shares.map((s) => (s / total) * 100);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/** Each seat's chance of winning in `state`, in the order of state.players, as whole percentages; a bankrupt seat has 0. */
export function chancesNow(engine: Engine, state: GameState): number[] {
  return percentages(v1(state.players.length).chances(contextOf(engine), state));
}
