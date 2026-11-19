/**
 * Searches the parameters of the style agent for strong styles and for different ones.
 *
 *   node scripts/search-styles.ts --size 4 --out <dir> [--generations 40] [--population 48] [--keep 12]
 *        [--games 600] [--workers 8]
 *   node scripts/search-styles.ts --admit --sizes 2,3,4 --from <dir> [--games 5000] [--candidates 24]
 *
 * A candidate's score is its win share as one seat among opponents drawn from a pool, over a list
 * of seeds shared by every candidate of a generation and changed every generation. An evolution
 * strategy keeps the best, perturbs them and breeds new ones; every candidate scored is also offered
 * to an archive in the manner of MAP-Elites, a grid over four behaviour descriptors that keeps the
 * best candidate in every cell. The run saves its state after every generation and resumes from it.
 * `--admit` scores the best of each archive again on fresh seeds and writes src/sim/styles-found.ts.
 */
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Engine, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent, playbookAgent } from '../src/sim/league.ts';
import type { FoundStyle } from '../src/sim/league.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';
import type { Part } from '../src/sim/parts.ts';
import type { Condition, Playbook, Rule } from '../src/sim/playbook.ts';
import type { Signals } from '../src/sim/signals.ts';
import { BASELINE, SETS, validateStyle } from '../src/sim/style.ts';
import type { SetId, Style } from '../src/sim/style.ts';
import { PRESETS, school } from '../src/sim/styles.ts';
import type { SeatAgent } from '../src/sim/styles.ts';

const ACTION_LIMIT = 40000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

// ---------- The genome ----------

/** Every gene is a number from 0 to 1, decoded to its field's range. */
type Genome = Record<string, number>;

const NUMBERS: [keyof Style | string, number, number][] = [
  ['partFactor', 1, 4],
  ['completeFactor', 1, 5],
  ['passStep', 0, 1],
  ['worksStep', 0, 1],
  ['reserve', 0, 600],
  ['reserveBuilt', 0, 800],
  ['reserveThreat', 0, 1],
  ['buyKeep', 0, 1],
  ['blockBonus', 1, 3],
  ['bidKeep', 0, 1],
  ['driveUp', 0, 1],
  ['buildingBid', 0.5, 2],
  ['buildBeyond', 0, 2000],
  ['redeemSpare', 0, 2],
  ['jailStay', 0, 1],
  ['proposeRate', 0, 1],
  ['offerLow', 1, 4],
  ['offerSpread', 0, 1.5],
  ['offerFloor', 1, 3],
  ['acceptMargin', 0.8, 3],
  ['completionPenalty', 0, 5],
  ['leaveCash', 0, 15],
  ['declinePoor', 0.5, 3],
  ['buildNear', 2, 20],
  ['moodWindow', 4, 30],
  ['moodFloor', 0, 1],
  ['giveUpBelow', 0, 0.2],
];
const SWITCHES = [
  'mortgageToBuy',
  'mortgageToBuild',
  'holdHouses',
  'jailStayBuilt',
  'swaps',
  'sellOffers',
  'distressOffers',
  'shunLeader',
  'neverSellPasses',
  'neverBeyond',
  'refuseAll',
  'useLeaveCash',
  'useDeclinePoor',
  'useBuildNear',
  'readsTable',
  'useGiveUp',
  'buildOrderLanding',
  'buildSpreadOne',
];
const PER_SET: [string, number, number][] = [
  ['buy', 0, 1],
  ['bidCap', 0, 3],
  ['prefer', 0.5, 2],
];

/**
 * The fields of table politics (M3b). They are in the genome only with --politics, so that a search
 * made before them repeats draw for draw and its saved genomes still decode. The fourth entry marks a
 * field that is a whole number.
 */
const POLITICS = process.argv.includes('--politics');
const TABLE_NUMBERS: [keyof Style, number, number, boolean?][] = [
  ['openShare', 0.1, 1],
  ['maxShare', 0.3, 1.5],
  ['raiseStep', 0, 0.5],
  ['probeGap', 1, 8, true],
  ['probeDrop', 0, 0.2],
  ['earlyBefore', 5, 40, true],
  ['earlyNeed', 0, 1],
  ['denyThreat', 1, 3],
  ['denyShare', 0, 1.5],
  ['denyRank', 1, 4, true],
  ['failBelow', 0.1, 1],
  ['giftEdge', 0.5, 6],
  ['allyAt', 0.5, 8],
  ['allyTurns', 1, 10, true],
  ['acceptEdge', -2, 5],
  ['againstLeader', 0, 2],
  ['forWeak', 0, 2],
  ['reciprocity', 0, 2],
];
const TABLE_SWITCHES = ['offerByValue', 'completeByList', 'earlyOffers', 'denyOffers', 'useEstates', 'estatesBoth', 'rescue', 'debtOffers', 'debtSales', 'courtAllies', 'answerBySheet', 'huntFailing'];

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const unscale = (value: number, low: number, high: number) => clamp((value - low) / (high - low));
const scale = (gene: number, low: number, high: number) => low + clamp(gene) * (high - low);

