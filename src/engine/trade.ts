import type { Context } from '../context.ts';
import type {
  GameState,
  PlayerId,
  PlayerState,
  PropertyId,
  PropertySquare,
  RuleError,
  TradeOffer,
  TradeSide,
} from '../types.ts';
import { charge, transfer } from './money.ts';
import { findPlayer, groupHasBuildings, mortgageInterest, mustPlayer, topPending } from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';

function isEmpty(side: TradeSide): boolean {
  return side.cash === 0 && side.properties.length === 0 && side.jailCards === 0;
}

function isWellFormed(side: TradeSide): boolean {
  return (
    !!side &&
    Number.isInteger(side.cash) &&
    side.cash >= 0 &&
    Number.isInteger(side.jailCards) &&
    side.jailCards >= 0 &&
    Array.isArray(side.properties) &&
    side.properties.every((id) => typeof id === 'string')
  );
}

function checkSide(ctx: Context, s: GameState, giver: PlayerState, side: TradeSide): RuleError | null {
  if (!isWellFormed(side)) return fail('INVALID_TRADE', 'Malformed trade offer.');
  if (side.cash > giver.cash) return fail('INSUFFICIENT_CASH', `${giver.id} does not hold ${side.cash}.`);
  if (side.jailCards > giver.jailCards.length) {
    return fail('NO_JAIL_CARD', `${giver.id} does not hold ${side.jailCards} jail card(s).`);
  }
  const seen = new Set<PropertyId>();
  for (const id of side.properties) {
    if (seen.has(id)) return fail('INVALID_TRADE', `"${id}" is listed twice.`);
    seen.add(id);
    const sq = ctx.properties.get(id);
    if (!sq) return fail('UNKNOWN_PROPERTY', `Unknown property "${id}".`);
    if (s.properties[id].owner !== giver.id) return fail('NOT_OWNER', `${giver.id} does not own ${sq.name}.`);
    if (sq.kind === 'street' && groupHasBuildings(ctx, s, sq.group)) {
      return fail('GROUP_HAS_BUILDINGS', `Sell every building in the ${sq.group} group first.`);
    }
  }
  return null;
}

function interestOn(ctx: Context, s: GameState, side: TradeSide): number {
  return side.properties.reduce((sum, id) => {
    const sq = ctx.properties.get(id) as PropertySquare;
    return s.properties[id].mortgaged ? sum + mortgageInterest(ctx, sq) : sum;
  }, 0);
}

export function checkOffer(ctx: Context, s: GameState, offer: TradeOffer): RuleError | null {
  const from = findPlayer(s, offer.from);
  const to = findPlayer(s, offer.to);
  if (!from || !to) return fail('UNKNOWN_PLAYER', 'A trade needs two players in the game.');
  if (from.id === to.id) return fail('INVALID_TRADE', 'A player cannot trade with themselves.');
  if (from.bankrupt || to.bankrupt) return fail('PLAYER_BANKRUPT', 'Bankrupt players cannot trade.');

  const blocked = checkSide(ctx, s, from, offer.give) ?? checkSide(ctx, s, to, offer.receive);
  if (blocked) return blocked;
  if (isEmpty(offer.give) || isEmpty(offer.receive)) {
    return fail('INVALID_TRADE', 'Both sides of a trade must hand something over.');
  }

  const fromCash = from.cash - offer.give.cash + offer.receive.cash;
  const toCash = to.cash - offer.receive.cash + offer.give.cash;
  if (fromCash < interestOn(ctx, s, offer.receive)) {
    return fail('INSUFFICIENT_CASH', `${from.id} could not pay the interest on the mortgages received.`);
  }
  if (toCash < interestOn(ctx, s, offer.give)) {
    return fail('INSUFFICIENT_CASH', `${to.id} could not pay the interest on the mortgages received.`);
  }
  return null;
}

