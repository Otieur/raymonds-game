/**
 * What a holding is worth.
 *
 * V0, the static return: the rent a property can expect from one turn of one opponent, from the
 * measured landing rates. It needs no fitting and knows nothing of the rest of the table.
 *
 * V1, the fitted model of each seat's chance of winning, is added below it by the valuation fit.
 */
import type { Context } from '../context.ts';
import { buildingStep } from '../engine/queries.ts';
import type { GameState, GroupId, PropertySquare, StreetSquare } from '../types.ts';
import { LANDING_RATES } from './landing-rates.ts';
import { V1_MODELS } from './valuation-v1.ts';
import {
  ceilingRoll,
  chips,
  duesInReach,
  holds,
  idleMortgages,
  nearSets,
  reachRoll,
  rentRoll,
  rivalMost,
  spareCash,
  sumOwned,
  viewOf,
  wanted,
} from './measures.ts';

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

// ---------- V1: the fitted model of each seat's chance of winning ----------

/**
 * The features of a seat that V1 weighs. Every share is of the total over the seats still in.
 * A feature that is the same for every seat would cancel out of the model, so the round and the
 * table size act through the weights instead (see `V1Model.knots`).
 */
export const V1_FEATURES: readonly string[] = [
  'cash',
  'cashShare',
  'disposableShare',
  'exposureShare',
  'mortgagedShare',
  'rentRollShare',
  'reachGainShare',
  'roomShare',
  'nearSets',
  'needs',
  'wanted',
  'chipsShare',
  ...['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima'].flatMap((g) => [`${g}:held`, `${g}:whole`, `${g}:built`, `${g}:rival`]),
  'passes>=1',
  'passes>=2',
  'passes>=3',
  'passes=4',
  'rivalPasses>=3',
  'works=1',
  'works=2',
  'place1',
  'place2',
  'place3',
];

/** A fitted V1: weights for each feature at each knot round, interpolated between knots. */
export interface V1Model {
  knots: readonly number[];
  features: readonly string[];
  /** [knot][feature] */
  weights: readonly (readonly number[])[];
}

/** The features of every seat still in, in the order of play. */
export function v1Features(ctx: Context, state: GameState): { seats: number[]; x: number[][] } {
  const view = viewOf(ctx, state);
  const seats = state.players.flatMap((p, i) => (p.bankrupt ? [] : [i]));
  const raw = seats.map((i) => {
    const p = state.players[i];
    const reach = reachRoll(view, p);
    const roll = rentRoll(ctx, state, p.id);
    return {
      cash: p.cash,
      disposable: spareCash(view, p) + idleMortgages(view, p),
      exposure: duesInReach(view, p).expected,
      mortgaged: sumOwned(view, p, (sq) => (state.properties[sq.id].mortgaged ? sq.price : 0)),
      rentRoll: roll,
      reachGain: reach - roll,
      room: ceilingRoll(view, p) - reach,
      chips: chips(view, p),
    };
  });
  const total = (key: keyof (typeof raw)[number]) => raw.reduce((sum, r) => sum + Math.max(0, r[key]), 0);
  const totals = Object.fromEntries((Object.keys(raw[0] ?? {}) as (keyof (typeof raw)[number])[]).map((k) => [k, total(k)]));
  const share = (value: number, key: string) => (totals[key] > 0 ? Math.max(0, value) / totals[key] : 0);
  const steps = ctx.rules.housesBeforeHotel + 1;

  const x = seats.map((i, k) => {
    const p = state.players[i];
    const r = raw[k];
    const row: number[] = [
      r.cash / ctx.board.economy.startingCash,
      share(r.cash, 'cash'),
      share(r.disposable, 'disposable'),
      share(r.exposure, 'exposure'),
      share(r.mortgaged, 'mortgaged'),
      share(r.rentRoll, 'rentRoll'),
      share(r.reachGain, 'reachGain'),
      share(r.room, 'room'),
      nearSets(view, p, false),
      nearSets(view, p, true),
      wanted(view, p),
      share(r.chips, 'chips'),
    ];
    for (const group of ['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima']) {
      const streets = ctx.groups.get(group) ?? [];
      const held = holds(view, group, p.id);
      const whole = held === streets.length ? 1 : 0;
      const built = whole ? streets.reduce((sum, sq) => sum + buildingStep(ctx, state.properties[sq.id].level), 0) / (streets.length * steps) : 0;
      row.push(held / streets.length, whole, built, rivalMost(view, group, p.id) / streets.length);
    }
    const passes = holds(view, 'passes', p.id);
    const works = holds(view, 'works', p.id);
    row.push(passes >= 1 ? 1 : 0, passes >= 2 ? 1 : 0, passes >= 3 ? 1 : 0, passes === 4 ? 1 : 0);
    row.push(rivalMost(view, 'passes', p.id) >= 3 ? 1 : 0, works === 1 ? 1 : 0, works === 2 ? 1 : 0);
    row.push(i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0);
    return row;
  });
  return { seats, x };
}

