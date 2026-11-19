import type { Engine } from '../engine/engine.ts';
import { nextFloat, seedFrom } from '../rng.ts';
import type { Action, GameState } from '../types.ts';
import { chooseRandomAction } from './random-agent.ts';

/** Chooses the next action for whichever player the game is waiting on. */
export type Agent = (engine: Engine, state: GameState, random: () => number) => Action | null;

export interface SimulationOptions {
  players?: number;
  seed?: number;
  maxActions?: number;
  /** Who plays; random play by default. */
  agent?: Agent;
}

export interface SimulationResult {
  state: GameState;
  actions: number;
  finished: boolean;
  eventCounts: Record<string, number>;
}

export function simulateGame(engine: Engine, options: SimulationOptions = {}): SimulationResult {
  const seed = options.seed ?? 1;
  const playerCount = options.players ?? 4;
  const maxActions = options.maxActions ?? 20000;
  const agent = options.agent ?? chooseRandomAction;

  const agentRng = { rng: seedFrom(`agents-${seed}`) };
  const random = () => nextFloat(agentRng);
  const players = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);

  let state = engine.newGame({ players, seed });
  let actions = 0;
  const eventCounts: Record<string, number> = {};

  while (state.winner === null && actions < maxActions) {
    const where = `seed ${seed}, action ${actions + 1}`;
    const action = agent(engine, state, random);
    if (!action) {
      throw new Error(`Nobody can act (${where}). Pending: ${JSON.stringify(state.pending)}`);
    }
    const result = engine.apply(state, action);
    if (!result.ok) {
      throw new Error(
        `A listed action was rejected (${where}): ${JSON.stringify(action)} -> ${result.error.code}: ${result.error.message}`,
      );
    }
    state = result.state;
    actions += 1;
    for (const event of result.events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    }
    const problems = engine.checkInvariants(state);
    if (problems.length > 0) {
      throw new Error(`Invariant broken (${where}) after ${JSON.stringify(action)}:\n${problems.join('\n')}`);
    }
  }

  return { state, actions, finished: state.winner !== null, eventCounts };
}
