import type { Context } from '../context.ts';
import type { GameState, PlayerId, PropertyId, PropertySquare, RuleError, StreetSquare } from '../types.ts';
import { placeBuilding } from './buildings.ts';
import { transfer } from './money.ts';
import { activePlayers, buildingKindAt, mustPlayer, placementError, topPending } from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';

export function checkBuy(ctx: Context, s: GameState, playerId: PlayerId): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'buy' || top.player !== playerId) {
    return fail('WRONG_PHASE', `${playerId} has no property to buy.`);
  }
  const sq = ctx.properties.get(top.property) as PropertySquare;
  if (mustPlayer(s, playerId).cash < sq.price) {
    return fail('INSUFFICIENT_CASH', `${sq.name} costs ${sq.price}.`);
  }
  return null;
}

export function doBuy(run: Run, playerId: PlayerId): void {
  const top = run.s.pending.pop();
  if (top?.kind !== 'buy') throw new Error('Internal error: no purchase to complete.');
  const sq = run.ctx.properties.get(top.property) as PropertySquare;
  transfer(run, playerId, null, sq.price, 'purchase');
  run.s.properties[sq.id].owner = playerId;
  run.events.push({
    type: 'PROPERTY_ACQUIRED',
    player: playerId,
    property: sq.id,
    price: sq.price,
    via: 'purchase',
  });
}

export function checkDecline(s: GameState, playerId: PlayerId): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'buy' || top.player !== playerId) {
    return fail('WRONG_PHASE', `${playerId} has no property to decline.`);
  }
  return null;
}

export function doDecline(run: Run): void {
  const top = run.s.pending.pop();
  if (top?.kind !== 'buy') throw new Error('Internal error: no purchase to decline.');
  startAuction(run, top.property);
}

export function startAuction(run: Run, propertyId: PropertyId): void {
  const bidders = activePlayers(run.s).map((p) => p.id);
  run.s.pending.push({ kind: 'auction', property: propertyId, bidders, highBid: 0, highBidder: null });
  run.events.push({ type: 'AUCTION_STARTED', property: propertyId, bidders: [...bidders] });
}

export function checkBid(
  ctx: Context,
  s: GameState,
  action: { player: PlayerId; amount: number; property?: PropertyId },
): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'auction' && top?.kind !== 'buildingAuction') {
    return fail('WRONG_PHASE', 'No auction is in progress.');
  }
  if (!top.bidders.includes(action.player)) {
    return fail('NOT_A_BIDDER', `${action.player} is not bidding in this auction.`);
  }
  if (top.highBidder === action.player) {
    return fail('INVALID_ACTION', `${action.player} already holds the high bid.`);
  }
  if (!Number.isInteger(action.amount) || action.amount < 1) {
    return fail('INVALID_ACTION', 'A bid must be a whole amount of at least 1.');
  }
  if (action.amount <= top.highBid) return fail('BID_TOO_LOW', `The bid to beat is ${top.highBid}.`);
  if (action.amount > mustPlayer(s, action.player).cash) {
    return fail('INSUFFICIENT_CASH', 'A bid cannot exceed the cash in hand.');
  }

  if (top.kind === 'buildingAuction') {
    const target = action.property ?? top.nominations[action.player];
    if (target === undefined) {
      return fail('INVALID_ACTION', 'Name the street the building would go on.');
    }
    const blocked = placementError(ctx, s, action.player, target);
    if (blocked) return blocked;
    if (buildingKindAt(ctx, s.properties[target].level) !== top.building) {
      return fail('INVALID_ACTION', `That street cannot take a ${top.building} right now.`);
    }
    const sq = ctx.properties.get(target) as StreetSquare;
    if (action.amount < sq.buildingCost) {
      return fail('BID_TOO_LOW', `A ${top.building} on ${sq.name} lists at ${sq.buildingCost}.`);
    }
  }
  return null;
}

export function doBid(run: Run, action: { player: PlayerId; amount: number; property?: PropertyId }): void {
  const top = topPending(run.s);
  if (top?.kind !== 'auction' && top?.kind !== 'buildingAuction') {
    throw new Error('Internal error: no auction to bid in.');
  }
  top.highBid = action.amount;
  top.highBidder = action.player;
  if (top.kind === 'buildingAuction' && action.property !== undefined) {
    top.nominations[action.player] = action.property;
  }
  run.events.push({ type: 'BID_PLACED', player: action.player, amount: action.amount });
}

export function checkPass(s: GameState, playerId: PlayerId): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'auction' && top?.kind !== 'buildingAuction') {
    return fail('WRONG_PHASE', 'No auction is in progress.');
  }
  if (!top.bidders.includes(playerId)) {
    return fail('NOT_A_BIDDER', `${playerId} is not bidding in this auction.`);
  }
  if (top.highBidder === playerId) {
    return fail('INVALID_ACTION', 'The high bidder cannot withdraw.');
  }
  return null;
}

export function doPass(run: Run, playerId: PlayerId): void {
  const top = topPending(run.s);
  if (top?.kind !== 'auction' && top?.kind !== 'buildingAuction') {
    throw new Error('Internal error: no auction to pass in.');
  }
  top.bidders = top.bidders.filter((id) => id !== playerId);
  run.events.push({ type: 'AUCTION_PASSED', player: playerId });
}

export function concludeAuctionIfDone(run: Run): boolean {
  const { s } = run;
  const top = topPending(s);

  if (top?.kind === 'auction') {
    if (top.bidders.length === 0) {
      s.pending.pop();
      run.events.push({ type: 'AUCTION_ENDED', property: top.property, winner: null, amount: 0 });
      return true;
    }
    if (top.highBidder !== null && top.bidders.length === 1) {
      s.pending.pop();
      transfer(run, top.highBidder, null, top.highBid, 'auction');
      s.properties[top.property].owner = top.highBidder;
      run.events.push({
        type: 'AUCTION_ENDED',
        property: top.property,
        winner: top.highBidder,
        amount: top.highBid,
      });
      run.events.push({
        type: 'PROPERTY_ACQUIRED',
        player: top.highBidder,
        property: top.property,
        price: top.highBid,
        via: 'auction',
      });
      return true;
    }
    return false;
  }

  if (top?.kind === 'buildingAuction' && top.bidders.length <= 1) {
    s.pending.pop();
    placeBuilding(run, top.highBidder, top.nominations[top.highBidder], top.highBid);
    return true;
  }
  return false;
}
