/**
 * The observation: 1,023 numbers written from the point of view of the seat that decides. That seat
 * is relative seat 0 and the others follow in the order of play. Amounts are divided by the
 * starting cash unless a block says otherwise. Nothing a seat may not know is read: the order of
 * the decks, the generator and the dice queue stay out.
 */
import type { Context } from '../context.ts';
import { ownsGroup, rentDue } from '../engine/queries.ts';
import { dealSheet, incomeInReach } from '../sim/deal.ts';
import type { Deal } from '../sim/deal.ts';
import { LANDING_RATES } from '../sim/landing-rates.ts';
import { duesInReach, holds, MEASURES, rivalMost, setOf } from '../sim/measures.ts';
import type { View } from '../sim/measures.ts';
import { dealsBetween, goodwillOf } from '../sim/relations.ts';
import { roundOf, v1 } from '../sim/valuation.ts';
import type { GameState, PlayerId } from '../types.ts';
import type { Draft } from './actions.ts';
import { habits } from './ledger.ts';
import type { Ledger } from './ledger.ts';

/**
 * Version 3 (M3b) widens the risk block to every seat and adds the relations and deal-sheet blocks.
 * Version 4 (M9, 20 November 2026) appends the offer block: whether the offer on the table, or the
 * seat's draft, completes a group for the proposer and for the receiver, how many buildings each
 * could then pay for on it, and two marks of the draft (naming a sale's partner; a sale). It is at
 * the end so that a model trained on version 3 is widened by zero weights (`mlp.ts`).
 */
export const OBS_VERSION = 4;
/** The rounds in which goodwill halves, as the observation reads it: the default of a style's `allyTurns`. */
const GOODWILL_HALF_LIFE = 4;
export const SEATS = 4;

export const OBS_LAYOUT: readonly { name: string; offset: number; length: number }[] = (() => {
  const blocks: [string, number][] = [
    ['seats', SEATS * 48],
    ['standing', SEATS * MEASURES.length],
    ['habits', SEATS * 12],
    ['properties', 28 * 15],
    ['facts', 28 * 7],
    ['table', 47],
    ['risk', SEATS * 3],
    ['relations', 6 + (SEATS - 1) * 6],
    ['sheet', SEATS],
    ['offer', 6],
  ];
  let offset = 0;
  return blocks.map(([name, length]) => {
    const block = { name, offset, length };
    offset += length;
    return block;
  });
})();
export const OBS_SIZE = OBS_LAYOUT.reduce((sum, block) => sum + block.length, 0);

export const DECISION_KINDS = ['free', 'buy', 'auction', 'buildingAuction', 'debt', 'mortgageTransfer', 'jailExit', 'trade'] as const;

export function decisionKind(state: GameState): number {
  const top = state.pending[state.pending.length - 1];
  return top ? DECISION_KINDS.indexOf(top.kind) : 0;
}

export interface ObserveInput {
  ctx: Context;
  state: GameState;
  view: View;
  /** The deciding seat's index in the order of play. */
  seat: number;
  ledger: Ledger;
  chances: number[];
  draft: Draft;
  proposalsLeft: number;
  shortGame: boolean;
}

/**
 * The group a deal completes for one side, if any (a street group it will hold whole and did not
 * before), and how many buildings that side could pay for on it with its cash after the deal, at
 * most 15.
 */
export function completion(ctx: Context, state: GameState, deal: Deal, side: PlayerId): { group: string; buildings: number } | null {
  const ownerAfter = (id: string): PlayerId | null => {
    if (deal.give.properties.includes(id)) return deal.to;
    if (deal.receive.properties.includes(id)) return deal.from;
    return state.properties[id].owner;
  };
  const moved = [...deal.give.properties, ...deal.receive.properties];
  for (const [group, streets] of ctx.groups) {
    if (!streets.some((sq) => moved.includes(sq.id))) continue;
    const whole = streets.every((sq) => ownerAfter(sq.id) === side);
    const before = streets.every((sq) => state.properties[sq.id].owner === side);
    if (!whole || before) continue;
    const player = state.players.find((p) => p.id === side);
    const cash = (player?.cash ?? 0) + (side === deal.to ? deal.give.cash - deal.receive.cash : deal.receive.cash - deal.give.cash);
    const cost = streets[0].buildingCost;
    return { group, buildings: Math.max(0, Math.min(15, Math.floor(cash / cost))) };
  }
  return null;
}

