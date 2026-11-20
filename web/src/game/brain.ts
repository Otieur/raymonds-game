/**
 * Runs a learned opponent: its network in a web worker when one can be started, and on the main
 * thread otherwise.
 *
 * The worker holds its own engine and agent and is fed the same events and states as the store, so a
 * decision is one message each way. A page opened from file:// may refuse to start the worker. The
 * first refusal settles every later opponent on the main thread, where a decision is a few passes of
 * the network inside the pause before a computer player acts.
 */
import { createMlp } from '../../../src/env/mlp.ts';
import type { ModelWeights } from '../../../src/env/mlp.ts';
import type { Action } from '../../../src/index.ts';
import { learnedOptions, learnedSeatAgent } from '../../../src/sim/league.ts';
import type { Mode, OpponentAgent } from '../../../src/sim/opponents.ts';
import type { FromBrain, ToBrain } from './brain-worker.ts';
import BrainWorker from './brain-worker.ts?worker&inline';

/** A learned opponent that may hold a worker, which must be shut down when its game is left. */
export interface BrainAgent extends OpponentAgent {
  dispose(): void;
}

/** How long a worker may take to load its model and say it is ready. */
const START_LIMIT_MS = 8000;

let workers: 'untried' | 'working' | 'refused' = 'untried';

/** The worker started but refused the model; the main thread would refuse it the same way. */
class ModelRefused extends Error {}

/** Where the opponents made so far run: for the console and for checking. */
export function brainWhere(): typeof workers {
  return workers;
}

export async function brainAgent(load: () => Promise<ModelWeights>, query: string, mode: Mode): Promise<BrainAgent> {
  const weights = await load();
  const options = learnedOptions(query);
  if (workers !== 'refused' && typeof Worker !== 'undefined') {
    try {
      const agent = await inWorker(weights, query, mode);
      workers = 'working';
      return agent;
    } catch (reason) {
      if (reason instanceof ModelRefused) throw reason;
      if (workers === 'untried') {
        workers = 'refused';
        console.info('Learned opponents run on the main thread: the worker could not start.', reason);
      }
    }
  }
  const seat = learnedSeatAgent(createMlp(weights), options);
  return { choose: seat.choose, observe: seat.observe, dispose: () => {} };
}

function inWorker(weights: ModelWeights, query: string, mode: Mode): Promise<BrainAgent> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new BrainWorker();
    } catch (reason) {
      reject(reason);
      return;
    }
    const waiting = new Map<number, { resolve: (action: Action | null) => void; reject: (reason: Error) => void }>();
    let next = 1;
    let broken: Error | null = null;
    const fail = (error: Error) => {
      if (broken) return;
      broken = error;
      clearTimeout(timer);
      worker.terminate();
      for (const request of waiting.values()) request.reject(error);
      waiting.clear();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('the worker did not start in time')), START_LIMIT_MS);
    const post = (message: ToBrain) => worker.postMessage(message);
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'the worker failed'));
    };
    worker.onmessageerror = () => fail(new Error('a message from the worker could not be read'));
    worker.onmessage = ({ data }: MessageEvent<FromBrain>) => {
      if (data.type === 'ready') {
        clearTimeout(timer);
        resolve(agent);
      } else if (data.type === 'failed') {
        fail(new ModelRefused(data.message));
      } else {
        const request = waiting.get(data.id);
        waiting.delete(data.id);
        if (data.error) request?.reject(new Error(data.error));
        else request?.resolve(data.action);
      }
    };
    const agent: BrainAgent = {
      choose(_engine, state, actor, random, limits) {
        if (broken) return Promise.reject(broken);
        const id = next++;
        const seed = Math.floor(random() * 2 ** 32);
        return new Promise<Action | null>((resolveAnswer, rejectAnswer) => {
          waiting.set(id, { resolve: resolveAnswer, reject: rejectAnswer });
          // The worker's engine is its own, so the seats this one may not ask again go with the question.
          post({ type: 'choose', id, state, actor, seed, blocked: [...(limits?.blocked ?? [])] });
        });
      },
      observe(events, state) {
        if (!broken) post({ type: 'observe', events, state });
      },
      dispose() {
        fail(new Error('the game was left'));
      },
    };
    post({ type: 'start', weights, query, mode });
  });
}
