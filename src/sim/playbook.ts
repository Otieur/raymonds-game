/**
 * Playbooks: a base style and an ordered list of rules. At every decision the agent computes the
 * signals of the position and walks the rules; a rule that holds swaps in parts from other schools
 * or sets fields outright. A rule stays on for `hold` of the seat's own turns after it last held,
 * so that a plan does not flicker when a signal hovers at a threshold.
 */
import type { Engine } from '../engine/engine.ts';
import type { Action, GameState, PlayerId } from '../types.ts';
import { compose } from './parts.ts';
import type { Part } from './parts.ts';
import type { Signals } from './signals.ts';
import { signalsOf } from './signals.ts';
import { applyChanges } from './style.ts';
import type { Style } from './style.ts';
import { decide, resolveStyle } from './style-agent.ts';
import type { StyleMemory } from './style-agent.ts';

export interface Condition {
  signal: keyof Signals;
  is: '<' | '>=' | '=';
  value: number;
}

export interface Rule {
  name: string;
  when: Condition[];
  take?: { part: Part; from: string }[];
  set?: Partial<Style>;
  hold: number;
}

export interface Playbook {
  name: string;
  base: Style;
  rules: Rule[];
}

const holdsNow = (signals: Signals, condition: Condition) => {
  const value = signals[condition.signal];
  if (condition.is === '<') return value < condition.value;
  if (condition.is === '>=') return value >= condition.value;
  return value === condition.value;
};

/** The rules that are on, and the style in force, for `actor` now. Records which rules held. */
export function resolvePlaybook(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  playbook: Playbook,
  memory: StyleMemory,
  schools: (name: string) => Style,
): { style: Style; on: string[] } {
  let style = resolveStyle(engine, state, actor, playbook.base, memory);
  if (playbook.rules.length === 0) return { style, on: [] };
  const signals = signalsOf(engine, state, actor, memory, style.buildTarget, style.moodWindow || 8);
  const turn = memory.ownTurns[actor] ?? 0;
  const held = (memory.ruleHeld[actor] ??= {});
  const on: string[] = [];
  for (const rule of playbook.rules) {
    const now = rule.when.every((condition) => holdsNow(signals, condition));
    if (now) held[rule.name] = turn;
    const last = held[rule.name];
    if (!now && (last === undefined || turn - last > rule.hold)) continue;
    on.push(rule.name);
    if (rule.take && rule.take.length > 0) {
      const parts: Partial<Record<Part, Style>> = {};
      for (const { part, from } of rule.take) parts[part] = schools(from);
      style = compose(style, parts, style.name);
    }
    if (rule.set) style = applyChanges(style, rule.set);
  }
  return { style, on };
}

/** Chooses for `actor` by a playbook. */
export function choosePlaybookAction(
  engine: Engine,
  state: GameState,
  actor: PlayerId,
  random: () => number,
  playbook: Playbook,
  memory: StyleMemory,
  schools: (name: string) => Style,
): Action | null {
  if (!engine.awaiting(state).includes(actor)) return null;
  const { style } = resolvePlaybook(engine, state, actor, playbook, memory, schools);
  return decide(engine, state, actor, random, style, memory);
}
