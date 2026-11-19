import type { Context } from '../context.ts';
import type { Action, GameState, RuleError } from '../types.ts';
import { checkBid, checkBuy, checkDecline, checkPass } from './auctions.ts';
import { checkDeclareBankruptcy } from './bankruptcy.ts';
import { checkBuild, checkSellBuilding, checkSellBuildings } from './buildings.ts';
import { checkMortgage, checkSettleTransfer, checkUnmortgage } from './mortgage.ts';
import { findPlayer } from './queries.ts';
import { fail } from './run.ts';
import { checkAcceptTrade, checkCancelTrade, checkProposeTrade, checkRejectTrade } from './trade.ts';
import { checkEndTurn, checkPayBail, checkRoll, checkUseJailCard } from './turn.ts';

export function validateAction(ctx: Context, s: GameState, action: Action): RuleError | null {
  if (!action || typeof action !== 'object' || typeof action.player !== 'string') {
    return fail('INVALID_ACTION', 'Malformed action.');
  }
  if (s.winner !== null) return fail('GAME_OVER', 'The game is over.');
  const actor = findPlayer(s, action.player);
  if (!actor) return fail('UNKNOWN_PLAYER', `Unknown player "${action.player}".`);
  if (actor.bankrupt) return fail('PLAYER_BANKRUPT', `${action.player} is out of the game.`);
  if (s.turn.phase === 'order' && action.type !== 'ROLL') {
    return fail('WRONG_PHASE', 'The opening roll comes first: it decides the order of play.');
  }

  switch (action.type) {
    case 'ROLL':
      return checkRoll(s, action.player);
    case 'END_TURN':
      return checkEndTurn(s, action.player);
    case 'PAY_BAIL':
      return checkPayBail(ctx, s, action.player);
    case 'USE_JAIL_CARD':
      return checkUseJailCard(s, action.player);
    case 'BUY':
      return checkBuy(ctx, s, action.player);
    case 'DECLINE':
      return checkDecline(s, action.player);
    case 'BID':
      return checkBid(ctx, s, action);
    case 'PASS':
      return checkPass(s, action.player);
    case 'BUILD':
      return checkBuild(ctx, s, action.player, action.property);
    case 'SELL_BUILDING':
      return checkSellBuilding(ctx, s, action.player, action.property);
    case 'SELL_BUILDINGS':
      return checkSellBuildings(ctx, s, action.player, action.levels);
    case 'MORTGAGE':
      return checkMortgage(ctx, s, action.player, action.property);
    case 'UNMORTGAGE':
      return checkUnmortgage(ctx, s, action.player, action.property);
    case 'SETTLE_TRANSFER':
      return checkSettleTransfer(ctx, s, action.player, action.lift);
    case 'PROPOSE_TRADE':
      return checkProposeTrade(ctx, s, action);
    case 'ACCEPT_TRADE':
      return checkAcceptTrade(ctx, s, action.player);
    case 'REJECT_TRADE':
      return checkRejectTrade(s, action.player);
    case 'CANCEL_TRADE':
      return checkCancelTrade(s, action.player);
    case 'DECLARE_BANKRUPTCY':
      return checkDeclareBankruptcy(ctx, s, action.player);
    default:
      return fail('INVALID_ACTION', 'Unknown action type.');
  }
}
