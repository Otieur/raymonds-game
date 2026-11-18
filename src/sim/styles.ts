/**
 * The named schools of play: plain styles, styles composed of other schools' parts, and playbooks.
 * Each is the baseline with the changes listed in docs/plan/m02-schools.md. The values are first
 * guesses meant to produce a recognisable behaviour; the style search looks for better ones.
 */
import type { Engine } from '../engine/engine.ts';
import type { Action, GameEvent, GameState, PlayerId } from '../types.ts';
import { compose } from './parts.ts';
import { choosePlaybookAction, resolvePlaybook } from './playbook.ts';
import type { Playbook, Rule } from './playbook.ts';
import { BASELINE, CHEAP, DEAR, SETS, styleFrom } from './style.ts';
import type { SetId, Style } from './style.ts';
import { createStyleMemory, decide, observe } from './style-agent.ts';

export interface Preset {
  name: string;
  family: 'buy' | 'build' | 'cash' | 'bid' | 'trade' | 'whole';
  sizes: (2 | 3 | 4)[];
  /** Where the idea comes from: P this plan, A the author's style, S1 to S4 the sources of M2. */
  from: string;
  describe: string;
  playbook: Playbook;
}

const ALL: (2 | 3 | 4)[] = [2, 3, 4];
const LARGE: (2 | 3 | 4)[] = [3, 4];

const sets = (value: number, which: readonly SetId[] = SETS): Partial<Record<SetId, number>> =>
  Object.fromEntries(which.map((set) => [set, value]));

