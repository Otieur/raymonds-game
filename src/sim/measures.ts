/**
 * Measures of a player's standing: numbers computed from a state for one seat, each a candidate
 * answer to how well that seat stands. The simulation study reports how well each tells who will
 * win; the valuation, the environment and the schools of play read them. To try another, add it
 * to MEASURES.
 */
import type { Context } from '../context.ts';
import { buildingStep, liquidationValue, netWorth, nextLevel, ownsGroup, rentDue } from '../engine/queries.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type { GameState, PlayerId, PlayerState, PropertySquare, StreetSquare } from '../types.ts';

/** Facts about a state that several measures share. */
export interface View {
  ctx: Context;
  state: GameState;
  /** For every set, how many of its properties each player holds. */
  held: Map<string, Map<PlayerId, number>>;
  /** How many properties each set has. */
  sizes: Map<string, number>;
}

/**
 * A way of putting a number on how a player stands. The study records, for each one, how well
 * it tells who will win. To try another, add it to MEASURES.
 */
export interface Measure {
  key: string;
  label: string;
  value: (view: View, player: PlayerState) => number;
  /**
   * Whether the measure enters the model of all measures together. The ones that do are chosen
   * not to repeat each other: funds, danger, rent now, rent within reach, rent beyond reach,
   * sets in the making, what rivals want, passes and mortgages.
   */
  together?: boolean;
}

/** The set a property belongs to: its group, the passes, or the works. */
export const setOf = (sq: PropertySquare): string => (sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works');

export function viewOf(ctx: Context, state: GameState): View {
  const held = new Map<string, Map<PlayerId, number>>();
  const sizes = new Map<string, number>();
  for (const sq of ctx.propertyOrder) {
    const set = setOf(sq);
    sizes.set(set, (sizes.get(set) ?? 0) + 1);
    const owner = state.properties[sq.id].owner;
    if (owner === null) continue;
    const counts = held.get(set) ?? new Map<PlayerId, number>();
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    held.set(set, counts);
  }
  return { ctx, state, held, sizes };
}

export const holds = (view: View, set: string, player: PlayerId) => view.held.get(set)?.get(player) ?? 0;

/** The most properties of a set that any one rival of `player` holds. */
export function rivalMost(view: View, set: string, player: PlayerId): number {
  let most = 0;
  for (const [owner, count] of view.held.get(set) ?? []) if (owner !== player && count > most) most = count;
  return most;
}

/** What `player` would owe on each total of two dice thrown from where they stand: the mean and the worst. */
export function duesInReach(view: View, player: PlayerState): { expected: number; largest: number } {
  const { ctx } = view;
  let expected = 0;
  let largest = 0;
  for (let total = 2; total <= 12; total++) {
    const sq = ctx.board.squares[(player.position + total) % ctx.size];
    let due = 0;
    if (sq.kind === 'tax') due = sq.amount;
    else if (sq.kind === 'street' || sq.kind === 'transit' || sq.kind === 'utility') {
      const owner = view.state.properties[sq.id].owner;
      if (owner !== null && owner !== player.id) due = rentDue(ctx, view.state, sq, { diceTotal: total, nearest: false });
    }
    expected += (due * (6 - Math.abs(7 - total))) / 36;
    largest = Math.max(largest, due);
  }
  return { expected, largest };
}

/** The rent each of a player's properties would charge now, added up (a works at a roll of 7). */
export function rentRoll(ctx: Context, state: GameState, player: PlayerId): number {
  let total = 0;
  for (const sq of ctx.propertyOrder) {
    if (state.properties[sq.id].owner === player) total += rentDue(ctx, state, sq, { diceTotal: 7, nearest: false });
  }
  return total;
}

/** The rent roll with every group the player holds built to the top. */
export function ceilingRoll(view: View, player: PlayerState): number {
  const { ctx } = view;
  let total = 0;
  for (const sq of ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner !== player.id) continue;
    if (sq.kind === 'street' && ownsGroup(ctx, view.state, player.id, sq.group)) total += sq.rents[HOTEL_LEVEL];
    else total += rentDue(ctx, view.state, sq, { diceTotal: 7, nearest: false });
  }
  return total;
}

/**
 * The rent roll the player would have after spending all the cash in hand on buildings, always
 * taking the one that adds most rent per coin and building evenly. The bank's supply is ignored.
 */
export function reachRoll(view: View, player: PlayerState): number {
  const { ctx } = view;
  const { state } = view;
  const levels = new Map<string, number>();
  const streets: StreetSquare[] = [];
  for (const [group, members] of ctx.groups) {
    if (!ownsGroup(ctx, state, player.id, group) || members.some((sq) => state.properties[sq.id].mortgaged)) continue;
    for (const sq of members) {
      levels.set(sq.id, state.properties[sq.id].level);
      streets.push(sq);
    }
  }
  const rentAt = (sq: StreetSquare, level: number) => (level === 0 ? sq.rents[0] * ctx.rules.groupRentMultiplier : sq.rents[level]);
  let roll = rentRoll(ctx, state, player.id);
  let budget = player.cash;
  for (;;) {
    let best: StreetSquare | undefined;
    let bestGain = 0;
    let bestRate = 0;
    for (const sq of streets) {
      const level = levels.get(sq.id) ?? 0;
      if (level >= HOTEL_LEVEL || sq.buildingCost > budget) continue;
      const lowest = Math.min(...(ctx.groups.get(sq.group) ?? []).map((mate) => buildingStep(ctx, levels.get(mate.id) ?? 0)));
      if (buildingStep(ctx, level) > lowest) continue;
      const gain = rentAt(sq, nextLevel(ctx, level)) - rentAt(sq, level);
      if (gain / sq.buildingCost > bestRate) {
        best = sq;
        bestGain = gain;
        bestRate = gain / sq.buildingCost;
      }
    }
    if (!best) return roll;
    levels.set(best.id, nextLevel(ctx, levels.get(best.id) ?? 0));
    budget -= best.buildingCost;
    roll += bestGain;
  }
}

