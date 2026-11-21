/**
 * The opponents a player can choose for a computer seat (M10): a name and a line of description in
 * both languages, a level where one is known, the table sizes and game modes it plays, and how to
 * make its agent for one seat of one game.
 *
 * Level 1 is today's rule-based agent, the default, so a game set up as before plays as before.
 * Named schools are offered as characters without a level until the league report assigns one.
 * Level 3 is the holder of the table size's style line, and level 4 the holder of its main line
 * when a model of it is shipped with the client; both come from `assets/lines.json`, so only a
 * holder is ever offered.
 *
 * An opponent's agent may answer with a promise: a learned one runs its network off the main thread
 * in the client.
 */
import type { Engine } from '../engine/engine.ts';
import type { Action, GameEvent, GameState, PlayerId } from '../types.ts';
import { memberAgent } from './league.ts';
import { PRESETS } from './styles.ts';

export interface Label {
  zh: string;
  en: string;
}

export type Mode = 'regular' | 'short';

/** What the client tells an agent beyond the engine it is handed. */
export interface AskLimits {
  /** The seats this one may not ask again this turn; the engine it is handed already leaves them out. */
  blocked: readonly PlayerId[];
}

/** A seat agent as the client uses it: `SeatAgent` is one, and so is an agent that answers later. */
export interface OpponentAgent {
  choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number, limits?: AskLimits): Action | null | Promise<Action | null>;
  observe(events: GameEvent[], state: GameState): void;
  /** At a rival's debt: an offer to the debtor, if the seat makes one (see `src/sim/window.ts`). */
  window?(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null | Promise<Action | null>;
  /** Releases what the agent holds, such as a worker, when its game is left or it is replaced. */
  dispose?(): void;
  /** For a playbook: every rule that has come on in this game, and the rules on at its last decision. */
  rules?(): { ever: string[]; last: string[] };
}

export interface Opponent {
  id: string;
  /** 1 to 4 where known; null for a character the league report has not placed yet. */
  level: 1 | 2 | 3 | 4 | null;
  sizes: (2 | 3 | 4)[];
  modes: Mode[];
  name: Label;
  describe: Label;
  /** For a learned opponent, the member its model was exported from, which a saved game records. */
  version?: string;
  /** An agent for one seat of one game; a learned opponent may need to load its model first. */
  create(): OpponentAgent | Promise<OpponentAgent>;
}

/** The lines of succession as `assets/lines.json` stores them; only the holders are read. */
export interface Lines {
  lines: Record<string, { holder: string }>;
}

/**
 * A model shipped with the client for a line (such as `main-2`): the member it was exported from, as
 * the line names it, and how to make its agent. It is offered only while that member holds the line.
 */
export interface ShippedModel {
  holder: string;
  /** `query` is what follows the `?` in the holder's name (see `learnedOptions`). */
  create(query: string, mode: Mode): Promise<OpponentAgent>;
}

export const DEFAULT_OPPONENT = 'rules';

const BOTH: Mode[] = ['regular', 'short'];

/** Named schools offered as characters: a preset each, with its names. */
const CHARACTERS: { preset: string; name: Label; describe: Label }[] = [
  {
    preset: 'reference-3',
    name: { zh: '作者流', en: "The author's style" },
    describe: {
      zh: '仿作者本人的打法：看局势换计划，提早求购要地，抢领先者要的地，与弱者结盟。',
      en: "Plays like the game's author: changes plan with the table, asks early, denies the leader, allies with the weak.",
    },
  },
  {
    preset: 'pass-baron',
    name: { zh: '关隘大亨', en: 'The pass baron' },
    describe: { zh: '关隘重于一切，买街道多半只为卡位。', en: 'Passes above everything; buys streets mostly to block.' },
  },
  {
    preset: 'blocker',
    name: { zh: '卡位者', en: 'The blocker' },
    describe: { zh: '别人缺的地绝不卖，竞拍专为截胡。', en: 'Never sells a street someone needs; bids to deny.' },
  },
  {
    preset: 'dealer',
    name: { zh: '掮客', en: 'The dealer' },
    describe: { zh: '常提交易，以地换地，公平就成交。', en: 'Proposes often, swaps property, accepts fair deals.' },
  },
  {
    preset: 'opportunist',
    name: { zh: '投机者', en: 'The opportunist' },
    describe: { zh: '十条随机应变的规则，局势一变就换计划。', en: 'Ten rules; holds no plan longer than the position supports it.' },
  },
  {
    preset: 'statesman-book-2',
    name: { zh: '纵横家', en: 'The statesman' },
    describe: {
      zh: '合纵连横：给弱者好价钱，对领先者要高价，用交易示好结盟。',
      en: 'Gives the weak good terms, prices the leader high, and makes alliances by its offers.',
    },
  },
];

