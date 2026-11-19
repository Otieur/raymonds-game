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
import { dealSheet, denialWorth, distressOf, isFailing, pointsPerCoin, threatOf, worthInCoins } from './deal.ts';
import type { Distress, Threat } from './deal.ts';
import { LANDING_RATES } from './landing-rates.ts';
import { duesInReach, viewOf } from './measures.ts';
import { ofType } from './random-agent.ts';
import { acceptRate, createRelations, goodwillOf, noteRelations, recordAsk } from './relations.ts';
import type { Relations } from './relations.ts';
import { applyChanges } from './style.ts';
import type { SetId, Style } from './style.ts';
import { priceOf, roundOf, v1 } from './valuation.ts';

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
  /** What has passed between each pair of seats. */
  relations: Relations;
  /** The context of the game, set at the first decision; the relations read the valuation through it. */
  ctx?: Context;
  /** The round in which each player last sent an invitation. */
  courted: Record<PlayerId, number>;
  /** The debt at which each player last tried to sell its way out. */
  debtSold: Record<PlayerId, string>;
}

export function createStyleMemory(): StyleMemory {
  return { proposedOn: {}, answers: [], refused: {}, mortgagedOn: {}, ruleHeld: {}, ownTurns: {}, relations: createRelations(), courted: {}, debtSold: {} };
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
  if (state) {
    const reads = memory.relations.tracking && memory.ctx !== undefined;
    noteRelations(memory.relations, state, events, memory.ctx, reads ? v1(state.players.length) : undefined);
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
  /** Each rival as a danger, computed when first needed. */
  threats?: Map<PlayerId, Threat>;
  /** Each rival that is failing, with how, computed when first needed. */
  failing?: Map<PlayerId, Distress>;
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

// ---------- Playing the table (docs/plan/m03b-table-politics.md) ----------

/** Whether a style reads what has passed between seats, so that the record must be kept in full. */
export function readsTable(style: Style): boolean {
  return (
    style.offerBy === 'value' || style.answerBy === 'sheet' || style.earlyOffers || style.denyOffers || style.estateOffers !== 'off' ||
    style.debtOffers || style.courtAllies || style.reciprocity > 0 || style.huntFailing
  );
}

const seatIndex = (L: Lens, id: PlayerId) => L.state.players.findIndex((p) => p.id === id);

function threatsOf(L: Lens): Map<PlayerId, Threat> {
  L.threats ??= new Map(rivals(L).map((p) => [p.id, threatOf(L.ctx, L.state, p.id, v1(L.state.players.length), chancesOf(L))]));
  return L.threats;
}

/** The rival with the highest potential chance: the one a seat has most to fear. */
function strongestRival(L: Lens): PlayerId | null {
  let best: PlayerId | null = null;
  let top = -1;
  for (const [id, threat] of threatsOf(L)) {
    if (threat.potential > top) {
      top = threat.potential;
      best = id;
    }
  }
  return best;
}

/**
 * The score of a deal for this seat, in points of chance by the deal sheet: its own change, less
 * the strongest rival's gain weighted by `againstLeader`, plus the gain of a partner ranked below
 * both weighted by `forWeak`, plus what the partner's goodwill adds, bounded at five points.
 */
function dealScore(L: Lens, offer: TradeOffer): number {
  const { style } = L;
  const chances = chancesOf(L);
  const sheet = dealSheet(L.ctx, L.state, offer, v1(L.state.players.length), chances);
  const me = seatIndex(L, L.me.id);
  const partnerId = offer.from === L.me.id ? offer.to : offer.from;
  const partner = seatIndex(L, partnerId);
  let score = sheet.delta[me] * 100;
  if (style.againstLeader > 0 || style.forWeak > 0) {
    const top = strongestRival(L);
    if (top !== null) {
      const topSeat = seatIndex(L, top);
      score -= style.againstLeader * sheet.delta[topSeat] * 100;
      if (partnerId !== top && chances[partner] < chances[me] && chances[partner] < chances[topSeat]) score += style.forWeak * sheet.delta[partner] * 100;
    }
  }
  if (style.reciprocity > 0) {
    const goodwill = goodwillOf(L.memory.relations, L.me.id, partnerId, Math.floor(roundOf(L.state)), style.allyTurns);
    score += Math.max(-5, Math.min(5, style.reciprocity * goodwill));
  }
  return score;
}

/**
 * The seat's own estimate of getting the streets of a group it would still lack after an ask: for
 * each, one over the seats still in when the bank holds it, the holder's rate of accepting offers
 * when a rival does, and nothing when that rival has refused the seat twice for a street of the group.
 */
function restChance(L: Lens, streets: StreetSquare[], asked: PropertyId): number {
  const mine = L.memory.relations.asks[L.me.id] ?? {};
  let chance = 1;
  for (const sq of streets) {
    const owner = ownerOf(L, sq.id);
    if (sq.id === asked || owner === L.me.id) continue;
    if (owner === null) chance *= 1 / (rivals(L).length + 1);
    else {
      const refusedTwice = streets.some((mate) => mine[mate.id]?.partner === owner && mine[mate.id].refused >= 2);
      chance *= refusedTwice ? 0 : acceptRate(L.memory.relations, owner);
    }
  }
  return chance;
}

/**
 * The share of a property's worth to offer its holder now, or null when it is not yet time to ask
 * again: `openShare` at first; `raiseStep` more for each refusal, to `maxShare`, once `probeGap` own
 * turns have passed; and the last share again, at once, when the holder has become short of cash or
 * its chance has fallen by `probeDrop` since the last ask.
 */
function shareToOffer(L: Lens, property: PropertyId, holder: PlayerState): number | null {
  const { style, memory } = L;
  const ask = memory.relations.asks[L.me.id]?.[property];
  if (!ask || ask.partner !== holder.id) return style.openShare;
  if (ask.refused === 0) return ask.share;
  const turns = (memory.ownTurns[L.me.id] ?? 0) - ask.turn;
  if (turns >= style.probeGap) return Math.min(style.maxShare, style.openShare + style.raiseStep * ask.refused);
  const short = holder.cash < duesInReach(viewOf(L.ctx, L.state), holder).largest;
  const fallen = ask.chance - chancesOf(L)[seatIndex(L, holder.id)] >= style.probeDrop;
  if (turns >= 1 && ((short && !ask.short) || fallen)) return ask.share;
  return null;
}

/** A seat's place by its chance of winning: 1 is the best. */
function rankOf(L: Lens, id: PlayerId): number {
  const chances = chancesOf(L);
  const mine = chances[seatIndex(L, id)];
  return 1 + L.state.players.filter((p, i) => !p.bankrupt && chances[i] > mine).length;
}

/** The rivals that are failing by the style's `failBelow`. */
function failingRivals(L: Lens): Map<PlayerId, Distress> {
  if (!L.failing) {
    L.failing = new Map();
    const valuation = v1(L.state.players.length);
    for (const p of rivals(L)) {
      const distress = distressOf(L.ctx, L.state, p.id, valuation, L.memory.relations.chances[p.id] ?? [], chancesOf(L));
      if (isFailing(distress, L.style.failBelow)) L.failing.set(p.id, distress);
    }
  }
  return L.failing;
}

/** Whether two seats are allied: each has shown the other goodwill of `allyAt`, and the partner is not the seat's strongest rival. */
function alliedWith(L: Lens, partner: PlayerId): boolean {
  const { style, memory } = L;
  const round = Math.floor(roundOf(L.state));
  if (goodwillOf(memory.relations, L.me.id, partner, round, style.allyTurns) < style.allyAt) return false;
  if (goodwillOf(memory.relations, partner, L.me.id, round, style.allyTurns) < style.allyAt) return false;
  return strongestRival(L) !== partner;
}

const asCash = (L: Lens, to: PlayerId, cash: number, property: PropertyId): Extract<Action, { type: 'PROPOSE_TRADE' }> => ({
  type: 'PROPOSE_TRADE',
  player: L.me.id,
  to,
  give: { cash, properties: [], jailCards: 0 },
  receive: { cash: 0, properties: [property], jailCards: 0 },
});

/** What stopping the strongest rival from getting a property is worth to this seat: in points, and in its own coins. */
function denial(L: Lens, rival: PlayerId, property: PropertyId, sale: number): { points: number; coins: number } {
  const valuation = v1(L.state.players.length);
  const points = denialWorth(L.ctx, L.state, L.me.id, rival, property, valuation, sale) * 100;
  return { points, coins: points / 100 / pointsPerCoin(L.ctx, L.state, L.me.id, valuation, chancesOf(L)) };
}

/**
 * Asks priced by value. The candidates: a street that completes a group; with `earlyOffers`, any
 * street of a group the seat holds part of; with `denyOffers`, the property the strongest rival
 * wants, held by a third seat; with `estateOffers`, a failing rival's property. The price is a share
 * of what the property is worth to the seat in that deal, and the ask with the best score is sent.
 */
function proposeByValue(L: Lens, partners: PlayerId[]): Action | null {
  const { state, me, style, memory } = L;
  const valuation = v1(state.players.length);
  const spare = me.cash - reserve(L);
  if (spare <= 0) return null;
  const view = viewOf(L.ctx, state);
  const isShort = (p: PlayerState) => p.cash < duesInReach(view, p).largest;
  type Candidate = { action: Action; score: number; target: PropertySquare; holder: PlayerState; share: number; cash: number };
  let best: Candidate | null = null;
  const tradable = (sq: PropertySquare) =>
    !state.properties[sq.id].mortgaged && !(sq.kind === 'street' && (L.groups.get(sq.group) ?? []).some((mate) => state.properties[mate.id].level > 0));

  /** Weighs one ask: `worth` is the most the seat should pay, `bonus` what the deal sheet does not see, in points. */
  const consider = (target: PropertySquare, holder: PlayerState, worth: number, bonus: number, floor: number, cap: number, least = 0): void => {
    let share = shareToOffer(L, target.id, holder);
    if (share === null) return;
    if (alliedWith(L, holder.id)) share = Math.max(share, 0.5);
    share = Math.min(share, cap);
    const cash = Math.min(spare, Math.max(floor, least, Math.round(worth * share)));
    if (cash < 1 || cash < floor || cash < least) return;
    const action = asCash(L, holder.id, cash, target.id);
    if (L.engine.validate(state, action) !== null) return;
    const score = dealScore(L, { from: me.id, to: holder.id, give: action.give, receive: action.receive }) + bonus;
    if (best === null || score > best.score) best = { action, score, target, holder, share, cash };
  };
  const worthFrom = (target: PropertySquare, holder: PlayerId): number => {
    const changed = structuredClone(state);
    changed.properties[target.id].owner = me.id;
    // What it can pay this holder without losing by the deal sheet: less than the worth against the bank, since the cash strengthens the holder.
    return worthInCoins(L.ctx, state, changed, me.id, valuation, spare, holder);
  };

  // Toward its own groups: the last street, and with early asks any street of a group it holds part of.
  const early = style.earlyOffers && roundOf(state) < style.earlyBefore;
  for (const streets of L.groups.values()) {
    if (streets.length < 2 || streets.some((sq) => state.properties[sq.id].level > 0)) continue;
    const held = streets.filter((sq) => ownerOf(L, sq.id) === me.id).length;
    const missing = streets.length - held;
    if (held === 0 || missing === 0 || (missing > 1 && !early)) continue;
    // With completeBy 'list' the street that completes a group is asked for at today's price, below.
    if (missing === 1 && style.completeBy === 'list') continue;
    for (const target of streets) {
      const holderId = ownerOf(L, target.id);
      if (holderId === null || holderId === me.id || !partners.includes(holderId) || state.properties[target.id].mortgaged) continue;
      if (missing > 1 && restChance(L, streets, target.id) < style.earlyNeed) continue;
      consider(target, state.players[seatIndex(L, holderId)], worthFrom(target, holderId), 0, 0, style.maxShare);
    }
  }

  const top = style.denyOffers || style.estateOffers === 'both' ? strongestRival(L) : null;
  const wanted = top === null ? null : (threatsOf(L).get(top) as Threat).wants;

  // Denying: what the strongest rival wants, held by a third seat.
  if (style.denyOffers && top !== null && wanted !== null && rankOf(L, me.id) <= style.denyRank && (threatsOf(L).get(top) as Threat).potential >= style.denyThreat) {
    const target = L.byId.get(wanted) as PropertySquare;
    const holderId = ownerOf(L, wanted);
    if (holderId !== null && holderId !== me.id && holderId !== top && partners.includes(holderId) && tradable(target)) {
      const worth = denial(L, top, wanted, acceptRate(memory.relations, holderId));
      consider(target, state.players[seatIndex(L, holderId)], worth.coins, worth.points, 0, style.denyShare);
    }
  }

  // Estates: a failing rival's property, before the bankruptcy that would hand it to its creditor.
  if (style.estateOffers !== 'off') {
    for (const [rivalId, distress] of failingRivals(L)) {
      if (!partners.includes(rivalId)) continue;
      const rival = state.players[seatIndex(L, rivalId)];
      const rescues = style.rescue && top !== null && distress.creditor === top;
      const due = rescues ? Math.max(0, duesInReach(view, rival).largest - rival.cash) : 0;
      for (const target of L.properties) {
        if (ownerOf(L, target.id) !== rivalId || !tradable(target)) continue;
        const worth = worthFrom(target, rivalId);
        if (worth >= target.price) consider(target, rival, worth, 0, target.price, style.maxShare, due <= worth * style.maxShare ? due : 0);
      }
      if (style.estateOffers === 'both' && top !== null && top !== rivalId && wanted !== null && ownerOf(L, wanted) === rivalId) {
        const target = L.byId.get(wanted) as PropertySquare;
        if (tradable(target)) {
          // A failing seat's estate goes to its creditor; when that is the strongest rival the sale is as good as certain.
          const worth = denial(L, top, wanted, distress.creditor === top ? 1 : acceptRate(memory.relations, rivalId));
          consider(target, rival, worth.coins, worth.points, target.price, style.denyShare, due <= worth.coins * style.denyShare ? due : 0);
        }
      }
    }
  }

  const chosen = best as Candidate | null;
  if (chosen === null || chosen.score <= 0) return null;
  const sent = send(L, chosen.action, false);
  if (!sent) return null;
  recordAsk(memory.relations, me.id, chosen.target.id, {
    partner: chosen.holder.id,
    share: chosen.share,
    cash: chosen.cash,
    turn: memory.ownTurns[me.id] ?? 0,
    chance: chancesOf(L)[seatIndex(L, chosen.holder.id)],
    short: isShort(chosen.holder),
  });
  return sent;
}

/**
 * An invitation: an offer that favours the seat this one wants as a partner, by at least `edge`
 * points, without the proposer losing and without the strongest rival gaining. Tried in order: a
 * swap that advances a group for each; a street the partner needs, for its list price or the least
 * that does not cost the seat; a generous price for a street the partner has no use for.
 */
function invitationTo(L: Lens, partner: PlayerState, top: PlayerId, edge: number): Action | null {
  const { state, me } = L;
  const chances = chancesOf(L);
  const valuation = v1(state.players.length);
  const mine = seatIndex(L, me.id);
  const theirs = seatIndex(L, partner.id);
  const topSeat = seatIndex(L, top);
  const free = (sq: PropertySquare) =>
    !state.properties[sq.id].mortgaged && !(sq.kind === 'street' && (L.groups.get(sq.group) ?? []).some((mate) => state.properties[mate.id].level > 0));
  const heldIn = (id: PlayerId, sq: PropertySquare) => (sq.kind === 'street' ? groupMates(L, sq).filter((mate) => ownerOf(L, mate.id) === id).length : 0);
  const invites = (action: Extract<Action, { type: 'PROPOSE_TRADE' }>): boolean => {
    if (L.engine.validate(state, action) !== null) return false;
    const sheet = dealSheet(L.ctx, state, { from: me.id, to: partner.id, give: action.give, receive: action.receive }, valuation, chances);
    return sheet.delta[mine] >= 0 && sheet.delta[topSeat] <= 0 && (sheet.delta[theirs] - sheet.delta[mine]) * 100 >= edge;
  };
  const offer = (give: { cash: number; properties: PropertyId[] }, receive: { cash: number; properties: PropertyId[] }) =>
    ({ type: 'PROPOSE_TRADE', player: me.id, to: partner.id, give: { ...give, jailCards: 0 }, receive: { ...receive, jailCards: 0 } }) as Extract<Action, { type: 'PROPOSE_TRADE' }>;
  const spare = Math.max(0, me.cash - reserve(L));
  // Streets of mine that the partner has a use for, and streets of the partner's that I have a use for.
  const useful = L.properties.filter((sq) => sq.kind === 'street' && ownerOf(L, sq.id) === me.id && free(sq) && !ownsGroup(L.ctx, state, me.id, sq.group) && heldIn(partner.id, sq) > 0);
  const wanted = L.properties.filter((sq) => sq.kind === 'street' && ownerOf(L, sq.id) === partner.id && free(sq) && heldIn(me.id, sq) > 0);
  for (const mineToGive of useful) {
    for (const theirsToGive of wanted) {
      for (const cash of [0, 50, 100, 200]) {
        if (cash > spare) break;
        const action = offer({ cash, properties: [mineToGive.id] }, { cash: 0, properties: [theirsToGive.id] });
        if (invites(action)) return action;
      }
    }
  }
  for (const sq of useful) {
    for (const multiple of [1, 1.5, 2, 3]) {
      const price = Math.round(sq.price * multiple);
      if (price > partner.cash) break;
      const action = offer({ cash: 0, properties: [sq.id] }, { cash: price, properties: [] });
      if (invites(action)) return action;
    }
  }
  for (const sq of wanted) {
    if (heldIn(partner.id, sq) > 0) continue;
    for (const multiple of [1.5, 2, 3]) {
      const price = Math.round(sq.price * multiple);
      if (price > spare) break;
      const action = offer({ cash: price, properties: [] }, { cash: 0, properties: [sq.id] });
      if (invites(action)) return action;
    }
  }
  return null;
}

/**
 * Courting, at most once a round. First an answer to a seat that has shown this one goodwill and
 * had nothing back; then, behind, an invitation to the trailing seat with whom there is a deal
 * against the strongest rival; ahead, an invitation to the seat ranked last.
 */
function courtAlly(L: Lens, partners: PlayerId[]): Action | null {
  const { state, me, style, memory } = L;
  if (state.players.filter((p) => !p.bankrupt).length < 3) return null;
  const round = Math.floor(roundOf(state));
  if (memory.courted[me.id] === round) return null;
  const top = strongestRival(L);
  if (top === null) return null;
  const chances = chancesOf(L);
  const even = 1 / (rivals(L).length + 1);
  const gap = (chances[seatIndex(L, me.id)] - chances[seatIndex(L, top)]) / even;
  const others = rivals(L).filter((p) => p.id !== top && partners.includes(p.id));
  const tries: { partner: PlayerState; edge: number }[] = [];
  for (const p of others) {
    const shown = goodwillOf(memory.relations, me.id, p.id, round, style.allyTurns);
    const returned = goodwillOf(memory.relations, p.id, me.id, round, style.allyTurns);
    if (shown >= style.giftEdge / 2 && returned <= 0) tries.push({ partner: p, edge: 0 });
  }
  if (gap < 0) for (const p of others) tries.push({ partner: p, edge: style.giftEdge });
  else if (gap >= 0.3 && others.length > 0) {
    const last = [...others].sort((a, b) => chances[seatIndex(L, a.id)] - chances[seatIndex(L, b.id)])[0];
    tries.push({ partner: last, edge: style.giftEdge });
  }
  for (const { partner, edge } of tries) {
    const action = invitationTo(L, partner, top, edge);
    if (!action) continue;
    const sent = send(L, action, false);
    if (sent) {
      memory.courted[me.id] = round;
      return sent;
    }
  }
  return null;
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

  if (style.courtAllies) {
    const invited = courtAlly(L, partners);
    if (invited) return invited;
  }
  if (style.offerBy === 'value') {
    const asked = proposeByValue(L, partners);
    if (asked) return asked;
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

    // A seat that prices by value has made its ask above, or is waiting to ask again; unless it keeps today's price for the last street.
    if (style.offerBy === 'value' && style.completeBy === 'value') continue;
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
  // Hunting: the groups a failing rival stands 2 to 12 squares before come first, and may be built past the target.
  const hunted = new Set<GroupId>();
  if (style.huntFailing && builds.length > 0) {
    for (const id of failingRivals(L).keys()) {
      const prey = state.players[seatIndex(L, id)];
      for (const { sq } of builds) {
        const ahead = ((L.ctx.squareIndex.get(sq.id) ?? 0) - prey.position + 40) % 40;
        if (ahead >= 2 && ahead <= 12) hunted.add(sq.group);
      }
    }
  }
  if (style.buildTarget < 5 || style.buildBeyond === null || style.buildSpread === 'one' || style.buildNear !== null || style.holdHouses) {
    const focus =
      style.buildSpread === 'one' && belowTarget.length > 0
        ? [...belowTarget].sort((a, b) => groupStep(L, b) - groupStep(L, a) || (a < b ? -1 : 1))[0]
        : null;
    builds = builds.filter(({ sq }) => {
      if (hunted.has(sq.group)) return true;
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
  builds.sort((a, b) => Number(hunted.has(b.sq.group)) - Number(hunted.has(a.sq.group)) || rentGain(L, b.sq) * rate(b.sq) - rentGain(L, a.sq) * rate(a.sq));
  for (const { action, sq } of builds) {
    const beyond = buildingStep(L.ctx, state.properties[sq.id].level) + 1 > style.buildTarget && !hunted.has(sq.group);
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
  if (style.denyOffers && rankOf(L, me.id) <= style.denyRank) {
    // The bank holds it, so the strongest rival gets it unless someone outbids: the cap rises to what stopping that is worth.
    const top = strongestRival(L);
    const threat = top === null ? undefined : threatsOf(L).get(top);
    if (top !== null && threat && threat.wants === property && threat.potential >= style.denyThreat) {
      limit = Math.max(limit, Math.min(bid.max - Math.round(reserve(L) * style.bidKeep), Math.round(denial(L, top, property, 1).coins * style.denyShare)));
    }
  }
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

/**
 * Selling out of a debt: when mortgaging its idle property would not cover the debt, the debtor
 * offers its most valuable property outside its complete groups to the seat, other than the
 * creditor, to which it is worth most, for at least what it lacks and never below list price. Once a debt.
 */
function debtSale(L: Lens, legal: LegalAction[]): Action | null {
  const { state, me, style, memory } = L;
  const top = state.pending[state.pending.length - 1];
  if (!style.debtSales || !top || top.kind !== 'debt' || top.debtor !== me.id) return null;
  const key = `${state.turn.number}:${top.amount}`;
  if (memory.debtSold[me.id] === key) return null;
  const raisable = idleProperty(L, legal).reduce((sum, action) => sum + (L.byId.get(action.property) as PropertySquare).mortgageValue, 0);
  if (me.cash + raisable >= top.amount) return null;
  memory.debtSold[me.id] = key;
  const valuation = v1(state.players.length);
  const lacks = top.amount - me.cash;
  const mine = L.properties
    .filter((sq) => ownerOf(L, sq.id) === me.id && !state.properties[sq.id].mortgaged)
    .filter((sq) => !(sq.kind === 'street' && (ownsGroup(L.ctx, state, me.id, sq.group) || (L.groups.get(sq.group) ?? []).some((mate) => state.properties[mate.id].level > 0))))
    .sort((a, b) => b.price - a.price);
  for (const sq of mine) {
    const price = Math.max(sq.price, lacks);
    let best: { buyer: PlayerState; worth: number } | null = null;
    for (const buyer of rivals(L)) {
      if (buyer.id === top.creditor || buyer.cash < price) continue;
      const changed = structuredClone(state);
      changed.properties[sq.id].owner = buyer.id;
      const worth = worthInCoins(L.ctx, state, changed, buyer.id, valuation, buyer.cash, me.id);
      if (worth >= price && (best === null || worth > best.worth)) best = { buyer, worth };
    }
    if (best === null) continue;
    const action: Action = {
      type: 'PROPOSE_TRADE',
      player: me.id,
      to: best.buyer.id,
      give: { cash: 0, properties: [sq.id], jailCards: 0 },
      receive: { cash: price, properties: [], jailCards: 0 },
    };
    if (L.engine.validate(state, action) === null) return action;
  }
  return null;
}

function raiseFunds(L: Lens, legal: LegalAction[]): Action | null {
  const sale = debtSale(L, legal);
  if (sale) return sale;
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
  if (style.answerBy === 'sheet') return { type: dealScore(L, offer) >= style.acceptEdge ? 'ACCEPT_TRADE' : 'REJECT_TRADE', player: me };
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
  memory.ctx ??= L.ctx;
  if (readsTable(style)) memory.relations.tracking = true;
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
  memory.ctx ??= L.ctx;
  if (readsTable(style)) memory.relations.tracking = true;
  return proposeTrade(L, engine.legalActions(state, actor), random);
}

/**
 * At a rival's debt: the offer the style would make the debtor for its property, if any. It asks
 * for the unmortgaged property, on a group without buildings, that is worth most to it, and with
 * `estateOffers: 'both'` for the one whose passing to the creditor would cost it most. Priced as a
 * first ask by value, and never below list price. The creditor itself makes no such offer.
 */
export function debtOfferFor(engine: Engine, state: GameState, actor: PlayerId, style: Style, memory: StyleMemory): Action | null {
  const top = state.pending[state.pending.length - 1];
  if (!style.debtOffers || !top || top.kind !== 'debt' || top.debtor === actor || top.creditor === actor) return null;
  const L = lensOf(engine, state, actor, style, memory);
  if (!L) return null;
  memory.ctx ??= L.ctx;
  memory.relations.tracking = true;
  const { me } = L;
  const debtor = state.players[seatIndex(L, top.debtor)];
  const valuation = v1(state.players.length);
  const spare = me.cash - reserve(L);
  if (spare <= 0) return null;
  let best: { action: Action; score: number } | null = null;
  const weigh = (target: PropertySquare, worth: number, bonus: number, cap: number) => {
    const cash = Math.min(spare, Math.max(target.price, Math.round(worth * Math.min(style.openShare, cap))));
    if (cash < target.price) return;
    const action = asCash(L, debtor.id, cash, target.id);
    if (engine.validate(state, action) !== null) return;
    const score = dealScore(L, { from: me.id, to: debtor.id, give: action.give, receive: action.receive }) + bonus;
    if (best === null || score > best.score) best = { action, score };
  };
  for (const target of L.properties) {
    if (ownerOf(L, target.id) !== debtor.id || state.properties[target.id].mortgaged) continue;
    if (target.kind === 'street' && (L.groups.get(target.group) ?? []).some((mate) => state.properties[mate.id].level > 0)) continue;
    const changed = structuredClone(state);
    changed.properties[target.id].owner = me.id;
    const worth = worthInCoins(L.ctx, state, changed, me.id, valuation, spare, debtor.id);
    if (worth >= target.price) weigh(target, worth, 0, style.maxShare);
    if (style.estateOffers === 'both' && top.creditor !== null) {
      // If the debtor fails, the creditor takes this property for certain.
      const stop = denial(L, top.creditor, target.id, 1);
      if (stop.coins * style.denyShare >= target.price) weigh(target, stop.coins, stop.points, style.denyShare);
    }
  }
  const chosen = best as { action: Action; score: number } | null;
  return chosen !== null && chosen.score > 0 ? chosen.action : null;
}

/** Whether `actor` counts `partner` as an ally by a style, for reports and tests. */
export function areAllied(engine: Engine, state: GameState, actor: PlayerId, partner: PlayerId, style: Style, memory: StyleMemory): boolean {
  const L = lensOf(engine, state, actor, style, memory);
  return L ? alliedWith(L, partner) : false;
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