export function checkProposeTrade(
  ctx: Context,
  s: GameState,
  action: { player: PlayerId; to: PlayerId; give: TradeSide; receive: TradeSide },
): RuleError | null {
  const top = topPending(s);
  const debtDeal = top?.kind === 'debt' && (top.debtor === action.player || top.debtor === action.to);
  if (top !== undefined && !debtDeal) {
    return fail('DECISION_PENDING', 'Another decision must be resolved first.');
  }
  return checkOffer(ctx, s, { from: action.player, to: action.to, give: action.give, receive: action.receive });
}

export function doProposeTrade(
  run: Run,
  action: { player: PlayerId; to: PlayerId; give: TradeSide; receive: TradeSide },
): void {
  const offer: TradeOffer = structuredClone({
    from: action.player,
    to: action.to,
    give: { cash: action.give.cash, properties: action.give.properties, jailCards: action.give.jailCards },
    receive: {
      cash: action.receive.cash,
      properties: action.receive.properties,
      jailCards: action.receive.jailCards,
    },
  });
  run.s.pending.push({ kind: 'trade', offer });
  run.events.push({ type: 'TRADE_PROPOSED', offer: structuredClone(offer) });
}

function openOffer(s: GameState): TradeOffer | null {
  const top = topPending(s);
  return top?.kind === 'trade' ? top.offer : null;
}

export function checkAcceptTrade(ctx: Context, s: GameState, playerId: PlayerId): RuleError | null {
  const offer = openOffer(s);
  if (!offer || offer.to !== playerId) return fail('WRONG_PHASE', `${playerId} has no offer to answer.`);
  return checkOffer(ctx, s, offer);
}

export function checkRejectTrade(s: GameState, playerId: PlayerId): RuleError | null {
  const offer = openOffer(s);
  if (!offer || offer.to !== playerId) return fail('WRONG_PHASE', `${playerId} has no offer to answer.`);
  return null;
}

export function checkCancelTrade(s: GameState, playerId: PlayerId): RuleError | null {
  const offer = openOffer(s);
  if (!offer || offer.from !== playerId) return fail('WRONG_PHASE', `${playerId} has no offer to withdraw.`);
  return null;
}

export function doCloseTrade(run: Run, outcome: 'TRADE_REJECTED' | 'TRADE_CANCELLED'): void {
  const top = run.s.pending.pop();
  if (top?.kind !== 'trade') throw new Error('Internal error: no trade to close.');
  run.events.push({ type: outcome, offer: top.offer });
}

function handOver(run: Run, from: PlayerId, to: PlayerId, side: TradeSide): PropertySquare[] {
  const { ctx, s } = run;
  const mortgaged: PropertySquare[] = [];
  for (const id of side.properties) {
    const sq = ctx.properties.get(id) as PropertySquare;
    s.properties[id].owner = to;
    run.events.push({ type: 'PROPERTY_ACQUIRED', player: to, property: id, price: 0, via: 'trade' });
    if (s.properties[id].mortgaged) mortgaged.push(sq);
  }
  const cards = mustPlayer(s, from).jailCards.splice(0, side.jailCards);
  mustPlayer(s, to).jailCards.push(...cards);
  return mortgaged;
}

export function takeOnMortgages(run: Run, playerId: PlayerId, mortgaged: PropertySquare[]): void {
  for (const sq of [...mortgaged].reverse()) {
    run.s.pending.push({ kind: 'mortgageTransfer', player: playerId, property: sq.id });
  }
  const interest = mortgaged.reduce((sum, sq) => sum + mortgageInterest(run.ctx, sq), 0);
  charge(run, playerId, null, interest, 'interest');
}

export function doAcceptTrade(run: Run): void {
  const top = run.s.pending.pop();
  if (top?.kind !== 'trade') throw new Error('Internal error: no trade to accept.');
  const { from, to, give, receive } = top.offer;

  transfer(run, from, to, give.cash, 'trade');
  transfer(run, to, from, receive.cash, 'trade');
  const toTakesOn = handOver(run, from, to, give);
  const fromTakesOn = handOver(run, to, from, receive);
  run.events.push({ type: 'TRADE_ACCEPTED', offer: top.offer });

  takeOnMortgages(run, to, toTakesOn);
  takeOnMortgages(run, from, fromTakesOn);
}