/** Style changes for each plain school. */
const STYLES: Record<string, { family: Preset['family']; sizes?: (2 | 3 | 4)[]; from: string; describe: string; changes: Partial<Style> }> = {
  baseline: { family: 'buy', from: 'P', describe: "Today's rule-based agent. Buys whatever it can afford.", changes: {} },
  'cheap-side': {
    family: 'buy', from: 'S1', describe: 'Only the first two sides of the board.',
    changes: { buy: sets(0, DEAR) as Style['buy'], bidCap: sets(0, DEAR) as Style['bidCap'] },
  },
  'dear-side': {
    family: 'buy', from: 'S1', describe: 'Only the last two sides of the board.',
    changes: { buy: sets(0, CHEAP) as Style['buy'], bidCap: sets(0, CHEAP) as Style['bidCap'] },
  },
  'warm-sides': {
    family: 'buy', from: 'A, S3', describe: 'Prefers the two sides landed on most.',
    changes: { prefer: sets(1.4, ['yuan', 'wei', 'shu', 'wu']), buy: sets(0.8, ['han', 'chain', 'conquest', 'sima', 'passes', 'works']) as Style['buy'] },
  },
  sniper: {
    family: 'buy', from: 'S4', describe: 'Buys only what completes or blocks a group; always the passes; never the works.',
    changes: { buy: { ...sets(0.5, ['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima']), passes: 1, works: 0 } as Style['buy'] },
  },
  prestige: {
    family: 'buy', from: 'S2', describe: 'The passes and House of Sima first.',
    changes: { prefer: { passes: 1.5, sima: 1.6 }, buy: { works: 0.5 } as Style['buy'] },
  },
  'orange-and-sky': {
    family: 'buy', from: 'S2', describe: 'The passes, Cao Wei and Chain Stratagem first.',
    changes: { prefer: { passes: 1.3, wei: 1.5, chain: 1.5 } },
  },
  'pass-baron': {
    family: 'buy', from: 'P, S1', describe: 'Passes above everything; streets mostly to block.',
    changes: {
      buy: { ...sets(0.8, ['han', 'chain', 'yuan', 'wei', 'shu', 'wu', 'conquest', 'sima', 'works']), passes: 1 } as Style['buy'],
      bidCap: { passes: 2.5 } as Style['bidCap'],
      neverSell: ['passes'],
      buildTarget: 3,
    },
  },
  'land-grabber': {
    family: 'buy', from: 'P', describe: 'Buys everything and mortgages to keep buying.',
    changes: { mortgageToBuy: true, buyKeep: 0, reserve: 50 },
  },
  'three-and-hold': {
    family: 'build', from: 'P, S1, S4', describe: 'Every group to three buildings, then cash.',
    changes: { buildTarget: 3, buildBeyond: null, reserveThreat: 1 },
  },
  rusher: {
    family: 'build', from: 'P', describe: 'The cheap groups, built up at once, everything else mortgaged to pay.',
    changes: { buy: { ...sets(1, CHEAP), ...sets(0.5, DEAR) } as Style['buy'], mortgageToBuild: true, reserve: 50, reserveBuilt: 100 },
  },
  'all-in': {
    family: 'build', from: 'S1', describe: 'No spare cash, ever: everything into buildings.',
    changes: { reserve: 0, reserveBuilt: 0, mortgageToBuild: true, jailStay: 0.5 },
  },
  slumlord: {
    family: 'build', from: 'S3', describe: 'Han Court and Chain Stratagem to a fortress as early as possible.',
    changes: { buy: { ...sets(0.5), han: 1, chain: 1 } as Style['buy'], completeFactor: 3, mortgageToBuild: true },
  },
  concentrator: {
    family: 'build', from: 'S3', describe: 'One group to four before the next gets anything.',
    changes: { buildSpread: 'one', buildTarget: 4 },
  },
  ambusher: {
    family: 'build', from: 'S3', describe: 'Holds its cash until a rival is within one roll of its group, then builds.',
    changes: { buildNear: 12, reserve: 100 },
  },
  cornerer: {
    family: 'build', from: 'P, S3', describe: 'Stops at four farmsteads to run the bank out of buildings.',
    changes: { holdHouses: true, buildTarget: 4 },
  },
  hoarder: {
    family: 'cash', from: 'P, S1', describe: 'A large reserve, few purchases early, strong bids late.',
    changes: { reserve: 400, reserveBuilt: 600, buy: sets(0.8) as Style['buy'], bidCap: sets(1.1) as Style['bidCap'] },
  },
  turtle: {
    family: 'cash', from: 'S3, S4', describe: 'A reserve that grows with the danger ahead; stays in jail once rivals build.',
    changes: { reserve: 300, reserveBuilt: 500, reserveThreat: 1, jailStayBuilt: true, buildTarget: 3 },
  },
  shark: {
    family: 'bid', from: 'P', describe: 'Declines at list price and buys at auction.',
    changes: { buy: sets(0.5) as Style['buy'], bidCap: sets(1) as Style['bidCap'], reserve: 100 },
  },
  driver: {
    family: 'bid', sizes: LARGE, from: 'S3', describe: 'Bids rivals up on what they need.',
    changes: { driveUp: 0.8 },
  },
  vulture: {
    family: 'bid', from: 'S3', describe: 'Waits for others to run short, then buys cheaply.',
    changes: { declinePoor: 1.5, distressOffers: true, reserve: 300 },
  },
  refuser: { family: 'trade', from: 'P', describe: 'Rejects every offer. Still makes offers.', changes: { acceptMargin: Infinity } },
  hermit: { family: 'trade', from: 'S1', describe: 'No deal of any kind.', changes: { acceptMargin: Infinity, proposeRate: 0 } },
  'open-hand': {
    family: 'trade', from: 'S1', describe: 'Takes nearly any offer. A weak opponent on purpose.',
    changes: { acceptMargin: 0.8, completionPenalty: 0 },
  },
  blocker: {
    family: 'trade', from: 'P', describe: 'Never sells a street somebody needs; bids to deny.',
    changes: { completionPenalty: 5, blockBonus: 2, acceptMargin: 1.5 },
  },
  dealer: {
    family: 'trade', from: 'P, S3', describe: 'Proposes often, swaps property, accepts fair deals.',
    changes: { swaps: true, acceptMargin: 1, offerLow: 1.5, offerHigh: 2.5 },
  },
  'big-spender': {
    family: 'trade', from: 'S1', describe: 'Pays up to three times the price for the street that completes a group.',
    changes: { offerLow: 2.5, offerHigh: 3.5, completeFactor: 3.5 },
  },
  squeezer: {
    family: 'trade', from: 'A, S3', describe: 'Sells the last street of a group to a rival who then cannot afford to build.',
    changes: { sellOffers: true, leaveCash: 1, offerHigh: 3 },
  },
  icebreaker: {
    family: 'trade', sizes: LARGE, from: 'S3', describe: 'Pays more when the table stops trading.',
    changes: { moodWindow: 8, moodFloor: 0.15, blockMode: { offerLow: 2.5, offerHigh: 3.5, acceptMargin: 0.9 } },
  },
  leveller: { family: 'trade', sizes: LARGE, from: 'P', describe: 'No deal with the leader.', changes: { shunLeader: true, swaps: true } },
  kingmaker: {
    family: 'trade', sizes: LARGE, from: 'S3', describe: 'Sells out to the weakest rival once it cannot win.',
    changes: { giveUpBelow: 0.05, sellOffers: true },
  },
  reference: {
    family: 'whole', from: 'A', describe: "The project author's style: reads the table and changes plan.",
    changes: {
      buy: { ...sets(1), works: 0, conquest: 0 } as Style['buy'],
      bidCeiling: { han: 250, chain: 250, yuan: 350, wei: 350, shu: 400, wu: 350, sima: 550, passes: 450, conquest: 0, works: 0 },
      bidCap: sets(3) as Style['bidCap'],
      prefer: { wei: 1.2, shu: 1.15, yuan: 1.15, chain: 1.1 },
      buildTarget: 3,
      buildBeyond: 600,
      buildOrder: 'landing',
      mortgageToBuild: true,
      reserve: 200,
      reserveBuilt: 200,
      reserveThreat: 0.5,
      swaps: true,
      leaveCash: 4,
      moodWindow: 8,
      moodFloor: 0.15,
      blockMode: {
        buy: { ...sets(0.8), passes: 1, works: 0, conquest: 0 } as Style['buy'],
        completionPenalty: 99,
        neverSell: ['passes'],
      },
    },
  },
  'two-stage': {
    family: 'whole', from: 'S4', describe: 'A cheap group first, then a dear one paid for by it.',
    changes: {
      buy: { ...sets(1, CHEAP), passes: 1, ...sets(0.5, DEAR), works: 0 } as Style['buy'],
      swaps: true,
      buildTarget: 3,
      afterFirstGroup: { prefer: { shu: 1.5, wu: 1.5, sima: 1.5 }, buy: { ...sets(1, DEAR) } as Style['buy'] },
    },
  },
  duelist: {
    family: 'whole', sizes: [2], from: 'P', describe: 'With one rival: never lets a property go cheaply at auction, never helps the only opponent.',
    changes: { bySize: { 2: { bidCap: sets(1.3) as Style['bidCap'], buyKeep: 0, mortgageToBuy: true, acceptMargin: Infinity } } },
  },
};

