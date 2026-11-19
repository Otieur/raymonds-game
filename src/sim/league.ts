/**
 * The league: every agent everything is measured against, by name.
 */
import type { Engine } from '../engine/engine.ts';
import { createLearnedAgent } from '../env/learned-agent.ts';
import { createMlp } from '../env/mlp.ts';
import type { Mlp, ModelWeights } from '../env/mlp.ts';
import type { GameEvent, GameState } from '../types.ts';
import { chooseHeuristicAction, createAgentMemory } from './heuristic-agent.ts';
import { choosePlaybookAction, resolvePlaybook } from './playbook.ts';
import type { Playbook } from './playbook.ts';
import { chooseRandomAction } from './random-agent.ts';
import { createStyleMemory, debtOfferFor, decide, observe, resolveStyle } from './style-agent.ts';
import { FOUND } from './styles-found.ts';
import { BASELINE, completeStyle, styleFrom, validateStyle } from './style.ts';
import type { Style, StoredStyle } from './style.ts';
import { PRESETS, presetAgent, school } from './styles.ts';
import type { SeatAgent } from './styles.ts';

export interface FoundStyle {
  name: string;
  size: 2 | 3 | 4;
  /** As stored: a style admitted before a field existed lacks it, and is completed with the baseline's value when it plays. */
  playbook: Omit<Playbook, 'base'> & { base: StoredStyle };
  /** Styles its rules take parts from that are not presets, by name. */
  sources?: Record<string, StoredStyle>;
  /** The behaviour descriptors it was filed by, and its scores. */
  record: Record<string, number | string>;
}

export interface Member {
  name: string;
  kind: 'fixed' | 'school' | 'found' | 'learned';
  sizes: (2 | 3 | 4)[];
  describe: string;
}

const silent = { observe: () => {}, rules: () => ({ ever: [], last: [] }) };

export function playbookAgent(playbook: Playbook, sources: Record<string, import('./style.ts').Style> = {}): SeatAgent {
  const memory = createStyleMemory();
  const resolve = (name: string) => sources[name] ?? school(name);
  const ever = new Set<string>();
  let last: string[] = [];
  return {
    choose: (engine, state, actor, random) => {
      if (!engine.awaiting(state).includes(actor)) return null;
      if (playbook.rules.length === 0) return choosePlaybookAction(engine, state, actor, random, playbook, memory, resolve);
      const { style, on } = resolvePlaybook(engine, state, actor, playbook, memory, resolve);
      last = on;
      for (const rule of on) ever.add(rule);
      return decide(engine, state, actor, random, style, memory);
    },
    observe: (events, state) => observe(memory, events, state),
    rules: () => ({ ever: [...ever], last }),
    window: (engine, state, actor) => {
      const style = playbook.rules.length === 0 ? resolveStyle(engine, state, actor, playbook.base, memory) : resolvePlaybook(engine, state, actor, playbook, memory, resolve).style;
      return debtOfferFor(engine, state, actor, style, memory);
    },
  };
}

/**
 * A member name with changes: `balancer+againstLeader=2+forWeak=0.5` is the Balancer with those two
 * fields set. Numbers, true, false and words are understood; the result must validate as a style.
 * For sweeps of a field, so that no preset is needed for every setting.
 */
