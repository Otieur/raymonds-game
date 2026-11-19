/**
 * A way of playing as data. Every constant of the rule-based agent is a field here, with the
 * agent's own value as its default, so that `BASELINE` plays exactly as `chooseHeuristicAction`
 * does. A style is plain JSON: it can be named, compared, searched and stored.
 */
import type { GroupId } from '../types.ts';

/** A group of streets, the four passes, or the two works. */
export type SetId = GroupId | 'passes' | 'works';

export const SETS: readonly SetId[] = ['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima', 'passes', 'works'];
/** The four cheap groups, on the first two sides of the board, and the four dear ones. */
export const CHEAP: readonly SetId[] = ['han', 'chain', 'yuan', 'wei'];
export const DEAR: readonly SetId[] = ['shu', 'wu', 'conquest', 'sima'];

export interface Style {
  name: string;

  // What a property is worth to the seat
  valuation: 'factors' | 'v1';
  /** Worth over list price when the seat holds part of the group. */
  partFactor: number;
  /** Worth over list price when the property completes the seat's group. */
  completeFactor: number;
  /** For each other pass held. */
  passStep: number;
  /** If the other works is held. */
  worksStep: number;
  /** A multiplier on the worth of a set's properties. */
  prefer: Partial<Record<SetId, number>>;

  // Cash kept in hand
  reserve: number;
  /** The reserve once any rival has a building. */
  reserveBuilt: number;
  /** Plus this share of the largest rent or tax the seat could owe on its next roll. */
  reserveThreat: number;

  // Buying on landing
  /** Buys when its valuation times this is at least the price. 1: anything; 0.8: only where it holds part; 0.5: only what completes a group; 0: never. */
  buy: Record<SetId, number>;
  /** The share of the reserve that must be left after an ordinary purchase. */
  buyKeep: number;
  /** Mortgages idle property to afford a purchase. */
  mortgageToBuy: boolean;
  /** Declines a property that does not complete its group when no rival holds this multiple of the price in cash. */
  declinePoor: number | null;

  // Property auctions
  /** The most it bids, as a multiple of its own valuation. */
  bidCap: Record<SetId, number>;
  /** An absolute ceiling in coins. */
  bidCeiling: Partial<Record<SetId, number>>;
  /** The cap is multiplied by this when the property would complete a rival's group. */
  blockBonus: number;
  /** The share of the reserve its bids must leave. */
  bidKeep: number;
  /** Raises by the minimum plus a random 0 to bidStep - 1. */
  bidStep: number;
  /** On a property it does not want, bids up to this share of what the keenest rival will pay. */
  driveUp: number;
  /** In a building auction, the most it bids, as a multiple of the building's cost. */
  buildingBid: number;

  // Building
  /** Building pauses on a group at this level until every group it holds has reached it. 5 is a fortress. */
  buildTarget: 1 | 2 | 3 | 4 | 5;
  /** Spare cash above the reserve needed to build past the target; null never builds past it. */
  buildBeyond: number | null;
  /** Which street gets the next building: most rent per coin, or that times the landing rate. */
  buildOrder: 'gain' | 'landing';
  /** 'one' takes one group to the target before the next. */
  buildSpread: 'even' | 'one';
  /** Builds on a group only while a rival stands 2 to this many squares before one of its streets. */
  buildNear: number | null;
  /** Mortgages idle property to pay for buildings below the target. */
  mortgageToBuild: boolean;
  /** Takes no fortress while the bank holds fewer than eight farmsteads. */
  holdHouses: boolean;

  // Mortgages and jail
  /** Redeems only when the reserve plus this share of a salary would be left. */
  redeemSpare: number;
  /** The share of property owned before it prefers to stay in jail. */
  jailStay: number;
  /** Also stays in jail once any rival has a group at three buildings or more. */
  jailStayBuilt: boolean;

  // Trading
  /** The chance it proposes on a turn where it could. */
  proposeRate: number;
  /** Cash offered for a missing street, as a range of multiples of its list price. */
  offerLow: number;
  offerHigh: number;
  /** Below this multiple it does not offer at all. */
  offerFloor: number;
  /** Offers a street a rival needs in exchange for the street it needs. */
  swaps: boolean;
  /** Accepts when what it receives is worth this many times what it gives. Infinity never accepts. */
  acceptMargin: number;
  /** Extra asked for a street that completes the proposer's group, as a multiple of its list price. */
  completionPenalty: number;
  /** Never gives up a property of these sets. */
  neverSell: SetId[];
  /** In a deal that completes a group for the partner, leaves the partner cash for at most this many buildings there. */
  leaveCash: number | null;
  /** Offers its own idle property for cash to the rival who holds most of that set. */
  sellOffers: boolean;
  /** Offers cash at or under list price to a rival who is short of cash. */
  distressOffers: boolean;
  /** At a table of three or four, no deal with the seat that leads by the valuation. */
  shunLeader: boolean;
  /** At a table of three or four, below this chance of winning it sells to the weakest rival. */
  giveUpBelow: number | null;

  // Playing the table: offers (docs/plan/m03b-table-politics.md)
  /** 'value' prices an ask by what the property is worth to the seat by the deal sheet, not by a multiple of list price. */
  offerBy: 'list' | 'value';
  /** With offerBy 'value': 'list' keeps today's price, a multiple of list price, for the street that completes a group, and prices only the other asks by value. */
  completeBy: 'list' | 'value';
  /** The first ask, as a share of that worth. */
  openShare: number;
  /** The most it offers, as that share. */
  maxShare: number;
  /** Added to the share each time the same ask is refused. */
  raiseStep: number;
  /** Own turns before a refused ask is made again. */
  probeGap: number;
  /** A fall in the holder's chance since the last ask that renews it at once. */
  probeDrop: number;
  /** Asks for streets of groups it holds part of, not only for a last street. */
  earlyOffers: boolean;
  /** The round after which early asks stop. */
  earlyBefore: number;
  /** The least chance of getting the rest of the group for an early ask. */
  earlyNeed: number;
  /** Buys what the strongest rival wants. */
  denyOffers: boolean;
  /** The rival's potential chance, over an even share, from which it acts. */
  denyThreat: number;
  /** The most it pays to deny, as a share of what the denial is worth to it. */
  denyShare: number;
  /** Denies only while ranked at or above this place. */
  denyRank: number;
  /** Buys from a failing rival: what it wants itself, or also what the strongest rival wants. */
  estateOffers: 'off' | 'self' | 'both';
  /** A rival is failing below this chance over an even share, when also short of cash or falling. */
  failBelow: number;
  /** Pays a failing rival enough to meet its largest due when the creditor is the strongest rival. */
  rescue: boolean;
  /** Offers for a rival's property at the moment that rival cannot pay a debt. */
  debtOffers: boolean;
  /** In a debt it cannot cover, offers its own property to a seat other than the creditor. */
  debtSales: boolean;
  /** Sends invitations: offers that favour a seat it wants as a partner. */
  courtAllies: boolean;
  /** Points by which an invitation favours the receiver. */
  giftEdge: number;
  /** Goodwill each way from which two seats are allied. */
  allyAt: number;
  /** Rounds an invitation waits for an answer, and the rounds in which goodwill halves. */
  allyTurns: number;

  // Playing the table: answers
  /** 'sheet' accepts by the deal's score, not by the factors. */
  answerBy: 'factors' | 'sheet';
  /** Points a deal's score must reach. */
  acceptEdge: number;
  /** The strongest rival's gain counts against a deal by this weight. */
  againstLeader: number;
  /** The gain of a partner ranked below both the seat and the strongest rival counts for a deal by this weight. */
  forWeak: number;
  /** The weight of a partner's goodwill in a deal's score: how far it reads signals. */
  reciprocity: number;

  // Playing the table: building
  /** Builds first where a failing rival is about to land. */
  huntFailing: boolean;

  // Reading the table
  /** Offers watched; 0 never changes mode. */
  moodWindow: number;
  /** The share accepted below which the table "does not trade". */
  moodFloor: number;
  /** Fields that change while the table does not trade. */
  blockMode: Partial<Style> | null;

  // By stage of its own game
  /** Fields that change once its first group stands at the build target. */
  afterFirstGroup: Partial<Style> | null;

  // By table size
  bySize: Partial<Record<2 | 3 | 4, Partial<Style>>>;
}

const everySet = (value: number): Record<SetId, number> => Object.fromEntries(SETS.map((set) => [set, value])) as Record<SetId, number>;

