import type { Engine } from '../engine/engine.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type {
  Action,
  GameState,
  GroupId,
  LegalAction,
  PlayerId,
  PlayerState,
  PropertyId,
  PropertySquare,
  StreetSquare,
  TradeOffer,
} from '../types.ts';
import { ofType } from './random-agent.ts';

type Random = () => number;

/** What the agent remembers between calls. Pass the same object for a whole game. */
export interface AgentMemory {
  /** The turn on which each player last proposed a trade. */
  proposedOn: Record<PlayerId, number>;
}

export function createAgentMemory(): AgentMemory {
  return { proposedOn: {} };
}

interface Lens {
  engine: Engine;
  state: GameState;
  me: PlayerState;
  properties: PropertySquare[];
  byId: Map<PropertyId, PropertySquare>;
  groups: Map<GroupId, StreetSquare[]>;
}

function lensOf(engine: Engine, state: GameState, actor: PlayerId): Lens | null {
  const me = state.players.find((p) => p.id === actor);
  if (!me || me.bankrupt) return null;
  const properties: PropertySquare[] = [];
  const groups = new Map<GroupId, StreetSquare[]>();
  for (const sq of engine.board.squares) {
    if (sq.kind !== 'street' && sq.kind !== 'transit' && sq.kind !== 'utility') continue;
    properties.push(sq);
    if (sq.kind === 'street') groups.set(sq.group, [...(groups.get(sq.group) ?? []), sq]);
  }
  return { engine, state, me, properties, byId: new Map(properties.map((sq) => [sq.id, sq])), groups };
}

const ownerOf = (L: Lens, id: PropertyId) => L.state.properties[id].owner;

function groupMates(L: Lens, sq: StreetSquare): StreetSquare[] {
  return (L.groups.get(sq.group) ?? []).filter((other) => other.id !== sq.id);
}

/** Whether every other street of the group belongs to `player`. */
function holdsRestOfGroup(L: Lens, player: PlayerId, sq: PropertySquare): boolean {
  if (sq.kind !== 'street') return false;
  const mates = groupMates(L, sq);
  return mates.length > 0 && mates.every((mate) => ownerOf(L, mate.id) === player);
}

/** Whether buying the street would stop one rival from completing the group. */
function blocksRival(L: Lens, sq: PropertySquare): boolean {
  if (sq.kind !== 'street') return false;
  const rival = ownerOf(L, groupMates(L, sq)[0]?.id ?? sq.id);
  return rival !== null && rival !== L.me.id && holdsRestOfGroup(L, rival, sq);
}

function unmortgageCost(L: Lens, sq: PropertySquare): number {
  return sq.mortgageValue + Math.ceil((sq.mortgageValue * L.engine.rules.mortgageInterestPercent) / 100);
}

/** What a property is worth to a player: its price, raised by what it does for their sets. */
function worth(L: Lens, player: PlayerId, sq: PropertySquare): number {
  let factor = 1;
  if (sq.kind === 'street') {
    const held = groupMates(L, sq).filter((mate) => ownerOf(L, mate.id) === player).length;
    if (holdsRestOfGroup(L, player, sq)) factor = 2.2;
    else if (held > 0) factor = 1.3;
  } else {
    const kin = L.properties.filter((p) => p.kind === sq.kind && p.id !== sq.id && ownerOf(L, p.id) === player);
    factor = 1 + (sq.kind === 'transit' ? 0.25 : 0.3) * kin.length;
  }
  const lien = L.state.properties[sq.id].mortgaged ? unmortgageCost(L, sq) : 0;
  return Math.round(sq.price * factor) - lien;
}

/** Cash to keep in hand; more once a rival has buildings to land on. */
function reserve(L: Lens): number {
  const threatened = L.properties.some(
    (sq) => L.state.properties[sq.id].level > 0 && ownerOf(L, sq.id) !== L.me.id,
  );
  return Math.round(L.engine.board.economy.salary * (threatened ? 1.5 : 0.75));
}

/** Extra rent per coin spent on the next building. */
function rentGain(L: Lens, sq: StreetSquare): number {
  const level = L.state.properties[sq.id].level;
  const next = level === L.engine.rules.housesBeforeHotel ? HOTEL_LEVEL : level + 1;
  return (sq.rents[next] - sq.rents[level]) / sq.buildingCost;
}

