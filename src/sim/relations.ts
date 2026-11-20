/**
 * What has passed between each pair of seats in one game: deals, refusals, the price of each ask,
 * what each seat has shown another by the offers it made, and every seat's chance round by round.
 * It is built from the game's events alone, so the record rebuilt from a whole event list equals
 * the one kept during play.
 *
 * The counts cost nothing and are always kept. The parts that read a valuation (what an offer
 * showed, the chance log) are kept only once `tracking` is set, which an agent does when its style
 * reads them; games among today's agent never pay for them.
 */
import type { Context } from '../context.ts';
import type { GameEvent, GameState, PlayerId, PropertyId, StreetSquare, TradeOffer } from '../types.ts';
import { dealSheet } from './deal.ts';
import { roundOf } from './valuation.ts';
import type { Valuation } from './valuation.ts';

export interface Ask {
  partner: PlayerId;
  /** The share of the property's worth that was offered. */
  share: number;
  cash: number;
  /** The turn of the ask. */
  turn: number;
  /** Times this ask has been refused. */
  refused: number;
  /** The holder's chance of winning at the time of the latest ask. */
  chance: number;
  /** Whether the holder was short of cash at the time. */
  short: boolean;
}

export interface Relations {
  tracking: boolean;
  /** Accepted deals between two seats, by `pairKey`. */
  deals: Record<string, number>;
  /** `refusals[a][b]`: offers from a that b refused. */
  refusals: Record<PlayerId, Record<PlayerId, number>>;
  /** For each seat: offers received and accepted. */
  answers: Record<PlayerId, { received: number; accepted: number }>;
  /** For each seat: whether each of its latest twelve offers was accepted, oldest first. */
  sent: Record<PlayerId, boolean[]>;
  /** `asks[a][property]`: a's latest ask for a property. */
  asks: Record<PlayerId, Record<PropertyId, Ask>>;
  /** Each seat's chance at the start of the latest eight rounds, oldest first. */
  chances: Record<PlayerId, number[]>;
  /** `shown[a][b]`: what b has shown a, as dated entries in points of chance. */
  shown: Record<PlayerId, Record<PlayerId, { round: number; points: number }[]>>;
  /** `taken[a][b]`: favours a accepted from b (offers from b in a's favour), as dated entries in points. */
  taken: Record<PlayerId, Record<PlayerId, { round: number; points: number }[]>>;
  /** `refusedMultiple[a][b]`: the highest cash, over list price, that b has refused from a for one property. */
  refusedMultiple: Record<PlayerId, Record<PlayerId, number>>;
  /** `lastOffer[a][b]`: the turn of a's latest offer to b. */
  lastOffer: Record<PlayerId, Record<PlayerId, number>>;
  /** Offers on the table: the receiver's gain less the proposer's by the deal sheet, in points. */
  open: Record<string, number>;
  /** The last round whose chances were logged. */
  round: number;
}

export function createRelations(): Relations {
  return { tracking: false, deals: {}, refusals: {}, answers: {}, sent: {}, asks: {}, chances: {}, shown: {}, taken: {}, refusedMultiple: {}, lastOffer: {}, open: {}, round: -1 };
}