/** Every opponent that can sit at a table of `size` in `mode`. */
export function opponentsFor(size: 2 | 3 | 4, mode: Mode, lines: Lines, models: Record<string, ShippedModel> = {}): Opponent[] {
  const out: Opponent[] = [
    {
      id: DEFAULT_OPPONENT,
      level: 1,
      sizes: [2, 3, 4],
      modes: BOTH,
      name: { zh: '常规', en: 'Standard' },
      describe: { zh: '游戏原有的电脑打法。', en: "The game's built-in computer player." },
      create: () => memberAgent('rules'),
    },
  ];
  for (const c of CHARACTERS) {
    const preset = PRESETS[c.preset];
    if (!preset || !preset.sizes.includes(size)) continue;
    out.push({ id: `school-${c.preset}`, level: null, sizes: preset.sizes, modes: BOTH, name: c.name, describe: c.describe, create: () => memberAgent(c.preset) });
  }
  const style = lines.lines[`style-${size}`]?.holder;
  if (style && style !== 'baseline' && !style.startsWith('model:')) {
    out.push({
      id: `style-${size}`,
      level: 3,
      sizes: [size],
      modes: BOTH,
      name: { zh: '寻优之将', en: 'The optimiser' },
      describe: { zh: '程序在数万局对局里为这个人数搜出的最强打法。', en: 'The strongest style the search found for this table size, over tens of thousands of games.' },
      create: () => memberAgent(style),
    });
  }
  const main = lines.lines[`main-${size}`]?.holder;
  const learned = models[`main-${size}`];
  if (learned && main?.startsWith('model:') && learned.holder === main && mode === 'regular') {
    const query = main.split('?')[1] ?? '';
    out.push({
      id: `main-${size}`,
      level: 4,
      sizes: [size],
      modes: ['regular'],
      version: learned.holder,
      name: { zh: '深思', en: 'The learned player' },
      describe: {
        zh: '神经网络自己下了几千万步练出来的；交易暂由常规打法代提。',
        en: 'A network trained over tens of millions of moves; its offers are still made by the standard player.',
      },
      create: () => learned.create(query, mode),
    });
  }
  return out;
}

/** The level an opponent's id stands for, whether or not it can be offered here. */
function levelOf(id: string): number | null {
  if (id === DEFAULT_OPPONENT) return 1;
  if (id.startsWith('style-')) return 3;
  if (id.startsWith('main-')) return 4;
  return null;
}

/**
 * The opponent with this id at a table of `size` in `mode`. One that cannot sit there gives way to
 * the offered opponent of the nearest level at or below its own (a saved game's learned opponent the
 * build no longer carries becomes the style line's holder), and a character to the default.
 */
export function opponentFor(id: string | undefined, size: 2 | 3 | 4, mode: Mode, lines: Lines, models: Record<string, ShippedModel> = {}): Opponent {
  const offered = opponentsFor(size, mode, lines, models);
  const exact = offered.find((o) => o.id === id);
  if (exact) return exact;
  const level = id ? levelOf(id) : null;
  if (level === null) return offered[0];
  const below = offered.filter((o) => o.level !== null && o.level <= level);
  return below.reduce((best, o) => ((o.level ?? 0) > (best.level ?? 0) ? o : best), offered[0]);
}
