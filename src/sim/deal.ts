/**
 * What a deal does to every seat at the table, by a valuation: the deal sheet. With three or four
 * players a deal moves chance of winning from the seats outside it to the seats inside it, so the
 * sheet has a line for every seat, not only for the two that deal.
 *
 * Also here: a rival read as a danger (`threatOf`), a seat read as a failing player (`distressOf`),
 * and what stopping a rival's acquisition is worth to another seat (`denialWorth`).
 */
import type { Context } from '../context.ts';
import { mortgageInterest, ownsGroup, rentDue } from '../engine/queries.ts';
import type { GameState, PlayerId, PlayerState, PropertyId, PropertySquare, TradeOffer } from '../types.ts';
import { duesInReach, spareCash, viewOf } from './measures.ts';
import type { View } from './measures.ts';
import type { Valuation } from './valuation.ts';

/** A deal is an offer: what `from` gives and what it receives. */
export type Deal = TradeOffer;

const seatOf = (state: GameState, id: PlayerId): number => {
  const index = state.players.findIndex((p) => p.id === id);
  if (index === -1) throw new Error(`No seat ${id}`);
  return index;
};

/**
 * The state after a deal, without the engine: cash, properties and jail cards change hands, and
 * whoever receives a mortgaged property pays the interest on it, as the rules require. The choice
 * to lift a received mortgage is left out; it is made after the deal and is not part of it.
 */
export function applyDeal(ctx: Context, state: GameState, deal: Deal): GameState {
  const out = structuredClone(state);
  const from = out.players[seatOf(out, deal.from)];
  const to = out.players[seatOf(out, deal.to)];
  from.cash += deal.receive.cash - deal.give.cash;
  to.cash += deal.give.cash - deal.receive.cash;
  const move = (ids: PropertyId[], receiver: PlayerState) => {
    for (const id of ids) {
      out.properties[id].owner = receiver.id;
      if (out.properties[id].mortgaged) receiver.cash -= mortgageInterest(ctx, ctx.properties.get(id) as PropertySquare);
    }
  };
  move(deal.give.properties, to);
  move(deal.receive.properties, from);
  to.jailCards.push(...from.jailCards.splice(0, deal.give.jailCards));
  from.jailCards.push(...to.jailCards.splice(0, deal.receive.jailCards));
  return out;
}

export interface DealSheet {
  /** Each seat's chance before the deal, in the order of state.players. */
  before: number[];
  /** The change in each seat's chance. Sums to zero. */
  delta: number[];
  /** The state with the deal applied. */
  after: GameState;
}

/** What a deal does to every seat's chance of winning. `before` may be passed when already known. */
export function dealSheet(ctx: Context, state: GameState, deal: Deal, valuation: Valuation, before?: number[]): DealSheet {
  const start = before ?? valuation.chances(ctx, state);
  const after = applyDeal(ctx, state, deal);
  const end = valuation.chances(ctx, after);
  return { before: start, delta: end.map((chance, i) => chance - start[i]), after };
}

/**
 * The cash at which `seat` is indifferent between `state` and `changed` with that much less cash,
 * between 0 and `bound`: the most it should pay for the change. Like `priceOf` of the valuation
 * module, for purchases only, and without copying the state at every step.
 *
 * With `payee`, the cash goes to that seat and not to the bank. The answer is then lower, often by
 * a third or more: cash paid to a rival strengthens the rival, which counts against the payer. A
 * purchase from another seat is priced this way.
 */
