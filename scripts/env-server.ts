/**
 * Serves environments to a trainer over standard input and output: one JSON request a line, one
 * JSON reply a line.
 *
 *   {"op":"hello"}                          -> sizes, layout, potentials, members
 *   {"op":"make","count":64,"config":{...}} -> {"ok":true}
 *   {"op":"reset"}                          -> {"steps":[...]}
 *   {"op":"step","actions":[...]}           -> {"steps":[...]}
 *   {"op":"close"}
 *
 * A step in a reply is {"e":3,"seat":1,"kind":0,"obs":[...],"legal":[0,13,57],"phi":[...],"done":false}.
 * An illegal action ends the process with a message naming the environment, the action and the
 * legal list: an agent must never send one.
 */
import { createInterface } from 'node:readline';
import { ACTIONS, ACTIONS_VERSION, legalIndices } from '../src/env/actions.ts';
import { createEnv, DEFAULT_CONFIG } from '../src/env/env.ts';
import type { Env, EnvConfig, Step } from '../src/env/env.ts';
import { DECISION_KINDS, OBS_LAYOUT, OBS_SIZE, OBS_VERSION } from '../src/env/observe.ts';
import { POTENTIALS } from '../src/env/potentials.ts';
import { PRESETS } from '../src/sim/styles.ts';
// Learned members (`model:<path>`: past selves, learned holders) are read through this loader.
import './model-loader.ts';

let envs: Env[] = [];

const round = (values: Float32Array) => Array.from(values, (v) => Math.round(v * 1e5) / 1e5);

function encode(e: number, step: Step): unknown {
  return {
    e,
    seat: step.seat,
    kind: step.kind,
    obs: step.done ? [] : round(step.observation),
    legal: legalIndices(step.legal),
    phi: Array.from(step.phi),
    done: step.done,
    truncated: step.truncated,
    final: step.final,
    info: step.info,
  };
}

function reply(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of reader) {
  if (!line.trim()) continue;
  const request = JSON.parse(line) as { op: string; count?: number; config?: Partial<EnvConfig>; actions?: number[] };
  switch (request.op) {
    case 'hello':
      reply({
        version: OBS_VERSION,
        actionsVersion: ACTIONS_VERSION,
        obs: OBS_SIZE,
        actions: ACTIONS,
        layout: OBS_LAYOUT,
        kinds: DECISION_KINDS,
        potentials: POTENTIALS,
        members: ['random', 'rules', ...Object.keys(PRESETS)],
      });
      break;
    case 'make': {
      const count = request.count ?? 1;
      const base = { ...DEFAULT_CONFIG, ...request.config };
      envs = Array.from({ length: count }, (_, i) =>
        createEnv({ ...base, seeds: { start: (base.seeds?.start ?? 10_000_000) + i, step: count } }),
      );
      reply({ ok: true });
      break;
    }
    case 'reset':
      reply({ steps: envs.map((env, e) => encode(e, env.reset())) });
      break;
    case 'step': {
      const actions = request.actions ?? [];
      if (actions.length !== envs.length) throw new Error(`Expected ${envs.length} actions, got ${actions.length}.`);
      reply({ steps: envs.map((env, e) => encode(e, env.step(actions[e]))) });
      break;
    }
    case 'close':
      process.exit(0);
      break;
    default:
      throw new Error(`Unknown request ${request.op}.`);
  }
}
