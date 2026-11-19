import type { Context } from '../context.ts';
import type { Action, GameState, LegalAction, PlayerId, PropertyId, StreetSquare } from '../types.ts';
import {
  activePlayers,
  buildingKindAt,
  findPlayer,
  groupHasBuildings,
  groupStreets,
  minimumBid,
  ownedProperties,
  ownsGroup,
  placementError,
  topPending,
} from './queries.ts';
import { validateAction } from './validate.ts';

export function awaiting(s: GameState): PlayerId[] {
  if (s.winner !== null) return [];
  const top = topPending(s);
  if (!top) return [s.turn.player];
  switch (top.kind) {
    case 'buy':
    case 'mortgageTransfer':
    case 'jailExit':
      return [top.player];
    case 'debt':
      return [top.debtor];
    case 'trade':
      return [top.offer.to];
    case 'auction':
    case 'buildingAuction':
      return top.bidders.filter((id) => id !== top.highBidder);
  }
}

export function legalActions(ctx: Context, s: GameState, playerId: PlayerId): LegalAction[] {
  const player = findPlayer(s, playerId);
  if (s.winner !== null || !player || player.bankrupt) return [];

  const legal: LegalAction[] = [];
  const offer = (action: Exclude<Action, { type: 'BID' | 'PROPOSE_TRADE' }>) => {
    if (validateAction(ctx, s, action) === null) legal.push(action);
  };

  offer({ type: 'ROLL', player: playerId });
  offer({ type: 'END_TURN', player: playerId });
  offer({ type: 'PAY_BAIL', player: playerId });
  offer({ type: 'USE_JAIL_CARD', player: playerId });
  offer({ type: 'BUY', player: playerId });
  offer({ type: 'DECLINE', player: playerId });
  offer({ type: 'PASS', player: playerId });
  offer({ type: 'SETTLE_TRANSFER', player: playerId, lift: true });
  offer({ type: 'SETTLE_TRANSFER', player: playerId, lift: false });
  offer({ type: 'ACCEPT_TRADE', player: playerId });
  offer({ type: 'REJECT_TRADE', player: playerId });
  offer({ type: 'CANCEL_TRADE', player: playerId });
  offer({ type: 'DECLARE_BANKRUPTCY', player: playerId });

  for (const sq of ownedProperties(ctx, s, playerId)) {
    offer({ type: 'MORTGAGE', player: playerId, property: sq.id });
    offer({ type: 'UNMORTGAGE', player: playerId, property: sq.id });
    if (sq.kind === 'street') {
      offer({ type: 'BUILD', player: playerId, property: sq.id });
      offer({ type: 'SELL_BUILDING', player: playerId, property: sq.id });
    }
  }

  for (const group of ctx.groups.keys()) {
    if (!ownsGroup(ctx, s, playerId, group) || !groupHasBuildings(ctx, s, group)) continue;
    const levels: Record<PropertyId, number> = {};
    for (const street of groupStreets(ctx, group)) levels[street.id] = 0;
    offer({ type: 'SELL_BUILDINGS', player: playerId, levels });
  }

  const top = topPending(s);
  const canBid =
    (top?.kind === 'auction' || top?.kind === 'buildingAuction') &&
    top.bidders.includes(playerId) &&
    top.highBidder !== playerId;
  if (canBid && top?.kind === 'auction') {
    const min = minimumBid(ctx, top);
    if (min <= player.cash) legal.push({ type: 'BID', player: playerId, min, max: player.cash });
  }
  if (canBid && top?.kind === 'buildingAuction') {
    const targets = ownedProperties(ctx, s, playerId)
      .filter((sq): sq is StreetSquare => sq.kind === 'street')
      .filter(
        (sq) =>
          placementError(ctx, s, playerId, sq.id) === null &&
          buildingKindAt(ctx, s.properties[sq.id].level) === top.building,
      )
      .map((sq) => ({ property: sq.id, min: minimumBid(ctx, top) }))
      .filter((target) => target.min <= player.cash);
    if (targets.length > 0) {
      const min = Math.min(...targets.map((target) => target.min));
      legal.push({ type: 'BID', player: playerId, min, max: player.cash, targets });
    }
  }

  const debtor = top?.kind === 'debt' ? top.debtor : null;
  if (s.turn.phase !== 'order' && (top === undefined || debtor !== null)) {
    const partners = activePlayers(s)
      .map((p) => p.id)
      .filter((id) => id !== playerId)
      .filter((id) => debtor === null || debtor === playerId || debtor === id);
    if (partners.length > 0) legal.push({ type: 'PROPOSE_TRADE', player: playerId, partners });
  }

  return legal;
}
