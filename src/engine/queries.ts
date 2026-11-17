import type { Context } from '../context.ts';
import { HOTEL_LEVEL, MAX_HOUSES } from '../types.ts';
import type {
  BuildingKind,
  GameState,
  GroupId,
  Pending,
  PlayerId,
  PlayerState,
  PropertyId,
  PropertySquare,
  RuleError,
  StreetSquare,
} from '../types.ts';
import { fail } from './run.ts';

export function findPlayer(s: GameState, id: PlayerId): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

export function mustPlayer(s: GameState, id: PlayerId): PlayerState {
  const player = findPlayer(s, id);
  if (!player) throw new Error(`Unknown player "${id}".`);
  return player;
}

export function activePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => !p.bankrupt);
}

export function playersAfter(s: GameState, id: PlayerId): PlayerState[] {
  const start = s.players.findIndex((p) => p.id === id);
  const result: PlayerState[] = [];
  for (let step = 1; step < s.players.length; step++) {
    const player = s.players[(start + step) % s.players.length];
    if (!player.bankrupt) result.push(player);
  }
  return result;
}

export function topPending(s: GameState): Pending | undefined {
  return s.pending[s.pending.length - 1];
}

export function canRaiseFunds(s: GameState): boolean {
  const top = topPending(s);
  return top === undefined || (top.kind !== 'trade' && top.kind !== 'buildingAuction');
}

export function ownedProperties(ctx: Context, s: GameState, owner: PlayerId): PropertySquare[] {
  return ctx.propertyOrder.filter((sq) => s.properties[sq.id].owner === owner);
}

export function groupStreets(ctx: Context, group: GroupId): readonly StreetSquare[] {
  return ctx.groups.get(group) ?? [];
}

export function ownsGroup(ctx: Context, s: GameState, owner: PlayerId, group: GroupId): boolean {
  const streets = groupStreets(ctx, group);
  return streets.length > 0 && streets.every((st) => s.properties[st.id].owner === owner);
}

export function groupLevels(ctx: Context, s: GameState, group: GroupId): number[] {
  return groupStreets(ctx, group).map((st) => s.properties[st.id].level);
}

export function groupHasBuildings(ctx: Context, s: GameState, group: GroupId): boolean {
  return groupLevels(ctx, s, group).some((level) => level > 0);
}

export function groupHasMortgage(ctx: Context, s: GameState, group: GroupId): boolean {
  return groupStreets(ctx, group).some((st) => s.properties[st.id].mortgaged);
}

export function mortgageInterest(ctx: Context, sq: PropertySquare): number {
  return Math.ceil((sq.mortgageValue * ctx.rules.mortgageInterestPercent) / 100);
}

export function unmortgageCost(ctx: Context, sq: PropertySquare): number {
  return sq.mortgageValue + mortgageInterest(ctx, sq);
}

export function resaleValue(ctx: Context, street: StreetSquare): number {
  return Math.floor((street.buildingCost * ctx.rules.buildingResalePercent) / 100);
}

export function buildingKindAt(level: number): BuildingKind {
  return level >= MAX_HOUSES ? 'hotel' : 'house';
}

export function bankSupply(s: GameState, kind: BuildingKind): number {
  return kind === 'house' ? s.bank.houses : s.bank.hotels;
}

export interface RentContext {
  diceTotal: number;
  nearest: boolean;
}

export function rentDue(ctx: Context, s: GameState, sq: PropertySquare, arrival: RentContext): number {
  const state = s.properties[sq.id];
  const owner = state.owner;
  if (owner === null || state.mortgaged) return 0;

  switch (sq.kind) {
    case 'street': {
      if (state.level > 0) return sq.rents[state.level];
      const bonus = ownsGroup(ctx, s, owner, sq.group) ? ctx.rules.groupRentMultiplier : 1;
      return sq.rents[0] * bonus;
    }
    case 'transit': {
      const held = ctx.transit.filter((t) => s.properties[t.id].owner === owner).length;
      const fare = ctx.board.transitRents[held - 1];
      return arrival.nearest ? fare * ctx.rules.nearestTransitRentMultiplier : fare;
    }
    case 'utility': {
      const held = ctx.utilities.filter((u) => s.properties[u.id].owner === owner).length;
      const multipliers = ctx.board.utilityMultipliers;
      const multiplier = arrival.nearest ? Math.max(...multipliers) : multipliers[held - 1];
      return multiplier * arrival.diceTotal;
    }
  }
}

export function liquidationValue(ctx: Context, s: GameState, playerId: PlayerId): number {
  let total = mustPlayer(s, playerId).cash;
  for (const sq of ownedProperties(ctx, s, playerId)) {
    const state = s.properties[sq.id];
    if (sq.kind === 'street') total += state.level * resaleValue(ctx, sq);
    if (!state.mortgaged) total += sq.mortgageValue;
  }
  return total;
}

export function placementError(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  propertyId: PropertyId,
): RuleError | null {
  const sq = ctx.properties.get(propertyId);
  if (!sq) return fail('UNKNOWN_PROPERTY', `Unknown property "${propertyId}".`);
  if (sq.kind !== 'street') return fail('NOT_A_STREET', `${sq.name} cannot hold buildings.`);
  const state = s.properties[sq.id];
  if (state.owner !== playerId) return fail('NOT_OWNER', `${playerId} does not own ${sq.name}.`);
  if (!ownsGroup(ctx, s, playerId, sq.group)) {
    return fail('GROUP_INCOMPLETE', `Building on ${sq.name} requires its whole group.`);
  }
  if (groupHasMortgage(ctx, s, sq.group)) {
    return fail('GROUP_MORTGAGED', `A street in the ${sq.group} group is mortgaged.`);
  }
  if (state.level >= HOTEL_LEVEL) return fail('MAX_LEVEL', `${sq.name} already has a hotel.`);
  if (state.level > Math.min(...groupLevels(ctx, s, sq.group))) {
    return fail('UNEVEN_BUILD', 'Buildings must be spread evenly across the group.');
  }
  return null;
}

export function buildDemand(
  ctx: Context,
  s: GameState,
  playerId: PlayerId,
  kind: BuildingKind,
): number {
  let total = 0;
  for (const group of ctx.groups.keys()) {
    if (!ownsGroup(ctx, s, playerId, group) || groupHasMortgage(ctx, s, group)) continue;
    const levels = groupLevels(ctx, s, group);
    if (kind === 'house') {
      total += levels.reduce((sum, level) => sum + Math.max(0, MAX_HOUSES - level), 0);
    } else if (levels.every((level) => level >= MAX_HOUSES)) {
      total += levels.filter((level) => level === MAX_HOUSES).length;
    }
  }
  return total;
}
