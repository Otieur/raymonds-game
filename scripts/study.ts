/**
 * A study of the game by simulation. It plays a large number of games between the built-in
 * agents on the Three Kingdoms board and prints, as Markdown, what they show about the board,
 * the course of a game, and what winning goes with. The figures in docs/statistics.md come
 * from this script.
 *
 *   node scripts/study.ts                                  2,000 games per main table
 *   node scripts/study.ts 100000                           100,000 games per main table
 *   node scripts/study.ts 100000 --json build/study.json   also saves every tally
 *   node scripts/study.ts 100000 --workers 4               uses four processes
 *   node scripts/study.ts --from build/study.json          prints the report of a saved run
 *   node scripts/study.ts ... --details                    adds the full report of every table
 *
 * The main tables are full games among rule-based players. The short game and the tables of one
 * odd player among ordinary ones get a fifth as many games; the tables where nobody trades,
 * whose games are far longer, a fiftieth. The games are shared out among worker processes; the
 * result does not depend on how many there are, because every game is fixed by its table and
 * its seed.
 */
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../src/context.ts';
import type { Context } from '../src/context.ts';
import { buildingStep, liquidationValue, nextLevel, ownsGroup, rentDue } from '../src/engine/queries.ts';
import {
  chooseHeuristicAction,
  chooseRandomAction,
  createAgentMemory,
  createEngine,
  HOTEL_LEVEL,
  SHORT_GAME_RULES,
  threeKingdoms,
} from '../src/index.ts';
import type {
  Action,
  AgentMemory,
  Engine,
  GameEvent,
  GameState,
  GroupId,
  PlayerId,
  PlayerState,
  PropertySquare,
  StreetSquare,
} from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { fitLinear as fit } from '../src/sim/linear.ts';

/** Actions after which an unfinished game is abandoned. */
const ACTION_LIMIT = 40000;
/** Games per job handed to a worker. */
const CHUNK = 200;
/** Rounds (one turn for each player at the table) after which the standing is recorded. */
const SNAPSHOT_ROUNDS = [10, 20, 30, 40, 60, 80, 100];
/** The rounds for which the full standing and the model are printed. */
const MODEL_ROUNDS = [10, 20, 30];
/** Game lengths are counted in buckets of this many turns. */
const TURN_BUCKET = 10;
const TURN_BUCKETS = 400;

/**
 * Who plays a seat. `rules` is the rule-based agent and `random` the random one. The others
 * are the rule-based agent with one habit changed: `no-works` never buys or bids on a works,
 * `no-conquest` never buys or bids on a street of the Conquest of Shu group, `refuser` rejects
 * every trade offered to it, `quiet` never proposes one, and `no-trade` does neither.
 */
type Policy = 'rules' | 'random' | 'no-works' | 'no-conquest' | 'refuser' | 'quiet' | 'no-trade';
type Via = 'purchase' | 'auction' | 'trade' | 'bankruptcy';
type MomentKind = 'soldOut' | 'firstGroup' | 'firstBuilding' | 'firstBankruptcy';

const POLICIES: Policy[] = ['rules', 'random', 'no-works', 'no-conquest', 'refuser', 'quiet', 'no-trade'];
const VIAS: Via[] = ['purchase', 'auction', 'trade', 'bankruptcy'];
const MOMENTS: MomentKind[] = ['soldOut', 'firstGroup', 'firstBuilding', 'firstBankruptcy'];

interface Table {
  key: string;
  label: string;
  engine: Engine;
  ctx: Context;
  seats: Policy[];
  games: number;
  /** Tables of one kind of player get the full report; the others only say who won. */
  detail: boolean;
}

interface Count {
  count: number;
  amount: number;
}

interface KindTally {
  decisions: number;
  legal: number;
  maxLegal: number;
}

interface Moment {
  games: number;
  turns: number;
}

interface GroupTally {
  /** Games in which somebody completed the group. */
  games: number;
  /** The turns on which it was first completed, added up. */
  turns: number;
  /** How the first completer came by the last street. */
  via: Record<Via, number>;
  /** Finished games among those, and how many of them the first completer won. */
  decided: number;
  completerWon: number;
  /** The highest level the group reached, by level. */
  peak: number[];
}

/** Players in some condition, and how many of them went on to win. */
interface Held {
  players: number[];
  won: number[];
}

/** How each measure of a player's standing relates to winning, at one snapshot. */
interface MeasureTally {
  /** Each measure added up over the players who went on to win, and over the rest. */
  winners: number[];
  others: number[];
  /** Games in which the measure told players apart, and the wins of its leader (a tie for the lead shares one win). */
  split: number[];
  credit: number[];
  /** The normal equations of a linear model of winning on each player's share of the table's total. */
  xtx: number[];
  xty: number[];
}

interface SnapshotTally {
  /** Finished games that lasted this long. */
  games: number;
  rows: number;
  wins: number;
  /** What a leader picked at random would win: one over the players left, added up. */
  chance: number;
  property: Held;
  group: Held;
  passes: Held;
  works: Held;
  groups: Held;
  measures: MeasureTally;
  /** The normal equations of a linear model of winning on what a player holds. */
  xtx: number[];
  xty: number[];
}

interface Tally {
  games: number;
  finished: number;
  actions: number;
  /** Player turns begun, in every game. */
  turns: number;
  /** Turns of the finished games, and their distribution. */
  finishedTurns: number;
  turnHistogram: number[];
  wins: Record<Policy, number>;
  winsByPlace: number[];
  kinds: Record<string, KindTally>;
  landings: number[];
  jailSent: Record<string, number>;
  jailLeft: Record<string, number>;
  paid: Record<string, Count>;
  rent: { count: number[]; amount: number[] };
  maxRent: number;
  acquired: Record<Via, { count: number[]; price: number[] }>;
  unsold: number;
  moments: Record<MomentKind, Moment>;
  groups: Record<GroupId, GroupTally>;
  firstGroup: { decided: number; completerWon: number };
  built: number[];
  buildingAuctions: number;
  buildingSales: number;
  mortgages: number;
  redemptions: number;
  trades: { proposed: number; accepted: number; rejected: number; cancelled: number; cash: number; list: number };
  bankruptcies: { toPlayer: number; toBank: number };
  snapshots: Record<string, SnapshotTally>;
}

/** One player's standing at a snapshot. */
interface Row {
  player: PlayerId;
  /** The model's non-zero features and their values. */
  features: number[];
  values: number[];
  properties: number[];
  groups: number[];
  passes: number;
  works: number;
  /** Every measure of standing, in the order of MEASURES. */
  measures: number[];
}

interface Snapshot {
  round: number;
  rows: Row[];
}

/** What is remembered about one game while it is played. */
interface Notes {
  seen: Set<MomentKind>;
  completed: Map<GroupId, PlayerId>;
  firstCompleter: PlayerId | null;
  peak: Map<GroupId, number>;
  snapshots: Snapshot[];
}

interface Job {
  table: number;
  chunk: number;
  from: number;
  to: number;
}

// ---------- Tables ----------

function makeTables(games: number): Table[] {
  const full = createEngine(threeKingdoms);
  const short = createEngine(threeKingdoms, SHORT_GAME_RULES);
  const fewer = Math.max(100, Math.round(games / 5));
  const fewest = Math.max(100, Math.round(games / 50));
  const tables: Table[] = [];
  const add = (key: string, label: string, engine: Engine, seats: Policy[], count: number, detail: boolean) => {
    tables.push({ key, label, engine, ctx: buildContext(engine.board, engine.rules), seats, games: count, detail });
  };
  const all = (policy: Policy, players: number): Policy[] => Array.from({ length: players }, () => policy);
  const oneAmong = (odd: Policy, rest: Policy, players: number): Policy[] => [odd, ...all(rest, players - 1)];
  const sizes = [2, 3, 4];

  for (const n of sizes) add(`full-${n}`, `Full game, ${n} rule-based players`, full, all('rules', n), games, true);
  for (const n of sizes) add(`short-${n}`, `Short game, ${n} rule-based players`, short, all('rules', n), fewer, true);
  for (const n of sizes) {
    add(`no-trade-${n}`, `Full game, ${n} rule-based players who never trade`, full, all('no-trade', n), fewest, true);
  }
  for (const n of sizes) {
    add(`rules-among-random-${n}`, `Full game, one rule-based player among ${n - 1} random`, full, oneAmong('rules', 'random', n), fewer, false);
  }
  for (const n of [3, 4]) {
    add(`random-among-rules-${n}`, `Full game, one random player among ${n - 1} rule-based`, full, oneAmong('random', 'rules', n), fewer, false);
  }
  for (const odd of ['no-works', 'no-conquest', 'refuser', 'quiet'] as const) {
    for (const n of sizes) {
      add(`${odd}-among-rules-${n}`, `Full game, one ${odd} player among ${n - 1} rule-based`, full, oneAmong(odd, 'rules', n), fewer, false);
    }
  }
  return tables;
}

// ---------- Players ----------

function shuns(policy: Policy, square: PropertySquare): boolean {
  if (policy === 'no-works') return square.kind === 'utility';
  if (policy === 'no-conquest') return square.kind === 'street' && square.group === 'conquest';
  return false;
}

function choose(
  policy: Policy,
  table: Table,
  state: GameState,
  actor: PlayerId,
  random: () => number,
  memory: AgentMemory,
): Action | null {
  const { engine, ctx } = table;
  if (policy === 'random') return chooseRandomAction(engine, state, random, actor);
  // Without a memory the rule-based agent proposes nothing.
  const proposes = policy !== 'quiet' && policy !== 'no-trade';
  const action = chooseHeuristicAction(engine, state, actor, random, proposes ? memory : undefined);
  if (!action || policy === 'rules' || policy === 'quiet') return action;
  if (policy === 'refuser' || policy === 'no-trade') {
    return action.type === 'ACCEPT_TRADE' ? { type: 'REJECT_TRADE', player: actor } : action;
  }

  const top = state.pending.at(-1);
  const subject = top && (top.kind === 'buy' || top.kind === 'auction') ? ctx.properties.get(top.property) : undefined;
  if (!subject || !shuns(policy, subject)) return action;
  if (action.type === 'BUY') return { type: 'DECLINE', player: actor };
  if (action.type === 'BID') return { type: 'PASS', player: actor };
  return action;
}