/** The genes of table politics for a style. */
function encodeTable(style: Style): Genome {
  const g: Genome = {};
  const on = (b: boolean) => (b ? 1 : 0);
  for (const [key, low, high] of TABLE_NUMBERS) g[key] = unscale(style[key] as number, low, high);
  g.offerByValue = on(style.offerBy === 'value');
  g.completeByList = on(style.completeBy === 'list');
  g.earlyOffers = on(style.earlyOffers);
  g.denyOffers = on(style.denyOffers);
  g.useEstates = on(style.estateOffers !== 'off');
  g.estatesBoth = on(style.estateOffers === 'both');
  g.rescue = on(style.rescue);
  g.debtOffers = on(style.debtOffers);
  g.debtSales = on(style.debtSales);
  g.courtAllies = on(style.courtAllies);
  g.answerBySheet = on(style.answerBy === 'sheet');
  g.huntFailing = on(style.huntFailing);
  return g;
}
const TABLE_DEFAULTS = encodeTable(BASELINE);

/** The fields of table politics from a genome; a gene it lacks is read at the baseline's value. */
function decodeTable(g: Genome): Partial<Style> {
  const gene = (key: string) => g[key] ?? TABLE_DEFAULTS[key];
  const out: Record<string, unknown> = {};
  for (const [key, low, high, whole] of TABLE_NUMBERS) {
    const value = scale(gene(key), low, high);
    out[key] = whole ? Math.round(value) : Math.round(value * 1000) / 1000;
  }
  const on = (key: string) => gene(key) >= 0.5;
  const fields = out as Partial<Style>;
  fields.maxShare = Math.max(fields.maxShare as number, fields.openShare as number);
  fields.offerBy = on('offerByValue') ? 'value' : 'list';
  fields.completeBy = on('completeByList') ? 'list' : 'value';
  fields.earlyOffers = on('earlyOffers');
  fields.denyOffers = on('denyOffers');
  fields.estateOffers = on('useEstates') ? (on('estatesBoth') ? 'both' : 'self') : 'off';
  fields.rescue = on('rescue');
  fields.debtOffers = on('debtOffers');
  fields.debtSales = on('debtSales');
  fields.courtAllies = on('courtAllies');
  fields.answerBy = on('answerBySheet') ? 'sheet' : 'factors';
  fields.huntFailing = on('huntFailing');
  return fields;
}

export function encode(style: Style, politics = POLITICS): Genome {
  const g: Genome = politics ? encodeTable(style) : {};
  for (const [key, low, high] of NUMBERS) {
    let value: number;
    if (key === 'offerSpread') value = style.offerHigh - style.offerLow;
    else if (key === 'acceptMargin') value = Number.isFinite(style.acceptMargin) ? style.acceptMargin : high;
    else if (key === 'buildBeyond') value = style.buildBeyond ?? 0;
    else if (key === 'leaveCash') value = style.leaveCash ?? 0;
    else if (key === 'declinePoor') value = style.declinePoor ?? 1.5;
    else if (key === 'buildNear') value = style.buildNear ?? 12;
    else if (key === 'giveUpBelow') value = style.giveUpBelow ?? 0.05;
    else if (key === 'moodWindow') value = style.moodWindow || 8;
    else value = style[key as keyof Style] as number;
    g[key] = unscale(value, low, high);
  }
  const on = (b: boolean) => (b ? 1 : 0);
  g.mortgageToBuy = on(style.mortgageToBuy);
  g.mortgageToBuild = on(style.mortgageToBuild);
  g.holdHouses = on(style.holdHouses);
  g.jailStayBuilt = on(style.jailStayBuilt);
  g.swaps = on(style.swaps);
  g.sellOffers = on(style.sellOffers);
  g.distressOffers = on(style.distressOffers);
  g.shunLeader = on(style.shunLeader);
  g.neverSellPasses = on(style.neverSell.includes('passes'));
  g.neverBeyond = on(style.buildBeyond === null);
  g.refuseAll = on(!Number.isFinite(style.acceptMargin));
  g.useLeaveCash = on(style.leaveCash !== null);
  g.useDeclinePoor = on(style.declinePoor !== null);
  g.useBuildNear = on(style.buildNear !== null);
  g.readsTable = on(style.moodWindow > 0 && style.blockMode !== null);
  g.useGiveUp = on(style.giveUpBelow !== null);
  g.buildOrderLanding = on(style.buildOrder === 'landing');
  g.buildSpreadOne = on(style.buildSpread === 'one');
  g.buildTarget = (style.buildTarget - 1) / 4;
  for (const [field, low, high] of PER_SET) {
    for (const set of SETS) {
      const record = style[field as 'buy' | 'bidCap' | 'prefer'] as Partial<Record<SetId, number>>;
      g[`${field}.${set}`] = unscale(record[set] ?? (field === 'prefer' ? 1 : field === 'buy' ? 1 : 0.85), low, high);
    }
  }
  return g;
}

const REFERENCE_BLOCK = school('reference').blockMode;

