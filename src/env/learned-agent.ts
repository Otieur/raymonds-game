/**
 * An agent built from a network: it keeps the ledger, encodes the state for the acting seat, runs
 * the network, takes the most likely legal action (or samples), and decodes it. Drafting steps run
 * inside the agent until an action for the engine comes out. If anything fails it falls back to the
 * rule-based agent.
 */
import type { Engine } from '../engine/engine.ts';
import { chooseHeuristicAction, createAgentMemory } from '../sim/heuristic-agent.ts';
import { viewOf } from '../sim/measures.ts';
import { isShortGame } from '../rules.ts';
import { chooseStyledAction, contextOf, createStyleMemory, observe as observeStyle, proposeFor } from '../sim/style-agent.ts';
import type { Style } from '../sim/style.ts';
import type { SeatAgent } from '../sim/styles.ts';
import { v1 } from '../sim/valuation.ts';
import type { Action, GameEvent, GameState, PlayerId } from '../types.ts';
import { codecFor, emptyDraft } from './actions.ts';
import type { Draft } from './actions.ts';
import { createLedger, note } from './ledger.ts';
import { DECISION_KINDS, decisionKind, observe } from './observe.ts';
import type { Mlp } from './mlp.ts';

/**
 * `rulesFor` lists kinds of decision (indices into DECISION_KINDS) that the rule-based agent makes
 * instead of the network; `rulesWhenLegal` lists action types (such as BUILD) whose being legal hands the
 * decision to the rule-based agent; `proposals: false` keeps it from drafting offers. All are for diagnosis;
 * the defaults leave every decision to the network.
 *
 * `proposer` is a style that makes the seat's offers, as the environment does while drafting is off: once on
 * each of the seat's turns, after its roll, the style is asked whether it would propose, and what it
 * proposes is sent. The network then drafts nothing. `answerer` is a style that answers the offers the
 * seat receives in the network's place (M9's comparison with ruled trading).
 *
 * The observation's mark of the short game is read from the engine's rules. An offer of the seat's own
 * that was refused is not drafted again that turn, as in the environment.
 */
const TRADE = DECISION_KINDS.indexOf('trade');

export function createLearnedAgent(
  model: Mlp,
  engine: Engine,
  options: { greedy?: boolean; rulesFor?: number[]; rulesWhenLegal?: string[]; proposals?: boolean; proposer?: Style; answerer?: Style } = {},
): SeatAgent & { fallbacks(): number } {
  const ctx = contextOf(engine);
  const shortGame = isShortGame(engine.rules);
  let me: PlayerId | null = null;
  const refused = new Set<number>();
  const refusedSales = new Set<string>();
  const ledger = createLedger();
  const memory = createAgentMemory();
  let fallbacks = 0;
  const proposals = new Map<string, number>();
  let turn = -1;
  const styleMemory = createStyleMemory();
  let asked = -1;
  return {
    choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null {
      if (!engine.awaiting(state).includes(actor)) return null;
      me = actor;
      if (options.answerer && decisionKind(state) === TRADE) {
        return chooseStyledAction(engine, state, actor, random, options.answerer, styleMemory) ?? { type: 'REJECT_TRADE', player: actor };
      }
      if (options.rulesFor?.includes(decisionKind(state))) return chooseHeuristicAction(engine, state, actor, random, memory);
      if (options.rulesWhenLegal && engine.legalActions(state, actor).some((a) => options.rulesWhenLegal?.includes(a.type))) {
        return chooseHeuristicAction(engine, state, actor, random, memory);
      }
      if (options.proposer && state.pending.length === 0 && state.turn.phase === 'postRoll' && state.turn.player === actor && asked !== state.turn.number) {
        asked = state.turn.number;
        const offer = proposeFor(engine, state, actor, random, options.proposer, styleMemory);
        if (offer) return offer;
      }
      try {
        if (state.turn.number !== turn) {
          turn = state.turn.number;
          proposals.clear();
          refused.clear();
          refusedSales.clear();
        }
        const seat = state.players.findIndex((p) => p.id === actor);
        const chances = v1(state.players.length).chances(ctx, state);
        const view = viewOf(ctx, state);
        let draft: Draft = emptyDraft();
        for (let step = 0; step < 4; step++) {
          const left = options.proposals === false || options.proposer ? 0 : 2 - (proposals.get(actor) ?? 0);
          const codec = codecFor(ctx, engine, state, actor, draft, { drafting: true, proposalsLeft: left, refused, refusedSales });
          const obs = observe({ ctx, state, view, seat, ledger, chances, draft, proposalsLeft: left, shortGame });
          const { policy } = model.forward(obs);
          let best = -1;
          if (options.greedy ?? true) {
            let top = -Infinity;
            for (let a = 0; a < policy.length; a++) if (codec.mask[a] && policy[a] > top) [top, best] = [policy[a], a];
          } else {
            let total = 0;
            const weights = Array.from(policy, (v, a) => (codec.mask[a] ? Math.exp(v) : 0));
            for (const w of weights) total += w;
            let pick = random() * total;
            best = weights.findIndex((w) => (pick -= w) <= 0);
          }
          if (best < 0) break;
          const decoded = codec.decode(best);
          if (decoded.kind === 'engine') {
            if (decoded.action.type === 'PROPOSE_TRADE') proposals.set(actor, (proposals.get(actor) ?? 0) + 1);
            return decoded.action;
          }
          if (decoded.draft.stage === 'none') proposals.set(actor, (proposals.get(actor) ?? 0) + 1);
          draft = decoded.draft;
        }
      } catch {
        // falls through to the rule-based agent
      }
      fallbacks += 1;
      return chooseHeuristicAction(engine, state, actor, random, memory);
    },
    observe(events: GameEvent[], state: GameState): void {
      note(ctx, ledger, state, events);
      if (options.proposer || options.answerer) observeStyle(styleMemory, events, state);
      for (const event of events) {
        if (event.type !== 'TRADE_REJECTED' || event.offer.from !== me) continue;
        const ask = ctx.propertyOrder.findIndex((sq) => event.offer.receive.properties.includes(sq.id));
        if (ask >= 0) refused.add(ask);
        else {
          const sold = ctx.propertyOrder.findIndex((sq) => event.offer.give.properties.includes(sq.id));
          if (sold >= 0) refusedSales.add(`${sold}>${event.offer.to}`);
        }
      }
    },
    rules: () => ({ ever: [], last: [] }),
    fallbacks: () => fallbacks,
  };
}