export const pairKey = (a: PlayerId, b: PlayerId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const offerKey = (offer: TradeOffer): string =>
  `${offer.from}>${offer.to}:${offer.give.cash}+${[...offer.give.properties].sort().join(',')}/${offer.receive.cash}+${[...offer.receive.properties].sort().join(',')}`;

/** What one offer may add to or take from goodwill, in points. */
const OFFER_BOUND = 5;
/** Taken for refusing an offer that was even or better for the refuser. */
const REFUSED_FAIR = 2;
/** Taken for buying the street another seat lacked. */
const DENIED = 5;

function show(relations: Relations, to: PlayerId, by: PlayerId, round: number, points: number): void {
  const list = ((relations.shown[to] ??= {})[by] ??= []);
  list.push({ round, points });
  if (list.length > 24) list.shift();
}

/**
 * Feeds the events of an applied action to the record. `state` is the state after the action.
 * Without `ctx` and `valuation`, or before `tracking` is set, only the counts are kept.
 */
export function noteRelations(relations: Relations, state: GameState, events: GameEvent[], ctx?: Context, valuation?: Valuation): void {
  const reads = relations.tracking && ctx !== undefined && valuation !== undefined;
  const round = Math.floor(roundOf(state));
  for (const event of events) {
    if (event.type === 'TURN_STARTED' && reads && round !== relations.round) {
      relations.round = round;
      const chances = (valuation as Valuation).chances(ctx as Context, state);
      state.players.forEach((p, i) => {
        const log = (relations.chances[p.id] ??= []);
        log.push(chances[i]);
        if (log.length > 8) log.shift();
      });
    }
    if (event.type === 'TRADE_PROPOSED') (relations.lastOffer[event.offer.from] ??= {})[event.offer.to] = state.turn.number;
    if (event.type === 'TRADE_PROPOSED' && reads) {
      // The offer is on the table and nothing has changed hands yet, so the sheet reads the position it was made in.
      const { offer } = event;
      const sheet = dealSheet(ctx as Context, state, offer, valuation as Valuation);
      const from = state.players.findIndex((p) => p.id === offer.from);
      const to = state.players.findIndex((p) => p.id === offer.to);
      relations.open[offerKey(offer)] = (sheet.delta[to] - sheet.delta[from]) * 100;
    }
    if (event.type === 'TRADE_ACCEPTED' || event.type === 'TRADE_REJECTED' || event.type === 'TRADE_CANCELLED') {
      const { offer } = event;
      const key = offerKey(offer);
      const favour = relations.open[key];
      delete relations.open[key];
      if (event.type === 'TRADE_CANCELLED') continue;
      const accepted = event.type === 'TRADE_ACCEPTED';
      const answer = (relations.answers[offer.to] ??= { received: 0, accepted: 0 });
      answer.received += 1;
      const sent = (relations.sent[offer.from] ??= []);
      sent.push(accepted);
      if (sent.length > 12) sent.shift();
      if (accepted) {
        answer.accepted += 1;
        relations.deals[pairKey(offer.from, offer.to)] = (relations.deals[pairKey(offer.from, offer.to)] ?? 0) + 1;
      } else {
        const refused = (relations.refusals[offer.from] ??= {});
        refused[offer.to] = (refused[offer.to] ?? 0) + 1;
        if (offer.receive.properties.length === 1) {
          const ask = relations.asks[offer.from]?.[offer.receive.properties[0]];
          if (ask && ask.partner === offer.to) ask.refused += 1;
          const price = ctx?.properties.get(offer.receive.properties[0])?.price;
          if (price && offer.give.properties.length === 0) {
            const by = (relations.refusedMultiple[offer.from] ??= {});
            by[offer.to] = Math.max(by[offer.to] ?? 0, offer.give.cash / price);
          }
        }
      }
      if (favour !== undefined) {
        // What the proposer showed the receiver: in full if taken, by half if not.
        const bounded = Math.max(-OFFER_BOUND, Math.min(OFFER_BOUND, favour));
        show(relations, offer.to, offer.from, round, accepted ? bounded : bounded / 2);
        // A favour taken is owed back; `goodwillOf` can set one not returned against the taker.
        if (accepted && bounded > 0) {
          const list = ((relations.taken[offer.to] ??= {})[offer.from] ??= []);
          list.push({ round, points: bounded });
          if (list.length > 24) list.shift();
        }
        // Refusing an offer that was even or better for the refuser counts against the refuser.
        if (!accepted && favour >= 0) show(relations, offer.from, offer.to, round, -REFUSED_FAIR);
      }
      if (accepted && reads) {
        // Buying, from a third seat, the street another seat lacked counts against the buyer.
        const moved: [PropertyId, PlayerId, PlayerId][] = [
          ...offer.receive.properties.map((id): [PropertyId, PlayerId, PlayerId] => [id, offer.from, offer.to]),
          ...offer.give.properties.map((id): [PropertyId, PlayerId, PlayerId] => [id, offer.to, offer.from]),
        ];
        for (const [id, buyer, seller] of moved) {
          const sq = (ctx as Context).properties.get(id);
          if (!sq || sq.kind !== 'street') continue;
          const mates = ((ctx as Context).groups.get(sq.group) ?? []).filter((mate: StreetSquare) => mate.id !== id);
          const holder = mates.length > 0 ? state.properties[mates[0].id].owner : null;
          if (holder === null || holder === buyer || holder === seller) continue;
          if (mates.every((mate: StreetSquare) => state.properties[mate.id].owner === holder)) show(relations, holder, buyer, round, -DENIED);
        }
      }
    }
  }
}

/** Records an ask at the moment it is sent. A repeat of the same ask keeps its count of refusals. */
export function recordAsk(relations: Relations, asker: PlayerId, property: PropertyId, ask: Omit<Ask, 'refused'>): void {
  const mine = (relations.asks[asker] ??= {});
  const earlier = mine[property];
  mine[property] = { ...ask, refused: earlier && earlier.partner === ask.partner ? earlier.refused : 0 };
}

/** The share of the offers a seat has received that it accepted; 0.5 until there are three. */
export function acceptRate(relations: Relations, seat: PlayerId): number {
  const answer = relations.answers[seat];
  return !answer || answer.received < 3 ? 0.5 : answer.accepted / answer.received;
}

/** The share refused of a seat's latest six offers; 0.5 until it has made six. */
export function shunnedShare(relations: Relations, seat: PlayerId): number {
  const sent = relations.sent[seat] ?? [];
  if (sent.length < 6) return 0.5;
  return sent.slice(-6).filter((accepted) => !accepted).length / 6;
}

export const dealsBetween = (relations: Relations, a: PlayerId, b: PlayerId): number => relations.deals[pairKey(a, b)] ?? 0;

/**
 * What seat `by` has shown seat `to`, in points: each entry halves for every `halfLife` rounds since
 * it was made. Positive after offers that favoured `to`, negative after offers that did not, after
 * refusals of fair offers and after a denying purchase.
 *
 * With `unreturned` above 0, each favour `by` took from `to` that `by` did not return (by an offer in
 * `to`'s favour in a later round) within `halfLife` rounds is set against it at that weight, decaying
 * in the same way. A seat that takes and gives nothing back then cannot keep a reader's goodwill
 * (M3b's gate 7 and its decision point).
 */
export function goodwillOf(relations: Relations, to: PlayerId, by: PlayerId, round: number, halfLife: number, unreturned = 0): number {
  const life = Math.max(1, halfLife);
  const decay = (from: number) => 0.5 ** (Math.max(0, round - from) / life);
  const list = relations.shown[to]?.[by] ?? [];
  let sum = 0;
  for (const entry of list) sum += entry.points * decay(entry.round);
  if (unreturned > 0) {
    for (const favour of relations.taken[by]?.[to] ?? []) {
      if (round - favour.round < life) continue;
      const returned = list.some((entry) => entry.round > favour.round && entry.points > 0);
      if (!returned) sum -= unreturned * favour.points * decay(favour.round);
    }
  }
  return sum;
}
