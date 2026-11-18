/**
 * An agent built from a network: it keeps the ledger, encodes the state for the acting seat, runs
 * the network, takes the most likely legal action (or samples), and decodes it. Drafting steps run
 * inside the agent until an action for the engine comes out. If anything fails it falls back to the
 * rule-based agent.
 */
import type { Engine } from '../engine/engine.ts';
import { chooseHeuristicAction, createAgentMemory } from '../sim/heuristic-agent.ts';
import { viewOf } from '../sim/measures.ts';
import { contextOf } from '../sim/style-agent.ts';
import type { SeatAgent } from '../sim/styles.ts';
import { v1 } from '../sim/valuation.ts';
import type { Action, GameEvent, GameState, PlayerId } from '../types.ts';
import { codecFor, emptyDraft } from './actions.ts';
import type { Draft } from './actions.ts';
import { createLedger, note } from './ledger.ts';
import { observe } from './observe.ts';
import type { Mlp } from './mlp.ts';

export function createLearnedAgent(model: Mlp, engine: Engine, options: { greedy?: boolean } = {}): SeatAgent & { fallbacks(): number } {
  const ctx = contextOf(engine);
  const ledger = createLedger();
  const memory = createAgentMemory();
  let fallbacks = 0;
  const proposals = new Map<string, number>();
  let turn = -1;
  return {
    choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null {
      if (!engine.awaiting(state).includes(actor)) return null;
      try {
        if (state.turn.number !== turn) {
          turn = state.turn.number;
          proposals.clear();
        }
        const seat = state.players.findIndex((p) => p.id === actor);
        const chances = v1(state.players.length).chances(ctx, state);
        const view = viewOf(ctx, state);
        let draft: Draft = emptyDraft();
        for (let step = 0; step < 4; step++) {
          const left = 2 - (proposals.get(actor) ?? 0);
          const codec = codecFor(ctx, engine, state, actor, draft, { drafting: true, proposalsLeft: left, refused: new Set() });
          const obs = observe({ ctx, state, view, seat, ledger, chances, draft, proposalsLeft: left, shortGame: false });
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
    },
    rules: () => ({ ever: [], last: [] }),
    fallbacks: () => fallbacks,
  };
}
