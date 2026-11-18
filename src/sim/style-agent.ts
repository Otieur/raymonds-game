/**
 * The rule-based agent with its settings taken from a `Style`. With `BASELINE` it makes exactly the
 * decisions `chooseHeuristicAction` makes, drawing the same random numbers in the same order; the
 * other fields add behaviour that today's agent does not have.
 */
import { buildContext } from '../context.ts';
import type { Context } from '../context.ts';
import type { Engine } from '../engine/engine.ts';
import { buildingStep, ownsGroup } from '../engine/queries.ts';
import { HOTEL_LEVEL } from '../types.ts';
import type {
  Action,
  GameEvent,
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
import { LANDING_RATES } from './landing-rates.ts';
import { duesInReach, viewOf } from './measures.ts';
import { ofType } from './random-agent.ts';
import { applyChanges } from './style.ts';
import type { SetId, Style } from './style.ts';
import { priceOf, v1 } from './valuation.ts';

type Random = () => number;

/** What the agent remembers between calls. Pass the same object for a whole game. */
export interface StyleMemory {
  /** The turn on which each player last proposed a trade. */
  proposedOn: Record<PlayerId, number>;
  /** The table's latest answers to offers, newest last. */
  answers: boolean[];
  /** Offer key to the turn it was last refused. */
  refused: Record<string, number>;
  /** The turn on which each player last mortgaged in order to buy or build. */
  mortgagedOn: Record<PlayerId, number>;
  /** For playbooks: the own turn on which each rule last held, by player. */
  ruleHeld: Record<PlayerId, Record<string, number>>;
  /** Own turns played, by player. */
  ownTurns: Record<PlayerId, number>;
}

export function createStyleMemory(): StyleMemory {
  return { proposedOn: {}, answers: [], refused: {}, mortgagedOn: {}, ruleHeld: {}, ownTurns: {} };
}

const offerKey = (offer: TradeOffer) =>
  `${offer.from}>${offer.to}:${[...offer.receive.properties].sort().join(',')}/${[...offer.give.properties].sort().join(',')}`;

/** Feeds the events of an applied action to the memory. Callers do this after every apply. */
export function observe(memory: StyleMemory, events: GameEvent[], state?: GameState): void {
  for (const event of events) {
    if (event.type === 'TRADE_ACCEPTED' || event.type === 'TRADE_REJECTED') {
      memory.answers.push(event.type === 'TRADE_ACCEPTED');
      if (memory.answers.length > 100) memory.answers.shift();
      if (event.type === 'TRADE_REJECTED' && state) memory.refused[offerKey(event.offer)] = state.turn.number;
    }
    if (event.type === 'TURN_STARTED') memory.ownTurns[event.player] = (memory.ownTurns[event.player] ?? 0) + 1;
  }
}

/** The share accepted of the table's latest `window` offers, or null until there are that many. */
export function moodOf(memory: StyleMemory, window: number): number | null {
  if (window <= 0 || memory.answers.length < window) return null;
  const recent = memory.answers.slice(-window);
  return recent.filter(Boolean).length / window;
}

const contexts = new WeakMap<Engine, Context>();
export function contextOf(engine: Engine): Context {
  let ctx = contexts.get(engine);
  if (!ctx) {
    ctx = buildContext(engine.board, engine.rules);
    contexts.set(engine, ctx);
  }
  return ctx;
}

interface Lens {
  engine: Engine;
  ctx: Context;
  state: GameState;
  me: PlayerState;
  style: Style;
  memory: StyleMemory;
  properties: PropertySquare[];
  byId: Map<PropertyId, PropertySquare>;
  groups: Map<GroupId, StreetSquare[]>;
  /** Each seat's chance by V1, computed when first needed. */
  chances?: number[];
}

function lensOf(engine: Engine, state: GameState, actor: PlayerId, style: Style, memory: StyleMemory): Lens | null {
  const me = state.players.find((p) => p.id === actor);
  if (!me || me.bankrupt) return null;
  const properties: PropertySquare[] = [];
  const groups = new Map<GroupId, StreetSquare[]>();
  for (const sq of engine.board.squares) {
    if (sq.kind !== 'street' && sq.kind !== 'transit' && sq.kind !== 'utility') continue;
    properties.push(sq);
    if (sq.kind === 'street') groups.set(sq.group, [...(groups.get(sq.group) ?? []), sq]);
  }
  return { engine, ctx: contextOf(engine), state, me, style, memory, properties, byId: new Map(properties.map((sq) => [sq.id, sq])), groups };
}

const setOf = (sq: PropertySquare): SetId => (sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works');
const ownerOf = (L: Lens, id: PropertyId) => L.state.properties[id].owner;
const rivals = (L: Lens) => L.state.players.filter((p) => !p.bankrupt && p.id !== L.me.id);

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

function chancesOf(L: Lens): number[] {
  L.chances ??= v1(L.state.players.length).chances(L.ctx, L.state);
  return L.chances;
}

/** What a property is worth to a player. */
function worth(L: Lens, player: PlayerId, sq: PropertySquare): number {
  const { style } = L;
  const lien = L.state.properties[sq.id].mortgaged ? unmortgageCost(L, sq) : 0;
  if (style.valuation === 'v1' && player === L.me.id && ownerOf(L, sq.id) !== player) {
    const changed = structuredClone(L.state);
    changed.properties[sq.id].owner = player;
    return Math.round(priceOf(v1(L.state.players.length), L.ctx, L.state, changed, player, 5 * sq.price)) - lien;
  }
  let factor = 1;
  if (sq.kind === 'street') {
    const held = groupMates(L, sq).filter((mate) => ownerOf(L, mate.id) === player).length;
    if (holdsRestOfGroup(L, player, sq)) factor = style.completeFactor;
    else if (held > 0) factor = style.partFactor;
  } else {
    const kin = L.properties.filter((p) => p.kind === sq.kind && p.id !== sq.id && ownerOf(L, p.id) === player);
    factor = 1 + (sq.kind === 'transit' ? style.passStep : style.worksStep) * kin.length;
  }
  const prefer = style.prefer[setOf(sq)] ?? 1;
  return Math.round(sq.price * factor * prefer) - lien;
}

/** Cash to keep in hand. */
function reserve(L: Lens): number {
  const threatened = L.properties.some((sq) => L.state.properties[sq.id].level > 0 && ownerOf(L, sq.id) !== L.me.id);
  let keep = threatened ? L.style.reserveBuilt : L.style.reserve;
  if (L.style.reserveThreat > 0) keep += Math.round(L.style.reserveThreat * duesInReach(viewOf(L.ctx, L.state), L.me).largest);
  return keep;
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

/** The lowest building step on any street of a group. */
function groupStep(L: Lens, group: GroupId): number {
  return Math.min(...(L.groups.get(group) ?? []).map((sq) => buildingStep(L.ctx, L.state.properties[sq.id].level)));
}

/** The seat's complete groups that can take buildings (none mortgaged). */
function buildableGroups(L: Lens): GroupId[] {
  return [...L.groups.keys()].filter(
    (group) => ownsGroup(L.ctx, L.state, L.me.id, group) && (L.groups.get(group) ?? []).every((sq) => !L.state.properties[sq.id].mortgaged),
  );
}

/** Its idle property: not in a complete group, not mortgaged, least valuable first. */
function idleProperty(L: Lens, legal: LegalAction[]): Extract<LegalAction, { type: 'MORTGAGE' }>[] {
  return ofType(legal, 'MORTGAGE')
    .filter((action) => {
      const sq = L.byId.get(action.property) as PropertySquare;
      return !(sq.kind === 'street' && ownsGroup(L.ctx, L.state, L.me.id, sq.group));
    })
    .sort((a, b) => worth(L, L.me.id, L.byId.get(a.property) as PropertySquare) - worth(L, L.me.id, L.byId.get(b.property) as PropertySquare));
}

function rivalHasGroupAt(L: Lens, steps: number): boolean {
  return [...L.groups.keys()].some((group) => rivals(L).some((p) => ownsGroup(L.ctx, L.state, p.id, group)) && groupStep(L, group) >= steps);
}

// ---------- Offers ----------

function leaderId(L: Lens): PlayerId | null {
  if (L.state.players.length < 3) return null;
  const chances = chancesOf(L);
  let best = -1;
  let id: PlayerId | null = null;
  L.state.players.forEach((p, i) => {
    if (!p.bankrupt && chances[i] > best) {
      best = chances[i];
      id = p.id;
    }
  });
  return id;
}

/** Sends an offer if the engine accepts it. New kinds of offer are not repeated soon after a refusal. */
function send(L: Lens, action: Action, avoidRefused = true): Action | null {
  if (L.engine.validate(L.state, action) !== null) return null;
  if (avoidRefused && action.type === 'PROPOSE_TRADE') {
    const key = offerKey({ from: action.player, to: action.to, give: action.give, receive: action.receive });
    const refused = L.memory.refused[key];
    if (refused !== undefined && L.state.turn.number - refused <= L.state.players.length) return null;
  }
  L.memory.proposedOn[L.me.id] = L.state.turn.number;
  return action;
}

/** Cash a partner keeps after paying, at most `buildings` buildings' worth on the group it completes. */
function squeezedPrice(L: Lens, partner: PlayerState, sq: StreetSquare, floor: number): number {
  const leave = (L.style.leaveCash ?? 0) * sq.buildingCost;
  return Math.max(floor, partner.cash - leave);
}

function proposeTrade(L: Lens, legal: LegalAction[], random: Random): Action | null {
  const { state, me, style } = L;
  const open = ofType(legal, 'PROPOSE_TRADE')[0];
  if (!open) return null;
  const leader = style.shunLeader ? leaderId(L) : null;
  const partners = open.partners.filter((id) => id !== leader || leader === me.id);

  // Giving up: sell to the weakest rival at list price.
  if (style.giveUpBelow !== null && state.players.length >= 3) {
    const chances = chancesOf(L);
    const mine = chances[state.players.indexOf(me)];
    if (mine < style.giveUpBelow) {
      const weakest = state.players
        .map((p, i) => ({ p, c: chances[i] }))
        .filter(({ p }) => !p.bankrupt && p.id !== me.id && partners.includes(p.id))
        .sort((a, b) => a.c - b.c)[0];
      const offered = L.properties.find(
        (sq) => ownerOf(L, sq.id) === me.id && !(sq.kind === 'street' && L.state.properties[sq.id].level > 0) && !style.neverSell.includes(setOf(sq)),
      );
      if (weakest && offered && weakest.p.cash >= offered.price) {
        const action = send(L, {
          type: 'PROPOSE_TRADE',
          player: me.id,
          to: weakest.p.id,
          give: { cash: 0, properties: [offered.id], jailCards: 0 },
          receive: { cash: offered.price, properties: [], jailCards: 0 },
        });
        if (action) return action;
      }
    }
  }

  // Distress offers: cash under list price to a rival short of cash, for a property the seat wants.
  if (style.distressOffers) {
    const view = viewOf(L.ctx, state);
    for (const rival of rivals(L)) {
      if (!partners.includes(rival.id)) continue;
      const short = state.pending.some((p) => p.kind === 'debt' && p.debtor === rival.id) || rival.cash < duesInReach(view, rival).largest;
      if (!short) continue;
      const target = L.properties.find(
        (sq) =>
          ownerOf(L, sq.id) === rival.id &&
          !state.properties[sq.id].mortgaged &&
          !(sq.kind === 'street' && state.properties[sq.id].level > 0) &&
          worth(L, me.id, sq) > sq.price,
      );
      if (!target) continue;
      const cash = Math.round(target.price * (0.6 + random() * 0.4));
      if (cash > me.cash - reserve(L)) continue;
      const action = send(L, {
        type: 'PROPOSE_TRADE',
        player: me.id,
        to: rival.id,
        give: { cash, properties: [], jailCards: 0 },
        receive: { cash: 0, properties: [target.id], jailCards: 0 },
      });
      if (action) return action;
    }
  }

  const spread = Math.round((style.offerHigh - style.offerLow) * 1e9) / 1e9;
  for (const streets of L.groups.values()) {
    const missing = streets.filter((sq) => ownerOf(L, sq.id) !== me.id);
    if (missing.length !== 1 || streets.length < 2) continue;
    const target = missing[0];
    const holder = ownerOf(L, target.id);
    if (holder === null || !partners.includes(holder) || state.properties[target.id].mortgaged) continue;

    if (style.swaps) {
      // A street of a group the holder lacks one of, which this seat holds, in exchange.
      const swap = L.properties.find((sq) => {
        if (sq.kind !== 'street' || ownerOf(L, sq.id) !== me.id || state.properties[sq.id].level > 0) return false;
        if (style.neverSell.includes(setOf(sq))) return false;
        return holdsRestOfGroup(L, holder, sq) && !groupMates(L, sq).some((mate) => state.properties[mate.id].level > 0);
      });
      if (swap) {
        const difference = worth(L, me.id, target) - worth(L, me.id, swap);
        const cash = Math.max(0, Math.min(me.cash - reserve(L), Math.round(difference)));
        const action = send(L, {
          type: 'PROPOSE_TRADE',
          player: me.id,
          to: holder,
          give: { cash, properties: [swap.id], jailCards: 0 },
          receive: { cash: 0, properties: [target.id], jailCards: 0 },
        });
        if (action) return action;
      }
    }

    const cash = Math.min(me.cash - reserve(L), Math.round(target.price * (style.offerLow + random() * spread)));
    if (cash < target.price * style.offerFloor) continue;
    // Today's agent repeats a refused cash offer on its next turn, so this one may too.
    const action = send(
      L,
      {
        type: 'PROPOSE_TRADE',
        player: me.id,
        to: holder,
        give: { cash, properties: [], jailCards: 0 },
        receive: { cash: 0, properties: [target.id], jailCards: 0 },
      },
      false,
    );
    if (action) return action;
  }

  // Selling idle property to the rival who holds most of its set.
  if (style.sellOffers) {
    for (const sq of L.properties) {
      if (ownerOf(L, sq.id) !== me.id || state.properties[sq.id].mortgaged) continue;
      if (sq.kind === 'street' && (ownsGroup(L.ctx, state, me.id, sq.group) || state.properties[sq.id].level > 0)) continue;
      if (style.neverSell.includes(setOf(sq))) continue;
      const buyer = rivals(L)
        .filter((p) => partners.includes(p.id))
        .map((p) => ({ p, held: L.properties.filter((other) => setOf(other) === setOf(sq) && ownerOf(L, other.id) === p.id).length }))
        .filter(({ held }) => held > 0)
        .sort((a, b) => b.held - a.held)[0];
      if (!buyer) continue;
      let price = Math.min(buyer.p.cash, Math.round(worth(L, buyer.p.id, sq) * style.offerHigh));
      if (style.leaveCash !== null && sq.kind === 'street' && holdsRestOfGroup(L, buyer.p.id, sq)) {
        price = Math.min(buyer.p.cash, squeezedPrice(L, buyer.p, sq, price));
      }
      if (price < sq.price) continue;
      const action = send(L, {
        type: 'PROPOSE_TRADE',
        player: me.id,
        to: buyer.p.id,
        give: { cash: 0, properties: [sq.id], jailCards: 0 },
        receive: { cash: price, properties: [], jailCards: 0 },
      });
      if (action) return action;
    }
  }
  return null;
}

// ---------- Decisions ----------

function freeTurn(L: Lens, legal: LegalAction[], random: Random): Action | null {
  const { state, me, style, memory } = L;
  const { salary, bail } = L.engine.board.economy;
  const keep = reserve(L);

  if (me.inJail && state.turn.phase === 'preRoll') {
    const unowned = L.properties.filter((sq) => ownerOf(L, sq.id) === null).length;
    const stayForBuilt = style.jailStayBuilt && rivalHasGroupAt(L, 3);
    if (unowned > L.properties.length * (1 - style.jailStay) && !stayForBuilt) {
      const card = ofType(legal, 'USE_JAIL_CARD')[0];
      if (card) return card;
      const pay = ofType(legal, 'PAY_BAIL')[0];
      if (pay && me.cash - bail >= keep) return pay;
    }
  }

  const groups = buildableGroups(L);
  const belowTarget = groups.filter((group) => groupStep(L, group) < style.buildTarget);
  const holdRedemptions = (style.mortgageToBuild && belowTarget.length > 0) || memory.mortgagedOn[me.id] === state.turn.number;

  if (!holdRedemptions) {
    const lifts = ofType(legal, 'UNMORTGAGE')
      .map((action) => ({ action, sq: L.byId.get(action.property) as PropertySquare }))
      .sort((a, b) => worth(L, me.id, b.sq) - worth(L, me.id, a.sq));
    for (const { action, sq } of lifts) {
      if (me.cash - unmortgageCost(L, sq) >= keep + salary * style.redeemSpare) return action;
    }
  }

  const rate = (sq: StreetSquare) => (style.buildOrder === 'landing' ? LANDING_RATES[L.ctx.squareIndex.get(sq.id) ?? 0] : 1);
  let builds = ofType(legal, 'BUILD').map((action) => ({ action, sq: streetOf(L, action.property) }));
  if (style.buildTarget < 5 || style.buildBeyond === null || style.buildSpread === 'one' || style.buildNear !== null || style.holdHouses) {
    const focus =
      style.buildSpread === 'one' && belowTarget.length > 0
        ? [...belowTarget].sort((a, b) => groupStep(L, b) - groupStep(L, a) || (a < b ? -1 : 1))[0]
        : null;
    builds = builds.filter(({ sq }) => {
      const step = groupStep(L, sq.group);
      if (step >= style.buildTarget && belowTarget.some((group) => group !== sq.group)) return false;
      if (focus !== null && sq.group !== focus) return false;
      const level = state.properties[sq.id].level;
      if (style.holdHouses && level === L.engine.rules.housesBeforeHotel && state.bank.houses < 8) return false;
      if (style.buildNear !== null) {
        const near = rivals(L).some((p) =>
          (L.groups.get(sq.group) ?? []).some((mate) => {
            const ahead = ((L.ctx.squareIndex.get(mate.id) ?? 0) - p.position + 40) % 40;
            return ahead >= 2 && ahead <= (style.buildNear as number);
          }),
        );
        if (!near) return false;
      }
      return true;
    });
  }
  builds.sort((a, b) => rentGain(L, b.sq) * rate(b.sq) - rentGain(L, a.sq) * rate(a.sq));
  for (const { action, sq } of builds) {
    const beyond = buildingStep(L.ctx, state.properties[sq.id].level) + 1 > style.buildTarget;
    if (beyond && style.buildBeyond === null) continue;
    const extra = beyond ? (style.buildBeyond as number) : 0;
    if (me.cash - sq.buildingCost >= keep + extra) return action;
  }

  // Mortgaging to build: when a group below target needs a building the cash will not cover.
  if (style.mortgageToBuild && belowTarget.length > 0) {
    const cheapest = Math.min(...belowTarget.flatMap((group) => (L.groups.get(group) ?? []).map((sq) => sq.buildingCost)));
    const idle = idleProperty(L, legal);
    const raisable = idle.reduce((sum, action) => sum + (L.byId.get(action.property) as PropertySquare).mortgageValue, 0);
    if (me.cash - keep < cheapest && me.cash + raisable - keep >= cheapest && idle.length > 0) {
      memory.mortgagedOn[me.id] = state.turn.number;
      return idle[0];
    }
  }

  if (state.turn.phase === 'postRoll' && memory.proposedOn[me.id] !== state.turn.number) {
    const proposes = style.proposeRate >= 1 || (style.proposeRate > 0 && random() < style.proposeRate);
    if (proposes) {
      const offer = proposeTrade(L, legal, random);
      if (offer) return offer;
    }
  }
  return ofType(legal, 'ROLL')[0] ?? ofType(legal, 'END_TURN')[0] ?? null;
}

function decideBuy(L: Lens, legal: LegalAction[], property: PropertyId): Action {
  const { style, me } = L;
  const decline: Action = { type: 'DECLINE', player: me.id };
  const buy = ofType(legal, 'BUY')[0];
  const sq = L.byId.get(property) as PropertySquare;
  const completes = holdsRestOfGroup(L, me.id, sq);
  const wanted = completes || blocksRival(L, sq);
  const multiplier = style.buy[setOf(sq)];
  if (multiplier < 1) {
    if (multiplier <= 0) return decline;
    const value = worth(L, me.id, sq) * multiplier;
    if (value < sq.price) return decline;
  }
  if (style.declinePoor !== null && !completes) {
    const richest = Math.max(0, ...rivals(L).map((p) => p.cash));
    if (richest < style.declinePoor * sq.price) return decline;
  }
  const keep = reserve(L) * style.buyKeep;
  if (buy && (wanted || me.cash - sq.price >= keep)) return buy;
  if (style.mortgageToBuy && worth(L, me.id, sq) >= sq.price) {
    const idle = idleProperty(L, legal).filter((action) => action.property !== property);
    const raisable = idle.reduce((sum, action) => sum + (L.byId.get(action.property) as PropertySquare).mortgageValue, 0);
    const need = wanted ? sq.price : sq.price + keep;
    if (idle.length > 0 && me.cash + raisable >= need) {
      L.memory.mortgagedOn[me.id] = L.state.turn.number;
      return idle[0];
    }
  }
  return decline;
}

function bidOnProperty(L: Lens, legal: LegalAction[], property: PropertyId, random: Random): Action {
  const { style, me, state } = L;
  const pass: Action = { type: 'PASS', player: me.id };
  const bid = ofType(legal, 'BID')[0];
  if (!bid) return pass;
  const sq = L.byId.get(property) as PropertySquare;
  const set = setOf(sq);
  const appetite = blocksRival(L, sq) ? style.bidCap[set] * style.blockBonus : style.bidCap[set];
  let limit = Math.min(bid.max - Math.round(reserve(L) * style.bidKeep), Math.round(worth(L, me.id, sq) * appetite));
  const ceiling = style.bidCeiling[set];
  if (ceiling !== undefined) limit = Math.min(limit, ceiling);
  if (bid.min > limit) {
    if (style.driveUp > 0) {
      const top = state.pending[state.pending.length - 1];
      const bidders = top?.kind === 'auction' ? top.bidders : [];
      const keenest = rivals(L)
        .filter((p) => bidders.includes(p.id))
        .map((p) => ({ p, held: L.properties.filter((other) => setOf(other) === set && ownerOf(L, other.id) === p.id).length }))
        .sort((a, b) => b.held - a.held)[0];
      if (keenest && keenest.held > 0) {
        const theirs = Math.min(keenest.p.cash, worth(L, keenest.p.id, sq) * 0.85);
        const room = bid.max - Math.round(reserve(L) * style.bidKeep);
        if (bid.min < style.driveUp * theirs && bid.min <= room) return { type: 'BID', player: me.id, amount: bid.min };
      }
    }
    return pass;
  }
  return { type: 'BID', player: me.id, amount: Math.min(limit, bid.min + Math.floor(random() * style.bidStep)) };
}

function bidOnBuilding(L: Lens, legal: LegalAction[], random: Random): Action {
  const pass: Action = { type: 'PASS', player: L.me.id };
  const bid = ofType(legal, 'BID')[0];
  if (!bid?.targets || bid.targets.length === 0) return pass;
  const target = [...bid.targets].sort((a, b) => rentGain(L, streetOf(L, b.property)) - rentGain(L, streetOf(L, a.property)))[0];
  const cost = streetOf(L, target.property).buildingCost;
  const limit = Math.min(bid.max - Math.round(reserve(L) / 2), Math.round(cost * L.style.buildingBid));
  if (target.min > limit) return pass;
  const amount = Math.min(limit, target.min + Math.floor(random() * 8));
  return { type: 'BID', player: L.me.id, amount, property: target.property };
}

function raiseFunds(L: Lens, legal: LegalAction[]): Action | null {
  const giveUp = ofType(legal, 'DECLARE_BANKRUPTCY')[0];
  if (giveUp) return giveUp;
  const mortgages = ofType(legal, 'MORTGAGE').sort(
    (a, b) => worth(L, L.me.id, L.byId.get(a.property) as PropertySquare) - worth(L, L.me.id, L.byId.get(b.property) as PropertySquare),
  );
  if (mortgages.length > 0) return mortgages[0];
  const sales = ofType(legal, 'SELL_BUILDING').sort((a, b) => streetOf(L, a.property).rents[HOTEL_LEVEL] - streetOf(L, b.property).rents[HOTEL_LEVEL]);
  return sales[0] ?? ofType(legal, 'SELL_BUILDINGS')[0] ?? null;
}

function answerOffer(L: Lens, offer: TradeOffer): Action {
  const { style } = L;
  const me = L.me.id;
  const reject: Action = { type: 'REJECT_TRADE', player: me };
  if (offer.receive.properties.some((id) => style.neverSell.includes(setOf(L.byId.get(id) as PropertySquare)))) return reject;
  if (style.shunLeader && leaderId(L) === offer.from) return reject;
  const cardValue = Math.round(L.engine.board.economy.bail * 0.8);
  let gain = offer.give.cash + offer.give.jailCards * cardValue;
  for (const id of offer.give.properties) gain += worth(L, me, L.byId.get(id) as PropertySquare);
  let loss = offer.receive.cash + offer.receive.jailCards * cardValue;
  for (const id of offer.receive.properties) {
    const sq = L.byId.get(id) as PropertySquare;
    loss += worth(L, me, sq);
    if (holdsRestOfGroup(L, offer.from, sq)) loss += Math.round(sq.price * style.completionPenalty);
  }
  return { type: gain >= loss * style.acceptMargin ? 'ACCEPT_TRADE' : 'REJECT_TRADE', player: me };
}

/** Decides for `actor` with a style already resolved for this moment. */
export function decide(engine: Engine, state: GameState, actor: PlayerId, random: Random, style: Style, memory: StyleMemory): Action | null {
  if (!engine.awaiting(state).includes(actor)) return null;
  const L = lensOf(engine, state, actor, style, memory);
  if (!L) return null;
  const legal = engine.legalActions(state, actor);
  const top = state.pending[state.pending.length - 1];
  if (!top) return freeTurn(L, legal, random);

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
      const lift = L.me.cash - sq.mortgageValue >= reserve(L) + L.engine.board.economy.salary * style.redeemSpare;
      const canLift = legal.some((action) => action.type === 'SETTLE_TRANSFER' && action.lift);
      return { type: 'SETTLE_TRANSFER', player: actor, lift: lift && canLift };
    }
    case 'jailExit':
      return { type: 'USE_JAIL_CARD', player: actor };
    case 'trade':
      return answerOffer(L, top.offer);
  }
}

/** The offer the style would make for `actor` now, if any: its proposing step alone, once a turn. */
export function proposeFor(engine: Engine, state: GameState, actor: PlayerId, random: Random, style: Style, memory: StyleMemory): Action | null {
  if (state.pending.length > 0 || state.turn.player !== actor || memory.proposedOn[actor] === state.turn.number) return null;
  const L = lensOf(engine, state, actor, style, memory);
  if (!L) return null;
  return proposeTrade(L, engine.legalActions(state, actor), random);
}

/** Whether the seat has a complete group standing at its build target. */
export function hasGroupAtTarget(engine: Engine, state: GameState, actor: PlayerId, target: number): boolean {
  const ctx = contextOf(engine);
  return [...ctx.groups.keys()].some(
    (group) =>
      ownsGroup(ctx, state, actor, group) &&
      Math.min(...(ctx.groups.get(group) ?? []).map((sq) => buildingStep(ctx, state.properties[sq.id].level))) >= target,
  );
}

/** The style in force: the style, then its entry for the table size, its later stage, and its block mode. */
export function resolveStyle(engine: Engine, state: GameState, actor: PlayerId, style: Style, memory: StyleMemory): Style {
  let out = style;
  const size = state.players.length as 2 | 3 | 4;
  const bySize = style.bySize[size];
  if (bySize) out = applyChanges(out, bySize);
  if (out.afterFirstGroup && hasGroupAtTarget(engine, state, actor, out.buildTarget)) out = applyChanges(out, out.afterFirstGroup);
  if (out.blockMode) {
    const mood = moodOf(memory, out.moodWindow);
    if (mood !== null && mood < out.moodFloor) out = applyChanges(out, out.blockMode);
  }
  return out;
}

/** Chooses for `actor` by a style. Returns null when the game is not waiting on `actor`. */
export function chooseStyledAction(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  random: Random,
  style: Style,
  memory: StyleMemory,
): Action | null {
  return decide(engine, state, actor, random, resolveStyle(engine, state, actor, style, memory), memory);
}