export function observe(input: ObserveInput): Float32Array {
  const { ctx, state, view, seat, ledger, chances, draft } = input;
  const out = new Float32Array(OBS_SIZE);
  const stake = ctx.board.economy.startingCash;
  const n = state.players.length;
  const me = state.players[seat];
  const rel = (i: number) => (i - seat + n) % n;
  const relOf = (id: PlayerId | null) => {
    const i = state.players.findIndex((p) => p.id === id);
    return i === -1 ? -1 : rel(i);
  };
  let at = 0;
  const put = (value: number) => {
    out[at++] = Number.isFinite(value) ? value : 0;
  };
  const block = (name: string) => {
    const b = OBS_LAYOUT.find((x) => x.name === name);
    if (!b || b.offset !== at) throw new Error(`Observation block ${name} is out of place at ${at}.`);
  };

  // Seats
  block('seats');
  for (let r = 0; r < SEATS; r++) {
    const i = r < n ? (seat + r) % n : -1;
    const p = i === -1 ? null : state.players[i];
    put(p ? 1 : 0);
    put(p?.bankrupt ? 1 : 0);
    put(p && state.turn.player === p.id ? 1 : 0);
    put(p ? p.cash / stake : 0);
    for (let sq = 0; sq < 40; sq++) put(p && !p.bankrupt && p.position === sq ? 1 : 0);
    put(p?.inJail ? 1 : 0);
    put(p ? p.jailRolls / 3 : 0);
    put(p ? p.jailCards.length / 2 : 0);
    put(i === -1 ? 0 : chances[i]);
  }

  // Standing: each measure as the seat's share of the table's total
  block('standing');
  const values = MEASURES.map((m) => state.players.map((p) => (p.bankrupt ? 0 : Math.max(0, m.value(view, p)))));
  const totals = values.map((row) => row.reduce((a, b) => a + b, 0));
  for (let r = 0; r < SEATS; r++) {
    const i = r < n ? (seat + r) % n : -1;
    MEASURES.forEach((_, k) => put(i === -1 || totals[k] === 0 ? 0 : values[k][i] / totals[k]));
  }

  // Habits
  block('habits');
  for (let r = 0; r < SEATS; r++) {
    const i = r < n ? (seat + r) % n : -1;
    const row = i === -1 ? new Array(12).fill(0) : habits(ledger, state.players[i].id, stake);
    for (const value of row) put(value);
  }

  // Properties
  block('properties');
  const top = state.pending[state.pending.length - 1];
  const subject = top && (top.kind === 'buy' || top.kind === 'auction' || top.kind === 'mortgageTransfer') ? top.property : null;
  const offer = top?.kind === 'trade' ? top.offer : null;
  const receiving = new Set<string>();
  const giving = new Set<string>();
  if (offer && offer.to === me.id) {
    offer.give.properties.forEach((id) => receiving.add(id));
    offer.receive.properties.forEach((id) => giving.add(id));
  }
  if (draft.stage !== 'none') {
    if (draft.ask >= 0) receiving.add(ctx.propertyOrder[draft.ask].id);
    if (draft.give !== null) giving.add(ctx.propertyOrder[draft.give].id);
  }
  for (const sq of ctx.propertyOrder) {
    const p = state.properties[sq.id];
    const owner = p.owner === null ? -1 : relOf(p.owner);
    put(owner === -1 ? 1 : 0);
    for (let r = 0; r < SEATS; r++) put(owner === r ? 1 : 0);
    put(p.mortgaged ? 1 : 0);
    for (let level = 0; level <= 5; level++) put(p.level === level ? 1 : 0);
    put(subject === sq.id ? 1 : 0);
    put(receiving.has(sq.id) ? 1 : 0);
    put(giving.has(sq.id) ? 1 : 0);
  }

  // Property facts
  block('facts');
  for (const sq of ctx.propertyOrder) {
    const set = setOf(sq);
    const size = view.sizes.get(set) ?? 1;
    const mine = holds(view, set, me.id);
    const rival = rivalMost(view, set, me.id);
    const owner = state.properties[sq.id].owner;
    put(sq.price / 400);
    put(LANDING_RATES[ctx.squareIndex.get(sq.id) ?? 0] * 20);
    put(owner === null ? 0 : rentDue(ctx, state, sq, { diceTotal: 7, nearest: false }) / 2000);
    put(mine / size);
    put(rival / size);
    put(sq.kind === 'street' && owner !== me.id && mine === size - 1 ? 1 : 0);
    const forRival =
      sq.kind === 'street' &&
      state.players.some((p) => !p.bankrupt && p.id !== me.id && p.id !== owner && holds(view, set, p.id) === size - 1 && !ownsGroup(ctx, state, p.id, sq.group));
    put(forRival ? 1 : 0);
  }

  // Table
  block('table');
  put(state.turn.phase === 'preRoll' ? 1 : 0);
  put(state.turn.phase === 'postRoll' ? 1 : 0);
  put(state.turn.doubles / 2);
  put(Math.min(1, (state.turn.number - 1) / n / 100));
  put(state.bank.houses / ctx.board.economy.houses);
  put(state.bank.hotels / ctx.board.economy.hotels);
  const kind = decisionKind(state);
  DECISION_KINDS.forEach((_, k) => put(kind === k ? 1 : 0));
  put(top?.kind === 'buildingAuction' && top.building === 'hotel' ? 1 : 0);
  put(draft.stage === 'none' ? 1 : 0);
  put(draft.stage === 'give' ? 1 : 0);
  put(draft.stage === 'cash' ? 1 : 0);
  const auction = top && (top.kind === 'auction' || top.kind === 'buildingAuction') ? top : null;
  put(auction ? auction.highBid / stake : 0);
  for (let r = 0; r < SEATS; r++) put(auction && auction.bidders.some((id) => relOf(id) === r) ? 1 : 0);
  for (let r = 0; r < SEATS; r++) put(auction && auction.highBidder !== null && relOf(auction.highBidder) === r ? 1 : 0);
  const debt = top?.kind === 'debt' ? top : null;
  put(debt ? debt.amount / stake : 0);
  put(debt && debt.creditor === null ? 1 : 0);
  for (let r = 1; r < SEATS; r++) put(debt && debt.creditor !== null && relOf(debt.creditor) === r ? 1 : 0);
  let cashIn = 0;
  let cashOut = 0;
  let other = -1;
  if (offer && offer.to === me.id) {
    cashIn = offer.give.cash;
    cashOut = offer.receive.cash;
    other = relOf(offer.from);
  } else if (draft.stage !== 'none') {
    other = relOf(draft.partner);
  }
  put(cashIn / stake);
  put(cashOut / stake);
  for (let r = 1; r < SEATS; r++) put(other === r ? 1 : 0);
  for (const size of [2, 3, 4]) put(n === size ? 1 : 0);
  put(state.players.filter((p) => !p.bankrupt).length / SEATS);
  put(input.shortGame ? 1 : 0);
  for (let place = 0; place < SEATS; place++) put(seat === place ? 1 : 0);
  put(input.proposalsLeft / 2);

  // Risk, for every seat: the largest rent or tax it could owe on its next roll, the amount expected, and the rent it expects from the others' next rolls
  block('risk');
  for (let r = 0; r < SEATS; r++) {
    const p = r < n ? state.players[(seat + r) % n] : null;
    if (!p || p.bankrupt) {
      put(0);
      put(0);
      put(0);
      continue;
    }
    const dues = duesInReach(view, p);
    put(dues.largest / stake);
    put(dues.expected / stake);
    put(incomeInReach(view, p.id) / stake);
  }

  // Relations: deals between each pair of seats, then for each rival what has passed between it and me
  block('relations');
  const { relations } = ledger;
  const idAt = (r: number): PlayerId | null => (r < n ? state.players[(seat + r) % n].id : null);
  const round = Math.floor(roundOf(state));
  for (let a = 0; a < SEATS; a++) {
    for (let b = a + 1; b < SEATS; b++) {
      const x = idAt(a);
      const y = idAt(b);
      put(x && y ? Math.min(1, dealsBetween(relations, x, y) / 5) : 0);
    }
  }
  for (let r = 1; r < SEATS; r++) {
    const rival = idAt(r);
    if (!rival) {
      for (let k = 0; k < 6; k++) put(0);
      continue;
    }
    const last = relations.lastOffer[me.id]?.[rival];
    put(Math.min(1, (relations.refusals[me.id]?.[rival] ?? 0) / 10));
    put(Math.min(1, (relations.refusals[rival]?.[me.id] ?? 0) / 10));
    put(Math.min(1, (relations.refusedMultiple[me.id]?.[rival] ?? 0) / 4));
    put(last === undefined ? 1 : Math.min(1, (state.turn.number - last) / 20));
    put(Math.max(-1, Math.min(1, goodwillOf(relations, me.id, rival, round, GOODWILL_HALF_LIFE) / 10)));
    put(Math.max(-1, Math.min(1, goodwillOf(relations, rival, me.id, round, GOODWILL_HALF_LIFE) / 10)));
  }

  // The deal sheet: what the offer on the table, or my draft so far, does to each seat's chance
  block('sheet');
  let deal: Deal | null = null;
  if (offer && offer.to === me.id) deal = offer;
  else if (draft.stage !== 'none' && draft.partner !== null) {
    deal = {
      from: me.id,
      to: draft.partner,
      give: { cash: 0, properties: draft.give === null ? [] : [ctx.propertyOrder[draft.give].id], jailCards: 0 },
      receive: { cash: 0, properties: draft.ask >= 0 ? [ctx.propertyOrder[draft.ask].id] : [], jailCards: 0 },
    };
  }
  const delta = deal ? dealSheet(ctx, state, deal, v1(n), chances).delta : null;
  for (let r = 0; r < SEATS; r++) put(delta && r < n ? delta[(seat + r) % n] : 0);

  // The offer: what the deal on the table, or the draft so far (with no cash yet), completes, and the draft's marks.
  block('offer');
  const proposerSide = deal ? completion(ctx, state, deal, deal.from) : null;
  const receiverSide = deal ? completion(ctx, state, deal, deal.to) : null;
  put(proposerSide ? 1 : 0);
  put(receiverSide ? 1 : 0);
  put(proposerSide ? proposerSide.buildings / 15 : 0);
  put(receiverSide ? receiverSide.buildings / 15 : 0);
  put(draft.stage === 'partner' ? 1 : 0);
  put(draft.stage !== 'none' && draft.ask < 0 ? 1 : 0);

  if (at !== OBS_SIZE) throw new Error(`The observation has ${at} numbers, not ${OBS_SIZE}.`);
  return out;
}