/** Groups in which the player lacks exactly one street; with `fromRival`, only where a rival holds it. */
export function nearSets(view: View, player: PlayerState, fromRival: boolean): number {
  let count = 0;
  for (const [group, members] of view.ctx.groups) {
    if (holds(view, group, player.id) !== members.length - 1) continue;
    const missing = members.find((sq) => view.state.properties[sq.id].owner !== player.id);
    if (!fromRival || (missing && view.state.properties[missing.id].owner !== null)) count += 1;
  }
  return count;
}

/** Sets in which the player holds the one property a rival lacks. */
export function wanted(view: View, player: PlayerState): number {
  let count = 0;
  for (const [set, size] of view.sizes) {
    if (holds(view, set, player.id) === 1 && rivalMost(view, set, player.id) === size - 1) count += 1;
  }
  return count;
}

/**
 * What the player holds that rivals are collecting, at list price: in full where it is the last
 * property a rival lacks, in part where a rival holds some of the set, not at all otherwise.
 */
export function chips(view: View, player: PlayerState): number {
  let total = 0;
  for (const sq of view.ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner !== player.id) continue;
    const set = setOf(sq);
    const size = view.sizes.get(set) ?? 1;
    const rival = rivalMost(view, set, player.id);
    if (rival === 0) continue;
    const demand = rival === size - 1 ? 1 : set === 'passes' ? rival / (size - 1) : 0.5;
    total += demand * sq.price;
  }
  return total;
}

export function sumOwned(view: View, player: PlayerState, value: (sq: PropertySquare) => number): number {
  let total = 0;
  for (const sq of view.ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner === player.id) total += value(sq);
  }
  return total;
}

/** What mortgaging the player's property outside its complete groups would raise. */
export function idleMortgages(view: View, player: PlayerState): number {
  const { ctx } = view;
  return sumOwned(view, player, (sq) => {
    if (view.state.properties[sq.id].mortgaged) return 0;
    if (sq.kind === 'street' && ownsGroup(ctx, view.state, player.id, sq.group)) return 0;
    return sq.mortgageValue;
  });
}

export const spareCash = (view: View, p: PlayerState) => Math.max(0, p.cash - duesInReach(view, p).largest);

export const MEASURES: readonly Measure[] = [
  { key: 'netWorth', label: 'Net worth, as the rules count it', value: (view, p) => netWorth(view.ctx, view.state, p.id) },
  { key: 'cash', label: 'Cash in hand', value: (_view, p) => p.cash },
  { key: 'spare', label: 'Spare cash: above the largest rent within one roll', value: spareCash },
  {
    key: 'disposable',
    label: 'Disposable funds: spare cash plus mortgages on property outside its complete groups',
    value: (view, p) => spareCash(view, p) + idleMortgages(view, p),
    together: true,
  },
  {
    key: 'liquid',
    label: 'Everything it could raise: all mortgaged, all buildings sold',
    value: (view, p) => liquidationValue(view.ctx, view.state, p.id),
  },
  {
    key: 'exposure',
    label: 'Danger: rent and tax expected on its next roll',
    value: (view, p) => duesInReach(view, p).expected,
    together: true,
  },
  {
    key: 'rentRoll',
    label: 'Rent roll: what its properties charge now',
    value: (view, p) => rentRoll(view.ctx, view.state, p.id),
    together: true,
  },
  {
    key: 'reachGain',
    label: 'Rent it could add at once by building with the cash in hand',
    value: (view, p) => reachRoll(view, p) - rentRoll(view.ctx, view.state, p.id),
    together: true,
  },
  { key: 'reachRoll', label: 'Rent roll within reach: now plus what cash could add', value: reachRoll },
  {
    key: 'room',
    label: 'Room to grow beyond that: fully built, less the rent roll within reach',
    value: (view, p) => ceilingRoll(view, p) - reachRoll(view, p),
    together: true,
  },
  { key: 'ceilingRoll', label: 'Rent roll with its groups fully built', value: ceilingRoll },
  {
    key: 'sets',
    label: 'Complete groups',
    value: (view, p) => [...view.ctx.groups.keys()].filter((group) => ownsGroup(view.ctx, view.state, p.id, group)).length,
  },
  { key: 'nearSets', label: 'Groups one street short', value: (view, p) => nearSets(view, p, false), together: true },
  { key: 'needs', label: 'Groups one street short, the street held by a rival', value: (view, p) => nearSets(view, p, true), together: true },
  { key: 'wanted', label: 'Sets in which it holds the one property a rival lacks', value: wanted, together: true },
  {
    key: 'chips',
    label: 'Trading chips: what it holds that rivals are collecting, at list price',
    value: chips,
    together: true,
  },
  { key: 'passes', label: 'Passes held', value: (view, p) => holds(view, 'passes', p.id), together: true },
  { key: 'properties', label: 'Properties held', value: (view, p) => sumOwned(view, p, () => 1) },
  {
    key: 'buildings',
    label: 'Spent on buildings',
    value: (view, p) =>
      sumOwned(view, p, (sq) => (sq.kind === 'street' ? buildingStep(view.ctx, view.state.properties[sq.id].level) * sq.buildingCost : 0)),
  },
  {
    key: 'mortgaged',
    label: 'Property under mortgage, at list price',
    value: (view, p) => sumOwned(view, p, (sq) => (view.state.properties[sq.id].mortgaged ? sq.price : 0)),
    together: true,
  },
];