function streetOf(L: Lens, id: PropertyId): StreetSquare {
  return L.byId.get(id) as StreetSquare;
}

function proposeTrade(L: Lens, legal: LegalAction[], random: Random, memory: AgentMemory): Action | null {
  const { state, me } = L;
  if (memory.proposedOn[me.id] === state.turn.number) return null;
  const open = ofType(legal, 'PROPOSE_TRADE')[0];
  if (!open) return null;

  for (const streets of L.groups.values()) {
    const missing = streets.filter((sq) => ownerOf(L, sq.id) !== me.id);
    if (missing.length !== 1 || streets.length < 2) continue;
    const target = missing[0];
    const holder = ownerOf(L, target.id);
    if (holder === null || !open.partners.includes(holder) || state.properties[target.id].mortgaged) continue;
    const cash = Math.min(me.cash - reserve(L), Math.round(target.price * (1.7 + random() * 0.5)));
    if (cash < target.price * 1.3) continue;
    const action: Action = {
      type: 'PROPOSE_TRADE',
      player: me.id,
      to: holder,
      give: { cash, properties: [], jailCards: 0 },
      receive: { cash: 0, properties: [target.id], jailCards: 0 },
    };
    if (L.engine.validate(state, action) === null) {
      memory.proposedOn[me.id] = state.turn.number;
      return action;
    }
  }
  return null;
}

function freeTurn(L: Lens, legal: LegalAction[], random: Random, memory?: AgentMemory): Action | null {
  const { state, me } = L;
  const { salary, bail } = L.engine.board.economy;
  const keep = reserve(L);

  if (me.inJail && state.turn.phase === 'preRoll') {
    const unowned = L.properties.filter((sq) => ownerOf(L, sq.id) === null).length;
    if (unowned > L.properties.length / 3) {
      const card = ofType(legal, 'USE_JAIL_CARD')[0];
      if (card) return card;
      const pay = ofType(legal, 'PAY_BAIL')[0];
      if (pay && me.cash - bail >= keep) return pay;
    }
  }

  const lifts = ofType(legal, 'UNMORTGAGE')
    .map((action) => ({ action, sq: L.byId.get(action.property) as PropertySquare }))
    .sort((a, b) => worth(L, me.id, b.sq) - worth(L, me.id, a.sq));
  for (const { action, sq } of lifts) {
    if (me.cash - unmortgageCost(L, sq) >= keep + salary / 2) return action;
  }

  const builds = ofType(legal, 'BUILD')
    .map((action) => ({ action, sq: streetOf(L, action.property) }))
    .sort((a, b) => rentGain(L, b.sq) - rentGain(L, a.sq));
  for (const { action, sq } of builds) {
    if (me.cash - sq.buildingCost >= keep) return action;
  }

  if (memory && state.turn.phase === 'postRoll') {
    const offer = proposeTrade(L, legal, random, memory);
    if (offer) return offer;
  }
  return ofType(legal, 'ROLL')[0] ?? ofType(legal, 'END_TURN')[0] ?? null;
}

function decideBuy(L: Lens, legal: LegalAction[], property: PropertyId): Action {
  const buy = ofType(legal, 'BUY')[0];
  const sq = L.byId.get(property) as PropertySquare;
  const wanted = holdsRestOfGroup(L, L.me.id, sq) || blocksRival(L, sq);
  if (buy && (wanted || L.me.cash - sq.price >= reserve(L) / 2)) return buy;
  return { type: 'DECLINE', player: L.me.id };
}

function bidOnProperty(L: Lens, legal: LegalAction[], property: PropertyId, random: Random): Action {
  const pass: Action = { type: 'PASS', player: L.me.id };
  const bid = ofType(legal, 'BID')[0];
  if (!bid) return pass;
  const sq = L.byId.get(property) as PropertySquare;
  const appetite = blocksRival(L, sq) ? 1.1 : 0.85;
  const limit = Math.min(bid.max - Math.round(reserve(L) / 3), Math.round(worth(L, L.me.id, sq) * appetite));
  if (bid.min > limit) return pass;
  return { type: 'BID', player: L.me.id, amount: Math.min(limit, bid.min + Math.floor(random() * 12)) };
}