const plain: Record<string, Style> = Object.fromEntries(Object.entries(STYLES).map(([name, spec]) => [name, styleFrom(name, spec.changes)]));

/** A plain school by name, for composing and for playbooks. */
export function school(name: string): Style {
  const style = plain[name];
  if (!style) throw new Error(`No school named ${name}.`);
  return style;
}

const OPPORTUNIST_RULES: Rule[] = [
  { name: 'opening', when: [{ signal: 'owned', is: '<', value: 0.6 }], take: [{ part: 'buy', from: 'land-grabber' }], hold: 0 },
  { name: 'build out', when: [{ signal: 'unbuilt', is: '>=', value: 1 }], take: [{ part: 'build', from: 'all-in' }, { part: 'cash', from: 'all-in' }], hold: 2 },
  {
    name: 'under threat',
    when: [{ signal: 'rivalLevel', is: '>=', value: 3 }, { signal: 'danger', is: '>=', value: 0.5 }],
    take: [{ part: 'cash', from: 'turtle' }],
    hold: 2,
  },
  { name: 'frozen table', when: [{ signal: 'mood', is: '<', value: 0.15 }], take: [{ part: 'answer', from: 'blocker' }, { part: 'buy', from: 'pass-baron' }], hold: 6 },
  {
    name: 'one short',
    when: [{ signal: 'needs', is: '>=', value: 1 }, { signal: 'mood', is: '>=', value: 0.15 }],
    take: [{ part: 'offer', from: 'big-spender' }],
    hold: 0,
  },
  { name: 'ambush', when: [{ signal: 'rivalNear', is: '=', value: 1 }, { signal: 'groups', is: '>=', value: 1 }], set: { buildTarget: 5, buildBeyond: 0 }, hold: 0 },
  { name: 'shortage', when: [{ signal: 'bankHouses', is: '<', value: 8 }, { signal: 'groups', is: '>=', value: 1 }], set: { holdHouses: true }, hold: 4 },
  {
    name: 'ahead',
    when: [{ signal: 'rank', is: '=', value: 1 }, { signal: 'chance', is: '>=', value: 1.5 }],
    take: [{ part: 'answer', from: 'refuser' }, { part: 'cash', from: 'hoarder' }],
    hold: 3,
  },
  {
    name: 'behind',
    when: [{ signal: 'chance', is: '<', value: 0.5 }, { signal: 'players', is: '>=', value: 3 }],
    take: [{ part: 'offer', from: 'dealer' }, { part: 'build', from: 'all-in' }],
    hold: 3,
  },
  {
    name: 'heads up',
    when: [{ signal: 'players', is: '=', value: 2 }],
    take: [{ part: 'answer', from: 'refuser' }, { part: 'bid', from: 'shark' }, { part: 'buy', from: 'land-grabber' }],
    hold: 99,
  },
];