// ---------- Measures of a player's standing ----------

/** Facts about a state that several measures share. */
interface View {
  table: Table;
  state: GameState;
  /** For every set, how many of its properties each player holds. */
  held: Map<string, Map<PlayerId, number>>;
  /** How many properties each set has. */
  sizes: Map<string, number>;
}

/**
 * A way of putting a number on how a player stands. The study records, for each one, how well
 * it tells who will win. To try another, add it to MEASURES.
 */
interface Measure {
  key: string;
  label: string;
  value: (view: View, player: PlayerState) => number;
  /**
   * Whether the measure enters the model of all measures together. The ones that do are chosen
   * not to repeat each other: funds, danger, rent now, rent within reach, rent beyond reach,
   * sets in the making, what rivals want, passes and mortgages.
   */
  together?: boolean;
}

/** The set a property belongs to: its group, the passes, or the works. */
const setOf = (sq: PropertySquare): string => (sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works');

function viewOf(table: Table, state: GameState): View {
  const held = new Map<string, Map<PlayerId, number>>();
  const sizes = new Map<string, number>();
  for (const sq of table.ctx.propertyOrder) {
    const set = setOf(sq);
    sizes.set(set, (sizes.get(set) ?? 0) + 1);
    const owner = state.properties[sq.id].owner;
    if (owner === null) continue;
    const counts = held.get(set) ?? new Map<PlayerId, number>();
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    held.set(set, counts);
  }
  return { table, state, held, sizes };
}

const holds = (view: View, set: string, player: PlayerId) => view.held.get(set)?.get(player) ?? 0;

/** The most properties of a set that any one rival of `player` holds. */
function rivalMost(view: View, set: string, player: PlayerId): number {
  let most = 0;
  for (const [owner, count] of view.held.get(set) ?? []) if (owner !== player && count > most) most = count;
  return most;
}

/** What `player` would owe on each total of two dice thrown from where they stand: the mean and the worst. */
function duesInReach(view: View, player: PlayerState): { expected: number; largest: number } {
  const { ctx } = view.table;
  let expected = 0;
  let largest = 0;
  for (let total = 2; total <= 12; total++) {
    const sq = ctx.board.squares[(player.position + total) % ctx.size];
    let due = 0;
    if (sq.kind === 'tax') due = sq.amount;
    else if (sq.kind === 'street' || sq.kind === 'transit' || sq.kind === 'utility') {
      const owner = view.state.properties[sq.id].owner;
      if (owner !== null && owner !== player.id) due = rentDue(ctx, view.state, sq, { diceTotal: total, nearest: false });
    }
    expected += (due * (6 - Math.abs(7 - total))) / 36;
    largest = Math.max(largest, due);
  }
  return { expected, largest };
}

/** The rent each of a player's properties would charge now, added up (a works at a roll of 7). */
function rentRoll(ctx: Context, state: GameState, player: PlayerId): number {
  let total = 0;
  for (const sq of ctx.propertyOrder) {
    if (state.properties[sq.id].owner === player) total += rentDue(ctx, state, sq, { diceTotal: 7, nearest: false });
  }
  return total;
}

/** The rent roll with every group the player holds built to the top. */
function ceilingRoll(view: View, player: PlayerState): number {
  const { ctx } = view.table;
  let total = 0;
  for (const sq of ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner !== player.id) continue;
    if (sq.kind === 'street' && ownsGroup(ctx, view.state, player.id, sq.group)) total += sq.rents[HOTEL_LEVEL];
    else total += rentDue(ctx, view.state, sq, { diceTotal: 7, nearest: false });
  }
  return total;
}

/**
 * The rent roll the player would have after spending all the cash in hand on buildings, always
 * taking the one that adds most rent per coin and building evenly. The bank's supply is ignored.
 */
function reachRoll(view: View, player: PlayerState): number {
  const { ctx } = view.table;
  const { state } = view;
  const levels = new Map<string, number>();
  const streets: StreetSquare[] = [];
  for (const [group, members] of ctx.groups) {
    if (!ownsGroup(ctx, state, player.id, group) || members.some((sq) => state.properties[sq.id].mortgaged)) continue;
    for (const sq of members) {
      levels.set(sq.id, state.properties[sq.id].level);
      streets.push(sq);
    }
  }
  const rentAt = (sq: StreetSquare, level: number) => (level === 0 ? sq.rents[0] * ctx.rules.groupRentMultiplier : sq.rents[level]);
  let roll = rentRoll(ctx, state, player.id);
  let budget = player.cash;
  for (;;) {
    let best: StreetSquare | undefined;
    let bestGain = 0;
    let bestRate = 0;
    for (const sq of streets) {
      const level = levels.get(sq.id) ?? 0;
      if (level >= HOTEL_LEVEL || sq.buildingCost > budget) continue;
      const lowest = Math.min(...(ctx.groups.get(sq.group) ?? []).map((mate) => buildingStep(ctx, levels.get(mate.id) ?? 0)));
      if (buildingStep(ctx, level) > lowest) continue;
      const gain = rentAt(sq, nextLevel(ctx, level)) - rentAt(sq, level);
      if (gain / sq.buildingCost > bestRate) {
        best = sq;
        bestGain = gain;
        bestRate = gain / sq.buildingCost;
      }
    }
    if (!best) return roll;
    levels.set(best.id, nextLevel(ctx, levels.get(best.id) ?? 0));
    budget -= best.buildingCost;
    roll += bestGain;
  }
}

/** Groups in which the player lacks exactly one street; with `fromRival`, only where a rival holds it. */
function nearSets(view: View, player: PlayerState, fromRival: boolean): number {
  let count = 0;
  for (const [group, members] of view.table.ctx.groups) {
    if (holds(view, group, player.id) !== members.length - 1) continue;
    const missing = members.find((sq) => view.state.properties[sq.id].owner !== player.id);
    if (!fromRival || (missing && view.state.properties[missing.id].owner !== null)) count += 1;
  }
  return count;
}

/** Sets in which the player holds the one property a rival lacks. */
function wanted(view: View, player: PlayerState): number {
  let count = 0;
  for (const [set, size] of view.sizes) {
    if (holds(view, set, player.id) === 1 && rivalMost(view, set, player.id) === size - 1) count += 1;
  }
  return count;
}

/**
 * What the player holds that rivals are collecting, at list price: in full where it is the last
 * property a rival lacks, in part where a rival holds some of the set, not at all otherwise.
 */
function chips(view: View, player: PlayerState): number {
  let total = 0;
  for (const sq of view.table.ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner !== player.id) continue;
    const set = setOf(sq);
    const size = view.sizes.get(set) ?? 1;
    const rival = rivalMost(view, set, player.id);
    if (rival === 0) continue;
    const demand = rival === size - 1 ? 1 : set === 'passes' ? rival / (size - 1) : 0.5;
    total += demand * sq.price;
  }
  return total;
}

function sumOwned(view: View, player: PlayerState, value: (sq: PropertySquare) => number): number {
  let total = 0;
  for (const sq of view.table.ctx.propertyOrder) {
    if (view.state.properties[sq.id].owner === player.id) total += value(sq);
  }
  return total;
}

/** What mortgaging the player's property outside its complete groups would raise. */
function idleMortgages(view: View, player: PlayerState): number {
  const { ctx } = view.table;
  return sumOwned(view, player, (sq) => {
    if (view.state.properties[sq.id].mortgaged) return 0;
    if (sq.kind === 'street' && ownsGroup(ctx, view.state, player.id, sq.group)) return 0;
    return sq.mortgageValue;
  });
}

const spareCash = (view: View, p: PlayerState) => Math.max(0, p.cash - duesInReach(view, p).largest);

const MEASURES: Measure[] = [
  { key: 'netWorth', label: 'Net worth, as the rules count it', value: (view, p) => view.table.engine.netWorth(view.state, p.id) },
  { key: 'cash', label: 'Cash in hand', value: (_view, p) => p.cash },
  { key: 'spare', label: 'Spare cash: above the largest rent within one roll', value: spareCash },
  {
    key: 'disposable',
    label: 'Disposable funds: spare cash plus mortgages on property outside its complete groups',
    value: (view, p) => spareCash(view, p) + idleMortgages(view, p),
    together: true,
  },
  {
    key: 'liquid',
    label: 'Everything it could raise: all mortgaged, all buildings sold',
    value: (view, p) => liquidationValue(view.table.ctx, view.state, p.id),
  },
  {
    key: 'exposure',
    label: 'Danger: rent and tax expected on its next roll',
    value: (view, p) => duesInReach(view, p).expected,
    together: true,
  },
  {
    key: 'rentRoll',
    label: 'Rent roll: what its properties charge now',
    value: (view, p) => rentRoll(view.table.ctx, view.state, p.id),
    together: true,
  },
  {
    key: 'reachGain',
    label: 'Rent it could add at once by building with the cash in hand',
    value: (view, p) => reachRoll(view, p) - rentRoll(view.table.ctx, view.state, p.id),
    together: true,
  },
  { key: 'reachRoll', label: 'Rent roll within reach: now plus what cash could add', value: reachRoll },
  {
    key: 'room',
    label: 'Room to grow beyond that: fully built, less the rent roll within reach',
    value: (view, p) => ceilingRoll(view, p) - reachRoll(view, p),
    together: true,
  },
  { key: 'ceilingRoll', label: 'Rent roll with its groups fully built', value: ceilingRoll },
  {
    key: 'sets',
    label: 'Complete groups',
    value: (view, p) => [...view.table.ctx.groups.keys()].filter((group) => ownsGroup(view.table.ctx, view.state, p.id, group)).length,
  },
  { key: 'nearSets', label: 'Groups one street short', value: (view, p) => nearSets(view, p, false), together: true },
  { key: 'needs', label: 'Groups one street short, the street held by a rival', value: (view, p) => nearSets(view, p, true), together: true },
  { key: 'wanted', label: 'Sets in which it holds the one property a rival lacks', value: wanted, together: true },
  {
    key: 'chips',
    label: 'Trading chips: what it holds that rivals are collecting, at list price',
    value: chips,
    together: true,
  },
  { key: 'passes', label: 'Passes held', value: (view, p) => holds(view, 'passes', p.id), together: true },
  { key: 'properties', label: 'Properties held', value: (view, p) => sumOwned(view, p, () => 1) },
  {
    key: 'buildings',
    label: 'Spent on buildings',
    value: (view, p) =>
      sumOwned(view, p, (sq) => (sq.kind === 'street' ? buildingStep(view.table.ctx, view.state.properties[sq.id].level) * sq.buildingCost : 0)),
  },
  {
    key: 'mortgaged',
    label: 'Property under mortgage, at list price',
    value: (view, p) => sumOwned(view, p, (sq) => (view.state.properties[sq.id].mortgaged ? sq.price : 0)),
    together: true,
  },
];

