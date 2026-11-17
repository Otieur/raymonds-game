import type { Context } from '../context.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type { GameState, GroupId, PlayerId, PropertyId, RuleError, StreetSquare } from '../types.ts';
import { transfer } from './money.ts';
import {
  activePlayers,
  bankSupply,
  buildDemand,
  buildingKindAt,
  buildingStep,
  canRaiseFunds,
  groupStreets,
  isBuildingLevel,
  mustPlayer,
  nextLevel,
  placementError,
  previousLevel,
  resaleValue,
} from './queries.ts';
import { fail } from './run.ts';
import type { Run } from './run.ts';

export function checkBuild(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): RuleError | null {
  if (s.pending.length > 0) {
    return fail('DECISION_PENDING', 'Another decision must be resolved first.');
  }
  const blocked = placementError(ctx, s, playerId, propertyId);
  if (blocked) return blocked;
  const sq = ctx.properties.get(propertyId) as StreetSquare;
  const kind = buildingKindAt(ctx, s.properties[propertyId].level);
  if (bankSupply(s, kind) < 1) return fail('BANK_SUPPLY', `The bank has no ${kind}s left.`);
  if (mustPlayer(s, playerId).cash < sq.buildingCost) {
    return fail('INSUFFICIENT_CASH', `A building on ${sq.name} costs ${sq.buildingCost}.`);
  }
  return null;
}

export function doBuild(run: Run, playerId: PlayerId, propertyId: PropertyId): void {
  const { ctx, s } = run;
  const sq = ctx.properties.get(propertyId) as StreetSquare;
  const kind = buildingKindAt(ctx, s.properties[propertyId].level);

  if (ctx.rules.buildingShortageAuction) {
    const rivals = activePlayers(s)
      .filter((p) => p.id !== playerId && buildDemand(ctx, s, p.id, kind) > 0)
      .map((p) => p.id);
    if (rivals.length > 0) {
      const bidders = [playerId, ...rivals];
      const demand = bidders.reduce((sum, id) => sum + buildDemand(ctx, s, id, kind), 0);
      if (bankSupply(s, kind) < demand) {
        s.pending.push({
          kind: 'buildingAuction',
          building: kind,
          bidders,
          highBid: sq.buildingCost,
          highBidder: playerId,
          nominations: { [playerId]: propertyId },
        });
        run.events.push({
          type: 'BUILDING_AUCTION_STARTED',
          building: kind,
          bidders: [...bidders],
          openedBy: playerId,
          openingBid: sq.buildingCost,
        });
        return;
      }
    }
  }
  placeBuilding(run, playerId, propertyId, sq.buildingCost);
}

export function placeBuilding(run: Run, playerId: PlayerId, propertyId: PropertyId, price: number): void {
  const state = run.s.properties[propertyId];
  transfer(run, playerId, null, price, 'building');
  const next = nextLevel(run.ctx, state.level);
  if (next === HOTEL_LEVEL) {
    run.s.bank.hotels -= 1;
    run.s.bank.houses += state.level;
  } else {
    run.s.bank.houses -= 1;
  }
  state.level = next;
  run.events.push({ type: 'BUILT', player: playerId, property: propertyId, level: state.level, cost: price });
}

interface SalePlan {
  group: GroupId;
  after: Record<PropertyId, number>;
  refund: number;
  housesReturned: number;
  hotelsReturned: number;
}

const housesOn = (levels: number[]) =>
  levels.reduce((sum, level) => sum + (level === HOTEL_LEVEL ? 0 : level), 0);
const hotelsOn = (levels: number[]) => levels.filter((level) => level === HOTEL_LEVEL).length;