/** The weights in force at a round: straight lines between knots, constant beyond the ends. */
export function weightsAt(model: V1Model, round: number): number[] {
  const { knots, weights } = model;
  if (round <= knots[0]) return [...weights[0]];
  const last = knots.length - 1;
  if (round >= knots[last]) return [...weights[last]];
  let k = 0;
  while (round > knots[k + 1]) k++;
  const t = (round - knots[k]) / (knots[k + 1] - knots[k]);
  return weights[k].map((w, f) => (1 - t) * w + t * weights[k + 1][f]);
}

/** The round of a state: turns played, over the seats at the start. */
export const roundOf = (state: GameState): number => (state.turn.number - 1) / state.players.length;

/** Each seat's chance of winning by a V1 model, in the order of state.players. Bankrupt seats get 0. */
export function v1Chances(model: V1Model, ctx: Context, state: GameState): number[] {
  const { seats, x } = v1Features(ctx, state);
  const w = weightsAt(model, roundOf(state));
  const scores = x.map((row) => row.reduce((sum, value, f) => sum + value * w[f], 0));
  const top = Math.max(...scores);
  const exp = scores.map((s) => Math.exp(s - top));
  const sum = exp.reduce((a, b) => a + b, 0);
  const chances = state.players.map(() => 0);
  seats.forEach((seat, k) => {
    chances[seat] = exp[k] / sum;
  });
  return chances;
}

/** Anything that gives each seat's chance of winning from a state. */
export interface Valuation {
  /** Each seat's chance of winning, in the order of state.players. A bankrupt seat has 0. They sum to 1. */
  chances(ctx: Context, state: GameState): number[];
}

export const valuationOf = (model: V1Model): Valuation => ({ chances: (ctx, state) => v1Chances(model, ctx, state) });

/**
 * The cash at which `seat` is indifferent between `state` and `changed` with that much less cash:
 * what the change is worth to it. Found by bisection between minus and plus `bound`.
 */
export function priceOf(valuation: Valuation, ctx: Context, state: GameState, changed: GameState, seat: string, bound: number): number {
  const index = state.players.findIndex((p) => p.id === seat);
  if (index === -1) throw new Error(`No seat ${seat}`);
  const target = valuation.chances(ctx, state)[index];
  const chanceAfterPaying = (coins: number) => {
    const paid = structuredClone(changed);
    paid.players[index].cash -= coins;
    return valuation.chances(ctx, paid)[index];
  };
  let low = -bound;
  let high = bound;
  if (chanceAfterPaying(high) >= target) return high;
  if (chanceAfterPaying(low) <= target) return low;
  for (let i = 0; i < 40 && high - low > 0.5; i++) {
    const mid = (low + high) / 2;
    if (chanceAfterPaying(mid) > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** V1 as fitted for a table size, from `src/sim/valuation-v1.ts`. */
export function v1(size: number): Valuation {
  const model = V1_MODELS[size];
  if (!model) throw new Error(`No V1 for ${size} players.`);
  return valuationOf(model);
}
