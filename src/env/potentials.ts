/**
 * Potentials: numbers between 0 and 1 for a seat, computed from the state. The trainer pays the
 * change in a potential between two decisions of a seat, so that holding something is rewarded
 * and losing it takes the reward back.
 */
import type { Context } from '../context.ts';
import { buildingStep, ownsGroup } from '../engine/queries.ts';
import { duesInReach, holds, idleMortgages, reachRoll, rentRoll, rivalMost, spareCash, viewOf } from '../sim/measures.ts';
import type { View } from '../sim/measures.ts';
import { groupIncome } from '../sim/valuation.ts';
import type { GameState } from '../types.ts';
import type { Ledger } from './ledger.ts';

export const POTENTIALS = [
  'value',
  'groups',
  'built3',
  'passes',
  'rentRoll',
  'reach',
  'denial',
  'safety',
  'funds',
  'supply',
  'solvency',
  'eliminations',
] as const;
export type PotentialName = (typeof POTENTIALS)[number];

const PASS_VALUES = [0, 0.03, 0.13, 0.38, 1];

/** What a potential needs that is the same for every seat of one state. */
export interface PotentialContext {
  ctx: Context;
  state: GameState;
  view: View;
  chances: number[];
  ledger: Ledger;
}

let bestThree: number | null = null;

function shareOf(values: number[], seat: number): number {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  return total > 0 ? Math.max(0, values[seat]) / total : 0;
}

/** The value of one potential for the seat at `seat` in the order of play. */
export function potential(name: PotentialName, pc: PotentialContext, seat: number): number {
  const { ctx, state, view } = pc;
  const player = state.players[seat];
  if (player.bankrupt) return 0;
  const alive = state.players.map((p) => !p.bankrupt);
  const across = (f: (i: number) => number) => state.players.map((_, i) => (alive[i] ? f(i) : 0));
  switch (name) {
    case 'value':
      return pc.chances[seat];
    case 'groups': {
      bestThree ??= [...ctx.groups.keys()]
        .map((g) => groupIncome(ctx, g, 3))
        .sort((a, b) => b - a)
        .slice(0, 3)
        .reduce((a, b) => a + b, 0);
      const held = [...ctx.groups.keys()].filter((g) => ownsGroup(ctx, state, player.id, g));
      return Math.min(1, held.reduce((sum, g) => sum + groupIncome(ctx, g, 3), 0) / bestThree);
    }
    case 'built3': {
      const streets = [...ctx.groups.keys()].filter((g) => ownsGroup(ctx, state, player.id, g)).flatMap((g) => ctx.groups.get(g) ?? []);
      if (streets.length === 0) return 0;
      return streets.filter((sq) => buildingStep(ctx, state.properties[sq.id].level) >= 3).length / streets.length;
    }
    case 'passes':
      return PASS_VALUES[holds(view, 'passes', player.id)];
    case 'rentRoll':
      return shareOf(across((i) => rentRoll(ctx, state, state.players[i].id)), seat);
    case 'reach':
      return shareOf(across((i) => reachRoll(view, state.players[i])), seat);
    case 'denial': {
      let count = 0;
      for (const [group, streets] of ctx.groups) {
        if (holds(view, group, player.id) === 1 && rivalMost(view, group, player.id) === streets.length - 1) count += 1;
      }
      return count / ctx.groups.size;
    }
    case 'safety':
      return player.cash >= duesInReach(view, player).largest ? 1 : 0;
    case 'funds':
      return shareOf(across((i) => spareCash(view, state.players[i]) + idleMortgages(view, state.players[i])), seat);
    case 'supply': {
      if (state.bank.houses >= 8) return 0;
      const steps = across((i) =>
        ctx.propertyOrder.reduce(
          (sum, sq) => sum + (sq.kind === 'street' && state.properties[sq.id].owner === state.players[i].id ? buildingStep(ctx, state.properties[sq.id].level) : 0),
          0,
        ),
      );
      return shareOf(steps, seat);
    }
    case 'solvency': {
      let total = 0;
      let free = 0;
      for (const sq of ctx.propertyOrder) {
        if (state.properties[sq.id].owner !== player.id) continue;
        total += sq.price;
        if (!state.properties[sq.id].mortgaged) free += sq.price;
      }
      return total === 0 ? 1 : free / total;
    }
    case 'eliminations':
      return (pc.ledger.seats[player.id]?.eliminations ?? 0) / Math.max(1, state.players.length - 1);
  }
}

export function potentialContext(ctx: Context, state: GameState, chances: number[], ledger: Ledger): PotentialContext {
  return { ctx, state, view: viewOf(ctx, state), chances, ledger };
}
