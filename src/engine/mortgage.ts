import type { Context } from '../context.ts';
import type { GameState, PlayerId, PropertyId, PropertySquare, RuleError } from '../types.ts';
import { transfer } from './money.ts';
import { canRaiseFunds, groupHasBuildings, mustPlayer, topPending, unmortgageCost } from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';

function ownedSquare(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): PropertySquare | RuleError {
  const sq = ctx.properties.get(propertyId);
  if (!sq) return fail('UNKNOWN_PROPERTY', `Unknown property "${propertyId}".`);
  if (s.properties[propertyId].owner !== playerId) {
    return fail('NOT_OWNER', `${playerId} does not own ${sq.name}.`);
  }
  return sq;
}

export function checkMortgage(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): RuleError | null {
  if (!canRaiseFunds(s)) return fail('DECISION_PENDING', 'Assets are frozen until the open decision is resolved.');
  const sq = ownedSquare(ctx, s, playerId, propertyId);
  if ('code' in sq) return sq;
  if (s.properties[propertyId].mortgaged) return fail('ALREADY_MORTGAGED', `${sq.name} is already mortgaged.`);
  if (sq.kind === 'street' && groupHasBuildings(ctx, s, sq.group)) {
    return fail('GROUP_HAS_BUILDINGS', `Sell every building in the ${sq.group} group first.`);
  }
  return null;
}

export function doMortgage(run: Run, playerId: PlayerId, propertyId: PropertyId): void {
  const sq = run.ctx.properties.get(propertyId) as PropertySquare;
  run.s.properties[propertyId].mortgaged = true;
  transfer(run, null, playerId, sq.mortgageValue, 'mortgage');
  run.events.push({ type: 'MORTGAGED', player: playerId, property: propertyId, amount: sq.mortgageValue });
}

export function checkUnmortgage(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): RuleError | null {
  if (s.pending.length > 0) {
    return fail('DECISION_PENDING', 'Another decision must be resolved first.');
  }
  const sq = ownedSquare(ctx, s, playerId, propertyId);
  if ('code' in sq) return sq;
  if (!s.properties[propertyId].mortgaged) return fail('NOT_MORTGAGED', `${sq.name} is not mortgaged.`);
  const cost = unmortgageCost(ctx, sq);
  if (mustPlayer(s, playerId).cash < cost) {
    return fail('INSUFFICIENT_CASH', `Lifting the mortgage on ${sq.name} costs ${cost}.`);
  }
  return null;
}

export function doUnmortgage(run: Run, playerId: PlayerId, propertyId: PropertyId): void {
  const sq = run.ctx.properties.get(propertyId) as PropertySquare;
  const cost = unmortgageCost(run.ctx, sq);
  transfer(run, playerId, null, cost, 'unmortgage');
  run.s.properties[propertyId].mortgaged = false;
  run.events.push({ type: 'UNMORTGAGED', player: playerId, property: propertyId, amount: cost });
}

export function checkSettleTransfer(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  lift: boolean,
): RuleError | null {
  const top = topPending(s);
  if (top?.kind !== 'mortgageTransfer' || top.player !== playerId) {
    return fail('WRONG_PHASE', `${playerId} has no received mortgage to settle.`);
  }
  if (typeof lift !== 'boolean') return fail('INVALID_ACTION', 'Say whether to lift the mortgage.');
  const sq = ctx.properties.get(top.property) as PropertySquare;
  if (lift && mustPlayer(s, playerId).cash < sq.mortgageValue) {
    return fail('INSUFFICIENT_CASH', `Lifting the mortgage on ${sq.name} costs ${sq.mortgageValue}.`);
  }
  return null;
}

export function doSettleTransfer(run: Run, playerId: PlayerId, lift: boolean): void {
  const top = run.s.pending.pop();
  if (top?.kind !== 'mortgageTransfer') throw new Error('Internal error: no mortgage transfer to settle.');
  const sq = run.ctx.properties.get(top.property) as PropertySquare;
  if (lift) {
    transfer(run, playerId, null, sq.mortgageValue, 'unmortgage');
    run.s.properties[top.property].mortgaged = false;
    run.events.push({ type: 'UNMORTGAGED', player: playerId, property: top.property, amount: sq.mortgageValue });
  } else {
    run.events.push({ type: 'MORTGAGE_KEPT', player: playerId, property: top.property });
  }
}
