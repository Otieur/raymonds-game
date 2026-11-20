/**
 * The worker side of `brain.ts`: one learned opponent for one seat of one game, with its own engine.
 * It is fed the same events and states as the store, in the same order, and answers each request for
 * a decision with one message.
 */
import { createMlp } from '../../../src/env/mlp.ts';
import type { ModelWeights } from '../../../src/env/mlp.ts';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../../../src/index.ts';
import type { Action, Engine, GameEvent, GameState, PlayerId } from '../../../src/index.ts';
import { nextFloat } from '../../../src/rng.ts';
import { withoutAsking } from '../../../src/sim/asks.ts';
import { learnedOptions, learnedSeatAgent } from '../../../src/sim/league.ts';
import type { Mode } from '../../../src/sim/opponents.ts';
import type { SeatAgent } from '../../../src/sim/styles.ts';

export type ToBrain =
  | { type: 'start'; weights: ModelWeights; query: string; mode: Mode }
  | { type: 'observe'; events: GameEvent[]; state: GameState }
  | { type: 'choose'; id: number; state: GameState; actor: PlayerId; seed: number; blocked: PlayerId[] };

export type FromBrain =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'answer'; id: number; action: Action | null; error?: string };

// Typed by hand: the client's type check uses the DOM's library, not the worker's.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToBrain>) => void) | null;
  postMessage(message: FromBrain): void;
};

let engine: Engine | null = null;
let agent: SeatAgent | null = null;

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'start':
      try {
        engine = createEngine(threeKingdoms, data.mode === 'short' ? SHORT_GAME_RULES : {});
        agent = learnedSeatAgent(createMlp(data.weights), learnedOptions(data.query));
        scope.postMessage({ type: 'ready' });
      } catch (error) {
        scope.postMessage({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
      break;
    case 'observe':
      agent?.observe(data.events, data.state);
      break;
    case 'choose': {
      const holder = { rng: data.seed };
      try {
        if (!engine || !agent) throw new Error('the worker was asked before it started');
        const view = withoutAsking(engine, data.blocked);
        scope.postMessage({ type: 'answer', id: data.id, action: agent.choose(view, data.state, data.actor, () => nextFloat(holder)) });
      } catch (error) {
        scope.postMessage({ type: 'answer', id: data.id, action: null, error: error instanceof Error ? error.message : String(error) });
      }
      break;
    }
  }
};