function variantAgent(name: string): SeatAgent | null {
  const [base, ...changes] = name.split('+');
  if (changes.length === 0) return null;
  const preset = PRESETS[base];
  if (!preset || preset.playbook.rules.length > 0) throw new Error(`Only a plain preset takes changes: ${name}`);
  const set: Record<string, unknown> = {};
  for (const change of changes) {
    const [key, raw] = change.split('=');
    if (!(key in BASELINE) || raw === undefined) throw new Error(`No field ${key} in ${name}`);
    set[key] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  const style = styleFrom(name, set as Partial<Style>, preset.playbook.base);
  const problems = validateStyle(style);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join('; ')}`);
  return playbookAgent({ name, base: style, rules: [] });
}

const models = new Map<string, Mlp>();
let loadModel: ((path: string) => ModelWeights) | null = null;

/** How a model exported by train/export.py is read from its path. Set by the Node scripts (`scripts/model-loader.ts`); the browser has none. */
export function setModelLoader(loader: (path: string) => ModelWeights): void {
  loadModel = loader;
}

/**
 * A learned member, named `model:<path>` after a model exported by train/export.py. It plays as the
 * learners of M6 play: the baseline makes its offers and the network every other decision, greedily.
 * The model is loaded once a process. The agent is made at its first decision, from that game's
 * engine, and is given the events it observed before then.
 */
function modelAgent(name: string): SeatAgent | null {
  if (!name.startsWith('model:')) return null;
  const path = name.slice('model:'.length);
  let mlp = models.get(path);
  if (!mlp) {
    if (!loadModel) throw new Error(`No model loader in this process for ${name}; import scripts/model-loader.ts.`);
    mlp = createMlp(loadModel(path));
    models.set(path, mlp);
  }
  const model = mlp;
  let agent: SeatAgent | null = null;
  const early: [GameEvent[], GameState][] = [];
  const ready = (engine: Engine): SeatAgent => {
    if (!agent) {
      agent = createLearnedAgent(model, engine, { proposer: PRESETS.baseline.playbook.base, greedy: true });
      for (const [events, state] of early.splice(0)) agent.observe(events, state);
    }
    return agent;
  };
  return {
    choose: (engine, state, actor, random) => ready(engine).choose(engine, state, actor, random),
    observe: (events, state) => {
      if (agent) agent.observe(events, state);
      else early.push([events, state]);
    },
    rules: () => ({ ever: [], last: [] }),
  };
}

/** A fresh agent for one seat of one game. */
export function memberAgent(name: string): SeatAgent {
  const learned = modelAgent(name);
  if (learned) return learned;
  const variant = variantAgent(name);
  if (variant) return variant;
  if (name === 'random') return { choose: (engine, state, actor, random) => chooseRandomAction(engine, state, random, actor), ...silent };
  if (name === 'rules') {
    const memory = createAgentMemory();
    return { choose: (engine, state, actor, random) => chooseHeuristicAction(engine, state, actor, random, memory), ...silent };
  }
  if (PRESETS[name]) return presetAgent(name);
  const found = FOUND.find((f) => f.name === name);
  if (found) {
    const sources = Object.fromEntries(Object.entries(found.sources ?? {}).map(([key, style]) => [key, completeStyle(style)]));
    return playbookAgent({ ...found.playbook, base: completeStyle(found.playbook.base) }, sources);
  }
  throw new Error(`No league member named ${name}.`);
}

/** The league for a table size: the fixed members, the schools meant for it, and the admitted styles. */
export function leagueOf(size: 2 | 3 | 4, options: { schools?: boolean } = {}): Member[] {
  const members: Member[] = [
    { name: 'random', kind: 'fixed', sizes: [2, 3, 4], describe: 'Random legal play.' },
    { name: 'baseline', kind: 'fixed', sizes: [2, 3, 4], describe: "Today's rule-based agent." },
    { name: 'refuser', kind: 'fixed', sizes: [2, 3, 4], describe: 'The baseline, rejecting every offer.' },
  ];
  if (options.schools ?? true) {
    for (const preset of Object.values(PRESETS)) {
      if (preset.name === 'baseline' || preset.name === 'refuser' || !preset.sizes.includes(size)) continue;
      members.push({ name: preset.name, kind: 'school', sizes: preset.sizes, describe: preset.describe });
    }
  }
  for (const found of FOUND) {
    if (found.size === size) members.push({ name: found.name, kind: 'found', sizes: [size], describe: `Found by the search: ${JSON.stringify(found.record)}` });
  }
  return members;
}