export function worthInCoins(ctx: Context, state: GameState, changed: GameState, seat: PlayerId, valuation: Valuation, bound: number, payee?: PlayerId): number {
  const index = seatOf(state, seat);
  const target = valuation.chances(ctx, state)[index];
  const trial = structuredClone(changed);
  const cash = trial.players[index].cash;
  const other = payee === undefined ? null : trial.players[seatOf(trial, payee)];
  const otherCash = other?.cash ?? 0;
  const chanceAfterPaying = (coins: number) => {
    trial.players[index].cash = cash - coins;
    if (other) other.cash = otherCash + coins;
    return valuation.chances(ctx, trial)[index];
  };
  if (chanceAfterPaying(0) <= target) return 0;
  let low = 0;
  let high = Math.max(0, Math.min(bound, cash));
  if (chanceAfterPaying(high) >= target) return high;
  while (high - low > 1) {
    const mid = (low + high) / 2;
    if (chanceAfterPaying(mid) > target) low = mid;
    else high = mid;
  }
  return Math.floor((low + high) / 2);
}

/** Points of chance that one coin is worth to a seat now, measured over 200 coins. */
export function pointsPerCoin(ctx: Context, state: GameState, seat: PlayerId, valuation: Valuation, before?: number[]): number {
  const index = seatOf(state, seat);
  const richer = structuredClone(state);
  richer.players[index].cash += 200;
  const start = (before ?? valuation.chances(ctx, state))[index];
  return Math.max(1e-6, (valuation.chances(ctx, richer)[index] - start) / 200);
}

const playersIn = (state: GameState) => state.players.filter((p) => !p.bankrupt);

/** The rent a seat expects from the other seats' next rolls. */
export function incomeInReach(view: View, seat: PlayerId): number {
  const { ctx, state } = view;
  let expected = 0;
  for (const other of playersIn(state)) {
    if (other.id === seat) continue;
    for (let total = 2; total <= 12; total++) {
      const sq = ctx.board.squares[(other.position + total) % ctx.size];
      if (sq.kind !== 'street' && sq.kind !== 'transit' && sq.kind !== 'utility') continue;
      if (state.properties[sq.id].owner !== seat) continue;
      expected += (rentDue(ctx, state, sq, { diceTotal: total, nearest: false }) * (6 - Math.abs(7 - total))) / 36;
    }
  }
  return expected;
}

export interface Threat {
  /** The seat's chance, over an even share among the seats still in. 1 is level. */
  now: number;
  /** The same after the one acquisition that would raise it most. */
  potential: number;
  /** That property, or null when no single acquisition raises its chance. */
  wants: PropertyId | null;
  /** Buildings its spare cash would pay for now on its complete groups. */
  canBuild: number;
  /** The rent it expects from the others' next rolls. */
  income: number;
}

/**
 * A seat as a danger. The acquisitions looked at are the ones that advance a set it already holds
 * part of: a street of a group without buildings in which it holds a street, a pass or a works when it
 * holds one. A first street of a group gains little (the intervention study) and is not looked at.
 */
export function threatOf(ctx: Context, state: GameState, seat: PlayerId, valuation: Valuation, before?: number[]): Threat {
  const index = seatOf(state, seat);
  const view = viewOf(ctx, state);
  const even = 1 / Math.max(1, playersIn(state).length);
  const start = (before ?? valuation.chances(ctx, state))[index];
  const trial = structuredClone(state);
  let best = start;
  let wants: PropertyId | null = null;
  for (const sq of ctx.propertyOrder) {
    const held = state.properties[sq.id];
    if (held.owner === seat) continue;
    const set = sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works';
    if ((view.held.get(set)?.get(seat) ?? 0) === 0) continue;
    if (sq.kind === 'street' && (ctx.groups.get(sq.group) ?? []).some((mate) => state.properties[mate.id].level > 0)) continue;
    trial.properties[sq.id].owner = seat;
    const chance = valuation.chances(ctx, trial)[index];
    trial.properties[sq.id].owner = held.owner;
    if (chance > best) {
      best = chance;
      wants = sq.id;
    }
  }
  const me = state.players[index];
  const costs = [...ctx.groups.keys()]
    .filter((group) => ownsGroup(ctx, state, seat, group) && (ctx.groups.get(group) ?? []).every((sq) => !state.properties[sq.id].mortgaged))
    .flatMap((group) => (ctx.groups.get(group) ?? []).map((sq) => sq.buildingCost));
  const canBuild = costs.length === 0 ? 0 : Math.floor(spareCash(view, me) / Math.min(...costs));
  return { now: start / even, potential: best / even, wants, canBuild, income: incomeInReach(view, seat) };
}

