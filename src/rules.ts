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
  startingDeeds: 0,
  housesBeforeHotel: 4,
  endAfterBankruptcies: null,
});

/**
 * The official short game (60 to 90 minutes), applied on top of the default rules:
 * 1. Each player is dealt two title deeds at setup and pays the bank their printed price.
 * 2. Three houses on every street of a group (instead of four) are enough to buy a hotel.
 *    Hotel rent is unchanged; a hotel sells back for half of its cost, one house less than usual.
 * 3. The game ends at the second bankruptcy. The bankrupt player hands everything, buildings
 *    included, to the creditor, and the remaining players are ranked by net worth.
 */
export const SHORT_GAME_RULES: Readonly<Partial<RuleConfig>> = Object.freeze({
  startingDeeds: 2,
  housesBeforeHotel: 3,
  endAfterBankruptcies: 2,
});
