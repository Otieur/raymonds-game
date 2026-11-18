/**
 * Fits the valuation V1 from snapshot files and prints how well it tells who will win.
 *
 *   node scripts/fit-valuation.ts --snapshots <dir> [--sizes 2,3,4] [--out src/sim/valuation-v1.ts]
 *        [--games 100000] [--grid-games 20000] [--limit <lines>]
 *
 * For each table size it reads `full-<n>.jsonl`, rebuilds every position, and computes the
 * features of every seat still in. Games are split by seed: the first 70% to fit, the next 15% to
 * choose the penalties, the last 15% to test. The model gives each seat a score, a weighted sum of
 * its features with weights that move in straight lines between knot rounds, and a seat's chance
 * of winning is its share of exp(score) over the seats still in. It is fitted by maximum likelihood
 * with L-BFGS, with a ridge penalty on every weight and a penalty on each weight's second difference
 * across the knots. Two one-feature models are fitted the same way for comparison: the seat's share
 * of net worth, and its share of the rent roll within reach.
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { buildContext } from '../src/context.ts';
import { netWorth } from '../src/engine/queries.ts';
import { createEngine, threeKingdoms } from '../src/index.ts';
import { reachRoll, viewOf } from '../src/sim/measures.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';
import { chances, lbfgs, objective } from '../src/sim/logit.ts';
import type { Features } from '../src/sim/logit.ts';
import { V1_FEATURES, v1Features } from '../src/sim/valuation.ts';

const KNOTS = [5, 10, 20, 30, 45, 60];
const LAMBDAS = [0.01, 0.1, 1, 10, 100];
const MUS = [0, 1, 10];

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);
const F = V1_FEATURES.length;

// ---------- Data ----------

/** Growable typed array of 32-bit floats. */
class Floats {
  data = new Float32Array(1 << 20);
  length = 0;
  push(value: number): void {
    if (this.length === this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = value;
  }
}

interface Data {
  /** Features of every seat row, F numbers each. */
  x: Float32Array;
  /** Comparison features of every seat row: net-worth share, rent-roll-within-reach share. */
  compare: Float32Array;
  /** For every snapshot: its first seat row, its seat count, the winner's position among them. */
  start: Int32Array;
  count: Int8Array;
  winner: Int8Array;
  round: Int16Array;
  seed: Int32Array;
  /** 0 fit, 1 choose, 2 test. */
  split: Int8Array;
  snapshots: number;
  seatRows: number;
}

async function load(file: string, games: number, limit: number): Promise<Data> {
  const x = new Floats();
  const compare = new Floats();
  const start: number[] = [];
  const count: number[] = [];
  const winner: number[] = [];
  const round: number[] = [];
  const seed: number[] = [];
  const split: number[] = [];
  let seatRows = 0;
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  const began = performance.now();
  for await (const line of reader) {
    if (!line) continue;
    if (start.length >= limit) break;
    const row = JSON.parse(line) as SnapshotRow;
    const state = stateOf(ctx, row);
    const { seats, x: features } = v1Features(ctx, state);
    const at = seats.indexOf(row.win);
    if (at === -1) throw new Error(`Seed ${row.seed}, round ${row.round}: the winner is out.`);
    const view = viewOf(ctx, state);
    const worth = seats.map((i) => Math.max(0, netWorth(ctx, state, state.players[i].id)));
    const reach = seats.map((i) => reachRoll(view, state.players[i]));
    const worthTotal = worth.reduce((a, b) => a + b, 0) || 1;
    const reachTotal = reach.reduce((a, b) => a + b, 0) || 1;
    start.push(seatRows);
    count.push(seats.length);
    winner.push(at);
    round.push(row.round);
    seed.push(row.seed);
    split.push(row.seed <= games * 0.7 ? 0 : row.seed <= games * 0.85 ? 1 : 2);
    features.forEach((values, k) => {
      for (const value of values) x.push(value);
      compare.push(worth[k] / worthTotal);
      compare.push(reach[k] / reachTotal);
    });
    seatRows += seats.length;
    if (start.length % 100000 === 0) {
      process.stderr.write(`  ${start.length} snapshots, ${((performance.now() - began) / 1000).toFixed(0)} s\n`);
    }
  }
  return {
    x: x.data.subarray(0, x.length),
    compare: compare.data.subarray(0, compare.length),
    start: Int32Array.from(start),
    count: Int8Array.from(count),
    winner: Int8Array.from(winner),
    round: Int16Array.from(round),
    seed: Int32Array.from(seed),
    split: Int8Array.from(split),
    snapshots: start.length,
    seatRows,
  };
}

const mainFeatures = (data: Data): Features => ({ values: data.x, width: F, offset: 0 });
const comparison = (data: Data, which: 0 | 1): Features => ({ values: data.compare, width: 2, offset: which });

function logLoss(data: Data, rows: Int32Array, p: Float64Array): number {
  let total = 0;
  for (const s of rows) total -= Math.log(Math.max(1e-12, p[data.start[s] + data.winner[s]]));
  return total / rows.length;
}

// ---------- Reports ----------

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

function wilson(wins: number, games: number): [number, number] {
  const z = 1.96;
  const share = wins / games;
  const centre = (share + (z * z) / (2 * games)) / (1 + (z * z) / games);
  const half = (z * Math.sqrt((share * (1 - share)) / games + (z * z) / (4 * games * games))) / (1 + (z * z) / games);
  return [centre - half, centre + half];
}

/** How often the leader goes on to win, by round; ties share the credit. */
function leaderRate(data: Data, rows: Int32Array, p: Float64Array, round: number): { rate: number; n: number } {
  let credit = 0;
  let n = 0;
  for (const s of rows) {
    if (data.round[s] !== round) continue;
    const first = data.start[s];
    const c = data.count[s];
    let top = -Infinity;
    for (let i = 0; i < c; i++) top = Math.max(top, p[first + i]);
    const leaders: number[] = [];
    for (let i = 0; i < c; i++) if (Math.abs(p[first + i] - top) < 1e-12) leaders.push(i);
    if (leaders.length === c) continue;
    n += 1;
    if (leaders.includes(data.winner[s])) credit += 1 / leaders.length;
  }
  return { rate: n ? credit / n : NaN, n };
}

/** A 95% interval for the mean, over games, of the difference in log loss, by bootstrap. */
function bootstrapDifference(data: Data, rows: Int32Array, pa: Float64Array, pb: Float64Array): [number, number, number] {
  const byGame = new Map<number, { sum: number; n: number }>();
  for (const s of rows) {
    const g = byGame.get(data.seed[s]) ?? { sum: 0, n: 0 };
    const win = data.start[s] + data.winner[s];
    g.sum += -Math.log(Math.max(1e-12, pa[win])) + Math.log(Math.max(1e-12, pb[win]));
    g.n += 1;
    byGame.set(data.seed[s], g);
  }
  const games = [...byGame.values()];
  const total = games.reduce((a, g) => a + g.sum, 0) / games.reduce((a, g) => a + g.n, 0);
  const holder = { rng: seedFrom('bootstrap') };
  const random = () => nextFloat(holder);
  const means: number[] = [];
  for (let b = 0; b < 1000; b++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[Math.floor(random() * games.length)];
      sum += g.sum;
      n += g.n;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return [total, means[25], means[974]];
}

function calibration(data: Data, rows: Int32Array, p: Float64Array): { bins: { mean: number; won: number; n: number }[]; worst: number } {
  const bins = Array.from({ length: 10 }, () => ({ sum: 0, won: 0, n: 0 }));
  for (const s of rows) {
    const first = data.start[s];
    for (let i = 0; i < data.count[s]; i++) {
      const q = p[first + i];
      const bin = bins[Math.min(9, Math.floor(q * 10))];
      bin.sum += q;
      bin.n += 1;
      if (i === data.winner[s]) bin.won += 1;
    }
  }
  const out = bins.map((b) => ({ mean: b.n ? b.sum / b.n : NaN, won: b.n ? b.won / b.n : NaN, n: b.n }));
  const worst = Math.max(...out.filter((b) => b.n >= 200).map((b) => Math.abs(b.won - b.mean)));
  return { bins: out, worst };
}

function table(headers: string[], rows: (string | number)[][]): void {
  console.log(`| ${headers.join(' | ')} |`);
  console.log(`| ${headers.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
  for (const row of rows) console.log(`| ${row.join(' | ')} |`);
  console.log('');
}

// ---------- Main ----------

// Joining fits made in separate processes, one for each table size.
const combine = option('--combine');
if (combine) {
  const fitted: Record<number, number[][]> = {};
  for (const file of combine.split(',')) Object.assign(fitted, JSON.parse(readFileSync(file, 'utf8')));
  writeModule(option('--out') ?? 'src/sim/valuation-v1.ts', fitted, Number(option('--games') ?? 100000));
  process.exit(0);
}

const dir = option('--snapshots');
if (!dir) throw new Error('Give --snapshots <dir>.');
const sizes = (option('--sizes') ?? '2,3,4').split(',').map(Number);
const games = Number(option('--games') ?? 100000);
const gridGames = Number(option('--grid-games') ?? 20000);
const limit = Number(option('--limit') ?? Infinity);
const out = option('--out');
const fitted: Record<number, number[][]> = {};

console.log('# Valuation V1\n');
console.log(
  `Snapshots from \`${dir}\`. Games split by seed: up to ${games * 0.7} to fit, up to ${games * 0.85} to choose the penalties, the rest to test. Knots at rounds ${KNOTS.join(', ')}. ${F} features.\n`,
);

for (const n of sizes) {
  const began = performance.now();
  process.stderr.write(`${n} players: loading\n`);
  const data = await load(join(dir, `full-${n}.jsonl`), games, limit);
  if (data.snapshots === 0) throw new Error(`No snapshots for ${n} players.`);
  const rowsOf = (part: number, maxSeed = Infinity) =>
    Int32Array.from(Array.from({ length: data.snapshots }, (_, s) => s).filter((s) => data.split[s] === part && data.seed[s] <= maxSeed));
  const fitRows = rowsOf(0);
  const gridRows = rowsOf(0, gridGames);
  const chooseRows = rowsOf(1);
  const testRows = rowsOf(2);
  process.stderr.write(
    `${n} players: ${data.snapshots} snapshots, ${data.seatRows} seat rows, loaded in ${((performance.now() - began) / 1000).toFixed(0)} s\n`,
  );

  const K = KNOTS.length;
  const main = mainFeatures(data);
  const given = option('--weights-in') ? (JSON.parse(readFileSync(option('--weights-in') as string, 'utf8')) as Record<number, number[][]>)[n] : null;
  // Choose the penalties on a subset of the fitting games, judged on the choosing games.
  let best: { lambda: number; mu: number; loss: number; w: Float64Array } = { lambda: 1, mu: 1, loss: Infinity, w: new Float64Array(K * F) };
  const grid: (string | number)[][] = [];
  let warm: Float64Array = new Float64Array(K * F);
  for (const lambda of given ? [] : [...LAMBDAS].reverse()) {
    for (const mu of MUS) {
      const w = lbfgs((v) => objective(KNOTS, data, main, F, gridRows, v, lambda, mu), warm);
      warm = w;
      const loss = logLoss(data, chooseRows, chances(KNOTS, data, main, F, chooseRows, w));
      grid.push([lambda, mu, loss.toFixed(5)]);
      process.stderr.write(`${n} players: lambda ${lambda}, mu ${mu}: ${loss.toFixed(5)}\n`);
      if (loss < best.loss) best = { lambda, mu, loss, w };
    }
  }
  process.stderr.write(`${n} players: final fit with lambda ${best.lambda}, mu ${best.mu}\n`);
  const w = given ? Float64Array.from(given.flat()) : lbfgs((v) => objective(KNOTS, data, main, F, fitRows, v, best.lambda, best.mu), best.w, 600);
  fitted[n] = Array.from({ length: K }, (_, k) => Array.from(w.subarray(k * F, (k + 1) * F)));

  const fitOne = (which: 0 | 1) => lbfgs((v) => objective(KNOTS, data, comparison(data, which), 1, fitRows, v, 1, 1), new Float64Array(K));
  const wWorth = fitOne(0);
  const wReach = fitOne(1);

  const pV1 = chances(KNOTS, data, main, F, testRows, w);
  const pWorth = chances(KNOTS, data, comparison(data, 0), 1, testRows, wWorth);
  const pReach = chances(KNOTS, data, comparison(data, 1), 1, testRows, wReach);
  const even = new Float64Array(data.seatRows);
  for (const s of testRows) for (let i = 0; i < data.count[s]; i++) even[data.start[s] + i] = 1 / data.count[s];

  console.log(`## ${n} players\n`);
  console.log(
    `${data.snapshots} snapshots from ${new Set(Array.from(data.seed)).size} games: ${fitRows.length} to fit (${gridRows.length} of them for the grid), ${chooseRows.length} to choose, ${testRows.length} to test. ${given ? `Weights from ${option('--weights-in')}.` : `Chosen penalties: ridge ${best.lambda}, smoothness ${best.mu}.`} ${((performance.now() - began) / 1000).toFixed(0)} s.\n`,
  );
  console.log('Log loss on the choosing games, by penalty:\n');
  table(['Ridge', 'Smoothness', 'Log loss'], grid);

  console.log('Log loss on the test games (lower is better):\n');
  const dWorth = bootstrapDifference(data, testRows, pWorth, pV1);
  const dReach = bootstrapDifference(data, testRows, pReach, pV1);
  table(
    ['Model', 'Log loss', 'Worse than V1 by, with 95% interval'],
    [
      ['Even shares', logLoss(data, testRows, even).toFixed(5), ''],
      ['Share of net worth', logLoss(data, testRows, pWorth).toFixed(5), `${dWorth[0].toFixed(5)} (${dWorth[1].toFixed(5)} to ${dWorth[2].toFixed(5)})`],
      ['Share of the rent roll within reach', logLoss(data, testRows, pReach).toFixed(5), `${dReach[0].toFixed(5)} (${dReach[1].toFixed(5)} to ${dReach[2].toFixed(5)})`],
      ['V1', logLoss(data, testRows, pV1).toFixed(5), ''],
    ],
  );

  console.log('How often the leader goes on to win, on the test games:\n');
  const rounds = [10, 20, 30, 40];
  const leaderRows = (label: string, p: Float64Array) => [
    label,
    ...rounds.map((r) => {
      const { rate, n: count } = leaderRate(data, testRows, p, r);
      if (!count) return 'n/a';
      const [lo, hi] = wilson(rate * count, count);
      return `${pct(rate)} (${pct(lo)} to ${pct(hi)})`;
    }),
  ];
  table(
    ['Leader by', ...rounds.map((r) => `Round ${r}`)],
    [leaderRows('Net worth', pWorth), leaderRows('Rent roll within reach', pReach), leaderRows('V1', pV1)],
  );

  const cal = calibration(data, testRows, pV1);
  console.log(`Calibration of V1 on the test games (largest gap in a tenth with at least 200 seats: ${pct(cal.worst)}):\n`);
  table(
    ['Predicted', 'Seats', 'Mean prediction', 'Share won'],
    cal.bins.map((b, i) => [`${i * 10}% to ${i * 10 + 10}%`, b.n, b.n ? pct(b.mean) : 'n/a', b.n ? pct(b.won) : 'n/a']),
  );

  console.log('Weights by knot:\n');
  table(
    ['Feature', ...KNOTS.map((k) => `Round ${k}`)],
    V1_FEATURES.map((name, f) => [name, ...KNOTS.map((_, k) => w[k * F + f].toFixed(3))]),
  );
}

const weightsFile = option('--weights');
if (weightsFile) {
  mkdirSync(dirname(weightsFile), { recursive: true });
  writeFileSync(weightsFile, JSON.stringify(fitted));
}
if (out) writeModule(out, fitted, games);

function writeModule(out: string, fitted: Record<number, number[][]>, games: number): void {
  for (const [n, weights] of Object.entries(fitted)) {
    if (weights.flat().some((v) => !Number.isFinite(v))) throw new Error(`The fit for ${n} players has weights that are not numbers.`);
  }
  const commit = process.env.FIT_COMMIT ?? 'unknown';
  const text = [
    '/**',
    ' * Generated by `node scripts/fit-valuation.ts`. Do not edit by hand.',
    ` * Fitted ${new Date().toISOString().slice(0, 10)} from snapshots of ${games} games for each table size,`,
    ` * fitting on seeds 1 to ${games * 0.7}, commit ${commit}.`,
    ' */',
    "import type { V1Model } from './valuation.ts';",
    '',
    `const KNOTS = ${JSON.stringify(KNOTS)};`,
    `const FEATURES = ${JSON.stringify(V1_FEATURES)};`,
    '',
    'export const V1_MODELS: Record<number, V1Model> = {',
    ...Object.entries(fitted).map(
      ([n, weights]) => `  ${n}: { knots: KNOTS, features: FEATURES, weights: ${JSON.stringify(weights.map((row) => row.map((v) => Number(v.toPrecision(6)))))} },`,
    ),
    '};',
    '',
  ].join('\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  process.stderr.write(`Wrote ${out}\n`);
}