// ---------- Tallies ----------

const zeros = (length: number): number[] => new Array<number>(length).fill(0);
const held = (length: number): Held => ({ players: zeros(length), won: zeros(length) });

/** The features of the linear model, in order. */
function featureNames(ctx: Context): string[] {
  return [
    '(intercept)',
    ...ctx.propertyOrder.map((sq) => sq.name),
    ...[...ctx.groups.keys()].map((group) => `whole group: ${group}`),
    'two or more passes',
    'three or more passes',
    'all four passes',
    'both works',
    'cash, per starting stake',
    'spent on buildings, per starting stake',
  ];
}

function emptyTally(table: Table): Tally {
  const { ctx } = table;
  const squares = ctx.size;
  const features = featureNames(ctx).length;
  const groups: Record<GroupId, GroupTally> = {};
  for (const group of ctx.groups.keys()) {
    groups[group] = { games: 0, turns: 0, via: { purchase: 0, auction: 0, trade: 0, bankruptcy: 0 }, decided: 0, completerWon: 0, peak: zeros(6) };
  }
  const snapshots: Record<string, SnapshotTally> = {};
  for (const round of SNAPSHOT_ROUNDS) {
    snapshots[String(round)] = {
      games: 0,
      rows: 0,
      wins: 0,
      property: held(ctx.propertyOrder.length),
      group: held(ctx.groups.size),
      passes: held(ctx.transit.length + 1),
      works: held(ctx.utilities.length + 1),
      groups: held(3),
      chance: 0,
      measures: {
        winners: zeros(MEASURES.length),
        others: zeros(MEASURES.length),
        split: zeros(MEASURES.length),
        credit: zeros(MEASURES.length),
        xtx: zeros((MEASURES.length + 1) ** 2),
        xty: zeros(MEASURES.length + 1),
      },
      xtx: zeros(features * features),
      xty: zeros(features),
    };
  }
  const acquired = {} as Tally['acquired'];
  for (const via of VIAS) acquired[via] = { count: zeros(squares), price: zeros(squares) };
  const moments = {} as Tally['moments'];
  for (const moment of MOMENTS) moments[moment] = { games: 0, turns: 0 };
  const wins = {} as Tally['wins'];
  for (const policy of POLICIES) wins[policy] = 0;

  return {
    games: 0,
    finished: 0,
    actions: 0,
    turns: 0,
    finishedTurns: 0,
    turnHistogram: zeros(TURN_BUCKETS),
    wins,
    winsByPlace: zeros(table.seats.length),
    kinds: {},
    landings: zeros(squares),
    jailSent: {},
    jailLeft: {},
    paid: {},
    rent: { count: zeros(squares), amount: zeros(squares) },
    maxRent: 0,
    acquired,
    unsold: 0,
    moments,
    groups,
    firstGroup: { decided: 0, completerWon: 0 },
    built: zeros(squares),
    buildingAuctions: 0,
    buildingSales: 0,
    mortgages: 0,
    redemptions: 0,
    trades: { proposed: 0, accepted: 0, rejected: 0, cancelled: 0, cash: 0, list: 0 },
    bankruptcies: { toPlayer: 0, toBank: 0 },
    snapshots,
  };
}

/** Adds two tallies. Numbers add up, except those named `max…`, which keep the larger. */
function merged(a: unknown, b: unknown, key = ''): unknown {
  if (typeof a === 'number' && typeof b === 'number') return key.startsWith('max') ? Math.max(a, b) : a + b;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((value, i) => merged(value, b[i], key));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [name, value] of Object.entries(b as Record<string, unknown>)) {
      out[name] = name in out ? merged(out[name], value, name) : value;
    }
    return out;
  }
  throw new Error(`The tallies do not match at "${key}".`);
}

const bump = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1;
};

// ---------- One game ----------

function decisionKind(state: GameState): string {
  if (state.turn.phase === 'order') return 'opening roll';
  return state.pending.at(-1)?.kind ?? 'free turn';
}

function rowOf(view: View, player: PlayerState): Row {
  const { ctx } = view.table;
  const { state } = view;
  const stake = ctx.board.economy.startingCash;
  const features = [0];
  const values = [1];
  const properties: number[] = [];
  const groups: number[] = [];
  let passes = 0;
  let works = 0;
  let spent = 0;

  ctx.propertyOrder.forEach((sq, i) => {
    const own = state.properties[sq.id];
    if (own.owner !== player.id) return;
    properties.push(i);
    features.push(1 + i);
    values.push(1);
    if (sq.kind === 'transit') passes += 1;
    else if (sq.kind === 'utility') works += 1;
    else spent += buildingStep(ctx, own.level) * sq.buildingCost;
  });
  let next = 1 + ctx.propertyOrder.length;
  for (const group of ctx.groups.keys()) {
    if (ownsGroup(ctx, state, player.id, group)) {
      groups.push(next - 1 - ctx.propertyOrder.length);
      features.push(next);
      values.push(1);
    }
    next += 1;
  }
  for (const threshold of [2, 3, 4]) {
    if (passes >= threshold) {
      features.push(next);
      values.push(1);
    }
    next += 1;
  }
  if (works >= 2) {
    features.push(next);
    values.push(1);
  }
  features.push(next + 1, next + 2);
  values.push(player.cash / stake, spent / stake);
  const measures = MEASURES.map((measure) => measure.value(view, player));
  return { player: player.id, features, values, properties, groups, passes, works, measures };
}

function snapshotOf(table: Table, state: GameState, round: number): Snapshot {
  const view = viewOf(table, state);
  return { round, rows: state.players.filter((p) => !p.bankrupt).map((p) => rowOf(view, p)) };
}

function note(table: Table, tally: Tally, notes: Notes, state: GameState, event: GameEvent): void {
  const { ctx } = table;
  const turn = state.turn.number;
  const mark = (moment: MomentKind) => {
    if (notes.seen.has(moment)) return;
    notes.seen.add(moment);
    tally.moments[moment].games += 1;
    tally.moments[moment].turns += turn;
  };

  switch (event.type) {
    case 'TURN_STARTED': {
      tally.turns += 1;
      const round = (event.turn - 1) / table.seats.length;
      if (SNAPSHOT_ROUNDS.includes(round)) notes.snapshots.push(snapshotOf(table, state, round));
      return;
    }
    case 'MOVED':
      tally.landings[event.to] += 1;
      return;
    case 'SENT_TO_JAIL':
      tally.landings[ctx.jailIndex] += 1;
      bump(tally.jailSent, event.reason);
      return;
    case 'LEFT_JAIL':
      bump(tally.jailLeft, event.how);
      return;
    case 'PAID': {
      const entry = (tally.paid[event.reason] ??= { count: 0, amount: 0 });
      entry.count += 1;
      entry.amount += event.amount;
      if (event.reason === 'rent' && event.from !== null) {
        const square = state.players.find((p) => p.id === event.from)?.position ?? 0;
        tally.rent.count[square] += 1;
        tally.rent.amount[square] += event.amount;
        tally.maxRent = Math.max(tally.maxRent, event.amount);
      }
      return;
    }
    case 'PROPERTY_ACQUIRED': {
      const index = ctx.squareIndex.get(event.property) ?? 0;
      tally.acquired[event.via].count[index] += 1;
      tally.acquired[event.via].price[index] += event.price;
      if (ctx.propertyOrder.every((sq) => state.properties[sq.id].owner !== null)) mark('soldOut');
      const sq = ctx.properties.get(event.property);
      if (sq?.kind === 'street' && !notes.completed.has(sq.group) && ownsGroup(ctx, state, event.player, sq.group)) {
        notes.completed.set(sq.group, event.player);
        notes.firstCompleter ??= event.player;
        const group = tally.groups[sq.group];
        group.games += 1;
        group.turns += turn;
        group.via[event.via] += 1;
        mark('firstGroup');
      }
      return;
    }
    case 'AUCTION_ENDED':
      if (event.winner === null) tally.unsold += 1;
      return;
    case 'BUILT': {
      tally.built[ctx.squareIndex.get(event.property) ?? 0] += 1;
      const sq = ctx.properties.get(event.property);
      if (sq?.kind === 'street') notes.peak.set(sq.group, Math.max(notes.peak.get(sq.group) ?? 0, event.level));
      mark('firstBuilding');
      return;
    }
    case 'BUILDINGS_SOLD':
      tally.buildingSales += 1;
      return;
    case 'BUILDING_AUCTION_STARTED':
      tally.buildingAuctions += 1;
      return;
    case 'MORTGAGED':
      tally.mortgages += 1;
      return;
    case 'UNMORTGAGED':
      tally.redemptions += 1;
      return;
    case 'TRADE_PROPOSED':
      tally.trades.proposed += 1;
      return;
    case 'TRADE_REJECTED':
      tally.trades.rejected += 1;
      return;
    case 'TRADE_CANCELLED':
      tally.trades.cancelled += 1;
      return;
    case 'TRADE_ACCEPTED':
      tally.trades.accepted += 1;
      tally.trades.cash += event.offer.give.cash;
      for (const id of event.offer.receive.properties) tally.trades.list += ctx.properties.get(id)?.price ?? 0;
      return;
    case 'BANKRUPT':
      if (event.creditor === null) tally.bankruptcies.toBank += 1;
      else tally.bankruptcies.toPlayer += 1;
      mark('firstBankruptcy');
      return;
    default:
      return;
  }
}