function planSale(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  levels: Record<PropertyId, number>,
): { plan: SalePlan } | { error: RuleError } {
  if (!levels || typeof levels !== 'object') {
    return { error: fail('INVALID_ACTION', 'Selling buildings needs target levels.') };
  }
  const ids = Object.keys(levels);
  if (ids.length === 0) return { error: fail('INVALID_ACTION', 'Name at least one street.') };

  let group: GroupId | null = null;
  let refund = 0;
  for (const id of ids) {
    const sq = ctx.properties.get(id);
    if (!sq) return { error: fail('UNKNOWN_PROPERTY', `Unknown property "${id}".`) };
    if (sq.kind !== 'street') return { error: fail('NOT_A_STREET', `${sq.name} holds no buildings.`) };
    const state = s.properties[id];
    if (state.owner !== playerId) return { error: fail('NOT_OWNER', `${playerId} does not own ${sq.name}.`) };
    if (group !== null && sq.group !== group) {
      return { error: fail('INVALID_ACTION', 'Sell buildings from one group at a time.') };
    }
    group = sq.group;
    const target = levels[id];
    const sold = buildingStep(ctx, state.level) - buildingStep(ctx, target);
    if (!isBuildingLevel(ctx, target) || sold < 0) {
      return { error: fail('INVALID_ACTION', `${target} is not a level ${sq.name} can be sold down to.`) };
    }
    refund += sold * resaleValue(ctx, sq);
  }

  const streets = groupStreets(ctx, group as GroupId);
  const before = streets.map((st) => s.properties[st.id].level);
  const after = streets.map((st) => (Object.hasOwn(levels, st.id) ? levels[st.id] : s.properties[st.id].level));
  if (after.every((level, i) => level === before[i])) {
    return { error: fail('NO_BUILDINGS', 'There is nothing to sell.') };
  }
  const steps = after.map((level) => buildingStep(ctx, level));
  if (Math.max(...steps) - Math.min(...steps) > 1) {
    return { error: fail('UNEVEN_BUILD', 'Buildings must be sold evenly across the group.') };
  }
  const housesReturned = housesOn(before) - housesOn(after);
  if (s.bank.houses + housesReturned < 0) {
    return { error: fail('BANK_SUPPLY', 'The bank does not have the houses to break hotels down that way.') };
  }

  const finalLevels: Record<PropertyId, number> = {};
  streets.forEach((st, i) => {
    finalLevels[st.id] = after[i];
  });
  return {
    plan: {
      group: group as GroupId,
      after: finalLevels,
      refund,
      housesReturned,
      hotelsReturned: hotelsOn(before) - hotelsOn(after),
    },
  };
}

export function checkSellBuildings(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  levels: Record<PropertyId, number>,
): RuleError | null {
  if (!canRaiseFunds(s)) return fail('DECISION_PENDING', 'Assets are frozen until the open decision is resolved.');
  const result = planSale(ctx, s, playerId, levels);
  return 'error' in result ? result.error : null;
}

export function doSellBuildings(run: Run, playerId: PlayerId, levels: Record<PropertyId, number>): void {
  const result = planSale(run.ctx, run.s, playerId, levels);
  if ('error' in result) throw new Error(`Internal error: ${result.error.message}`);
  const { plan } = result;

  const changed: Record<PropertyId, number> = {};
  for (const [id, level] of Object.entries(plan.after)) {
    if (run.s.properties[id].level !== level) changed[id] = level;
    run.s.properties[id].level = level;
  }
  run.s.bank.houses += plan.housesReturned;
  run.s.bank.hotels += plan.hotelsReturned;
  transfer(run, null, playerId, plan.refund, 'refund');
  run.events.push({ type: 'BUILDINGS_SOLD', player: playerId, levels: changed, refund: plan.refund });
}

function singleStep(
  ctx: Context,
  s: GameState,
  propertyId: PropertyId,
): { levels: Record<PropertyId, number> } | { error: RuleError } {
  const sq = ctx.properties.get(propertyId);
  if (!sq) return { error: fail('UNKNOWN_PROPERTY', `Unknown property "${propertyId}".`) };
  const level = s.properties[propertyId].level;
  if (level === 0) return { error: fail('NO_BUILDINGS', `${sq.name} has no buildings.`) };
  return { levels: { [propertyId]: previousLevel(ctx, level) } };
}

export function checkSellBuilding(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): RuleError | null {
  const step = singleStep(ctx, s, propertyId);
  if ('error' in step) return step.error;
  return checkSellBuildings(ctx, s, playerId, step.levels);
}

export function doSellBuilding(run: Run, playerId: PlayerId, propertyId: PropertyId): void {
  const step = singleStep(run.ctx, run.s, propertyId);
  if ('error' in step) throw new Error(`Internal error: ${step.error.message}`);
  doSellBuildings(run, playerId, step.levels);
}