function bidOnBuilding(L: Lens, legal: LegalAction[], random: Random): Action {
  const pass: Action = { type: 'PASS', player: L.me.id };
  const bid = ofType(legal, 'BID')[0];
  if (!bid?.targets || bid.targets.length === 0) return pass;
  const target = [...bid.targets].sort(
    (a, b) => rentGain(L, streetOf(L, b.property)) - rentGain(L, streetOf(L, a.property)),
  )[0];
  const cost = streetOf(L, target.property).buildingCost;
  const limit = Math.min(bid.max - Math.round(reserve(L) / 2), Math.round(cost * 1.15));
  if (target.min > limit) return pass;
  const amount = Math.min(limit, target.min + Math.floor(random() * 8));
  return { type: 'BID', player: L.me.id, amount, property: target.property };
}

function raiseFunds(L: Lens, legal: LegalAction[]): Action | null {
  const giveUp = ofType(legal, 'DECLARE_BANKRUPTCY')[0];
  if (giveUp) return giveUp;
  const mortgages = ofType(legal, 'MORTGAGE').sort(
    (a, b) =>
      worth(L, L.me.id, L.byId.get(a.property) as PropertySquare) -
      worth(L, L.me.id, L.byId.get(b.property) as PropertySquare),
  );
  if (mortgages.length > 0) return mortgages[0];
  const sales = ofType(legal, 'SELL_BUILDING').sort(
    (a, b) => streetOf(L, a.property).rents[HOTEL_LEVEL] - streetOf(L, b.property).rents[HOTEL_LEVEL],
  );
  return sales[0] ?? ofType(legal, 'SELL_BUILDINGS')[0] ?? null;
}

function answerOffer(L: Lens, offer: TradeOffer): Action {
  const me = L.me.id;
  const cardValue = Math.round(L.engine.board.economy.bail * 0.8);
  let gain = offer.give.cash + offer.give.jailCards * cardValue;
  for (const id of offer.give.properties) gain += worth(L, me, L.byId.get(id) as PropertySquare);
  let loss = offer.receive.cash + offer.receive.jailCards * cardValue;
  for (const id of offer.receive.properties) {
    const sq = L.byId.get(id) as PropertySquare;
    loss += worth(L, me, sq);
    if (holdsRestOfGroup(L, offer.from, sq)) loss += Math.round(sq.price * 0.8);
  }
  return { type: gain >= loss * 1.1 ? 'ACCEPT_TRADE' : 'REJECT_TRADE', player: me };
}

/**
 * Picks an action for `actor` by simple rules of thumb: buy what it can afford, keep a cash
 * reserve, build where rent grows fastest, and trade only when the deal is clearly good.
 * Returns null when the game is not waiting on `actor`. With a `memory`, the agent also
 * proposes at most one trade per turn of its own.
 */
export function chooseHeuristicAction(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  random: Random,
  memory?: AgentMemory,
): Action | null {
  if (!engine.awaiting(state).includes(actor)) return null;
  const L = lensOf(engine, state, actor);
  if (!L) return null;
  const legal = engine.legalActions(state, actor);
  const top = state.pending[state.pending.length - 1];
  if (!top) return freeTurn(L, legal, random, memory);

  switch (top.kind) {
    case 'buy':
      return decideBuy(L, legal, top.property);
    case 'auction':
      return bidOnProperty(L, legal, top.property, random);
    case 'buildingAuction':
      return bidOnBuilding(L, legal, random);
    case 'debt':
      return raiseFunds(L, legal);
    case 'mortgageTransfer': {
      const sq = L.byId.get(top.property) as PropertySquare;
      const lift = L.me.cash - sq.mortgageValue >= reserve(L) + L.engine.board.economy.salary / 2;
      const canLift = legal.some((action) => action.type === 'SETTLE_TRANSFER' && action.lift);
      return { type: 'SETTLE_TRANSFER', player: actor, lift: lift && canLift };
    }
    case 'jailExit':
      return { type: 'USE_JAIL_CARD', player: actor };
    case 'trade':
      return answerOffer(L, top.offer);
  }
}

/** An agent for `simulateGame`: whichever player the game waits on acts by the rules above. */
export function heuristicAgent(memory: AgentMemory = createAgentMemory()) {
  return (engine: Engine, state: GameState, random: Random): Action | null => {
    const waiting = engine.awaiting(state);
    if (waiting.length === 0) return null;
    const actor = waiting[Math.floor(random() * waiting.length)];
    return chooseHeuristicAction(engine, state, actor, random, memory);
  };
}