function close(tally: Tally, notes: Notes, state: GameState, policyOf: Map<PlayerId, Policy>): void {
  const winner = state.winner;
  for (const [group, peak] of notes.peak) tally.groups[group].peak[peak] += 1;
  for (const group of notes.completed.keys()) {
    if (!notes.peak.has(group)) tally.groups[group].peak[0] += 1;
  }
  if (winner === null) return;

  tally.finished += 1;
  tally.finishedTurns += state.turn.number;
  tally.turnHistogram[Math.min(TURN_BUCKETS - 1, Math.floor(state.turn.number / TURN_BUCKET))] += 1;
  tally.wins[policyOf.get(winner) ?? 'rules'] += 1;
  tally.winsByPlace[state.players.findIndex((p) => p.id === winner)] += 1;

  for (const [group, completer] of notes.completed) {
    tally.groups[group].decided += 1;
    if (completer === winner) tally.groups[group].completerWon += 1;
  }
  if (notes.firstCompleter !== null) {
    tally.firstGroup.decided += 1;
    if (notes.firstCompleter === winner) tally.firstGroup.completerWon += 1;
  }

  const size = tally.snapshots[String(SNAPSHOT_ROUNDS[0])].xty.length;
  for (const snapshot of notes.snapshots) {
    const entry = tally.snapshots[String(snapshot.round)];
    entry.games += 1;
    entry.chance += 1 / snapshot.rows.length;

    const tallied = entry.measures;
    const width = MEASURES.length + 1;
    const totals = MEASURES.map((_, k) => snapshot.rows.reduce((sum, row) => sum + row.measures[k], 0));
    MEASURES.forEach((_, k) => {
      const top = Math.max(...snapshot.rows.map((row) => row.measures[k]));
      const leaders = snapshot.rows.filter((row) => row.measures[k] === top);
      if (leaders.length === snapshot.rows.length) return;
      tallied.split[k] += 1;
      if (leaders.some((row) => row.player === winner)) tallied.credit[k] += 1 / leaders.length;
    });

    for (const row of snapshot.rows) {
      const won = row.player === winner ? 1 : 0;
      entry.rows += 1;
      entry.wins += won;
      const shares = [1, ...row.measures.map((value, k) => (totals[k] > 0 ? value / totals[k] : 0))];
      row.measures.forEach((value, k) => {
        (won ? tallied.winners : tallied.others)[k] += value;
      });
      for (let a = 0; a < width; a++) {
        tallied.xty[a] += shares[a] * won;
        for (let b = 0; b < width; b++) tallied.xtx[a * width + b] += shares[a] * shares[b];
      }
      const tick = (condition: Held, index: number) => {
        condition.players[index] += 1;
        condition.won[index] += won;
      };
      for (const index of row.properties) tick(entry.property, index);
      for (const index of row.groups) tick(entry.group, index);
      tick(entry.passes, row.passes);
      tick(entry.works, row.works);
      tick(entry.groups, Math.min(2, row.groups.length));
      for (let a = 0; a < row.features.length; a++) {
        entry.xty[row.features[a]] += row.values[a] * won;
        for (let b = 0; b < row.features.length; b++) {
          entry.xtx[row.features[a] * size + row.features[b]] += row.values[a] * row.values[b];
        }
      }
    }
  }
}

