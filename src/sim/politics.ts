/**
 * Measures of table politics: what a seat does about the other seats (early, denying and estate
 * purchases, whom it deals with, invitations, offers at a debt), and what a table as a whole shows
 * (how often the leader goes on to win, how often the lead changes, where estates go).
 *
 * A watch is fed every applied action of one game. Everything it keeps is a number, so tallies of
 * many games add up field by field.
 */
import type { Context } from '../context.ts';
import type { GameEvent, GameState, PlayerId, PropertyId, PropertySquare, TradeOffer } from '../types.ts';
import { dealSheet, threatOf } from './deal.ts';
import { roundOf } from './valuation.ts';
import type { Valuation } from './valuation.ts';

export const DEAL_KINDS = ['early', 'completing', 'denying', 'estate', 'other'] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export interface SeatPolitics {
  games: number;
  /** Accepted asks after which the proposer, who held part of the group, still lacks a street of it; and the sum of their rounds. */
  earlyDeals: number;
  earlyRounds: number;
  /** Accepted asks for the property the proposer's strongest rival wanted. */
  denyingDeals: number;
  /** Property, by list price, bought from seats that went bankrupt within ten rounds. */
  estateValue: number;
  /** Cash paid and list price bought, by kind of purchase. An estate purchase is also counted under its other kind. */
  paid: Record<DealKind, number>;
  list: Record<DealKind, number>;
  /** Purchases by ask, and the asks made for those properties before they were sold. */
  purchases: number;
  asks: number;
  /** Accepted deals as either party, and those with the seat ranked first and ranked last at the time. */
  deals: number;
  dealsWithFirst: number;
  dealsWithLast: number;
  /** Over its deals: the change, in points, of the best-ranked seat outside the deal; and the deals that had such a seat. */
  outsiderDelta: number;
  outsiderDeals: number;
  /** Bankruptcies in which it was the creditor. */
  creditorOf: number;
  /** Invitations sent, those accepted, and those answered with an offer that was even or better for the sender. */
  invitations: number;
  invitationsAccepted: number;
  agreements: number;
  /** For its alliances: rounds from the agreement to the last deal between the two; and deals made with a seat allied at the time. */
  allianceRounds: number;
  dealsAllied: number;
  /** Offers made to a rival in a debt it could not cover, and those accepted. */
  debtOffers: number;
  debtOffersAccepted: number;
  /** Its own debts that its cash did not cover, and those that did not end in its bankruptcy. */
  ownDebts: number;
  ownDebtsSurvived: number;
  /** Offers it received from a seat that had earlier refused an offer of its own, and those it accepted. */
  spurnedOffers: number;
  spurnedAccepted: number;
}

export interface TablePolitics {
  games: number;
  finished: number;
  /** Finished games that reached round 10, and those the seat ranked first at round 10 won; the same for round 20. */
  leader10: number;
  leader10Wins: number;
  leader20: number;
  leader20Wins: number;
  /** Times the seat ranked first changed from one round to the next. */
  leadChanges: number;
  bankruptcies: number;
  /** Property, by list price, that passed at bankruptcies; the part that went to the seat ranked first before. */
  bankruptValue: number;
  toLeaderValue: number;
  /** Property sold by a debtor at a debt it could not cover; and sold, within ten rounds before, by seats that then went bankrupt. */
  soldAtDebtValue: number;
  soldBeforeValue: number;
}

const zeroKinds = (): Record<DealKind, number> => ({ early: 0, completing: 0, denying: 0, estate: 0, other: 0 });

export const emptySeatPolitics = (): SeatPolitics => ({
  games: 0, earlyDeals: 0, earlyRounds: 0, denyingDeals: 0, estateValue: 0, paid: zeroKinds(), list: zeroKinds(), purchases: 0, asks: 0,
  deals: 0, dealsWithFirst: 0, dealsWithLast: 0, outsiderDelta: 0, outsiderDeals: 0, creditorOf: 0,
  invitations: 0, invitationsAccepted: 0, agreements: 0, allianceRounds: 0, dealsAllied: 0,
  debtOffers: 0, debtOffersAccepted: 0, ownDebts: 0, ownDebtsSurvived: 0, spurnedOffers: 0, spurnedAccepted: 0,
});

/** A seat's tally as a list of numbers in a fixed order, for tallies that are kept as flat arrays. */
export const POLITICS_KEYS = [
  'games', 'earlyDeals', 'earlyRounds', 'denyingDeals', 'estateValue',
  'paidEarly', 'paidCompleting', 'paidDenying', 'paidEstate', 'paidOther', 'listEarly', 'listCompleting', 'listDenying', 'listEstate', 'listOther',
  'purchases', 'asks', 'deals', 'dealsWithFirst', 'dealsWithLast', 'outsiderDelta', 'outsiderDeals', 'creditorOf',
  'invitations', 'invitationsAccepted', 'agreements', 'allianceRounds', 'dealsAllied',
  'debtOffers', 'debtOffersAccepted', 'ownDebts', 'ownDebtsSurvived', 'spurnedOffers', 'spurnedAccepted',
] as const;
export type PoliticsKey = (typeof POLITICS_KEYS)[number];

export function namedPolitics(values: number[] | undefined): Record<PoliticsKey, number> {
  return Object.fromEntries(POLITICS_KEYS.map((key, i) => [key, values?.[i] ?? 0])) as Record<PoliticsKey, number>;
}

export function flatPolitics(seat: SeatPolitics): number[] {
  const named: Record<PoliticsKey, number> = {
    ...(seat as unknown as Record<PoliticsKey, number>),
    paidEarly: seat.paid.early, paidCompleting: seat.paid.completing, paidDenying: seat.paid.denying, paidEstate: seat.paid.estate, paidOther: seat.paid.other,
    listEarly: seat.list.early, listCompleting: seat.list.completing, listDenying: seat.list.denying, listEstate: seat.list.estate, listOther: seat.list.other,
  };
  return POLITICS_KEYS.map((key) => named[key]);
}

export const emptyTablePolitics = (): TablePolitics => ({
  games: 0, finished: 0, leader10: 0, leader10Wins: 0, leader20: 0, leader20Wins: 0, leadChanges: 0,
  bankruptcies: 0, bankruptValue: 0, toLeaderValue: 0, soldAtDebtValue: 0, soldBeforeValue: 0,
});

/** Adds one tally to another, field by field. */
export function addPolitics<T extends SeatPolitics | TablePolitics>(into: T, from: T): T {
  const add = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(b)) {
      if (typeof value === 'number') a[key] = ((a[key] as number) ?? 0) + value;
      else add(a[key] as Record<string, unknown>, value as Record<string, unknown>);
    }
  };
  add(into as unknown as Record<string, unknown>, from as unknown as Record<string, unknown>);
  return into;
}

const offerKey = (offer: TradeOffer): string =>
  `${offer.from}>${offer.to}:${offer.give.cash}+${[...offer.give.properties].sort().join(',')}/${offer.receive.cash}+${[...offer.receive.properties].sort().join(',')}`;
