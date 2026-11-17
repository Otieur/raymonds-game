import type { Context } from '../context.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type { GameState, PlayerId, PropertySquare, RuleError } from '../types.ts';
import { transfer } from './money.ts';
import {
  activePlayers,
  buildingStep,
  liquidationValue,
  mustPlayer,
  ownedProperties,
  resaleValue,
  standings,
  topPending,
} from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';
import { takeOnMortgages } from './trade.ts';

export function checkDeclareBankruptcy(ctx: Context, s: GameState, playerId: PlayerId): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'debt' || top.debtor !== playerId) {
    return fail('WRONG_PHASE', `${playerId} has no debt to default on.`);
  }
  if (liquidationValue(ctx, s, playerId) >= top.amount) {
    return fail('CAN_STILL_PAY', 'This debt can be covered by selling buildings and mortgaging property.');
  }
  return null;
}

export function doDeclareBankruptcy(run: Run, playerId: PlayerId): void {
  const top = topPending(run.s);
  if (top?.kind !== 'debt') throw new Error('Internal error: no debt to default on.');
  bankrupt(run, playerId, top.creditor);
}

function dropPendingFor(s: GameState, gone: PlayerId): void {
  s.pending = s.pending.filter((item) => {
    switch (item.kind) {
      case 'buy':
      case 'mortgageTransfer':
      case 'jailExit':
        return item.player !== gone;
      case 'debt':
        return item.debtor !== gone && item.creditor !== gone;
      case 'trade':
        return item.offer.from !== gone && item.offer.to !== gone;
      case 'auction':
        item.bidders = item.bidders.filter((id) => id !== gone);
        if (item.highBidder === gone) {
          item.highBidder = null;
          item.highBid = 0;
        }
        return true;
      case 'buildingAuction':
        if (item.highBidder === gone) return false;
        item.bidders = item.bidders.filter((id) => id !== gone);
        delete item.nominations[gone];
        return true;
    }
  });
}

function endGame(run: Run, reason: 'lastPlayer' | 'bankruptcyLimit'): void {
  const { ctx, s } = run;
  const ranking = standings(ctx, s);
  s.winner = ranking[0].player;
  s.pending = [];
  s.auctionQueue = [];
  run.events.push({ type: 'GAME_OVER', winner: s.winner, reason, standings: ranking });
}

export function bankrupt(run: Run, debtorId: PlayerId, creditor: PlayerId | null): void {
  const { ctx, s } = run;
  const debtor = mustPlayer(s, debtorId);
  const owned = ownedProperties(ctx, s, debtorId);

  const playersLeft = activePlayers(s).length - 1;
  const bankruptcies = s.players.filter((p) => p.bankrupt).length + 1;
  const limit = ctx.rules.endAfterBankruptcies;
  const endsByLimit = playersLeft > 1 && limit !== null && bankruptcies >= limit;
  // When this bankruptcy ends the game, a rival creditor takes the buildings as they stand.
  const keepBuildings = endsByLimit && creditor !== null;

  let refund = 0;
  for (const sq of owned) {
    if (sq.kind !== 'street' || keepBuildings) continue;
    const state = s.properties[sq.id];
    if (state.level === 0) continue;
    refund += buildingStep(ctx, state.level) * resaleValue(ctx, sq);
    if (state.level === HOTEL_LEVEL) s.bank.hotels += 1;
    else s.bank.houses += state.level;
    state.level = 0;
  }
  transfer(run, null, debtorId, refund, 'refund');

  run.events.push({ type: 'BANKRUPT', player: debtorId, creditor });
  transfer(run, debtorId, creditor, debtor.cash, 'bankruptcy');

  const mortgaged: PropertySquare[] = [];
  if (creditor !== null) {
    mustPlayer(s, creditor).jailCards.push(...debtor.jailCards);
    for (const sq of owned) {
      const state = s.properties[sq.id];
      state.owner = creditor;
      run.events.push({ type: 'PROPERTY_ACQUIRED', player: creditor, property: sq.id, price: 0, via: 'bankruptcy' });
      if (state.mortgaged) mortgaged.push(sq);
    }
  } else {
    for (const held of debtor.jailCards) s.decks[held.deck].push(held.card);
    for (const sq of owned) {
      s.properties[sq.id].owner = null;
      s.properties[sq.id].mortgaged = false;
    }
  }

  debtor.jailCards = [];
  debtor.bankrupt = true;
  debtor.inJail = false;
  debtor.jailRolls = 0;
  dropPendingFor(s, debtorId);

  if (activePlayers(s).length === 1) {
    endGame(run, 'lastPlayer');
    return;
  }
  if (endsByLimit) {
    endGame(run, 'bankruptcyLimit');
    return;
  }

  if (creditor !== null) {
    takeOnMortgages(run, creditor, mortgaged);
  } else {
    s.auctionQueue.push(...owned.map((sq) => sq.id));
  }
}