function playGame(table: Table, seed: number, tally: Tally): void {
  const { engine, seats } = table;
  const ids = seats.map((_, i) => `p${i + 1}`);
  const policyOf = new Map(ids.map((id, i) => [id, seats[i]]));
  const holder = { rng: seedFrom(`study-${table.key}-${seed}`) };
  const random = () => nextFloat(holder);
  const memory = createAgentMemory();
  const notes: Notes = { seen: new Set(), completed: new Map(), firstCompleter: null, peak: new Map(), snapshots: [] };

  let state = engine.newGame({ players: ids, seed });
  let actions = 0;
  while (state.winner === null && actions < ACTION_LIMIT) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];

    if (table.detail) {
      const legal = engine.legalActions(state, actor).length;
      const entry = (tally.kinds[decisionKind(state)] ??= { decisions: 0, legal: 0, maxLegal: 0 });
      entry.decisions += 1;
      entry.legal += legal;
      entry.maxLegal = Math.max(entry.maxLegal, legal);
    }

    const action = choose(policyOf.get(actor) ?? 'rules', table, state, actor, random, memory);
    if (!action) throw new Error(`${table.key}, seed ${seed}: ${actor} has no action. Pending: ${JSON.stringify(state.pending)}`);
    const result = engine.apply(state, action);
    if (!result.ok) {
      throw new Error(`${table.key}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    }
    state = result.state;
    actions += 1;
    for (const event of result.events) note(table, tally, notes, state, event);
  }

  tally.games += 1;
  tally.actions += actions;
  close(tally, notes, state, policyOf);
}

// ---------- Arithmetic ----------

/** A 95% Wilson interval for a share. */
function wilson(wins: number, games: number): [number, number] {
  const z = 1.96;
  const share = wins / games;
  const centre = (share + (z * z) / (2 * games)) / (1 + (z * z) / games);
  const half = (z * Math.sqrt((share * (1 - share)) / games + (z * z) / (4 * games * games))) / (1 + (z * z) / games);
  return [centre - half, centre + half];
}

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function share(wins: number, games: number, digits = 1): string {
  if (games === 0) return 'n/a';
  const [low, high] = wilson(wins, games);
  return `${percent(wins / games, digits)} (${(low * 100).toFixed(digits)} to ${(high * 100).toFixed(digits)})`;
}

/** The turn count below which `fraction` of the finished games ended, to the nearest bucket. */
function quantile(histogram: number[], fraction: number): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (seen >= total * fraction) return i * TURN_BUCKET + TURN_BUCKET / 2;
  }
  return histogram.length * TURN_BUCKET;
}

/** How each measure's share of the table's total moves with winning: the correlation, and the spread of the share. */
function measureMoments(snapshot: SnapshotTally): { correlation: number[]; spread: number[] } {
  const { xtx, xty } = snapshot.measures;
  const width = MEASURES.length + 1;
  const n = snapshot.rows;
  const correlation: number[] = [];
  const spread: number[] = [];
  MEASURES.forEach((_, k) => {
    const sum = xtx[k + 1];
    const squares = xtx[(k + 1) * width + k + 1];
    const variance = squares / n - (sum / n) ** 2;
    const covariance = xty[k + 1] / n - (sum / n) * (snapshot.wins / n);
    const winning = (snapshot.wins / n) * (1 - snapshot.wins / n);
    spread.push(Math.sqrt(Math.max(0, variance)));
    correlation.push(variance > 0 ? covariance / Math.sqrt(variance * winning) : Number.NaN);
  });
  return { correlation, spread };
}

// ---------- The report ----------

function markdown(headers: string[], rows: (string | number)[][]): void {
  console.log(`| ${headers.join(' | ')} |`);
  console.log(`| ${headers.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
  console.log('');
}

const fixed = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');
const perGame = (value: number, tally: Tally, digits = 1) => fixed(value / tally.games, digits);

function reportGames(table: Table, tally: Tally): void {
  const players = table.seats.length;
  const mean = tally.finishedTurns / tally.finished;
  console.log('**Games**\n');
  markdown(
    ['Measure', 'Value'],
    [
      ['Games played', tally.games],
      ['Finished within the action limit', `${tally.finished} (${percent(tally.finished / tally.games, 2)})`],
      ['Turns per game, all games', perGame(tally.turns, tally)],
      ['Turns in a finished game, mean', fixed(mean)],
      ['Rounds in a finished game, mean', fixed(mean / players)],
      ['Turns, 10th percentile', quantile(tally.turnHistogram, 0.1)],
      ['Turns, median', quantile(tally.turnHistogram, 0.5)],
      ['Turns, 90th percentile', quantile(tally.turnHistogram, 0.9)],
      ['Turns, 99th percentile', quantile(tally.turnHistogram, 0.99)],
      ['Actions per game, mean', perGame(tally.actions, tally, 0)],
    ],
  );

  const names: Record<MomentKind, string> = {
    soldOut: 'Every property owned',
    firstGroup: 'First group completed',
    firstBuilding: 'First building',
    firstBankruptcy: 'First bankruptcy',
  };
  console.log('**When things first happen**\n');
  markdown(
    ['Moment', 'Share of games', 'Mean turn', 'Mean round'],
    MOMENTS.map((moment) => {
      const { games, turns } = tally.moments[moment];
      return [names[moment], percent(games / tally.games), fixed(turns / games), fixed(turns / games / players)];
    }),
  );

  console.log('**Wins by place in the order of play**\n');
  markdown(
    ['Place', 'Wins'],
    tally.winsByPlace.map((wins, place) => [place + 1, share(wins, tally.finished)]),
  );
}

function reportDecisions(tally: Tally): void {
  console.log('**Decisions**\n');
  const rows = Object.entries(tally.kinds).sort((a, b) => b[1].decisions - a[1].decisions);
  markdown(
    ['Decision', 'Per game', 'Legal actions, mean', 'Most'],
    rows.map(([kind, entry]) => [kind, perGame(entry.decisions, tally), fixed(entry.legal / entry.decisions), entry.maxLegal]),
  );
}

function reportLandings(table: Table, tally: Tally): number[] {
  const { ctx } = table;
  const squares = ctx.board.squares;
  const rate = tally.landings.map((count) => count / tally.turns);
  console.log('**Landings per player turn**\n');
  markdown(
    ['Square', 'Kind', 'Landings'],
    squares.map((sq, i) => [`${i} ${sq.name}`, sq.kind === 'street' ? sq.group : sq.kind, percent(rate[i], 2)]),
  );
  const sides = [0, 1, 2, 3].map((side) => rate.slice(side * 10 + 1, side * 10 + 10).reduce((a, b) => a + b, 0));
  markdown(
    ['Side one', 'Side two', 'Side three', 'Side four', 'All squares'],
    [[...sides.map((value) => percent(value)), percent(rate.reduce((a, b) => a + b, 0))]],
  );
  return rate;
}

function reportReturns(table: Table, rate: number[]): void {
  const { ctx } = table;
  const multiplier = ctx.rules.groupRentMultiplier;
  console.log('**Return on a complete group, by level** (income is rent expected per turn of one opponent)\n');
  const income: (string | number)[][] = [];
  const marginal: (string | number)[][] = [];
  const payback: (string | number)[][] = [];
  for (const [group, streets] of ctx.groups) {
    const price = streets.reduce((sum, sq) => sum + sq.price, 0);
    const cost = streets.reduce((sum, sq) => sum + sq.buildingCost, 0);
    const mean = streets.reduce((sum, sq) => sum + rate[ctx.squareIndex.get(sq.id) ?? 0], 0) / streets.length;
    const levels = [0, 1, 2, 3, 4, 5].map((level) =>
      streets.reduce((sum, sq) => sum + rate[ctx.squareIndex.get(sq.id) ?? 0] * sq.rents[level] * (level === 0 ? multiplier : 1), 0),
    );
    income.push([group, percent(mean, 2), ...levels.map((value) => fixed(value))]);
    marginal.push([group, ...levels.slice(1).map((value, i) => fixed(((value - levels[i]) / cost) * 100, 2))]);
    payback.push([group, price, ...levels.map((value, level) => `${price + cost * level} / ${fixed((price + cost * level) / value, 0)}`)]);
  }
  markdown(['Group', 'Landings per street', 'Bare', '1', '2', '3', '4', 'Fortress'], income);
  console.log('Extra income per 100 coins spent on reaching each level:\n');
  markdown(['Group', '1', '2', '3', '4', 'Fortress'], marginal);
  console.log('Outlay at list prices, and the opponent turns that pay it back:\n');
  markdown(['Group', 'Streets', 'Bare', '1', '2', '3', '4', 'Fortress'], payback);

  const passes = ctx.transit.reduce((sum, sq) => sum + rate[ctx.squareIndex.get(sq.id) ?? 0], 0);
  const works = ctx.utilities.reduce((sum, sq) => sum + rate[ctx.squareIndex.get(sq.id) ?? 0], 0);
  const rows: (string | number)[][] = [];
  ctx.board.transitRents.forEach((rent, i) => {
    const count = i + 1;
    const outlay = ctx.transit.slice(0, count).reduce((sum, sq) => sum + sq.price, 0);
    const value = ((passes * count) / ctx.transit.length) * rent;
    rows.push([`${count} of ${ctx.transit.length} passes`, outlay, fixed(value), fixed(outlay / value, 0)]);
  });
  ctx.board.utilityMultipliers.forEach((factor, i) => {
    const count = i + 1;
    const outlay = ctx.utilities.slice(0, count).reduce((sum, sq) => sum + sq.price, 0);
    const value = ((works * count) / ctx.utilities.length) * factor * 7;
    rows.push([`${count} of ${ctx.utilities.length} works`, outlay, fixed(value), fixed(outlay / value, 0)]);
  });
  markdown(['Holding', 'Outlay', 'Income per opponent turn', 'Turns to pay back'], rows);
}

function reportEarnings(table: Table, tally: Tally): void {
  const { ctx } = table;
  const total = tally.rent.amount.reduce((a, b) => a + b, 0);
  console.log(`**Rent collected** (largest single payment: ${tally.maxRent})\n`);
  markdown(
    ['Property', 'Price', 'Rent per game', 'Payments per game', 'Mean payment', 'Rent per game over price', 'Share of all rent'],
    ctx.propertyOrder.map((sq) => {
      const i = ctx.squareIndex.get(sq.id) ?? 0;
      const amount = tally.rent.amount[i];
      const count = tally.rent.count[i];
      return [
        sq.name,
        sq.price,
        perGame(amount, tally, 0),
        perGame(count, tally, 2),
        fixed(amount / count, 0),
        fixed(amount / tally.games / sq.price, 2),
        percent(amount / total),
      ];
    }),
  );
  const sets = new Map<string, PropertySquare[]>();
  for (const sq of ctx.propertyOrder) {
    const key = sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works';
    sets.set(key, [...(sets.get(key) ?? []), sq]);
  }
  markdown(
    ['Set', 'List price', 'Rent per game', 'Rent per game over price', 'Share of all rent', 'Buildings bought per game'],
    [...sets].map(([key, members]) => {
      const price = members.reduce((sum, sq) => sum + sq.price, 0);
      const amount = members.reduce((sum, sq) => sum + tally.rent.amount[ctx.squareIndex.get(sq.id) ?? 0], 0);
      const built = members.reduce((sum, sq) => sum + tally.built[ctx.squareIndex.get(sq.id) ?? 0], 0);
      return [key, price, perGame(amount, tally, 0), fixed(amount / tally.games / price, 2), percent(amount / total), perGame(built, tally, 2)];
    }),
  );
}

function reportSales(table: Table, tally: Tally): void {
  const { ctx } = table;
  console.log('**How property changes hands** (per game)\n');
  const sets = new Map<string, PropertySquare[]>();
  for (const sq of ctx.propertyOrder) {
    const key = sq.kind === 'street' ? sq.group : sq.kind === 'transit' ? 'passes' : 'works';
    sets.set(key, [...(sets.get(key) ?? []), sq]);
  }
  markdown(
    ['Set', 'Bought at list', 'Won at auction', 'Auction price over list', 'By trade', 'By bankruptcy'],
    [...sets].map(([key, members]) => {
      const sum = (pick: (i: number, sq: PropertySquare) => number) =>
        members.reduce((total, sq) => total + pick(ctx.squareIndex.get(sq.id) ?? 0, sq), 0);
      const auctions = sum((i) => tally.acquired.auction.count[i]);
      const paid = sum((i) => tally.acquired.auction.price[i]);
      const list = sum((i, sq) => tally.acquired.auction.count[i] * sq.price);
      return [
        key,
        perGame(sum((i) => tally.acquired.purchase.count[i]), tally, 2),
        perGame(auctions, tally, 2),
        list === 0 ? 'n/a' : percent(paid / list, 0),
        perGame(sum((i) => tally.acquired.trade.count[i]), tally, 2),
        perGame(sum((i) => tally.acquired.bankruptcy.count[i]), tally, 2),
      ];
    }),
  );
}

function reportGroups(table: Table, tally: Tally): void {
  const players = table.seats.length;
  console.log('**Groups completed**\n');
  markdown(
    ['Group', 'Completed in', 'Mean round', 'Last street bought', 'at auction', 'by trade', 'by bankruptcy', 'First completer wins', 'Peak level: none', '1 or 2', '3', '4', 'Fortress'],
    Object.entries(tally.groups).map(([group, entry]) => {
      const peaks = entry.peak.reduce((a, b) => a + b, 0);
      const peak = (levels: number[]) => (peaks === 0 ? 'n/a' : percent(levels.reduce((sum, level) => sum + entry.peak[level], 0) / peaks, 0));
      return [
        group,
        percent(entry.games / tally.games),
        fixed(entry.turns / entry.games / players),
        ...VIAS.map((via) => (entry.games === 0 ? 'n/a' : percent(entry.via[via] / entry.games, 0))),
        share(entry.completerWon, entry.decided),
        peak([0]),
        peak([1, 2]),
        peak([3]),
        peak([4]),
        peak([5]),
      ];
    }),
  );
  console.log(
    `The first player to complete any group wins ${share(tally.firstGroup.completerWon, tally.firstGroup.decided)} ` +
      `of the finished games in which a group is completed.\n`,
  );
}

function reportMoney(tally: Tally): void {
  console.log('**Money and events** (per game)\n');
  const reasons = Object.entries(tally.paid).sort((a, b) => b[1].amount - a[1].amount);
  markdown(
    ['Payment', 'Count', 'Amount', 'Mean'],
    reasons.map(([reason, entry]) => [reason, perGame(entry.count, tally, 2), perGame(entry.amount, tally, 0), fixed(entry.amount / entry.count, 0)]),
  );
  const { trades } = tally;
  const rows: (string | number)[][] = [
    ['Trades proposed', perGame(trades.proposed, tally, 2)],
    ['Trades accepted', perGame(trades.accepted, tally, 2)],
    ['Share of proposals accepted', trades.proposed === 0 ? 'n/a' : percent(trades.accepted / trades.proposed)],
    ['Cash paid in accepted trades over the list price received', trades.list === 0 ? 'n/a' : percent(trades.cash / trades.list, 0)],
    ['Auctions that nobody won', perGame(tally.unsold, tally, 2)],
    ['Building auctions (bank short of buildings)', perGame(tally.buildingAuctions, tally, 2)],
    ['Sales of buildings back to the bank', perGame(tally.buildingSales, tally, 2)],
    ['Mortgages taken', perGame(tally.mortgages, tally, 2)],
    ['Mortgages redeemed', perGame(tally.redemptions, tally, 2)],
    ['Bankruptcies to a player', perGame(tally.bankruptcies.toPlayer, tally, 2)],
    ['Bankruptcies to the bank', perGame(tally.bankruptcies.toBank, tally, 2)],
  ];
  for (const [reason, count] of Object.entries(tally.jailSent)) rows.push([`Sent to jail: ${reason}`, perGame(count, tally, 2)]);
  for (const [how, count] of Object.entries(tally.jailLeft)) rows.push([`Left jail: ${how}`, perGame(count, tally, 2)]);
  markdown(['Event', 'Per game'], rows);
}

/** For one table: how often the leader by each measure goes on to win, round by round. */
function reportLeaders(tally: Tally, rounds: number[]): void {
  const reached = rounds.filter((round) => tally.snapshots[String(round)].games > 0);
  markdown(
    ['Leader by', ...reached.map((round) => `Round ${round}`)],
    [
      ['(Games that last this long)', ...reached.map((round) => percent(tally.snapshots[String(round)].games / tally.finished))],
      ['(A leader picked at random)', ...reached.map((round) => percent(tally.snapshots[String(round)].chance / tally.snapshots[String(round)].games))],
      ...MEASURES.map((measure, k) => [
        measure.label,
        ...reached.map((round) => {
          const { split, credit } = tally.snapshots[String(round)].measures;
          return split[k] === 0 ? 'n/a' : percent(credit[k] / split[k]);
        }),
      ]),
    ],
  );
}

/** For one table: the correlation between each measure (as a share of the table's total) and winning. */
function reportCorrelations(tally: Tally, rounds: number[]): void {
  const reached = rounds.filter((round) => tally.snapshots[String(round)].games > 0);
  const moments = reached.map((round) => measureMoments(tally.snapshots[String(round)]));
  markdown(
    ['Measure', ...reached.map((round) => `Round ${round}`)],
    MEASURES.map((measure, k) => [measure.label, ...moments.map(({ correlation }) => fixed(correlation[k], 2))]),
  );
}

/** For one table and one round: every measure in full, and all of them together in one model. */
function reportMeasures(snapshot: SnapshotTally): void {
  if (snapshot.games === 0) return;
  const { winners, others, split, credit, xtx, xty } = snapshot.measures;
  const { correlation, spread } = measureMoments(snapshot);
  // The model of the measures marked `together`: the constant and their columns of the normal equations.
  const width = MEASURES.length + 1;
  const kept = [0, ...MEASURES.flatMap((measure, k) => (measure.together ? [k + 1] : []))];
  const model = fit(
    kept.flatMap((a) => kept.map((b) => xtx[a * width + b])),
    kept.map((a) => xty[a]),
    snapshot.rows,
    snapshot.wins,
  );
  const place = new Map(kept.map((feature, j) => [feature, j]));
  const holdings = fit(snapshot.xtx, snapshot.xty, snapshot.rows, snapshot.wins);
  markdown(
    ['Measure', 'Mean, eventual winners', 'Mean, the rest', 'Tells players apart in', 'Its leader wins', 'Correlation with winning', 'Together: points per standard deviation (error)'],
    MEASURES.map((measure, k) => [
      measure.label,
      fixed(winners[k] / snapshot.wins, 1),
      fixed(others[k] / (snapshot.rows - snapshot.wins), 1),
      percent(split[k] / snapshot.games),
      split[k] === 0 ? 'n/a' : share(credit[k], split[k]),
      fixed(correlation[k], 2),
      measure.together
        ? `${fixed(model.beta[place.get(k + 1) ?? 0] * spread[k] * 100, 2)} (${fixed(model.error[place.get(k + 1) ?? 0] * spread[k] * 100, 2)})`
        : '',
    ]),
  );
  const alone = (key: string) => percent(correlation[MEASURES.findIndex((measure) => measure.key === key)] ** 2);
  console.log(
    `Share of the variance in winning explained: the ${kept.length - 1} measures with a figure in the last column, together, ` +
      `${percent(model.explained)}; the model of holdings ${percent(holdings.explained)}; net worth alone ${alone('netWorth')}; ` +
      `the rent roll alone ${alone('rentRoll')}; the rent roll within reach alone ${alone('reachRoll')}.\n`,
  );
}

function reportSnapshots(table: Table, tally: Tally): void {
  const { ctx } = table;
  const names = featureNames(ctx);
  const groups = [...ctx.groups.keys()];

  console.log('**How often the leader by each measure goes on to win**\n');
  reportLeaders(tally, SNAPSHOT_ROUNDS);
  console.log('**Correlation of each measure with winning**\n');
  reportCorrelations(tally, SNAPSHOT_ROUNDS);

  for (const round of MODEL_ROUNDS) {
    const entry = tally.snapshots[String(round)];
    if (entry.games === 0) continue;
    const base = entry.wins / entry.rows;
    console.log(`**Standing after round ${round}** (${entry.games} games, ${entry.rows} players, of whom ${percent(base)} go on to win)\n`);

    const condition = (label: string, holders: Held, index: number) => [
      label,
      percent(holders.players[index] / entry.rows),
      share(holders.won[index], holders.players[index]),
    ];
    markdown(
      ['Holding', 'Share of players', 'Go on to win'],
      [
        ...entry.passes.players.map((_, count) => condition(count === 1 ? '1 pass' : `${count} passes`, entry.passes, count)),
        ...entry.works.players.map((_, count) => condition(`${count} works`, entry.works, count)),
        ...['No complete group', 'One complete group', 'Two or more'].map((label, i) => condition(label, entry.groups, i)),
        ...groups.map((group, i) => condition(`Whole group: ${group}`, entry.group, i)),
      ],
    );

    console.log(`Measures of standing after round ${round}:\n`);
    reportMeasures(entry);

    const { beta, error } = fit(entry.xtx, entry.xty, entry.rows, entry.wins);
    console.log('Linear model of winning on what a player holds (percentage points, with standard errors):\n');
    markdown(
      ['Feature', 'Price', 'Holders who win', 'Points', 'Standard error', 'Points per 100 coins of price'],
      names.map((name, i) => {
        const sq = i >= 1 && i <= ctx.propertyOrder.length ? ctx.propertyOrder[i - 1] : undefined;
        return [
          name,
          sq ? sq.price : '',
          sq ? percent(entry.property.won[i - 1] / entry.property.players[i - 1]) : '',
          fixed(beta[i] * 100, 2),
          fixed(error[i] * 100, 2),
          sq ? fixed((beta[i] * 100 * 100) / sq.price, 2) : '',
        ];
      }),
    );
  }
}

function reportDetail(table: Table, tally: Tally): void {
  console.log(`\n## ${table.label}\n`);
  reportGames(table, tally);
  reportDecisions(tally);
  const rate = reportLandings(table, tally);
  reportReturns(table, rate);
  reportEarnings(table, tally);
  reportSales(table, tally);
  reportGroups(table, tally);
  reportMoney(tally);
  reportSnapshots(table, tally);
}

function reportMatches(tables: Table[], tallies: Tally[]): void {
  console.log('\n## One odd player among ordinary ones\n');
  markdown(
    ['Table', 'Games', 'Finished', 'Odd player wins', 'An even share', 'Turns, mean'],
    tables.flatMap((table, i) => {
      if (table.detail) return [];
      const tally = tallies[i];
      const odd = table.seats[0];
      return [
        [
          table.label,
          tally.games,
          percent(tally.finished / tally.games, 2),
          share(tally.wins[odd], tally.finished),
          percent(1 / table.seats.length),
          fixed(tally.finishedTurns / tally.finished),
        ],
      ];
    }),
  );
}

// ---------- The summary across table sizes ----------

interface Entry {
  table: Table;
  tally: Tally;
}

const playersOf = (entry: Entry) => entry.table.seats.length;

/** A table with one column for each entry and one row for each measure. */
function across(first: string, entries: Entry[], heading: (entry: Entry) => string, rows: [string, (entry: Entry) => string | number][]): void {
  markdown(
    [first, ...entries.map(heading)],
    rows.map(([label, cell]) => [label, ...entries.map(cell)]),
  );
}

const bySize = (entry: Entry) => `${playersOf(entry)} players`;

function momentRows(moment: MomentKind, label: string): [string, (entry: Entry) => string | number][] {
  return [
    [`${label}: share of games`, ({ tally }) => percent(tally.moments[moment].games / tally.games)],
    [`${label}: mean round`, (entry) => fixed(entry.tally.moments[moment].turns / entry.tally.moments[moment].games / playersOf(entry))],
  ];
}

function summaryGames(entries: Entry[], heading = bySize): void {
  across('Measure', entries, heading, [
    ['Games played', ({ tally }) => tally.games],
    ['Finished within the action limit', ({ tally }) => percent(tally.finished / tally.games, 2)],
    ['Turns per game, all games', ({ tally }) => perGame(tally.turns, tally)],
    ['Turns in a finished game, mean', ({ tally }) => fixed(tally.finishedTurns / tally.finished)],
    ['Rounds in a finished game, mean', (entry) => fixed(entry.tally.finishedTurns / entry.tally.finished / playersOf(entry))],
    ['Turns, 10th percentile', ({ tally }) => quantile(tally.turnHistogram, 0.1)],
    ['Turns, median', ({ tally }) => quantile(tally.turnHistogram, 0.5)],
    ['Turns, 90th percentile', ({ tally }) => quantile(tally.turnHistogram, 0.9)],
    ['Turns, 99th percentile', ({ tally }) => quantile(tally.turnHistogram, 0.99)],
    ['Actions per game, mean', ({ tally }) => perGame(tally.actions, tally, 0)],
    ...momentRows('soldOut', 'Every property owned'),
    ...momentRows('firstGroup', 'First group completed'),
    ...momentRows('firstBuilding', 'First building'),
    ...momentRows('firstBankruptcy', 'First bankruptcy'),
    ['The first to complete any group wins', ({ tally }) => share(tally.firstGroup.completerWon, tally.firstGroup.decided)],
  ]);
}

function summaryEvents(entries: Entry[]): void {
  const paid = (reason: string) => ({ tally }: Entry) => perGame(tally.paid[reason]?.amount ?? 0, tally, 0);
  const jail = ({ tally }: Entry) => perGame(Object.values(tally.jailSent).reduce((a, b) => a + b, 0), tally, 2);
  across('Per game', entries, bySize, [
    ['Rent paid', paid('rent')],
    ['Salary collected', paid('salary')],
    ['Spent on buildings', paid('building')],
    ['Spent on property at list price', paid('purchase')],
    ['Spent at auction', paid('auction')],
    ['Cash in accepted trades', paid('trade')],
    ['Taxes paid', paid('tax')],
    ['Trades proposed', ({ tally }) => perGame(tally.trades.proposed, tally, 2)],
    ['Trades accepted', ({ tally }) => perGame(tally.trades.accepted, tally, 2)],
    ['Share of proposals accepted', ({ tally }) => percent(tally.trades.accepted / tally.trades.proposed)],
    ['Cash paid in accepted trades over the list price received', ({ tally }) => percent(tally.trades.cash / tally.trades.list, 0)],
    ['Building auctions (bank short of buildings)', ({ tally }) => perGame(tally.buildingAuctions, tally, 2)],
    ['Sales of buildings back to the bank', ({ tally }) => perGame(tally.buildingSales, tally, 2)],
    ['Mortgages taken', ({ tally }) => perGame(tally.mortgages, tally, 2)],
    ['Mortgages redeemed', ({ tally }) => perGame(tally.redemptions, tally, 2)],
    ['Bankruptcies to a player', ({ tally }) => perGame(tally.bankruptcies.toPlayer, tally, 2)],
    ['Bankruptcies to the bank', ({ tally }) => perGame(tally.bankruptcies.toBank, tally, 2)],
    ['Times sent to jail', jail],
    ['Largest single rent', ({ tally }) => tally.maxRent],
  ]);
}

function reportSummary(entries: Map<string, Entry>): void {
  const pick = (prefix: string) => [2, 3, 4].flatMap((n) => entries.get(`${prefix}-${n}`) ?? []);
  const full = pick('full');
  const short = pick('short');
  const silent = pick('no-trade');
  if (full.length === 0) return;
  const { ctx } = full[0].table;
  const squares = ctx.board.squares;
  const rates = full.map(({ tally }) => tally.landings.map((count) => count / tally.turns));

  console.log('\n## Full game among rule-based players, by table size\n');
  console.log('### Games\n');
  summaryGames(full);

  console.log('### Wins by place in the order of play\n');
  across(
    'Place',
    full,
    bySize,
    [0, 1, 2, 3].map((place): [string, (entry: Entry) => string] => [
      String(place + 1),
      ({ tally }) => (place < tally.winsByPlace.length ? share(tally.winsByPlace[place], tally.finished) : ''),
    ]),
  );

  console.log('### Decisions per game (and the mean number of legal actions)\n');
  const kinds = [...new Set(full.flatMap(({ tally }) => Object.keys(tally.kinds)))].sort(
    (a, b) => (full.at(-1)?.tally.kinds[b]?.decisions ?? 0) - (full.at(-1)?.tally.kinds[a]?.decisions ?? 0),
  );
  across(
    'Decision',
    full,
    bySize,
    kinds.map((kind): [string, (entry: Entry) => string] => [
      kind,
      ({ tally }) => {
        const entry = tally.kinds[kind];
        return entry ? `${perGame(entry.decisions, tally)} (${fixed(entry.legal / entry.decisions)}, most ${entry.maxLegal})` : '';
      },
    ]),
  );

  console.log('### Landings per player turn\n');
  markdown(
    ['Square', 'Kind', ...full.map(bySize)],
    squares.map((sq, i) => [`${i} ${sq.name}`, sq.kind === 'street' ? sq.group : sq.kind, ...rates.map((rate) => percent(rate[i], 2))]),
  );
  markdown(
    ['Squares', ...full.map(bySize)],
    [
      ...[0, 1, 2, 3].map((side) => [
        `Side ${side + 1} (nine squares)`,
        ...rates.map((rate) => percent(rate.slice(side * 10 + 1, side * 10 + 10).reduce((a, b) => a + b, 0))),
      ]),
      ['All squares', ...rates.map((rate) => percent(rate.reduce((a, b) => a + b, 0)))],
    ],
  );

  const last = full.at(-1) as Entry;
  console.log(`### Static return, from the landing rates of the ${playersOf(last)}-player game\n`);
  reportReturns(last.table, rates.at(-1) as number[]);

  console.log('### Rent collected by set (rent per game over list price, and share of all rent)\n');
  const sets = [...new Set(ctx.propertyOrder.map(setOf))];
  markdown(
    ['Set', 'List price', ...full.map(bySize)],
    sets.map((set) => {
      const members = ctx.propertyOrder.filter((sq) => setOf(sq) === set);
      const price = members.reduce((sum, sq) => sum + sq.price, 0);
      return [
        set,
        price,
        ...full.map(({ tally }) => {
          const total = tally.rent.amount.reduce((a, b) => a + b, 0);
          const amount = members.reduce((sum, sq) => sum + tally.rent.amount[ctx.squareIndex.get(sq.id) ?? 0], 0);
          return `${fixed(amount / tally.games / price, 2)} (${percent(amount / total)})`;
        }),
      ];
    }),
  );

  console.log('### How property first leaves the bank and moves on (per game, share won at auction, auction price over list)\n');
  markdown(
    ['Set', ...full.map(bySize)],
    sets.map((set) => {
      const members = ctx.propertyOrder.filter((sq) => setOf(sq) === set);
      return [
        set,
        ...full.map(({ tally }) => {
          const sum = (pickOne: (i: number, sq: PropertySquare) => number) =>
            members.reduce((total, sq) => total + pickOne(ctx.squareIndex.get(sq.id) ?? 0, sq), 0);
          const bought = sum((i) => tally.acquired.purchase.count[i]);
          const auctioned = sum((i) => tally.acquired.auction.count[i]);
          const paid = sum((i) => tally.acquired.auction.price[i]);
          const list = sum((i, sq) => tally.acquired.auction.count[i] * sq.price);
          return `${percent(auctioned / (bought + auctioned))} at ${list === 0 ? 'n/a' : percent(paid / list, 0)}`;
        }),
      ];
    }),
  );

  console.log('### Groups\n');
  const groups = [...ctx.groups.keys()];
  const groupTable = (title: string, cell: (entry: GroupTally, tally: Tally, players: number) => string) => {
    console.log(`${title}\n`);
    markdown(
      ['Group', ...full.map(bySize)],
      groups.map((group) => [group, ...full.map((entry) => cell(entry.tally.groups[group], entry.tally, playersOf(entry)))]),
    );
  };
  groupTable('Share of games in which the group is completed, and the mean round:', (group, tally, players) =>
    `${percent(group.games / tally.games)}, round ${fixed(group.turns / group.games / players)}`,
  );
  groupTable('How the first completer came by the last street (bought, auction, trade, bankruptcy):', (group) =>
    VIAS.map((via) => percent(group.via[via] / group.games, 0)).join(' / '),
  );
  groupTable('How often the first to complete the group wins:', (group) => share(group.completerWon, group.decided));
  groupTable('The highest level the group reached (none / 1 or 2 / 3 / 4 / fortress):', (group) => {
    const total = group.peak.reduce((a, b) => a + b, 0);
    const part = (levels: number[]) => percent(levels.reduce((sum, level) => sum + group.peak[level], 0) / total, 0);
    return [part([0]), part([1, 2]), part([3]), part([4]), part([5])].join(' / ');
  });

  console.log('### Money and events\n');
  summaryEvents(full);

  console.log('### Who is ahead: how often the leader by each measure goes on to win\n');
  for (const entry of full) {
    console.log(`${bySize(entry)}:\n`);
    reportLeaders(entry.tally, SNAPSHOT_ROUNDS);
  }

  console.log('### Who is ahead: the correlation of each measure with winning\n');
  for (const entry of full) {
    console.log(`${bySize(entry)}:\n`);
    reportCorrelations(entry.tally, SNAPSHOT_ROUNDS);
  }

  for (const round of MODEL_ROUNDS) {
    console.log(`### Measures of standing after round ${round}\n`);
    for (const entry of full) {
      console.log(`${bySize(entry)}:\n`);
      reportMeasures(entry.tally.snapshots[String(round)]);
    }
  }

  for (const round of MODEL_ROUNDS) {
    console.log(`### What players hold after round ${round}, and whether they win\n`);
    const snapshots = full.map(({ tally }) => tally.snapshots[String(round)]);
    const fits = snapshots.map((snapshot) => fit(snapshot.xtx, snapshot.xty, snapshot.rows, snapshot.wins));
    const cell = (pickOne: (snapshot: SnapshotTally) => [number, number]) => (snapshot: SnapshotTally) => {
      const [won, players] = pickOne(snapshot);
      return players === 0 ? 'n/a' : `${share(won, players)}; ${percent(players / snapshot.rows)} of players`;
    };
    const rows: [string, (snapshot: SnapshotTally) => string][] = [
      ['Any player', cell((snapshot) => [snapshot.wins, snapshot.rows])],
      ...[0, 1, 2, 3, 4].map((count): [string, (snapshot: SnapshotTally) => string] => [
        count === 1 ? '1 pass' : `${count} passes`,
        cell((snapshot) => [snapshot.passes.won[count], snapshot.passes.players[count]]),
      ]),
      ...[0, 1, 2].map((count): [string, (snapshot: SnapshotTally) => string] => [
        `${count} works`,
        cell((snapshot) => [snapshot.works.won[count], snapshot.works.players[count]]),
      ]),
      ...['No complete group', 'One complete group', 'Two or more'].map((label, i): [string, (snapshot: SnapshotTally) => string] => [
        label,
        cell((snapshot) => [snapshot.groups.won[i], snapshot.groups.players[i]]),
      ]),
      ...groups.map((group, i): [string, (snapshot: SnapshotTally) => string] => [
        `Whole group: ${group}`,
        cell((snapshot) => [snapshot.group.won[i], snapshot.group.players[i]]),
      ]),
    ];
    markdown(
      ['Holding', ...full.map(bySize)],
      rows.map(([label, value]) => [label, ...snapshots.map(value)]),
    );

    console.log(`Linear model of winning on what a player holds after round ${round} (percentage points, standard error in brackets):\n`);
    const names = featureNames(ctx);
    markdown(
      ['Feature', 'Price', ...full.map(bySize)],
      names.map((name, i) => {
        const sq = i >= 1 && i <= ctx.propertyOrder.length ? ctx.propertyOrder[i - 1] : undefined;
        return [name, sq ? sq.price : '', ...fits.map(({ beta, error }) => `${fixed(beta[i] * 100, 2)} (${fixed(error[i] * 100, 2)})`)];
      }),
    );

    // The model prices cash as well, so each holding can be restated as the cash that moves the
    // chance of winning as far. For a property, that figure over its list price is how far the
    // list price misstates it.
    console.log(
      `The same model after round ${round}, restated in coins: the cash that moves the chance of winning as far as the holding does (for a property, also as a multiple of its list price):\n`,
    );
    const cash = names.indexOf('cash, per starting stake');
    const stake = ctx.board.economy.startingCash;
    markdown(
      ['Holding', 'Price', ...full.map(bySize)],
      names.flatMap((name, i) => {
        if (i === 0 || i >= cash) return [];
        const sq = i <= ctx.propertyOrder.length ? ctx.propertyOrder[i - 1] : undefined;
        return [
          [
            name,
            sq ? sq.price : '',
            ...fits.map(({ beta }) => {
              const coins = (beta[i] / beta[cash]) * stake;
              return sq ? `${fixed(coins, 0)} (${fixed(coins / sq.price, 2)})` : fixed(coins, 0);
            }),
          ],
        ];
      }),
    );

    // A whole set is its properties and every term the model adds for holding them together.
    console.log(
      `A whole set after round ${round}, in coins by the same model (and as a multiple of its list price):\n`,
    );
    const at = (name: string) => names.indexOf(name);
    const indexOf = (sq: PropertySquare) => 1 + ctx.propertyOrder.indexOf(sq);
    type WholeSet = [label: string, members: readonly PropertySquare[], extras: number[]];
    const sets: WholeSet[] = [
      ...[...ctx.groups].map(([group, streets]): WholeSet => [group, streets, [at(`whole group: ${group}`)]]),
      ['passes', ctx.transit, [at('two or more passes'), at('three or more passes'), at('all four passes')]],
      ['works', ctx.utilities, [at('both works')]],
    ];
    markdown(
      ['Set', 'List price', ...full.map(bySize)],
      sets.map(([label, members, extras]) => {
        const price = members.reduce((sum, sq) => sum + sq.price, 0);
        return [
          label,
          price,
          ...fits.map(({ beta }) => {
            const points = [...members.map(indexOf), ...extras].reduce((sum, i) => sum + beta[i], 0);
            const coins = (points / beta[cash]) * stake;
            return `${fixed(coins, 0)} (${fixed(coins / price, 2)})`;
          }),
        ];
      }),
    );
  }

  if (silent.length > 0) {
    console.log('\n## With and without trading\n');
    across('Measure', [...full, ...silent], (entry) => `${playersOf(entry)}, ${entry.table.key.startsWith('full') ? 'trading' : 'no trades'}`, [
      ['Games played', ({ tally }) => tally.games],
      ['Finished within the action limit', ({ tally }) => share(tally.finished, tally.games)],
      ['Turns per game, all games', ({ tally }) => perGame(tally.turns, tally, 0)],
      ['Turns in a finished game, mean', ({ tally }) => fixed(tally.finishedTurns / tally.finished, 0)],
      ['Games in which a group is completed', ({ tally }) => percent(tally.moments.firstGroup.games / tally.games)],
      ['Games in which every property is owned', ({ tally }) => percent(tally.moments.soldOut.games / tally.games)],
      ['Games with a bankruptcy', ({ tally }) => percent(tally.moments.firstBankruptcy.games / tally.games)],
    ]);
  }

  if (short.length > 0) {
    console.log('\n## The short game among rule-based players\n');
    summaryGames(short);
    console.log('Wins by place in the order of play:\n');
    across(
      'Place',
      short,
      bySize,
      [0, 1, 2, 3].map((place): [string, (entry: Entry) => string] => [
        String(place + 1),
        ({ tally }) => (place < tally.winsByPlace.length ? share(tally.winsByPlace[place], tally.finished) : ''),
      ]),
    );
    for (const entry of short) {
      console.log(`How often the leader by each measure goes on to win, ${bySize(entry)}:\n`);
      reportLeaders(entry.tally, MODEL_ROUNDS);
    }
  }
}

// ---------- Running ----------

function runChunk(table: Table, from: number, to: number): Tally {
  const tally = emptyTally(table);
  for (let seed = from; seed <= to; seed++) playGame(table, seed, tally);
  return tally;
}

function runAll(tables: Table[], games: number, workers: number): Promise<Tally[]> {
  const jobs: Job[] = [];
  tables.forEach((table, index) => {
    for (let from = 1, chunk = 0; from <= table.games; from += CHUNK, chunk++) {
      jobs.push({ table: index, chunk, from, to: Math.min(table.games, from + CHUNK - 1) });
    }
  });
  // Chunks are folded in in order, so that the sums do not depend on which worker finished first.
  const tallies = tables.map((table) => emptyTally(table));
  const waiting = tables.map(() => new Map<number, Tally>());
  const due = tables.map(() => 0);
  const started = performance.now();

  return new Promise((resolve, reject) => {
    let next = 0;
    let done = 0;
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const child = fork(fileURLToPath(import.meta.url), ['--worker', String(games)]);
      const give = () => {
        if (next < jobs.length) child.send(jobs[next++]);
        else child.disconnect();
      };
      child.on('message', (message: { job: Job; tally: Tally }) => {
        const { table, chunk } = message.job;
        waiting[table].set(chunk, message.tally);
        while (waiting[table].has(due[table])) {
          tallies[table] = merged(tallies[table], waiting[table].get(due[table])) as Tally;
          waiting[table].delete(due[table]);
          due[table] += 1;
        }
        done += 1;
        if (done % 50 === 0 || done === jobs.length) {
          const seconds = (performance.now() - started) / 1000;
          process.stderr.write(`\r${done} of ${jobs.length} jobs, ${seconds.toFixed(0)} s`);
        }
        if (done === jobs.length) {
          process.stderr.write('\n');
          resolve(tallies);
        }
        give();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(`A worker stopped with code ${code}.`));
      });
      give();
    }
  });
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function print(tables: Table[], tallies: Tally[], opening: string): void {
  console.log('# Simulation study\n');
  console.log(opening);
  reportSummary(new Map(tables.map((table, i) => [table.key, { table, tally: tallies[i] }])));
  reportMatches(tables, tallies);
  if (process.argv.includes('--details')) {
    tables.forEach((table, i) => {
      if (table.detail) reportDetail(table, tallies[i]);
    });
  }
}

function describe(tables: Table[], tallies: Tally[]): string {
  const counts = [...new Set(tables.map((table) => table.games))].join(', ');
  const played = tallies.reduce((sum, tally) => sum + tally.games, 0);
  return `Three Kingdoms board. Games per table, by kind of table: ${counts}. Seeds from 1. ${played} games in all.`;
}

const saved = option('--from');
if (process.argv[2] === '--worker') {
  const tables = makeTables(Number(process.argv[3]));
  process.on('message', (job: Job) => {
    process.send?.({ job, tally: runChunk(tables[job.table], job.from, job.to) });
  });
} else if (saved) {
  const run = JSON.parse(readFileSync(saved, 'utf8')) as { games: number; tables: { key: string; tally: Tally }[] };
  const tables = makeTables(run.games);
  const tallies = tables.map((table) => {
    const found = run.tables.find((entry) => entry.key === table.key);
    if (!found) throw new Error(`${saved} has no table "${table.key}".`);
    return found.tally;
  });
  print(tables, tallies, describe(tables, tallies));
} else {
  const games = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 2000);
  if (!Number.isInteger(games) || games < 1) throw new Error('Give a whole number of games.');
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 1));
  const tables = makeTables(games);
  const started = performance.now();
  const tallies = await runAll(tables, games, workers);
  const seconds = (performance.now() - started) / 1000;
  print(tables, tallies, `${describe(tables, tallies)} ${seconds.toFixed(0)} seconds on ${workers} processes.`);

  const json = option('--json');
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    const kept = tables.map((table, i) => ({ key: table.key, label: table.label, seats: table.seats, tally: tallies[i] }));
    writeFileSync(json, JSON.stringify({ games, tables: kept }));
    process.stderr.write(`Saved ${json}\n`);
  }
}