const pair = (a: PlayerId, b: PlayerId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Points by which an offer must favour its receiver to be counted as an invitation. */
const INVITATION_EDGE = 2;
/** Rounds within which an answer in kind makes an agreement, and a sale counts as made before a bankruptcy. */
const ANSWER_ROUNDS = 4;
const ESTATE_ROUNDS = 10;

export interface PoliticsWatch {
  /** Feed after every applied action: the state before it, its events, and the state after it. */
  note(before: GameState, events: GameEvent[], after: GameState): void;
  /** Call once when the game is over or cut off. */
  finish(state: GameState): { seats: Record<PlayerId, SeatPolitics>; table: TablePolitics };
}

export function createPoliticsWatch(ctx: Context, ids: PlayerId[], valuation: Valuation): PoliticsWatch {
  const seats: Record<PlayerId, SeatPolitics> = Object.fromEntries(ids.map((id) => [id, { ...emptySeatPolitics(), games: 1 }]));
  const table: TablePolitics = { ...emptyTablePolitics(), games: 1 };
  let round = -1;
  let leader: PlayerId | null = null;
  const leaderAt: Record<number, PlayerId | null> = {};
  const open = new Map<string, { top: PlayerId | null; wants: PropertyId | null; ranks: Record<PlayerId, number>; delta: number[]; atDebt: boolean; invitation: boolean; round: number }>();
  const asksFor = new Map<string, number>();
  const sales: { buyer: PlayerId; seller: PlayerId; value: number; cash: number; round: number }[] = [];
  const invites: { from: PlayerId; to: PlayerId; round: number }[] = [];
  const allies = new Map<string, { formed: number; last: number }>();
  let debt: { key: string; debtor: PlayerId } | null = null;
  /** `refusedBy[a]`: the seats that have refused an offer of a's. */
  const refusedBy = new Map<PlayerId, Set<PlayerId>>();

  const indexOf = (state: GameState, id: PlayerId) => state.players.findIndex((p) => p.id === id);
  const price = (id: PropertyId) => (ctx.properties.get(id) as PropertySquare).price;
  const ranksOf = (state: GameState, chances: number[]): Record<PlayerId, number> =>
    Object.fromEntries(state.players.filter((p) => !p.bankrupt).map((p) => [p.id, 1 + state.players.filter((q, i) => !q.bankrupt && chances[i] > chances[indexOf(state, p.id)]).length]));
  const leaderOf = (state: GameState, chances: number[]): PlayerId | null => {
    let best: PlayerId | null = null;
    let top = -1;
    state.players.forEach((p, i) => {
      if (!p.bankrupt && chances[i] > top) [top, best] = [chances[i], p.id];
    });
    return best;
  };

  function proposed(offer: TradeOffer, before: GameState, after: GameState): void {
    const chances = valuation.chances(ctx, after);
    const sheet = dealSheet(ctx, after, offer, valuation, chances);
    const from = indexOf(after, offer.from);
    const to = indexOf(after, offer.to);
    // The proposer's strongest rival, by what it could become, and what it wants.
    let top: PlayerId | null = null;
    let wants: PropertyId | null = null;
    let most = -1;
    for (const p of after.players) {
      if (p.bankrupt || p.id === offer.from) continue;
      const threat = threatOf(ctx, after, p.id, valuation, chances);
      if (threat.potential > most) [most, top, wants] = [threat.potential, p.id, threat.wants];
    }
    const inPlay = after.players.filter((p) => !p.bankrupt).length;
    const invitation =
      inPlay >= 3 && top !== null && top !== offer.to && sheet.delta[from] >= 0 && sheet.delta[indexOf(after, top)] <= 0 && (sheet.delta[to] - sheet.delta[from]) * 100 >= INVITATION_EDGE;
    const owed = before.pending.find((p) => p.kind === 'debt');
    const atDebt = owed !== undefined && owed.kind === 'debt' && owed.debtor === offer.to && offer.from !== owed.debtor;
    open.set(offerKey(offer), { top, wants, ranks: ranksOf(after, chances), delta: sheet.delta, atDebt, invitation, round });
    if (offer.give.properties.length === 0 && offer.receive.properties.length === 1) {
      const key = `${offer.from}:${offer.receive.properties[0]}`;
      asksFor.set(key, (asksFor.get(key) ?? 0) + 1);
    }
    if (invitation) seats[offer.from].invitations += 1;
    if (atDebt) seats[offer.from].debtOffers += 1;
    // An answer in kind to an invitation this seat accepted: an offer that is even or better for the one who invited.
    const invited = invites.findIndex((i) => i.from === offer.to && i.to === offer.from && round - i.round <= ANSWER_ROUNDS);
    if (invited !== -1 && sheet.delta[to] - sheet.delta[from] >= 0) {
      seats[offer.to].agreements += 1;
      invites.splice(invited, 1);
      if (!allies.has(pair(offer.from, offer.to))) allies.set(pair(offer.from, offer.to), { formed: round, last: round });
    }
  }

  function accepted(offer: TradeOffer, before: GameState): void {
    const info = open.get(offerKey(offer));
    open.delete(offerKey(offer));
    const inPlay = before.players.filter((p) => !p.bankrupt).length;
    for (const [me, partner] of [[offer.from, offer.to], [offer.to, offer.from]] as const) {
      seats[me].deals += 1;
      if (!info) continue;
      if (info.ranks[partner] === 1) seats[me].dealsWithFirst += 1;
      if (info.ranks[partner] === inPlay) seats[me].dealsWithLast += 1;
      const outsider = before.players.filter((p) => !p.bankrupt && p.id !== offer.from && p.id !== offer.to).sort((a, b) => info.ranks[a.id] - info.ranks[b.id])[0];
      if (outsider) {
        seats[me].outsiderDelta += info.delta[indexOf(before, outsider.id)] * 100;
        seats[me].outsiderDeals += 1;
      }
    }
    const ally = allies.get(pair(offer.from, offer.to));
    if (ally) {
      ally.last = round;
      seats[offer.from].dealsAllied += 1;
      seats[offer.to].dealsAllied += 1;
    }
    if (info?.invitation) {
      seats[offer.from].invitationsAccepted += 1;
      invites.push({ from: offer.from, to: offer.to, round });
    }
    if (info?.atDebt) {
      seats[offer.from].debtOffersAccepted += 1;
      table.soldAtDebtValue += offer.receive.properties.reduce((sum, id) => sum + price(id), 0);
    }
    // What each side bought, for the count of estates.
    for (const [buyer, seller, bought, cash] of [
      [offer.from, offer.to, offer.receive.properties, offer.give.cash - offer.receive.cash],
      [offer.to, offer.from, offer.give.properties, offer.receive.cash - offer.give.cash],
    ] as const) {
      const value = bought.reduce((sum, id) => sum + price(id), 0);
      if (value > 0) sales.push({ buyer, seller, value, cash: Math.max(0, cash), round });
    }
    if (offer.give.properties.length !== 0 || offer.receive.properties.length !== 1) return;
    // An ask: cash for one property.
    const id = offer.receive.properties[0];
    const sq = ctx.properties.get(id) as PropertySquare;
    const mine = seats[offer.from];
    let kind: DealKind = 'other';
    if (sq.kind === 'street') {
      const streets = ctx.groups.get(sq.group) ?? [];
      const held = streets.filter((mate) => before.properties[mate.id].owner === offer.from).length;
      const missing = streets.length - held - 1;
      if (missing === 0 && held > 0) kind = 'completing';
      else if (held > 0 && missing > 0) kind = 'early';
    }
    if (kind !== 'completing' && info && info.wants === id && info.top !== offer.to) kind = 'denying';
    if (kind === 'early') {
      mine.earlyDeals += 1;
      mine.earlyRounds += round;
    }
    if (kind === 'denying') mine.denyingDeals += 1;
    mine.paid[kind] += offer.give.cash;
    mine.list[kind] += sq.price;
    mine.purchases += 1;
    mine.asks += asksFor.get(`${offer.from}:${id}`) ?? 1;
    asksFor.delete(`${offer.from}:${id}`);
  }

  return {
    note(before, events, after) {
      for (const event of events) {
        if (event.type === 'TURN_STARTED') {
          const now = Math.floor(roundOf(after));
          if (now !== round) {
            round = now;
            const next = leaderOf(after, valuation.chances(ctx, after));
            if (leader !== null && next !== leader) table.leadChanges += 1;
            leader = next;
            if (round === 10 || round === 20) leaderAt[round] = leader;
          }
        }
        if (event.type === 'TRADE_PROPOSED') proposed(event.offer, before, after);
        if (event.type === 'TRADE_ACCEPTED' || event.type === 'TRADE_REJECTED') {
          // An offer from a seat that had refused the receiver before.
          if (refusedBy.get(event.offer.to)?.has(event.offer.from)) {
            seats[event.offer.to].spurnedOffers += 1;
            if (event.type === 'TRADE_ACCEPTED') seats[event.offer.to].spurnedAccepted += 1;
          }
          if (event.type === 'TRADE_REJECTED') refusedBy.set(event.offer.from, (refusedBy.get(event.offer.from) ?? new Set()).add(event.offer.to));
        }
        if (event.type === 'TRADE_ACCEPTED') accepted(event.offer, before);
        if (event.type === 'TRADE_REJECTED' || event.type === 'TRADE_CANCELLED') open.delete(offerKey(event.offer));
        if (event.type === 'BANKRUPT') {
          const value = ctx.propertyOrder.filter((sq) => before.properties[sq.id].owner === event.player).reduce((sum, sq) => sum + sq.price, 0);
          table.bankruptcies += 1;
          table.bankruptValue += value;
          if (event.creditor !== null) {
            seats[event.creditor].creditorOf += 1;
            if (event.creditor === leader) table.toLeaderValue += value;
          }
          for (const sale of sales) {
            if (sale.seller !== event.player || round - sale.round > ESTATE_ROUNDS) continue;
            seats[sale.buyer].estateValue += sale.value;
            seats[sale.buyer].paid.estate += sale.cash;
            seats[sale.buyer].list.estate += sale.value;
            table.soldBeforeValue += sale.value;
          }
        }
      }
      // Debts the debtor's cash does not cover: opened, and closed with the debtor still in.
      const owed = after.pending.find((p) => p.kind === 'debt');
      const key = owed && owed.kind === 'debt' ? `${after.turn.number}:${owed.debtor}:${owed.creditor}:${owed.amount}` : null;
      if (debt && debt.key !== key) {
        const debtor = after.players.find((p) => p.id === debt?.debtor);
        if (debtor && !debtor.bankrupt) seats[debt.debtor].ownDebtsSurvived += 1;
        debt = null;
      }
      if (!debt && owed && owed.kind === 'debt' && key !== null) {
        const debtor = after.players.find((p) => p.id === owed.debtor);
        if (debtor && !debtor.bankrupt && debtor.cash < owed.amount) {
          debt = { key, debtor: owed.debtor };
          seats[owed.debtor].ownDebts += 1;
        }
      }
    },
    finish(state) {
      if (state.winner !== null) {
        table.finished = 1;
        for (const at of [10, 20] as const) {
          if (leaderAt[at] === undefined) continue;
          table[at === 10 ? 'leader10' : 'leader20'] += 1;
          if (leaderAt[at] === state.winner) table[at === 10 ? 'leader10Wins' : 'leader20Wins'] += 1;
        }
      }
      for (const [key, ally] of allies) {
        for (const id of key.split('|')) seats[id].allianceRounds += ally.last - ally.formed;
      }
      return { seats, table };
    },
  };
}
