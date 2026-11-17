export type PlayerId = string;
export type SquareId = string;
export type PropertyId = SquareId;
export type GroupId = string;
export type DeckId = string;
export type CardId = string;
export type Dice = [number, number];
export type BuildingKind = 'house' | 'hotel';

export const MAX_HOUSES = 4;
export const HOTEL_LEVEL = 5;

export interface StreetSquare {
  kind: 'street';
  id: PropertyId;
  name: string;
  group: GroupId;
  price: number;
  buildingCost: number;
  rents: readonly [number, number, number, number, number, number];
  mortgageValue: number;
}

export interface TransitSquare {
  kind: 'transit';
  id: PropertyId;
  name: string;
  price: number;
  mortgageValue: number;
}

export interface UtilitySquare {
  kind: 'utility';
  id: PropertyId;
  name: string;
  price: number;
  mortgageValue: number;
}

export interface TaxSquare {
  kind: 'tax';
  id: SquareId;
  name: string;
  amount: number;
}

export interface CardSquare {
  kind: 'card';
  id: SquareId;
  name: string;
  deck: DeckId;
}

export interface PlainSquare {
  kind: 'start' | 'jail' | 'rest' | 'goToJail';
  id: SquareId;
  name: string;
}

export type PropertySquare = StreetSquare | TransitSquare | UtilitySquare;
export type Square = PropertySquare | TaxSquare | CardSquare | PlainSquare;

export type CardEffect =
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'collectFromEach'; amount: number }
  | { type: 'payEach'; amount: number }
  | { type: 'moveTo'; square: SquareId }
  | { type: 'moveBack'; steps: number }
  | { type: 'moveToNearest'; kind: 'transit' | 'utility' }
  | { type: 'goToJail' }
  | { type: 'jailFree' }
  | { type: 'repairs'; perHouse: number; perHotel: number };

export interface CardDefinition {
  id: CardId;
  text: string;
  effect: CardEffect;
}

export interface Economy {
  startingCash: number;
  salary: number;
  bail: number;
  houses: number;
  hotels: number;
}

export interface BoardDefinition {
  id: string;
  name: string;
  squares: readonly Square[];
  transitRents: readonly number[];
  utilityMultipliers: readonly number[];
  decks: Readonly<Record<DeckId, readonly CardDefinition[]>>;
  economy: Economy;
}

export interface RuleConfig {
  minPlayers: number;
  maxPlayers: number;
  doublesToJail: number;
  maxJailRolls: number;
  mortgageInterestPercent: number;
  buildingResalePercent: number;
  groupRentMultiplier: number;
  nearestTransitRentMultiplier: number;
  buildingShortageAuction: boolean;
}

export interface HeldJailCard {
  deck: DeckId;
  card: CardId;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  cash: number;
  position: number;
  inJail: boolean;
  jailRolls: number;
  jailCards: HeldJailCard[];
  bankrupt: boolean;
}

export interface PropertyState {
  owner: PlayerId | null;
  mortgaged: boolean;
  level: number;
}

export interface TradeSide {
  cash: number;
  properties: PropertyId[];
  jailCards: number;
}

export interface TradeOffer {
  from: PlayerId;
  to: PlayerId;
  give: TradeSide;
  receive: TradeSide;
}

export type PaymentReason =
  | 'salary'
  | 'rent'
  | 'tax'
  | 'card'
  | 'bail'
  | 'interest'
  | 'purchase'
  | 'auction'
  | 'building'
  | 'refund'
  | 'mortgage'
  | 'unmortgage'
  | 'trade'
  | 'bankruptcy';

export type Resume = { kind: 'jailMove'; dice: Dice };

export type Pending =
  | { kind: 'buy'; player: PlayerId; property: PropertyId }
  | {
      kind: 'auction';
      property: PropertyId;
      bidders: PlayerId[];
      highBid: number;
      highBidder: PlayerId | null;
    }
  | {
      kind: 'buildingAuction';
      building: BuildingKind;
      bidders: PlayerId[];
      highBid: number;
      highBidder: PlayerId;
      nominations: Record<PlayerId, PropertyId>;
    }
  | {
      kind: 'debt';
      debtor: PlayerId;
      creditor: PlayerId | null;
      amount: number;
      reason: PaymentReason;
      resume?: Resume;
    }
  | { kind: 'mortgageTransfer'; player: PlayerId; property: PropertyId }
  | { kind: 'trade'; offer: TradeOffer };

export interface TurnState {
  player: PlayerId;
  number: number;
  phase: 'preRoll' | 'postRoll';
  doubles: number;
  lastRoll: Dice | null;
}

export interface GameState {
  schema: 1;
  board: string;
  players: PlayerState[];
  properties: Record<PropertyId, PropertyState>;
  bank: { houses: number; hotels: number };
  decks: Record<DeckId, CardId[]>;
  turn: TurnState;
  pending: Pending[];
  auctionQueue: PropertyId[];
  rng: number;
  diceQueue: Dice[];
  winner: PlayerId | null;
}