/** Today's rule-based agent. */
export const BASELINE: Style = {
  name: 'baseline',
  valuation: 'factors',
  partFactor: 1.3,
  completeFactor: 2.2,
  passStep: 0.25,
  worksStep: 0.3,
  prefer: {},
  reserve: 150,
  reserveBuilt: 300,
  reserveThreat: 0,
  buy: everySet(1),
  buyKeep: 0.5,
  mortgageToBuy: false,
  declinePoor: null,
  bidCap: everySet(0.85),
  bidCeiling: {},
  blockBonus: 1.1 / 0.85,
  bidKeep: 1 / 3,
  bidStep: 12,
  driveUp: 0,
  buildingBid: 1.15,
  buildTarget: 5,
  buildBeyond: 0,
  buildOrder: 'gain',
  buildSpread: 'even',
  buildNear: null,
  mortgageToBuild: false,
  holdHouses: false,
  redeemSpare: 0.5,
  jailStay: 2 / 3,
  jailStayBuilt: false,
  proposeRate: 1,
  offerLow: 1.7,
  offerHigh: 2.2,
  offerFloor: 1.3,
  swaps: false,
  acceptMargin: 1.1,
  completionPenalty: 0.8,
  neverSell: [],
  leaveCash: null,
  sellOffers: false,
  distressOffers: false,
  shunLeader: false,
  giveUpBelow: null,
  offerBy: 'list',
  completeBy: 'value',
  openShare: 0.3,
  maxShare: 0.8,
  raiseStep: 0.15,
  probeGap: 3,
  probeDrop: 0.05,
  earlyOffers: false,
  earlyBefore: 20,
  earlyNeed: 0,
  denyOffers: false,
  denyThreat: 1.3,
  denyShare: 0.8,
  denyRank: 4,
  estateOffers: 'off',
  failBelow: 0.4,
  rescue: false,
  debtOffers: false,
  debtSales: false,
  courtAllies: false,
  giftEdge: 2,
  allyAt: 3,
  allyTurns: 4,
  answerBy: 'factors',
  acceptEdge: 0,
  againstLeader: 0,
  forWeak: 0,
  reciprocity: 0,
  huntFailing: false,
  moodWindow: 0,
  moodFloor: 0,
  blockMode: null,
  afterFirstGroup: null,
  bySize: {},
};

/** The fields added for playing the table (M3b). */
export const TABLE_FIELDS = [
  'offerBy', 'completeBy', 'openShare', 'maxShare', 'raiseStep', 'probeGap', 'probeDrop', 'earlyOffers', 'earlyBefore', 'earlyNeed',
  'denyOffers', 'denyThreat', 'denyShare', 'denyRank', 'estateOffers', 'failBelow', 'rescue', 'debtOffers', 'debtSales',
  'courtAllies', 'giftEdge', 'allyAt', 'allyTurns', 'answerBy', 'acceptEdge', 'againstLeader', 'forWeak', 'reciprocity', 'huntFailing',
] as const satisfies readonly (keyof Style)[];

/** A style as it may have been stored before the table fields existed. */
export type StoredStyle = Omit<Style, (typeof TABLE_FIELDS)[number]> & Partial<Pick<Style, (typeof TABLE_FIELDS)[number]>>;

/** A stored style with every field it lacks at the baseline's value, so that it plays as it did when it was stored. */
export function completeStyle(stored: StoredStyle): Style {
  return { ...BASELINE, ...stored };
}

/** A style from the baseline and some changes. Record fields such as `buy` are merged set by set. */
export function styleFrom(name: string, changes: Partial<Style>, base: Style = BASELINE): Style {
  return applyChanges({ ...base, name }, changes);
}

/** Applies changes over a style; a record field is merged key by key rather than replaced. */
export function applyChanges(style: Style, changes: Partial<Style>): Style {
  const out = { ...style } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const current = out[key];
    const isRecord = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (key !== 'blockMode' && key !== 'afterFirstGroup' && key !== 'bySize' && isRecord(current) && isRecord(value)) {
      out[key] = { ...(current as object), ...(value as object) };
    } else {
      out[key] = value;
    }
  }
  return out as unknown as Style;
}

