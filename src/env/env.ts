/**
 * The environment: a game turned into a stream of decisions for a learner. It serves one decision
 * at a time, applies forced moves without asking, plays league members' seats itself, and reports
 * the potentials from which the trainer makes rewards. The rules are the engine's; nothing here
 * decides what is legal.
 */
import type { Context } from '../context.ts';
import { createEngine } from '../engine/engine.ts';
import type { Engine } from '../engine/engine.ts';
import { threeKingdoms } from '../boards/three-kingdoms.ts';
import { SHORT_GAME_RULES } from '../rules.ts';
import { nextFloat, seedFrom } from '../rng.ts';
import { chooseHeuristicAction } from '../sim/heuristic-agent.ts';
import { viewOf } from '../sim/measures.ts';
import { proposeFor, contextOf, createStyleMemory, debtOfferFor } from '../sim/style-agent.ts';
import { createDebtWindows, debtWindow } from '../sim/window.ts';
import { memberAgent } from '../sim/league.ts';
import { PRESETS } from '../sim/styles.ts';
import type { SeatAgent } from '../sim/styles.ts';
import { v1 } from '../sim/valuation.ts';
import type { Action, GameState, PlayerId } from '../types.ts';
import { ACTIONS, codecFor, emptyDraft, legalIndices } from './actions.ts';
import type { Codec, Draft } from './actions.ts';
import { createLedger, note } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { decisionKind, observe, OBS_SIZE } from './observe.ts';
import { potential, potentialContext, POTENTIALS } from './potentials.ts';
import type { PotentialName } from './potentials.ts';

export interface EnvConfig {
  players: 2 | 3 | 4 | { 2: number; 3: number; 4: number };
  rules: 'full' | 'short';
  learners: number;
  opponents: { member: string; weight: number }[];
  turnLimit: { 2: number; 3: number; 4: number };
  potentials: string[];
  drafting: boolean;
  /**
   * With drafting on, the share of a learner's turns on which it drafts its own offers; on the
   * others the proposer school offers for it, as with drafting off. Drawn at the start of each turn
   * from a stream of its own, so the game's dice do not depend on it. 1 when absent (M9's T2 uses 0.5).
   */
  draftShare?: number;
  proposer: string | null;
  maxProposals: number;
  seeds: { start: number; step: number };
  mode?: 'play' | 'teach' | 'conduct';
  /** Whether the observation and the value potential use V1; even shares otherwise. True by default. */
  valuation?: boolean;
}

export const DEFAULT_CONFIG: EnvConfig = {
  players: 4,
  rules: 'full',
  learners: 1,
  opponents: [{ member: 'baseline', weight: 1 }],
  turnLimit: { 2: 310, 3: 360, 4: 410 },
  potentials: ['value'],
  drafting: false,
  proposer: 'baseline',
  maxProposals: 2,
  seeds: { start: 10_000_000, step: 1 },
};

export interface Final {
  /** 1 for the winner, 0 for the rest; all 0 when the game was cut off. */
  result: number[];
  /** Finishing places, 1 first; null when cut off. */
  places: number[] | null;
  turns: number;
  /** Indices in the order of play of the seats the trainer played. */
  learners: number[];
  /** Who sat in each seat, in the order of play: a league member's name, or 'learner'. */
  members: string[];
  /** The learners' offers over the game: those they drafted themselves, and those their school made for them, with how many were accepted. */
  offers: { drafted: number; draftedAccepted: number; school: number; schoolAccepted: number };
}

export interface Step {
  /** The deciding seat's index in the order of play; -1 on the step that ends a game. */
  seat: number;
  kind: number;
  observation: Float32Array;
  legal: Uint8Array;
  phi: Float32Array;
  done: boolean;
  truncated: boolean;
  final?: Final;
  info: { game: number; seed: number; turn: number; round: number; forced: number; ruled: number };
}

interface Seat {
  learner: boolean;
  agent: SeatAgent | null;
  member: string;
}

export { memberAgent };

