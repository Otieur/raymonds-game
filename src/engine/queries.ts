import type { Context } from '../context.ts';
import { HOTEL_LEVEL } from '../types.ts';
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
  Standing,
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

/*
 * A street's level is its house count (0 to housesBeforeHotel) or HOTEL_LEVEL for a hotel,
 * so rents[level] is always the right rent. Its step counts buildings bought in order:
 * a hotel is one step past the last house. Even building, refunds and building value use steps.
 */

export function buildingStep(ctx: Context, level: number): number {
  return level === HOTEL_LEVEL ? ctx.rules.housesBeforeHotel + 1 : level;
}

export function isBuildingLevel(ctx: Context, level: number): boolean {
  return Number.isInteger(level) && ((level >= 0 && level <= ctx.rules.housesBeforeHotel) || level === HOTEL_LEVEL);
}

export function nextLevel(ctx: Context, level: number): number {
  return level === ctx.rules.housesBeforeHotel ? HOTEL_LEVEL : level + 1;
}

export function previousLevel(ctx: Context, level: number): number {
  return level === HOTEL_LEVEL ? ctx.rules.housesBeforeHotel : level - 1;
}

export function groupSteps(ctx: Context, s: GameState, group: GroupId): number[] {
  return groupLevels(ctx, s, group).map((level) => buildingStep(ctx, level));
}

/** The kind of building the next purchase on a street at this level would be. */
export function buildingKindAt(ctx: Context, level: number): BuildingKind {
  return level >= ctx.rules.housesBeforeHotel ? 'hotel' : 'house';
}

/** The first bid must reach the opening bid; every later bid must beat the high bid. */
export function minimumBid(ctx: Context, auction: { highBid: number; highBidder: PlayerId | null }): number {
  return auction.highBidder === null ? ctx.rules.auctionOpeningBid : auction.highBid + 1;
}

/** A building auction opens at the opening bid, or at the list price if that is lower. */
export function buildingOpeningBid(ctx: Context, street: StreetSquare): number {
  return Math.min(ctx.rules.auctionOpeningBid, street.buildingCost);
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
    if (sq.kind === 'street') total += buildingStep(ctx, state.level) * resaleValue(ctx, sq);
    if (!state.mortgaged) total += sq.mortgageValue;
  }
  return total;
}

/**
 * Net worth as the short game counts it: cash, properties at their printed price (half for a
 * mortgaged one), and buildings at what they cost, a hotel including the houses it replaced.
 */
export function netWorth(ctx: Context, s: GameState, playerId: PlayerId): number {
  let total = mustPlayer(s, playerId).cash;
  for (const sq of ownedProperties(ctx, s, playerId)) {
    const state = s.properties[sq.id];
    total += state.mortgaged ? Math.floor(sq.price / 2) : sq.price;
    if (sq.kind === 'street') total += buildingStep(ctx, state.level) * sq.buildingCost;
  }
  return total;
}

/** Players still in the game, richest first; ties go to more cash, then to seat order. */
export function standings(ctx: Context, s: GameState): Standing[] {
  return activePlayers(s)
    .map((p, seat) => ({ seat, standing: { player: p.id, netWorth: netWorth(ctx, s, p.id), cash: p.cash } }))
    .sort((a, b) => b.standing.netWorth - a.standing.netWorth || b.standing.cash - a.standing.cash || a.seat - b.seat)
    .map((entry) => entry.standing);
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
  if (buildingStep(ctx, state.level) > Math.min(...groupSteps(ctx, s, sq.group))) {
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
    const houses = ctx.rules.housesBeforeHotel;
    if (kind === 'house') {
      total += levels.reduce((sum, level) => sum + (level === HOTEL_LEVEL ? 0 : Math.max(0, houses - level)), 0);
    } else if (levels.every((level) => level >= houses)) {
      total += levels.filter((level) => level === houses).length;
    }
  }
  return total;
}