export interface Distress {
  /** The seat's chance, over an even share among the seats still in. */
  chance: number;
  /** Its cash is below the largest rent or tax it could owe on its next roll. */
  short: boolean;
  /** The share of its property, by list price, that is mortgaged. */
  mortgaged: number;
  /** Its chance fell in each of the last three rounds on record. */
  falling: boolean;
  /** The owner of the largest rent it could owe on its next roll: the seat most likely to take its estate. */
  creditor: PlayerId | null;
}

/** A seat as a failing player. `history` is its chance at the start of recent rounds, oldest first. */
export function distressOf(ctx: Context, state: GameState, seat: PlayerId, valuation: Valuation, history: number[] = [], before?: number[]): Distress {
  const index = seatOf(state, seat);
  const me = state.players[index];
  const view = viewOf(ctx, state);
  const even = 1 / Math.max(1, playersIn(state).length);
  let total = 0;
  let mortgaged = 0;
  for (const sq of ctx.propertyOrder) {
    if (state.properties[sq.id].owner !== seat) continue;
    total += sq.price;
    if (state.properties[sq.id].mortgaged) mortgaged += sq.price;
  }
  let largest = 0;
  let creditor: PlayerId | null = null;
  for (let roll = 2; roll <= 12; roll++) {
    const sq = ctx.board.squares[(me.position + roll) % ctx.size];
    if (sq.kind !== 'street' && sq.kind !== 'transit' && sq.kind !== 'utility') continue;
    const owner = state.properties[sq.id].owner;
    if (owner === null || owner === seat) continue;
    const due = rentDue(ctx, state, sq, { diceTotal: roll, nearest: false });
    if (due > largest) {
      largest = due;
      creditor = owner;
    }
  }
  const last = history.slice(-4);
  const falling = last.length === 4 && last[1] < last[0] && last[2] < last[1] && last[3] < last[2];
  return {
    chance: (before ?? valuation.chances(ctx, state))[index] / even,
    short: me.cash < duesInReach(view, me).largest,
    mortgaged: total === 0 ? 0 : mortgaged / total,
    falling,
    creditor,
  };
}

/** Whether a seat is failing, by a style's `failBelow`: a low chance, and either short of cash or falling. */
export const isFailing = (distress: Distress, failBelow: number): boolean => distress.chance < failBelow && (distress.short || distress.falling);

/**
 * What it is worth to `me`, in points of its own chance, that `rival` does not get `property`:
 * `sale` times the difference between holding the property itself and seeing the rival hold it,
 * the rival having paid twice its list price to the holder. `sale` is the chance that the holder
 * sells to the rival; 1 when the bank holds the property.
 */
export function denialWorth(ctx: Context, state: GameState, me: PlayerId, rival: PlayerId, property: PropertyId, valuation: Valuation, sale: number): number {
  const sq = ctx.properties.get(property) as PropertySquare;
  const holder = state.properties[property].owner;
  const mine = structuredClone(state);
  mine.properties[property].owner = me;
  const theirs = structuredClone(state);
  theirs.properties[property].owner = rival;
  const rivalSeat = theirs.players[seatOf(theirs, rival)];
  const price = Math.min(rivalSeat.cash, 2 * sq.price);
  rivalSeat.cash -= price;
  if (holder !== null && holder !== rival) theirs.players[seatOf(theirs, holder)].cash += price;
  const index = seatOf(state, me);
  const gap = valuation.chances(ctx, mine)[index] - valuation.chances(ctx, theirs)[index];
  return Math.max(0, sale * gap);
}