export function createEnv(config: EnvConfig = DEFAULT_CONFIG) {
  for (const name of config.potentials) if (!(POTENTIALS as readonly string[]).includes(name)) throw new Error(`No potential named ${name}.`);
  const engines = { full: createEngine(threeKingdoms), short: createEngine(threeKingdoms, SHORT_GAME_RULES) };
  const engine: Engine = engines[config.rules];
  const ctx: Context = contextOf(engine);

  let game = -1;
  let seed = 0;
  let state: GameState;
  let ledger: Ledger;
  let random: () => number;
  let drafts = new Map<PlayerId, Draft>();
  let proposals = new Map<PlayerId, number>();
  let refused = new Map<PlayerId, Set<number>>();
  let refusedSales = new Map<PlayerId, Set<string>>();
  let draftingNow = new Map<PlayerId, boolean>();
  let offers = { drafted: 0, draftedAccepted: 0, school: 0, schoolAccepted: 0 };
  /** Who made the offer now on the table for a learner: its own draft or its school; null when none is open. */
  let openOffer: 'drafted' | 'school' | null = null;
  let draftRandom: () => number = () => 0;
  let proposerAsked = new Set<PlayerId>();
  let proposerMemory = createStyleMemory();
  let windows = createDebtWindows();
  let eliminated: PlayerId[] = [];
  let forced = 0;
  let ruled = 0;
  let codec: Codec | null = null;
  let current: PlayerId | null = null;
  let ended = false;
  let chanceCache: { state: GameState; chances: number[] } | null = null;

  const sizeFor = (draw: number): 2 | 3 | 4 => {
    if (typeof config.players === 'number') return config.players;
    const weights = config.players;
    const total = weights[2] + weights[3] + weights[4];
    let pick = draw * total;
    for (const n of [2, 3, 4] as const) {
      if (pick < weights[n]) return n;
      pick -= weights[n];
    }
    return 4;
  };

  const pickMember = (draw: number): string => {
    const total = config.opponents.reduce((sum, o) => sum + o.weight, 0);
    let pick = draw * total;
    for (const o of config.opponents) {
      if (pick < o.weight) return o.member;
      pick -= o.weight;
    }
    return config.opponents[config.opponents.length - 1].member;
  };

  function chancesOf(s: GameState): number[] {
    if (config.valuation === false) {
      const alive = s.players.filter((p) => !p.bankrupt).length;
      return s.players.map((p) => (p.bankrupt ? 0 : 1 / alive));
    }
    if (chanceCache?.state !== s) chanceCache = { state: s, chances: v1(s.players.length).chances(ctx, s) };
    return chanceCache.chances;
  }

  function startGame(): void {
    game += 1;
    seed = config.seeds.start + game * config.seeds.step;
    const holder = { rng: seedFrom(`env-${seed}`) };
    random = () => nextFloat(holder);
    const n = sizeFor(random());
    const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
    const learners = Math.min(config.learners, n);
    const byId = new Map<PlayerId, Seat>();
    ids.forEach((id, i) => {
      if (i < learners) byId.set(id, { learner: true, agent: null, member: 'learner' });
      else {
        const member = pickMember(random());
        byId.set(id, { learner: false, agent: memberAgent(member), member });
      }
    });
    state = engine.newGame({ players: ids, seed });
    ledger = createLedger();
    drafts = new Map(ids.map((id) => [id, emptyDraft()]));
    proposals = new Map(ids.map((id) => [id, 0]));
    refused = new Map(ids.map((id) => [id, new Set()]));
    refusedSales = new Map(ids.map((id) => [id, new Set()]));
    draftingNow = new Map(ids.map((id) => [id, true]));
    offers = { drafted: 0, draftedAccepted: 0, school: 0, schoolAccepted: 0 };
    openOffer = null;
    const draftHolder = { rng: seedFrom(`draft-${seed}`) };
    draftRandom = () => nextFloat(draftHolder);
    proposerAsked = new Set();
    proposerMemory = createStyleMemory();
    windows = createDebtWindows();
    eliminated = [];
    forced = 0;
    ruled = 0;
    ended = false;
    seatsById = byId;
  }
  let seatsById = new Map<PlayerId, Seat>();

  function apply(action: Action): void {
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`Game ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    state = result.state;
    note(ctx, ledger, state, result.events);
    for (const seat of seatsById.values()) seat.agent?.observe(result.events, state);
    for (const event of result.events) {
      if (event.type === 'TURN_STARTED') {
        const share = config.draftShare ?? 1;
        draftingNow.set(event.player, share >= 1 ? true : share <= 0 ? false : draftRandom() < share);
        for (const id of proposals.keys()) proposals.set(id, 0);
        for (const set of refused.values()) set.clear();
        for (const set of refusedSales.values()) set.clear();
        proposerAsked.clear();
      }
      if ((event.type === 'TRADE_ACCEPTED' || event.type === 'TRADE_REJECTED' || event.type === 'TRADE_CANCELLED') && openOffer) {
        if (event.type === 'TRADE_ACCEPTED') offers[openOffer === 'drafted' ? 'draftedAccepted' : 'schoolAccepted'] += 1;
        openOffer = null;
      }
      if (event.type === 'TRADE_REJECTED') {
        const ask = ctx.propertyOrder.findIndex((sq) => event.offer.receive.properties.includes(sq.id));
        if (ask >= 0) refused.get(event.offer.from)?.add(ask);
        else {
          // A sale refused: the same property is not offered to the same partner again this turn.
          const sold = ctx.propertyOrder.findIndex((sq) => event.offer.give.properties.includes(sq.id));
          if (sold >= 0) refusedSales.get(event.offer.from)?.add(`${sold}>${event.offer.to}`);
        }
      }
      if (event.type === 'BANKRUPT') eliminated.push(event.player);
    }
  }

  /** The seat the environment serves next among those the engine waits on. */
  function nextActor(): PlayerId {
    const waiting = engine.awaiting(state);
    if (waiting.length <= 1) return waiting[0];
    const top = state.pending[state.pending.length - 1];
    const after = top && (top.kind === 'auction' || top.kind === 'buildingAuction') && top.highBidder ? top.highBidder : state.turn.player;
    const order = state.players.map((p) => p.id);
    const start = order.indexOf(after);
    for (let k = 1; k <= order.length; k++) {
      const id = order[(start + k) % order.length];
      if (waiting.includes(id)) return id;
    }
    return waiting[0];
  }

  /** Whether a seat drafts its own offers this turn. */
  function draftsNow(id: PlayerId): boolean {
    return config.drafting && (draftingNow.get(id) ?? true);
  }

  function codecOf(actor: PlayerId): Codec {
    return codecFor(ctx, engine, state, actor, drafts.get(actor) ?? emptyDraft(), {
      drafting: draftsNow(actor),
      proposalsLeft: config.maxProposals - (proposals.get(actor) ?? 0),
      refused: refused.get(actor) ?? new Set(),
      refusedSales: refusedSales.get(actor) ?? new Set(),
    });
  }

  function finalStep(truncated: boolean): Step {
    ended = true;
    const n = state.players.length;
    const winner = state.winner;
    const result = state.players.map((p) => (!truncated && p.id === winner ? 1 : 0));
    let places: number[] | null = null;
    if (!truncated) {
      const order = [winner, ...state.players.filter((p) => p.id !== winner && !eliminated.includes(p.id)).map((p) => p.id), ...[...eliminated].reverse()];
      places = state.players.map((p) => order.indexOf(p.id) + 1);
    }
    return {
      seat: -1,
      kind: 0,
      observation: new Float32Array(OBS_SIZE),
      legal: new Uint8Array(ACTIONS),
      phi: new Float32Array(config.potentials.length),
      done: true,
      truncated,
      final: {
        result,
        places,
        turns: state.turn.number,
        learners: state.players.flatMap((p, i) => (seatsById.get(p.id)?.learner ? [i] : [])),
        members: state.players.map((p) => (seatsById.get(p.id)?.learner ? 'learner' : (seatsById.get(p.id)?.member ?? ''))),
        offers: { ...offers },
      },
      info: { game, seed, turn: state.turn.number, round: (state.turn.number - 1) / n, forced, ruled },
    };
  }

  function stepFor(actor: PlayerId, c: Codec): Step {
    const seat = state.players.findIndex((p) => p.id === actor);
    const chances = chancesOf(state);
    const view = viewOf(ctx, state);
    const observation = observe({
      ctx,
      state,
      view,
      seat,
      ledger,
      chances,
      draft: drafts.get(actor) ?? emptyDraft(),
      proposalsLeft: config.maxProposals - (proposals.get(actor) ?? 0),
      shortGame: config.rules === 'short',
    });
    const pc = potentialContext(ctx, state, chances, ledger);
    const phi = Float32Array.from(config.potentials.map((name) => potential(name as PotentialName, pc, seat)));
    return {
      seat,
      kind: decisionKind(state),
      observation,
      legal: c.mask,
      phi,
      done: false,
      truncated: false,
      info: { game, seed, turn: state.turn.number, round: (state.turn.number - 1) / state.players.length, forced, ruled },
    };
  }

  /** Who answers at a debt window for a seat: the member that plays it, or for a learner the school that proposes on its behalf. */
  function windowAgent(id: PlayerId): SeatAgent | undefined {
    const seat = seatsById.get(id);
    if (!seat) return undefined;
    if (!seat.learner) return seat.agent ?? undefined;
    const style = !draftsNow(id) && config.proposer ? PRESETS[config.proposer]?.playbook.base : undefined;
    if (!style) return undefined;
    return { choose: () => null, observe: () => {}, rules: () => ({ ever: [], last: [] }), window: (e, s, actor) => debtOfferFor(e, s, actor, style, proposerMemory) };
  }

  /** Plays on until a learner has a real choice or the game ends. */
  function advance(): Step {
    for (;;) {
      if (state.winner !== null) return finalStep(false);
      if (state.turn.number > config.turnLimit[state.players.length as 2 | 3 | 4]) return finalStep(true);
      // At a debt the debtor cannot cover, the ruled seats that offer for its property are asked first, and so is the school that proposes for a learner.
      const early = debtWindow(engine, state, windowAgent, random, windows);
      if (early) {
        apply(early.action);
        continue;
      }
      const actor = nextActor();
      const seat = seatsById.get(actor) as Seat;
      if (!seat.learner) {
        const action = seat.agent?.choose(engine, state, actor, random);
        if (!action) throw new Error(`Game ${seed}: ${seat.member} has no action.`);
        apply(action);
        continue;
      }
      const draft = drafts.get(actor) ?? emptyDraft();
      if (!draftsNow(actor) && config.proposer && draft.stage === 'none' && !proposerAsked.has(actor) && state.pending.length === 0 && state.turn.phase === 'postRoll' && state.turn.player === actor) {
        proposerAsked.add(actor);
        const style = PRESETS[config.proposer]?.playbook.base;
        const offer = style ? proposeFor(engine, state, actor, random, style, proposerMemory) : null;
        if (offer) {
          offers.school += 1;
          openOffer = 'school';
          apply(offer);
          continue;
        }
      }
      const c = codecOf(actor);
      const legal = legalIndices(c.mask);
      if (legal.length === 0) {
        const action = chooseHeuristicAction(engine, state, actor, random);
        if (!action) throw new Error(`Game ${seed}: nothing to do for ${actor}.`);
        ruled += 1;
        apply(action);
        continue;
      }
      if (legal.length === 1) {
        forced += 1;
        take(actor, c, legal[0]);
        continue;
      }
      codec = c;
      current = actor;
      return stepFor(actor, c);
    }
  }

  function take(actor: PlayerId, c: Codec, index: number): void {
    const decoded = c.decode(index);
    if (decoded.kind === 'draft') {
      if (decoded.draft.stage === 'none') proposals.set(actor, (proposals.get(actor) ?? 0) + 1);
      drafts.set(actor, decoded.draft);
      return;
    }
    if (decoded.action.type === 'PROPOSE_TRADE') {
      proposals.set(actor, (proposals.get(actor) ?? 0) + 1);
      drafts.set(actor, emptyDraft());
      offers.drafted += 1;
      openOffer = 'drafted';
    }
    apply(decoded.action);
  }

  return {
    config,
    reset(): Step {
      startGame();
      return advance();
    },
    step(action: number): Step {
      if (ended || !codec || current === null) {
        startGame();
        return advance();
      }
      if (!codec.mask[action]) throw new Error(`Game ${seed}: action ${action} is not legal. Legal: ${legalIndices(codec.mask).join(',')}`);
      take(current, codec, action);
      codec = null;
      return advance();
    },
    /** The game as it stands, for tests and tools. */
    get state(): GameState {
      return state;
    },
    seatOf(index: number): string {
      return seatsById.get(state.players[index]?.id)?.member ?? '';
    },
  };
}

export type Env = ReturnType<typeof createEnv>;
