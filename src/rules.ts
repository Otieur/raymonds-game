import type { RuleConfig } from './types.ts';

export const DEFAULT_RULES: Readonly<RuleConfig> = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  doublesToJail: 3,
  maxJailRolls: 3,
  mortgageInterestPercent: 10,
  buildingResalePercent: 50,
  groupRentMultiplier: 2,
  nearestTransitRentMultiplier: 2,
  buildingShortageAuction: true,
});