export type Action =
  | { type: 'ROLL'; player: PlayerId }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'PAY_BAIL'; player: PlayerId }
  | { type: 'USE_JAIL_CARD'; player: PlayerId }
  | { type: 'BUY'; player: PlayerId }
  | { type: 'DECLINE'; player: PlayerId }
  | { type: 'BID'; player: PlayerId; amount: number; property?: PropertyId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'BUILD'; player: PlayerId; property: PropertyId }
  | { type: 'SELL_BUILDING'; player: PlayerId; property: PropertyId }
  | { type: 'SELL_BUILDINGS'; player: PlayerId; levels: Record<PropertyId, number> }
  | { type: 'MORTGAGE'; player: PlayerId; property: PropertyId }
  | { type: 'UNMORTGAGE'; player: PlayerId; property: PropertyId }
  | { type: 'SETTLE_TRANSFER'; player: PlayerId; lift: boolean }
  | { type: 'PROPOSE_TRADE'; player: PlayerId; to: PlayerId; give: TradeSide; receive: TradeSide }
  | { type: 'ACCEPT_TRADE'; player: PlayerId }
  | { type: 'REJECT_TRADE'; player: PlayerId }
  | { type: 'CANCEL_TRADE'; player: PlayerId }
  | { type: 'DECLARE_BANKRUPTCY'; player: PlayerId };

export type LegalAction =
  | Exclude<Action, { type: 'BID' | 'PROPOSE_TRADE' }>
  | {
      type: 'BID';
      player: PlayerId;
      min: number;
      max: number;
      targets?: { property: PropertyId; min: number }[];
    }
  | { type: 'PROPOSE_TRADE'; player: PlayerId; partners: PlayerId[] };

export type GameEvent =
  | { type: 'TURN_STARTED'; player: PlayerId; turn: number }
  | { type: 'DICE_ROLLED'; player: PlayerId; dice: Dice; purpose: 'move' | 'jail' | 'utility' }
  | { type: 'MOVED'; player: PlayerId; from: number; to: number; passedStart: boolean }
  | { type: 'SENT_TO_JAIL'; player: PlayerId; reason: 'square' | 'card' | 'doubles' }
  | { type: 'JAIL_ROLL_FAILED'; player: PlayerId; attempt: number }
  | { type: 'LEFT_JAIL'; player: PlayerId; how: 'doubles' | 'bail' | 'card' | 'forcedBail' }
  | { type: 'CARD_DRAWN'; player: PlayerId; deck: DeckId; card: CardId }
  | { type: 'PAID'; from: PlayerId | null; to: PlayerId | null; amount: number; reason: PaymentReason }
  | {
      type: 'DEBT_INCURRED';
      debtor: PlayerId;
      creditor: PlayerId | null;
      amount: number;
      reason: PaymentReason;
    }
  | { type: 'PROPERTY_OFFERED'; player: PlayerId; property: PropertyId }
  | {
      type: 'PROPERTY_ACQUIRED';
      player: PlayerId;
      property: PropertyId;
      price: number;
      via: 'purchase' | 'auction' | 'trade' | 'bankruptcy';
    }
  | { type: 'AUCTION_STARTED'; property: PropertyId; bidders: PlayerId[] }
  | {
      type: 'BUILDING_AUCTION_STARTED';
      building: BuildingKind;
      bidders: PlayerId[];
      openedBy: PlayerId;
      openingBid: number;
    }
  | { type: 'BID_PLACED'; player: PlayerId; amount: number }
  | { type: 'AUCTION_PASSED'; player: PlayerId }
  | { type: 'AUCTION_ENDED'; property: PropertyId; winner: PlayerId | null; amount: number }
  | { type: 'BUILT'; player: PlayerId; property: PropertyId; level: number; cost: number }
  | { type: 'BUILDINGS_SOLD'; player: PlayerId; levels: Record<PropertyId, number>; refund: number }
  | { type: 'MORTGAGED'; player: PlayerId; property: PropertyId; amount: number }
  | { type: 'UNMORTGAGED'; player: PlayerId; property: PropertyId; amount: number }
  | { type: 'MORTGAGE_KEPT'; player: PlayerId; property: PropertyId }
  | { type: 'TRADE_PROPOSED'; offer: TradeOffer }
  | { type: 'TRADE_ACCEPTED'; offer: TradeOffer }
  | { type: 'TRADE_REJECTED'; offer: TradeOffer }
  | { type: 'TRADE_CANCELLED'; offer: TradeOffer }
  | { type: 'BANKRUPT'; player: PlayerId; creditor: PlayerId | null }
  | { type: 'GAME_OVER'; winner: PlayerId };

export type ErrorCode =
  | 'INVALID_ACTION'
  | 'GAME_OVER'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_BANKRUPT'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'DECISION_PENDING'
  | 'NOT_IN_JAIL'
  | 'NO_JAIL_CARD'
  | 'INSUFFICIENT_CASH'
  | 'UNKNOWN_PROPERTY'
  | 'NOT_A_STREET'
  | 'NOT_OWNER'
  | 'ALREADY_MORTGAGED'
  | 'NOT_MORTGAGED'
  | 'GROUP_INCOMPLETE'
  | 'GROUP_MORTGAGED'
  | 'GROUP_HAS_BUILDINGS'
  | 'UNEVEN_BUILD'
  | 'MAX_LEVEL'
  | 'NO_BUILDINGS'
  | 'BANK_SUPPLY'
  | 'NOT_A_BIDDER'
  | 'BID_TOO_LOW'
  | 'INVALID_TRADE'
  | 'CAN_STILL_PAY';

export interface RuleError {
  code: ErrorCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleError };
