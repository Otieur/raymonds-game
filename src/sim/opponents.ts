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
 */
import { memberAgent } from './league.ts';
import { PRESETS } from './styles.ts';
import type { SeatAgent } from './styles.ts';

export interface Label {
  zh: string;
  en: string;
}

export type Mode = 'regular' | 'short';

export interface Opponent {
  id: string;
  /** 1 to 4 where known; null for a character the league report has not placed yet. */
  level: 1 | 2 | 3 | 4 | null;
  sizes: (2 | 3 | 4)[];
  modes: Mode[];
  name: Label;
  describe: Label;
  /** An agent for one seat of one game; a learned opponent may need to load its model first. */
  create(): SeatAgent | Promise<SeatAgent>;
}

/** The lines of succession as `assets/lines.json` stores them; only the holders are read. */
export interface Lines {
  lines: Record<string, { holder: string }>;
}

/** A model shipped with the client for a line (such as `main-2`), and how to make its agent. */
export interface ShippedModel {
  create(): Promise<SeatAgent>;
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
      name: { zh: '寻优之将', en: 'The searched style' },
      describe: { zh: '程序在数万局对局里为这个人数搜出的最强打法。', en: 'The strongest style the search found for this table size, over tens of thousands of games.' },
      create: () => memberAgent(style),
    });
  }
  const learned = models[`main-${size}`];
  if (learned && mode === 'regular') {
    out.push({
      id: `main-${size}`,
      level: 4,
      sizes: [size],
      modes: ['regular'],
      name: { zh: '深思', en: 'The learned player' },
      describe: {
        zh: '神经网络自己下了几千万步练出来的；交易暂由常规打法代提。',
        en: 'A network trained over tens of millions of moves; its offers are still made by the standard player.',
      },
      create: () => learned.create(),
    });
  }
  return out;
}

/** The opponent with this id at a table of `size` in `mode`, or the default when it cannot sit there. */
export function opponentFor(id: string | undefined, size: 2 | 3 | 4, mode: Mode, lines: Lines, models: Record<string, ShippedModel> = {}): Opponent {
  const offered = opponentsFor(size, mode, lines, models);
  return offered.find((o) => o.id === id) ?? offered[0];
}