/** Ranges every number must lie in. */
const RANGES: Partial<Record<keyof Style, [number, number]>> = {
  partFactor: [1, 4],
  completeFactor: [1, 5],
  passStep: [0, 2],
  worksStep: [0, 2],
  reserve: [0, 2000],
  reserveBuilt: [0, 2000],
  reserveThreat: [0, 2],
  buyKeep: [0, 2],
  blockBonus: [1, 3],
  bidKeep: [0, 2],
  bidStep: [1, 100],
  driveUp: [0, 1],
  buildingBid: [0, 5],
  buildTarget: [1, 5],
  redeemSpare: [0, 5],
  jailStay: [0, 1],
  proposeRate: [0, 1],
  offerLow: [0, 10],
  offerHigh: [0, 10],
  offerFloor: [0, 10],
  completionPenalty: [0, 100],
  moodWindow: [0, 100],
  moodFloor: [0, 1],
  openShare: [0, 2],
  maxShare: [0, 2],
  raiseStep: [0, 1],
  probeGap: [1, 40],
  probeDrop: [0, 1],
  earlyBefore: [0, 200],
  earlyNeed: [0, 1],
  denyThreat: [0, 4],
  denyShare: [0, 2],
  denyRank: [1, 4],
  failBelow: [0, 4],
  giftEdge: [0, 20],
  allyAt: [0, 20],
  allyTurns: [1, 40],
  acceptEdge: [-20, 20],
  againstLeader: [0, 5],
  forWeak: [0, 5],
  reciprocity: [0, 5],
};

/** The problems with a style, one message each; empty when it is sound. */
export function validateStyle(style: Style): string[] {
  const problems: string[] = [];
  for (const [key, [low, high]] of Object.entries(RANGES) as [keyof Style, [number, number]][]) {
    const value = style[key];
    if (typeof value !== 'number' || Number.isNaN(value) || value < low || value > high) {
      problems.push(`${String(key)} must be a number from ${low} to ${high}, not ${String(value)}`);
    }
  }
  for (const key of ['buy', 'bidCap'] as const) {
    for (const set of SETS) {
      const value = style[key][set];
      if (typeof value !== 'number' || value < 0 || value > 10) problems.push(`${key}.${set} must be a number from 0 to 10`);
    }
  }
  if (style.offerHigh < style.offerLow) problems.push('offerHigh must not be below offerLow');
  if (style.maxShare < style.openShare) problems.push('maxShare must not be below openShare');
  if (style.offerBy !== 'list' && style.offerBy !== 'value') problems.push("offerBy must be 'list' or 'value'");
  if (style.completeBy !== 'list' && style.completeBy !== 'value') problems.push("completeBy must be 'list' or 'value'");
  if (style.answerBy !== 'factors' && style.answerBy !== 'sheet') problems.push("answerBy must be 'factors' or 'sheet'");
  if (!['off', 'self', 'both'].includes(style.estateOffers)) problems.push("estateOffers must be 'off', 'self' or 'both'");
  if (!(style.acceptMargin > 0)) problems.push('acceptMargin must be above 0');
  if (style.buildBeyond !== null && !(style.buildBeyond >= 0)) problems.push('buildBeyond must be 0 or more, or null');
  if (style.declinePoor !== null && !(style.declinePoor > 0)) problems.push('declinePoor must be above 0, or null');
  if (style.buildNear !== null && !(style.buildNear >= 2 && style.buildNear <= 40)) problems.push('buildNear must be from 2 to 40, or null');
  if (style.leaveCash !== null && !(style.leaveCash >= 0 && style.leaveCash <= 15)) problems.push('leaveCash must be from 0 to 15, or null');
  if (style.giveUpBelow !== null && !(style.giveUpBelow >= 0 && style.giveUpBelow <= 1)) problems.push('giveUpBelow must be from 0 to 1, or null');
  for (const set of style.neverSell) if (!SETS.includes(set)) problems.push(`neverSell names an unknown set ${set}`);
  for (const [set, value] of Object.entries(style.prefer)) {
    if (!SETS.includes(set) || typeof value !== 'number' || value < 0 || value > 5) problems.push(`prefer.${set} must be a number from 0 to 5`);
  }
  for (const [set, value] of Object.entries(style.bidCeiling)) {
    if (!SETS.includes(set) || typeof value !== 'number' || value < 0) problems.push(`bidCeiling.${set} must be 0 or more`);
  }
  return problems;
}