export function decode(g: Genome, name: string): Style {
  const n = (key: string) => {
    const spec = NUMBERS.find(([k]) => k === key);
    if (!spec) throw new Error(key);
    return scale(g[key], spec[1], spec[2]);
  };
  const on = (key: string) => g[key] >= 0.5;
  const perSet = (field: string) => {
    const spec = PER_SET.find(([k]) => k === field) as [string, number, number];
    return Object.fromEntries(SETS.map((set) => [set, Math.round(scale(g[`${field}.${set}`], spec[1], spec[2]) * 1000) / 1000]));
  };
  const offerLow = n('offerLow');
  const style: Style = {
    ...BASELINE,
    name,
    partFactor: n('partFactor'),
    completeFactor: n('completeFactor'),
    passStep: n('passStep'),
    worksStep: n('worksStep'),
    prefer: perSet('prefer'),
    reserve: Math.round(n('reserve')),
    reserveBuilt: Math.round(n('reserveBuilt')),
    reserveThreat: n('reserveThreat'),
    buy: perSet('buy') as Style['buy'],
    buyKeep: n('buyKeep'),
    mortgageToBuy: on('mortgageToBuy'),
    declinePoor: on('useDeclinePoor') ? n('declinePoor') : null,
    bidCap: perSet('bidCap') as Style['bidCap'],
    bidCeiling: {},
    blockBonus: n('blockBonus'),
    bidKeep: n('bidKeep'),
    bidStep: 12,
    driveUp: n('driveUp'),
    buildingBid: n('buildingBid'),
    buildTarget: (1 + Math.round(clamp(g.buildTarget) * 4)) as Style['buildTarget'],
    buildBeyond: on('neverBeyond') ? null : Math.round(n('buildBeyond')),
    buildOrder: on('buildOrderLanding') ? 'landing' : 'gain',
    buildSpread: on('buildSpreadOne') ? 'one' : 'even',
    buildNear: on('useBuildNear') ? Math.round(n('buildNear')) : null,
    mortgageToBuild: on('mortgageToBuild'),
    holdHouses: on('holdHouses'),
    redeemSpare: n('redeemSpare'),
    jailStay: n('jailStay'),
    jailStayBuilt: on('jailStayBuilt'),
    proposeRate: n('proposeRate'),
    offerLow,
    offerHigh: offerLow + n('offerSpread'),
    offerFloor: Math.min(n('offerFloor'), offerLow),
    swaps: on('swaps'),
    acceptMargin: on('refuseAll') ? Infinity : n('acceptMargin'),
    completionPenalty: n('completionPenalty'),
    neverSell: on('neverSellPasses') ? ['passes'] : [],
    leaveCash: on('useLeaveCash') ? Math.round(n('leaveCash')) : null,
    sellOffers: on('sellOffers'),
    distressOffers: on('distressOffers'),
    shunLeader: on('shunLeader'),
    giveUpBelow: on('useGiveUp') ? n('giveUpBelow') : null,
    moodWindow: on('readsTable') ? Math.round(n('moodWindow')) : 0,
    moodFloor: on('readsTable') ? n('moodFloor') : 0,
    blockMode: on('readsTable') ? REFERENCE_BLOCK : null,
    afterFirstGroup: null,
    bySize: {},
    ...('offerByValue' in g ? decodeTable(g) : {}),
  };
  const problems = validateStyle(style);
  if (problems.length > 0) throw new Error(`Decoded style ${name} is unsound: ${problems.join('; ')}`);
  return style;
}

function generator(seed: string): () => number {
  const holder = { rng: seedFrom(seed) };
  return () => nextFloat(holder);
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function perturb(g: Genome, sigma: number, random: () => number, politics = POLITICS): Genome {
  const out = { ...g };
  for (const [key] of NUMBERS) out[key] = clamp(out[key] + sigma * gaussian(random));
  for (const key of SWITCHES) if (random() < 0.1) out[key] = out[key] >= 0.5 ? 0 : 1;
  if (random() < 0.2) out.buildTarget = clamp(out.buildTarget + (random() < 0.5 ? -0.25 : 0.25));
  for (const [field] of PER_SET) {
    if (random() < 0.5) for (const set of SETS) out[`${field}.${set}`] = clamp(out[`${field}.${set}`] + sigma * gaussian(random));
    else {
      const set = SETS[Math.floor(random() * SETS.length)];
      out[`${field}.${set}`] = clamp(out[`${field}.${set}`] + 2 * sigma * gaussian(random));
    }
  }
  if (politics) {
    // After everything else, so that the draws before this point are those of a search without politics.
    for (const [key] of TABLE_NUMBERS) out[key] = clamp((out[key] ?? TABLE_DEFAULTS[key]) + sigma * gaussian(random));
    for (const key of TABLE_SWITCHES) {
      const now = out[key] ?? TABLE_DEFAULTS[key];
      out[key] = random() < 0.1 ? (now >= 0.5 ? 0 : 1) : now;
    }
  }
  return out;
}

function crossover(a: Genome, b: Genome, random: () => number): Genome {
  const out: Genome = {};
  for (const key of Object.keys(a)) out[key] = random() < 0.5 ? a[key] : (b[key] ?? a[key]);
  return out;
}

// ---------- Scoring ----------

interface ScoreJob {
  id: string;
  style: Style;
  /** For a playbook candidate: its rules, and the styles they take parts from. */
  playbook?: Playbook;
  sources?: Record<string, Style>;
  size: 2 | 3 | 4;
  from: number;
  to: number;
  pool: string[];
  poolStyles: Record<string, Style>;
}

interface Score {
  id: string;
  games: number;
  finished: number;
  wins: number;
  spentProperty: number;
  spentBuildings: number;
  trades: number;
  seen20: number;
  passes20: number;
  cash20: number;
}

/** Plays one game with the candidate in seat 0 and pool members in the rest; returns what seat 0 did. */
function scoreGame(engine: Engine, job: ScoreJob, seed: number, out: Score): void {
  const opponents = generator(`opponents-${job.size}-${seed}`);
  const random = generator(`search-${job.size}-${seed}`);
  const ids = Array.from({ length: job.size }, (_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>();
  agents.set('p1', playbookAgent(job.playbook ?? { name: job.id, base: job.style, rules: [] }, job.sources ?? {}));
  for (const id of ids.slice(1)) {
    const name = job.pool[Math.floor(opponents() * job.pool.length)];
    const style = job.poolStyles[name];
    agents.set(id, style ? playbookAgent({ name, base: style, rules: [] }) : memberAgent(name));
  }
  const windows = createDebtWindows();
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    // At a debt the debtor cannot cover, seats that offer for its property are asked first.
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`${job.id}, seed ${seed}: ${actor} has no action.`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`${job.id}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
    for (const event of result.events) {
      if (event.type === 'PAID' && event.from === 'p1' && (event.reason === 'purchase' || event.reason === 'auction')) out.spentProperty += event.amount;
      if (event.type === 'BUILT' && event.player === 'p1') out.spentBuildings += event.cost;
      if (event.type === 'TRADE_ACCEPTED' && (event.offer.from === 'p1' || event.offer.to === 'p1')) out.trades += 1;
      if (event.type === 'TURN_STARTED' && event.turn === 20 * job.size + 1) {
        const me = state.players.find((p) => p.id === 'p1');
        if (me && !me.bankrupt) {
          out.seen20 += 1;
          out.cash20 += me.cash;
          out.passes20 += ['hulao-pass', 'guandu-ford', 'changban-bridge', 'jiange-pass'].filter((id) => state.properties[id].owner === 'p1').length;
        }
      }
    }
  }
  out.games += 1;
  if (state.winner !== null) {
    out.finished += 1;
    if (state.winner === 'p1') out.wins += 1;
  }
}

function runScore(engine: Engine, job: ScoreJob): Score {
  const out: Score = { id: job.id, games: 0, finished: 0, wins: 0, spentProperty: 0, spentBuildings: 0, trades: 0, seen20: 0, passes20: 0, cash20: 0 };
  for (let seed = job.from; seed <= job.to; seed++) scoreGame(engine, job, seed, out);
  return out;
}

class Pool {
  private children: ReturnType<typeof fork>[] = [];
  private waiting = new Map<string, (score: Score) => void>();
  private queue: ScoreJob[] = [];
  private idle: ReturnType<typeof fork>[] = [];
  constructor(workers: number) {
    for (let w = 0; w < workers; w++) {
      const child = fork(fileURLToPath(import.meta.url), ['--worker']);
      child.on('message', (score: Score & { key: string }) => {
        this.waiting.get(score.key)?.(score);
        this.waiting.delete(score.key);
        this.next(child);
      });
      child.on('exit', (code) => {
        if (code) throw new Error(`A worker stopped with code ${code}.`);
      });
      this.children.push(child);
      this.idle.push(child);
    }
  }
  private next(child: ReturnType<typeof fork>): void {
    const job = this.queue.shift();
    if (job) child.send(job);
    else this.idle.push(child);
  }
  score(job: ScoreJob): Promise<Score> {
    const key = `${job.id}|${job.from}`;
    return new Promise((resolve) => {
      this.waiting.set(key, resolve);
      const message = { ...job, key } as ScoreJob & { key: string };
      const child = this.idle.pop();
      if (child) child.send(message);
      else this.queue.push(message);
    });
  }
  close(): void {
    for (const child of this.children) child.disconnect();
  }
}

/** Scores a style over `games` seeds from `start`, in chunks spread over the workers. */
async function scoreStyle(
  pool: Pool,
  id: string,
  style: Style,
  size: 2 | 3 | 4,
  start: number,
  games: number,
  opponents: string[],
  poolStyles: Record<string, Style>,
  extra: { playbook?: Playbook; sources?: Record<string, Style> } = {},
): Promise<Score> {
  const chunk = Math.max(50, Math.ceil(games / 4));
  const parts: Promise<Score>[] = [];
  for (let from = start; from < start + games; from += chunk) {
    parts.push(pool.score({ id, style, size, from, to: Math.min(start + games - 1, from + chunk - 1), pool: opponents, poolStyles, ...extra }));
  }
  const scores = await Promise.all(parts);
  return scores.reduce((a, b) => {
    const out = { ...a };
    for (const key of Object.keys(b) as (keyof Score)[]) if (key !== 'id') (out[key] as number) += b[key] as number;
    return out;
  });
}

// ---------- The archive ----------

function cellOf(s: Score): string {
  const share = s.spentBuildings / Math.max(1, s.spentBuildings + s.spentProperty);
  const trades = s.trades / Math.max(1, s.games);
  const passes = s.seen20 ? s.passes20 / s.seen20 : 0;
  const cash = s.seen20 ? s.cash20 / s.seen20 : 0;
  const b = share < 0.3 ? 0 : share < 0.5 ? 1 : share < 0.7 ? 2 : 3;
  const t = trades === 0 ? 0 : trades <= 1 ? 1 : trades <= 3 ? 2 : 3;
  const p = passes < 0.75 ? 0 : passes < 1.5 ? 1 : 2;
  const c = cash < 200 ? 0 : cash < 500 ? 1 : 2;
  return `b${b}t${t}p${p}c${c}`;
}

interface Entry {
  id: string;
  genome: Genome;
  score: number;
  cell: string;
  generation: number;
}

interface SearchState {
  size: 2 | 3 | 4;
  generation: number;
  population: Entry[];
  archive: Record<string, Entry>;
  pool: string[];
  poolStyles: Record<string, Style>;
  history: { generation: number; best: string; bestScore: number; rescored: number | null; cells: number }[];
}

function save(dir: string, state: SearchState): void {
  const file = join(dir, 'state.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(state, (_, v) => (v === Infinity ? 'Infinity' : v)));
  renameSync(`${file}.tmp`, file);
}

function load(dir: string): SearchState | null {
  const file = join(dir, 'state.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'), (_, v) => (v === 'Infinity' ? Infinity : v)) as SearchState;
}

async function search(): Promise<void> {
  const size = Number(option('--size') ?? 4) as 2 | 3 | 4;
  const dir = option('--out');
  if (!dir) throw new Error('Give --out <dir>.');
  mkdirSync(dir, { recursive: true });
  const generations = Number(option('--generations') ?? 40);
  const populationSize = Number(option('--population') ?? 48);
  const keep = Number(option('--keep') ?? 12);
  const games = Number(option('--games') ?? 600);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const random = generator(`search-${size}`);
  let state = load(dir);
  if (!state) {
    const starts = Object.values(PRESETS).filter((p) => p.sizes.includes(size) && p.playbook.rules.length === 0);
    const population: Entry[] = starts.map((p) => ({ id: p.name, genome: encode(p.playbook.base), score: 0, cell: '', generation: 0 }));
    let k = 0;
    while (population.length < populationSize) {
      const parent = population[k++ % starts.length];
      population.push({ id: `g0-${population.length}`, genome: perturb(parent.genome, 0.15, random), score: 0, cell: '', generation: 0 });
    }
    state = { size, generation: 0, population: population.slice(0, Math.max(populationSize, starts.length)), archive: {}, pool: ['baseline', 'refuser', 'reference'], poolStyles: {}, history: [] };
  }
  const pool = new Pool(workers);
  const started = performance.now();
  while (state.generation < generations) {
    const g = state.generation;
    const start = 2_000_000 + ((g * games) % 100_000);
    const sigma = 0.15 - (0.1 * g) / Math.max(1, generations - 1);
    const scored = await Promise.all(
      state.population.map(async (entry) => {
        const style = decode(entry.genome, entry.id);
        const s = await scoreStyle(pool, entry.id, style, size, start, games, state!.pool, state!.poolStyles);
        return { ...entry, score: s.wins / Math.max(1, s.finished), cell: cellOf(s) };
      }),
    );
    for (const entry of scored) {
      const held = state.archive[entry.cell];
      if (!held || entry.score > held.score) state.archive[entry.cell] = entry;
    }
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, keep);
    const best = kept[0];
    // The kept were scored on this generation's list; their next score, on the next list, shows how much was luck.
    const previous = state.history.at(-1);
    const rescored = previous ? (scored.find((e) => e.id === previous.best)?.score ?? null) : null;
    state.history.push({ generation: g, best: best.id, bestScore: best.score, rescored, cells: Object.keys(state.archive).length });
    if (!state.pool.includes(best.id) && state.pool.length < 12) {
      state.pool.push(best.id);
      state.poolStyles[best.id] = decode(best.genome, best.id);
    }
    const children: Entry[] = [];
    const archive = Object.values(state.archive);
    while (children.length + kept.length < populationSize) {
      const id = `g${g + 1}-${children.length}`;
      let genome: Genome;
      if (random() < 0.25 && archive.length > 0) genome = perturb(archive[Math.floor(random() * archive.length)].genome, sigma, random);
      else {
        const parent = kept[Math.floor(random() * kept.length)];
        genome = random() < 0.25 ? crossover(parent.genome, kept[Math.floor(random() * kept.length)].genome, random) : parent.genome;
        genome = perturb(genome, sigma, random);
      }
      children.push({ id, genome, score: 0, cell: '', generation: g + 1 });
    }
    state.population = [...kept, ...children];
    state.generation = g + 1;
    save(dir, state);
    process.stderr.write(
      `${size} players, generation ${g}: best ${best.id} ${(best.score * 100).toFixed(1)}%${rescored === null ? '' : `, last best rescored ${(rescored * 100).toFixed(1)}%`}, ${Object.keys(state.archive).length} cells, ${((performance.now() - started) / 1000).toFixed(0)} s\n`,
    );
  }
  pool.close();
}

// ---------- Searching for playbooks ----------

const SIGNAL_RANGES: Record<keyof Signals, [number, number]> = {
  tableSize: [2, 4], players: [1, 4], round: [0, 80], owned: [0, 1], chance: [0, 3], rank: [1, 4], leader: [0, 3],
  rentShare: [0, 1], groups: [0, 4], unbuilt: [0, 3], nearSets: [0, 3], needs: [0, 3], wanted: [0, 3], passes: [0, 4],
  spare: [0, 2], danger: [0, 3], rivalLevel: [0, 5], rivalNear: [0, 1], rivalPoor: [0, 1], bankHouses: [0, 32], mood: [0, 1],
  threat: [0, 4], gap: [-3, 3], failing: [0, 1], shunned: [0, 1],
};
/** The four signals of table politics join the search only with --politics, so that an earlier search can be repeated draw for draw. */
const TABLE_SIGNALS: (keyof Signals)[] = ['threat', 'gap', 'failing', 'shunned'];
const SIGNALS = (Object.keys(SIGNAL_RANGES) as (keyof Signals)[]).filter((signal) => process.argv.includes('--politics') || !TABLE_SIGNALS.includes(signal));
const PART_NAMES: Part[] = ['value', 'buy', 'bid', 'build', 'cash', 'offer', 'answer'];

interface PlaybookGenome {
  base: string;
  rules: Rule[];
}

function randomCondition(random: () => number): Condition {
  const signal = SIGNALS[Math.floor(random() * SIGNALS.length)];
  const [low, high] = SIGNAL_RANGES[signal];
  return { signal, is: random() < 0.5 ? '<' : '>=', value: Math.round((low + random() * (high - low)) * 100) / 100 };
}

function randomRule(sources: string[], random: () => number, id: string): Rule {
  const when = [randomCondition(random), ...(random() < 0.4 ? [randomCondition(random)] : [])];
  const take = Array.from({ length: random() < 0.5 ? 1 : 2 }, () => ({
    part: PART_NAMES[Math.floor(random() * PART_NAMES.length)],
    from: sources[Math.floor(random() * sources.length)],
  }));
  return { name: id, when, take, hold: Math.floor(random() * 7) };
}

function mutatePlaybook(p: PlaybookGenome, sources: string[], random: () => number, tag: string): PlaybookGenome {
  const rules: Rule[] = structuredClone(p.rules);
  let base = p.base;
  if (random() < 0.1) base = sources[Math.floor(random() * sources.length)];
  if (random() < 0.15 && rules.length < 8) rules.push(randomRule(sources, random, `${tag}-r${rules.length}`));
  if (random() < 0.15 && rules.length > 0) rules.splice(Math.floor(random() * rules.length), 1);
  if (random() < 0.1 && rules.length > 1) {
    const i = Math.floor(random() * (rules.length - 1));
    [rules[i], rules[i + 1]] = [rules[i + 1], rules[i]];
  }
  if (rules.length > 0) {
    const rule = rules[Math.floor(random() * rules.length)];
    const pick = random();
    if (pick < 0.2) {
      const c = rule.when[Math.floor(random() * rule.when.length)];
      const [low, high] = SIGNAL_RANGES[c.signal];
      c.value = Math.round(Math.max(low, Math.min(high, c.value + 0.1 * (high - low) * gaussian(random))) * 100) / 100;
    } else if (pick < 0.4 && rule.take) rule.take[Math.floor(random() * rule.take.length)].from = sources[Math.floor(random() * sources.length)];
    else if (pick < 0.6 && rule.take) rule.take[Math.floor(random() * rule.take.length)].part = PART_NAMES[Math.floor(random() * PART_NAMES.length)];
    else if (pick < 0.8) rule.when[Math.floor(random() * rule.when.length)] = randomCondition(random);
    else rule.hold = Math.max(0, Math.min(6, rule.hold + (random() < 0.5 ? -1 : 1)));
  }
  rules.forEach((rule, i) => {
    rule.name = `${tag}-r${i}`;
  });
  return { base, rules };
}

async function searchPlaybooks(): Promise<void> {
  const size = Number(option('--size') ?? 4) as 2 | 3 | 4;
  const dir = option('--out');
  const stylesDir = option('--styles-from');
  if (!dir || !stylesDir) throw new Error('Give --out <dir> and --styles-from <dir of the style search>.');
  mkdirSync(dir, { recursive: true });
  const generations = Number(option('--generations') ?? 30);
  const populationSize = Number(option('--population') ?? 48);
  const keep = Number(option('--keep') ?? 12);
  const games = Number(option('--games') ?? 600);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const styleState = load(stylesDir);
  if (!styleState) throw new Error(`No style search in ${stylesDir}.`);
  const archive = Object.values(styleState.archive).sort((a, b) => b.score - a.score).slice(0, 16);
  const sources: Record<string, Style> = Object.fromEntries(archive.map((e) => [`cell-${e.cell}`, decode(e.genome, `cell-${e.cell}`)]));
  const names = [...Object.keys(sources), ...Object.values(PRESETS).filter((p) => p.playbook.rules.length === 0 && p.sizes.includes(size)).map((p) => p.name)];
  const resolve = (name: string) => sources[name] ?? school(name);
  const random = generator(`playbooks-${size}`);
  const file = join(dir, 'state.json');
  type Candidate = { id: string; genome: PlaybookGenome; score: number };
  let state: { generation: number; population: Candidate[]; history: { generation: number; best: string; bestScore: number }[]; best: Candidate | null } = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'), (_, v) => (v === 'Infinity' ? Infinity : v))
    : { generation: 0, population: [], history: [], best: null };
  if (state.population.length === 0) {
    const starts: Candidate[] = [
      { id: 'opportunist', genome: { base: 'opportunist-base', rules: PRESETS.opportunist.playbook.rules }, score: 0 },
      { id: 'reference', genome: { base: 'reference', rules: [] }, score: 0 },
      { id: 'two-stage', genome: { base: 'two-stage', rules: [] }, score: 0 },
      ...Object.keys(sources).map((name) => ({ id: name, genome: { base: name, rules: [] }, score: 0 })),
    ];
    sources['opportunist-base'] = PRESETS.opportunist.playbook.base;
    while (starts.length < populationSize) {
      const n = 1 + Math.floor(random() * 3);
      const id = `p0-${starts.length}`;
      starts.push({ id, genome: { base: names[Math.floor(random() * names.length)], rules: Array.from({ length: n }, (_, i) => randomRule(names, random, `${id}-r${i}`)) }, score: 0 });
    }
    state.population = starts.slice(0, Math.max(populationSize, starts.length));
  }
  sources['opportunist-base'] = PRESETS.opportunist.playbook.base;
  const pool = new Pool(workers);
  const started = performance.now();
  while (state.generation < generations) {
    const g = state.generation;
    const start = 2_000_000 + 50_000 + ((g * games) % 50_000);
    const scored = await Promise.all(
      state.population.map(async (c) => {
        const playbook: Playbook = { name: c.id, base: resolve(c.genome.base), rules: c.genome.rules };
        const s = await scoreStyle(pool, c.id, playbook.base, size, start, games, styleState.pool, styleState.poolStyles, { playbook, sources });
        return { ...c, score: s.wins / Math.max(1, s.finished) };
      }),
    );
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, keep);
    state.best = kept[0];
    state.history.push({ generation: g, best: kept[0].id, bestScore: kept[0].score });
    const children: Candidate[] = [];
    while (children.length + kept.length < populationSize) {
      const id = `p${g + 1}-${children.length}`;
      const parent = kept[Math.floor(random() * kept.length)];
      let genome = parent.genome;
      if (random() < 0.25) {
        const other = kept[Math.floor(random() * kept.length)].genome;
        genome = { base: genome.base, rules: genome.rules.map((rule, i) => (random() < 0.5 && other.rules[i] ? other.rules[i] : rule)) };
      }
      children.push({ id, genome: mutatePlaybook(genome, names, random, id), score: 0 });
    }
    state.population = [...kept, ...children];
    state.generation = g + 1;
    writeFileSync(`${file}.tmp`, JSON.stringify(state, (_, v) => (v === Infinity ? 'Infinity' : v)));
    renameSync(`${file}.tmp`, file);
    process.stderr.write(`${size} players, playbooks, generation ${g}: best ${kept[0].id} ${(kept[0].score * 100).toFixed(1)}%, ${((performance.now() - started) / 1000).toFixed(0)} s\n`);
  }
  pool.close();
  // Which signals the kept playbooks react to.
  const kept = state.population.slice(0, keep);
  const counts = new Map<string, number>();
  const parts = new Map<string, number>();
  for (const c of kept) {
    for (const rule of c.genome.rules) {
      for (const condition of rule.when) counts.set(condition.signal, (counts.get(condition.signal) ?? 0) + 1);
      for (const t of rule.take ?? []) parts.set(t.part, (parts.get(t.part) ?? 0) + 1);
    }
  }
  console.log(`# Playbook search, ${size} players\n`);
  console.log(`${state.generation} generations of ${populationSize}, ${games} games each. Best: ${state.best?.id} at ${((state.best?.score ?? 0) * 100).toFixed(1)}% on its last list of seeds.\n`);
  console.log('Signals the kept playbooks react to, and how often:\n');
  console.log('| Signal | Conditions |\n| --- | ---: |');
  for (const [signal, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`| ${signal} | ${n} |`);
  console.log('\nParts the kept playbooks switch, and how often:\n');
  console.log('| Part | Times taken |\n| --- | ---: |');
  for (const [part, n] of [...parts].sort((a, b) => b[1] - a[1])) console.log(`| ${part} | ${n} |`);
  console.log(`\nThe best playbook: \`${JSON.stringify(state.best?.genome)}\`\n`);
  const json = option('--json');
  if (json && state.best) {
    const best = state.best;
    const entry: FoundStyle = {
      name: `playbook-${size}-best`,
      size,
      playbook: { name: `playbook-${size}-best`, base: resolve(best.genome.base), rules: best.genome.rules },
      sources,
      record: { searchScore: Number(best.score.toFixed(4)), from: best.id, rules: best.genome.rules.length },
    };
    writeFileSync(json, JSON.stringify([entry], (_, v) => (v === Infinity ? 1e9 : v)));
  }
}

// ---------- Admission ----------

async function admit(): Promise<void> {
  const sizes = (option('--sizes') ?? '2,3,4').split(',').map(Number) as (2 | 3 | 4)[];
  const from = option('--from');
  if (!from) throw new Error('Give --from <dir>.');
  const games = Number(option('--games') ?? 5000);
  const candidates = Number(option('--candidates') ?? 24);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const pool = new Pool(workers);
  const found: FoundStyle[] = [];
  const lines: string[] = ['# Admission to the league\n'];
  for (const size of sizes) {
    const state = load(join(from, `styles-${size}`));
    if (!state) throw new Error(`No search state for ${size} players.`);
    const even = 1 / size;
    const entries = Object.values(state.archive).sort((a, b) => b.score - a.score).slice(0, candidates);
    const results = await Promise.all(
      entries.map(async (entry) => {
        const style = decode(entry.genome, `${option('--prefix') ?? 'found'}-${size}-${entry.cell}`);
        const s = await scoreStyle(pool, style.name, style, size, 2_100_000, games, ['baseline'], {});
        return { entry, style, share: s.wins / Math.max(1, s.finished), finished: s.finished };
      }),
    );
    results.sort((a, b) => b.share - a.share);
    lines.push(`## ${size} players\n`, '| Candidate | Cell | Search score | Win share among baselines | Admitted |', '| --- | --- | ---: | ---: | --- |');
    let admitted = 0;
    for (const [i, r] of results.entries()) {
      const z = 1.96;
      const half = z * Math.sqrt((r.share * (1 - r.share)) / Math.max(1, r.finished));
      const ok = i === 0 || (r.share >= even && r.share - half >= even - 0.02);
      const take = ok && admitted < 21;
      if (take) {
        admitted += 1;
        found.push({
          name: r.style.name,
          size,
          playbook: { name: r.style.name, base: r.style, rules: [] },
          record: { cell: r.entry.cell, searchScore: Number(r.entry.score.toFixed(4)), admissionShare: Number(r.share.toFixed(4)), games: r.finished, from: r.entry.id },
        });
      }
      lines.push(`| ${r.entry.id} | ${r.entry.cell} | ${(r.entry.score * 100).toFixed(1)}% | ${(r.share * 100).toFixed(1)}% ± ${(half * 100).toFixed(1)} | ${take ? 'yes' : 'no'} |`);
    }
    lines.push('');
  }
  pool.close();
  const text = [
    '/**',
    ' * Generated by `node scripts/search-styles.ts --admit`. Do not edit by hand.',
    ' * The styles and playbooks the search admitted to the league, with their records.',
    ' */',
    "import type { FoundStyle } from './league.ts';",
    '',
    `export const FOUND: FoundStyle[] = ${JSON.stringify(found, (_, v) => (v === Infinity ? 1e9 : v), 2)};`,
    '',
  ].join('\n');
  const json = option('--json');
  if (json) writeFileSync(json, JSON.stringify(found, (_, v) => (v === Infinity ? 1e9 : v)));
  else writeFileSync(option('--write') ?? 'src/sim/styles-found.ts', text);
  console.log(lines.join('\n'));
}

/** Writes src/sim/styles-found.ts from the admission files of several sizes. */
function mergeFound(files: string[], out: string): void {
  const found = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as FoundStyle[]);
  const text = [
    '/**',
    ' * Generated by `node scripts/search-styles.ts --merge-found`. Do not edit by hand.',
    ' * The styles and playbooks the search admitted to the league, with their records.',
    ' */',
    "import type { FoundStyle } from './league.ts';",
    '',
    `export const FOUND: FoundStyle[] = ${JSON.stringify(found, null, 2)};`,
    '',
  ].join('\n');
  writeFileSync(out, text);
  console.log(`Wrote ${out}: ${found.length} admitted styles.`);
}

if (process.argv[2] === '--worker') {
  const engine = createEngine(threeKingdoms);
  process.on('message', (job: ScoreJob & { key: string }) => process.send?.({ ...runScore(engine, job), key: job.key }));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--merge-found')) mergeFound((option('--merge-found') as string).split(','), option('--out') ?? 'src/sim/styles-found.ts');
  else if (process.argv.includes('--admit')) await admit();
  else if (process.argv.includes('--playbooks')) await searchPlaybooks();
  else await search();
}
