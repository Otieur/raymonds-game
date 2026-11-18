/**
 * What a holding is worth.
 *
 * V0, the static return: the rent a property can expect from one turn of one opponent, from the
 * measured landing rates. It needs no fitting and knows nothing of the rest of the table.
 *
 * V1, the fitted model of each seat's chance of winning, is added below it by the valuation fit.
 */
import type { Context } from '../context.ts';
import type { GroupId, PropertySquare, StreetSquare } from '../types.ts';
import { LANDING_RATES } from './landing-rates.ts';

/** The mean roll of two dice, at which a works is valued. */
const MEAN_ROLL = 7;

function rateOf(ctx: Context, sq: PropertySquare): number {
  const index = ctx.squareIndex.get(sq.id);
  if (index === undefined) throw new Error(`Unknown property ${sq.id}`);
  return LANDING_RATES[index];
}

/**
 * Rent expected from one turn of one opponent.
 *
 * For a street, `level` says it stands in a complete group at that level (0 is bare, at the
 * group's doubled rent); without it the street is taken alone, at its bare rent. For a pass or a
 * works, `held` is how many of its kind the owner holds (1 by default).
 */
export function staticIncome(ctx: Context, sq: PropertySquare, at: { level?: number; held?: number } = {}): number {
  const rate = rateOf(ctx, sq);
  switch (sq.kind) {
    case 'street': {
      if (at.level === undefined) return rate * sq.rents[0];
      return rate * (at.level === 0 ? sq.rents[0] * ctx.rules.groupRentMultiplier : sq.rents[at.level]);
    }
    case 'transit':
      return rate * ctx.board.transitRents[(at.held ?? 1) - 1];
    case 'utility':
      return rate * ctx.board.utilityMultipliers[(at.held ?? 1) - 1] * MEAN_ROLL;
  }
}

/** The level a street reaches with its next building. */
function levelAfter(ctx: Context, level: number): number {
  return level === ctx.rules.housesBeforeHotel ? 5 : level + 1;
}

/** Extra income from the next building on a street of a complete group, per coin it costs. */
export function marginalReturn(ctx: Context, sq: StreetSquare, level: number): number {
  const gain = staticIncome(ctx, sq, { level: levelAfter(ctx, level) }) - staticIncome(ctx, sq, { level });
  return gain / sq.buildingCost;
}

/** Income of a whole group with every street at one level. */
export function groupIncome(ctx: Context, group: GroupId, level: number): number {
  const streets = ctx.groups.get(group);
  if (!streets) throw new Error(`Unknown group ${group}`);
  return streets.reduce((sum, sq) => sum + staticIncome(ctx, sq, { level }), 0);
}
