import { buildContext } from '../context.ts';
import type { Context } from '../context.ts';
import { DEFAULT_RULES } from '../rules.ts';
import type {
  Action,
  ApplyResult,
  BoardDefinition,
  GameState,
  LegalAction,
  PlayerId,
  RuleConfig,
  RuleError,
} from '../types.ts';
import { concludeAuctionIfDone, doBid, doBuy, doDecline, doPass, startAuction } from './auctions.ts';
import { doDeclareBankruptcy } from './bankruptcy.ts';
import { doBuild, doSellBuilding, doSellBuildings } from './buildings.ts';
import { checkInvariants } from './invariants.ts';
import { awaiting, legalActions } from './legal.ts';
import { transfer } from './money.ts';
import { doMortgage, doSettleTransfer, doUnmortgage } from './mortgage.ts';
import { runResume } from './movement.ts';
import { mustPlayer, topPending } from './queries.ts';
import type { Run } from './run.ts';
import { newGame } from './setup.ts';
import type { NewGameOptions } from './setup.ts';
import { doAcceptTrade, doCloseTrade, doProposeTrade } from './trade.ts';
import { advanceTurn, doPayBail, doRoll, doUseJailCard } from './turn.ts';
import { validateAction } from './validate.ts';

export interface Engine {
  readonly board: BoardDefinition;
  readonly rules: RuleConfig;
  newGame(options: NewGameOptions): GameState;
  validate(state: GameState, action: Action): RuleError | null;
  apply(state: GameState, action: Action): ApplyResult;
  legalActions(state: GameState, player: PlayerId): LegalAction[];
  awaiting(state: GameState): PlayerId[];
  checkInvariants(state: GameState): string[];
}

function execute(run: Run, action: Action): void {
  switch (action.type) {
    case 'ROLL':
      return doRoll(run, action.player);
    case 'END_TURN':
      return advanceTurn(run);
    case 'PAY_BAIL':
      return doPayBail(run, action.player);
    case 'USE_JAIL_CARD':
      return doUseJailCard(run, action.player);
    case 'BUY':
      return doBuy(run, action.player);
    case 'DECLINE':
      return doDecline(run);
    case 'BID':
      return doBid(run, action);
    case 'PASS':
      return doPass(run, action.player);
    case 'BUILD':
      return doBuild(run, action.player, action.property);
    case 'SELL_BUILDING':
      return doSellBuilding(run, action.player, action.property);
    case 'SELL_BUILDINGS':
      return doSellBuildings(run, action.player, action.levels);
    case 'MORTGAGE':
      return doMortgage(run, action.player, action.property);
    case 'UNMORTGAGE':
      return doUnmortgage(run, action.player, action.property);
    case 'SETTLE_TRANSFER':
      return doSettleTransfer(run, action.player, action.lift);
    case 'PROPOSE_TRADE':
      return doProposeTrade(run, action);
    case 'ACCEPT_TRADE':
      return doAcceptTrade(run);
    case 'REJECT_TRADE':
      return doCloseTrade(run, 'TRADE_REJECTED');
    case 'CANCEL_TRADE':
      return doCloseTrade(run, 'TRADE_CANCELLED');
    case 'DECLARE_BANKRUPTCY':
      return doDeclareBankruptcy(run, action.player);
  }
}

function settle(run: Run): void {
  const { s } = run;
  for (;;) {
    if (s.winner !== null) return;
    if (mustPlayer(s, s.turn.player).bankrupt) {
      advanceTurn(run);
      continue;
    }
    const top = topPending(s);

    if (s.auctionQueue.length > 0 && top?.kind !== 'auction') {
      startAuction(run, s.auctionQueue.shift() as string);
      continue;
    }
    if (top?.kind === 'debt') {
      if (mustPlayer(s, top.debtor).cash < top.amount) return;
      s.pending.pop();
      transfer(run, top.debtor, top.creditor, top.amount, top.reason);
      if (top.resume) runResume(run, top.debtor, top.resume);
      continue;
    }
    if (top?.kind === 'auction' || top?.kind === 'buildingAuction') {
      if (concludeAuctionIfDone(run)) continue;
      return;
    }
    return;
  }
}

function apply(ctx: Context, state: GameState, action: Action): ApplyResult {
  const error = validateAction(ctx, state, action);
  if (error) return { ok: false, error };
  const run: Run = { ctx, s: structuredClone(state), events: [] };
  execute(run, action);
  settle(run);
  return { ok: true, state: run.s, events: run.events };
}

export function createEngine(board: BoardDefinition, rules: Partial<RuleConfig> = {}): Engine {
  const ctx = buildContext(board, { ...DEFAULT_RULES, ...rules });
  return {
    board: ctx.board,
    rules: ctx.rules,
    newGame: (options) => newGame(ctx, options),
    validate: (state, action) => validateAction(ctx, state, action),
    apply: (state, action) => apply(ctx, state, action),
    legalActions: (state, player) => legalActions(ctx, state, player),
    awaiting: (state) => awaiting(state),
    checkInvariants: (state) => checkInvariants(ctx, state),
  };
}
