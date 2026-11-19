/**
 * The ledger: running counts of how each seat has behaved, built from the engine's events. The
 * state says where things stand; the ledger says how the table has played, which is what a player
 * reads to decide whether to play for groups or for passes.
 */
import type { Context } from '../context.ts';
import { createRelations, noteRelations } from '../sim/relations.ts';
import type { Relations } from '../sim/relations.ts';
import { v1 } from '../sim/valuation.ts';
import type { GameEvent, GameState, PlayerId, PropertySquare } from '../types.ts';

export interface SeatLedger {
  bought: number;
  declined: number;
  auctionsHeld: number;
  auctionsBid: number;
  auctionsWon: number;
  highestBid: number;
  offersMade: number;
  offersMadeAccepted: number;
  offersReceived: number;
  offersReceivedAccepted: number;
  buildingsBought: number;
  buildingsSold: number;
  mortgages: number;
  turns: number;
  turnCash: number;
  eliminations: number;
}

export interface Ledger {
  seats: Record<PlayerId, SeatLedger>;
  /** Bidders of the auction under way, so that an auction counts once for each. */
  bidding: Set<PlayerId>;
  lastOffered: PlayerId | null;
  /** What has passed between each pair of seats, for the relations block of the observation. */
  relations: Relations;
}

const emptySeat = (): SeatLedger => ({
  bought: 0,
  declined: 0,
  auctionsHeld: 0,
  auctionsBid: 0,
  auctionsWon: 0,
  highestBid: 0,
  offersMade: 0,
  offersMadeAccepted: 0,
  offersReceived: 0,
  offersReceivedAccepted: 0,
  buildingsBought: 0,
  buildingsSold: 0,
  mortgages: 0,
  turns: 0,
  turnCash: 0,
  eliminations: 0,
});

export function createLedger(): Ledger {
  const relations = createRelations();
  relations.tracking = true;
  return { seats: {}, bidding: new Set(), lastOffered: null, relations };
}

const seatOf = (ledger: Ledger, id: PlayerId) => (ledger.seats[id] ??= emptySeat());

/** Feeds one applied action's events. `state` is the state after the action. */
export function note(ctx: Context, ledger: Ledger, state: GameState, events: GameEvent[]): void {
  noteRelations(ledger.relations, state, events, ctx, v1(state.players.length));
  for (const event of events) {
    switch (event.type) {
      case 'PROPERTY_OFFERED':
        ledger.lastOffered = event.player;
        break;
      case 'AUCTION_STARTED':
        if (ledger.lastOffered) seatOf(ledger, ledger.lastOffered).declined += 1;
        ledger.lastOffered = null;
        ledger.bidding = new Set();
        for (const id of event.bidders) seatOf(ledger, id).auctionsHeld += 1;
        break;
      case 'BID_PLACED': {
        const seat = seatOf(ledger, event.player);
        if (!ledger.bidding.has(event.player)) {
          ledger.bidding.add(event.player);
          seat.auctionsBid += 1;
        }
        const top = state.pending[state.pending.length - 1];
        const property = top?.kind === 'auction' ? (ctx.properties.get(top.property) as PropertySquare) : undefined;
        if (property) seat.highestBid = Math.max(seat.highestBid, event.amount / property.price);
        break;
      }
      case 'AUCTION_ENDED':
        if (event.winner) {
          seatOf(ledger, event.winner).auctionsWon += 1;
          const property = ctx.properties.get(event.property) as PropertySquare | undefined;
          if (property) seatOf(ledger, event.winner).highestBid = Math.max(seatOf(ledger, event.winner).highestBid, event.amount / property.price);
        }
        ledger.bidding = new Set();
        break;
      case 'PROPERTY_ACQUIRED':
        if (event.via === 'purchase') {
          seatOf(ledger, event.player).bought += 1;
          ledger.lastOffered = null;
        }
        break;
      case 'TRADE_PROPOSED':
        seatOf(ledger, event.offer.from).offersMade += 1;
        seatOf(ledger, event.offer.to).offersReceived += 1;
        break;
      case 'TRADE_ACCEPTED':
        seatOf(ledger, event.offer.from).offersMadeAccepted += 1;
        seatOf(ledger, event.offer.to).offersReceivedAccepted += 1;
        break;
      case 'BUILT':
        seatOf(ledger, event.player).buildingsBought += 1;
        break;
      case 'BUILDINGS_SOLD':
        seatOf(ledger, event.player).buildingsSold += 1;
        break;
      case 'MORTGAGED':
        seatOf(ledger, event.player).mortgages += 1;
        break;
      case 'TURN_STARTED': {
        const seat = seatOf(ledger, event.player);
        seat.turns += 1;
        seat.turnCash += state.players.find((p) => p.id === event.player)?.cash ?? 0;
        break;
      }
      case 'BANKRUPT':
        if (event.creditor) seatOf(ledger, event.creditor).eliminations += 1;
        break;
      default:
        break;
    }
  }
}

/** A share with a prior of one half until there are three cases. */
const rate = (part: number, whole: number) => (whole < 3 ? 0.5 : part / whole);
const capped = (value: number, scale: number) => Math.min(2, value / scale);

/** The twelve numbers the observation carries for a seat. */
export function habits(ledger: Ledger, id: PlayerId, startingCash: number): number[] {
  const s = ledger.seats[id] ?? emptySeat();
  return [
    rate(s.bought, s.bought + s.declined),
    rate(s.auctionsBid, s.auctionsHeld),
    rate(s.auctionsWon, s.auctionsBid),
    capped(s.highestBid, 3),
    s.turns < 3 ? 0.5 : Math.min(2, s.offersMade / s.turns),
    rate(s.offersMadeAccepted, s.offersMade),
    capped(s.offersReceived, 10),
    rate(s.offersReceivedAccepted, s.offersReceived),
    capped(s.buildingsBought, 20),
    capped(s.buildingsSold, 10),
    capped(s.mortgages, 10),
    s.turns === 0 ? 1 : capped(s.turnCash / s.turns, startingCash),
  ];
}

/** The ledger rebuilt from a whole game's events, applied in order with the state after each action. */
export function ledgerOf(ctx: Context, history: { state: GameState; events: GameEvent[] }[]): Ledger {
  const ledger = createLedger();
  for (const { state, events } of history) note(ctx, ledger, state, events);
  return ledger;
}
