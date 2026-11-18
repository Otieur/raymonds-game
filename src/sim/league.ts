/**
 * The league: every agent everything is measured against, by name.
 */
import { chooseHeuristicAction, createAgentMemory } from './heuristic-agent.ts';
import { choosePlaybookAction, resolvePlaybook } from './playbook.ts';
import type { Playbook } from './playbook.ts';
import { chooseRandomAction } from './random-agent.ts';
import { createStyleMemory, decide, observe } from './style-agent.ts';
import { FOUND } from './styles-found.ts';
import { PRESETS, presetAgent, school } from './styles.ts';
import type { SeatAgent } from './styles.ts';

export interface FoundStyle {
  name: string;
  size: 2 | 3 | 4;
  playbook: Playbook;
  /** Styles its rules take parts from that are not presets, by name. */
  sources?: Record<string, import('./style.ts').Style>;
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
  };
}

/** A fresh agent for one seat of one game. */
export function memberAgent(name: string): SeatAgent {
  if (name === 'random') return { choose: (engine, state, actor, random) => chooseRandomAction(engine, state, random, actor), ...silent };
  if (name === 'rules') {
    const memory = createAgentMemory();
    return { choose: (engine, state, actor, random) => chooseHeuristicAction(engine, state, actor, random, memory), ...silent };
  }
  if (PRESETS[name]) return presetAgent(name);
  const found = FOUND.find((f) => f.name === name);
  if (found) return playbookAgent(found.playbook, found.sources);
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