const COMPOSED: Record<string, { describe: string; style: Style }> = {
  'sky-rush': {
    describe: 'Buys and values like Orange and sky, builds and keeps cash like All in, answers like Blocker.',
    style: compose(BASELINE, { buy: plain['orange-and-sky'], value: plain['orange-and-sky'], build: plain['all-in'], cash: plain['all-in'], answer: plain.blocker }, 'sky-rush'),
  },
  'iron-bank': {
    describe: 'Buys like Pass baron, keeps cash like Hoarder, bids like Vulture, answers like Refuser.',
    style: compose(BASELINE, { buy: plain['pass-baron'], cash: plain.hoarder, bid: plain.vulture, answer: plain.refuser }, 'iron-bank'),
  },
};

export const PRESETS: Record<string, Preset> = {
  ...Object.fromEntries(
    Object.entries(STYLES).map(([name, spec]) => [
      name,
      { name, family: spec.family, sizes: spec.sizes ?? ALL, from: spec.from, describe: spec.describe, playbook: { name, base: plain[name], rules: [] } },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(COMPOSED).map(([name, spec]) => [
      name,
      { name, family: 'whole' as const, sizes: ALL, from: 'P', describe: spec.describe, playbook: { name, base: spec.style, rules: [] } },
    ]),
  ),
  opportunist: {
    name: 'opportunist',
    family: 'whole',
    sizes: ALL,
    from: 'P',
    describe: 'A playbook of ten rules: holds no plan longer than the position supports it.',
    playbook: { name: 'opportunist', base: styleFrom('opportunist', { valuation: 'v1', buildTarget: 3 }), rules: OPPORTUNIST_RULES },
  },
};

/** An agent for one seat of one game, playing a preset. */
export interface SeatAgent {
  choose(engine: Engine, state: GameState, actor: PlayerId, random: () => number): Action | null;
  observe(events: GameEvent[], state: GameState): void;
  /** For a playbook: every rule that has come on in this game, and the rules on at its last decision. */
  rules(): { ever: string[]; last: string[] };
}

export function presetAgent(name: string): SeatAgent {
  const preset = PRESETS[name];
  if (!preset) throw new Error(`No preset named ${name}.`);
  const memory = createStyleMemory();
  const ever = new Set<string>();
  let last: string[] = [];
  return {
    choose: (engine, state, actor, random) => {
      if (!engine.awaiting(state).includes(actor)) return null;
      if (preset.playbook.rules.length === 0) return choosePlaybookAction(engine, state, actor, random, preset.playbook, memory, school);
      const { style, on } = resolvePlaybook(engine, state, actor, preset.playbook, memory, school);
      last = on;
      for (const rule of on) ever.add(rule);
      return decide(engine, state, actor, random, style, memory);
    },
    observe: (events, state) => observe(memory, events, state),
    rules: () => ({ ever: [...ever], last }),
  };
}
