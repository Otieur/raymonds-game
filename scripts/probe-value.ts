/**
 * Measures what a purchase from the bank is worth by intervention: take a position from a
 * simulated game, change one thing, and play every version to the end many times.
 *
 *   node scripts/probe-value.ts --snapshots <dir> [--sizes 2,3,4] [--positions 100] [--playouts 10]
 *        [--rounds 5,10,15,20] [--from-seed 85001] [--workers 8] [--json <file>]
 *
 * Arms, for a seat and a property the bank still holds:
 *   B  no change;
 *   A  the seat buys the property at its list price (skipped if it cannot pay);
 *   D  the seat is given the property for nothing;
 *   C  the seat is given 200 coins.
 * Every arm of a position is played out with the same fresh draws of dice and decks, by the
 * rule-based agent at every seat. A cell is a set, what the seat already holds of it, a round and
 * a table size. For each cell the report gives the differences A - B, D - B and C - B in the seat's
 * win share, the worth of the property in coins as 200 (D - B) / (C - B), and what V1 predicts.
 */
import { fork } from 'node:child_process';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../src/context.ts';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState, PropertySquare } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { holds, setOf, viewOf } from '../src/sim/measures.ts';
import { isOut, stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';
import { priceOf, v1 } from '../src/sim/valuation.ts';

const ARMS = ['B', 'A', 'D', 'C'] as const;
type Arm = (typeof ARMS)[number];
const GIFT = 200;
const ACTION_LIMIT = 40000;

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

interface Position {
  row: SnapshotRow;
  seat: number;
  property: string;
  cell: string;
}

interface Outcome {
  cell: string;
  /** Wins of the seat in each arm, out of `playouts`; null for an arm that was skipped. */
  wins: Record<Arm, number | null>;
  playouts: number;
  unfinished: number;
  /** V1's chance for the seat at the start of each arm. */
  predicted: Record<Arm, number | null>;
  /** What V1 says the gift of the property is worth, in coins. */
  price: number;
}

/** What the seat holds of the property's set: nothing, part, or all but this one. */
function heldClass(state: GameState, seat: number, sq: PropertySquare): 'none' | 'part' | 'last' | null {
  const set = setOf(sq);
  const view = viewOf(ctx, state);
  const size = view.sizes.get(set) ?? 1;
  const held = holds(view, set, state.players[seat].id);
  if (held === 0) return 'none';
  if (held === size - 1) return 'last';
  return 'part';
}

function changed(base: GameState, arm: Arm, seat: number, sq: PropertySquare): GameState | null {
  const state = structuredClone(base);
  const player = state.players[seat];
  if (arm === 'A') {
    if (player.cash < sq.price) return null;
    player.cash -= sq.price;
    state.properties[sq.id].owner = player.id;
  } else if (arm === 'D') {
    state.properties[sq.id].owner = player.id;
  } else if (arm === 'C') {
    player.cash += GIFT;
  }
  return state;
}

function playOut(start: GameState, seed: string): string | null {
  const holder = { rng: seedFrom(`${seed}-agents`) };
  const random = () => nextFloat(holder);
  const memory = createAgentMemory();
  let state = start;
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const actor = waiting[Math.floor(random() * waiting.length)];
    const action = chooseHeuristicAction(engine, state, actor, random, memory);
    if (!action) throw new Error(`No action for ${actor} in a playout (${seed}).`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`A playout action was refused (${seed}): ${result.error.message}`);
    state = result.state;
  }
  return state.winner;
}

function probe(position: Position, playouts: number): Outcome {
  const { row, seat } = position;
  const sq = ctx.properties.get(position.property) as PropertySquare;
  const valuation = v1(row.n);
  const wins: Record<Arm, number | null> = { B: 0, A: 0, D: 0, C: 0 };
  const predicted: Record<Arm, number | null> = { B: null, A: null, D: null, C: null };
  let unfinished = 0;
  const base = stateOf(ctx, row);
  for (const arm of ARMS) {
    const start = changed(base, arm, seat, sq);
    if (!start) {
      wins[arm] = null;
      continue;
    }
    predicted[arm] = valuation.chances(ctx, start)[seat];
  }
  for (let j = 0; j < playouts; j++) {
    const draw = `probe-${row.table}-${row.seed}-${row.round}-${position.property}-${j}`;
    const fresh = stateOf(ctx, row, draw);
    for (const arm of ARMS) {
      if (wins[arm] === null) continue;
      const start = changed(fresh, arm, seat, sq) as GameState;
      const winner = playOut(start, draw);
      if (winner === null) unfinished += 1;
      else if (winner === start.players[seat].id) wins[arm] = (wins[arm] as number) + 1;
    }
  }
  const gift = changed(base, 'D', seat, sq) as GameState;
  const price = priceOf(valuation, ctx, base, gift, base.players[seat].id, 5 * sq.price);
  return { cell: position.cell, wins, playouts, unfinished, predicted, price };
}

// ---------- Choosing positions ----------

async function choose(file: string, size: number, rounds: number[], fromSeed: number, cap: number): Promise<Position[]> {
  const counts = new Map<string, number>();
  const chosen: Position[] = [];
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    const row = JSON.parse(line) as SnapshotRow;
    if (row.seed < fromSeed || !rounds.includes(row.round)) continue;
    const state = stateOf(ctx, row);
    const candidates: Position[] = [];
    for (let seat = 0; seat < row.n; seat++) {
      if (isOut(row, seat)) continue;
      for (const sq of ctx.propertyOrder) {
        if (state.properties[sq.id].owner !== null) continue;
        const held = heldClass(state, seat, sq);
        if (!held) continue;
        const cell = `${size}|${setOf(sq)}|${held}|${row.round}`;
        if ((counts.get(cell) ?? 0) >= cap) continue;
        candidates.push({ row, seat, property: sq.id, cell });
      }
    }
    if (candidates.length === 0) continue;
    // The candidate whose cell is emptiest, ties broken by a draw fixed by the position.
    const holder = { rng: seedFrom(`choose-${row.table}-${row.seed}-${row.round}`) };
    const least = Math.min(...candidates.map((c) => counts.get(c.cell) ?? 0));
    const pool = candidates.filter((c) => (counts.get(c.cell) ?? 0) === least);
    const pick = pool[Math.floor(nextFloat(holder) * pool.length)];
    chosen.push(pick);
    counts.set(pick.cell, (counts.get(pick.cell) ?? 0) + 1);
  }
  return chosen;
}

// ---------- Running ----------

function runAll(positions: Position[], playouts: number, workers: number): Promise<Outcome[]> {
  const CHUNK = 10;
  const jobs: Position[][] = [];
  for (let i = 0; i < positions.length; i += CHUNK) jobs.push(positions.slice(i, i + CHUNK));
  const results: Outcome[][] = [];
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let next = 0;
    let done = 0;
    if (jobs.length === 0) resolve([]);
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), ['--worker', String(playouts)]);
      const give = () => {
        if (next < jobs.length) {
          child.send({ index: next, positions: jobs[next] });
          next += 1;
        } else child.disconnect();
      };
      child.on('message', (message: { index: number; outcomes: Outcome[] }) => {
        results[message.index] = message.outcomes;
        done += 1;
        if (done % 20 === 0 || done === jobs.length) {
          const seconds = (performance.now() - started) / 1000;
          process.stderr.write(`${done} of ${jobs.length} jobs, ${seconds.toFixed(0)} s\n`);
        }
        if (done === jobs.length) resolve(results.flat());
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

// ---------- Report ----------

interface CellSummary {
  cell: string;
  positions: number;
  b: number;
  aMinusB: number | null;
  dMinusB: number;
  dMinusBHalf: number;
  cMinusB: number;
  coins: number | null;
  predictedDMinusB: number;
  price: number;
  unfinished: number;
}

function summarize(outcomes: Outcome[]): CellSummary[] {
  const byCell = new Map<string, Outcome[]>();
  for (const o of outcomes) byCell.set(o.cell, [...(byCell.get(o.cell) ?? []), o]);
  const out: CellSummary[] = [];
  for (const [cell, list] of byCell) {
    const share = (o: Outcome, arm: Arm) => (o.wins[arm] as number) / o.playouts;
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const d = list.map((o) => share(o, 'D') - share(o, 'B'));
    const dMean = mean(d);
    const sd = Math.sqrt(d.reduce((a, v) => a + (v - dMean) ** 2, 0) / Math.max(1, d.length - 1));
    const withA = list.filter((o) => o.wins.A !== null);
    const cMinusB = mean(list.map((o) => share(o, 'C') - share(o, 'B')));
    out.push({
      cell,
      positions: list.length,
      b: mean(list.map((o) => share(o, 'B'))),
      aMinusB: withA.length > 0 ? mean(withA.map((o) => share(o, 'A') - share(o, 'B'))) : null,
      dMinusB: dMean,
      dMinusBHalf: (1.96 * sd) / Math.sqrt(d.length),
      cMinusB,
      coins: cMinusB > 0.005 ? (GIFT * dMean) / cMinusB : null,
      predictedDMinusB: mean(list.map((o) => (o.predicted.D as number) - (o.predicted.B as number))),
      price: mean(list.map((o) => o.price)),
      unfinished: list.reduce((a, o) => a + o.unfinished, 0),
    });
  }
  return out.sort((a, b) => (a.cell < b.cell ? -1 : 1));
}

function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    order.forEach(([, i], k) => {
      r[i] = k;
    });
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - ma);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - ma) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const pts = (v: number | null) => (v === null ? 'n/a' : (v * 100).toFixed(1));

function report(summaries: CellSummary[], minimum: number): void {
  const usable = summaries.filter((s) => s.positions >= minimum);
  const clear = usable.filter((s) => Math.abs(s.dMinusB) > s.dMinusBHalf);
  const agree = clear.filter((s) => Math.sign(s.predictedDMinusB) === Math.sign(s.dMinusB)).length;
  const rho = usable.length > 2 ? spearman(usable.map((s) => s.dMinusB), usable.map((s) => s.predictedDMinusB)) : NaN;
  console.log(
    `Cells with at least ${minimum} positions: ${usable.length} of ${summaries.length}. Of those, ${clear.length} have a measured D - B whose interval excludes zero; V1 has the same sign in ${agree} (${clear.length ? ((100 * agree) / clear.length).toFixed(1) : 'n/a'}%). Rank correlation of predicted and measured D - B over the usable cells: ${rho.toFixed(3)}.\n`,
  );
  console.log('Differences are in points of the seat\'s win share. Worth in coins is 200 (D - B) / (C - B), shown where C - B is above half a point.\n');
  console.log('| Size | Set | Seat holds | Round | Positions | B | A - B | D - B | C - B | Worth in coins | V1: D - B | V1: price of D |');
  console.log('| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of usable) {
    const [size, set, held, round] = s.cell.split('|');
    console.log(
      `| ${size} | ${set} | ${held} | ${round} | ${s.positions} | ${pts(s.b)} | ${pts(s.aMinusB)} | ${pts(s.dMinusB)} ± ${pts(s.dMinusBHalf)} | ${pts(s.cMinusB)} | ${s.coins === null ? 'n/a' : s.coins.toFixed(0)} | ${pts(s.predictedDMinusB)} | ${s.price.toFixed(0)} |`,
    );
  }
  console.log('');
}

// ---------- Main ----------

if (process.argv[2] === '--worker') {
  const playouts = Number(process.argv[3]);
  process.on('message', (job: { index: number; positions: Position[] }) => {
    process.send?.({ index: job.index, outcomes: job.positions.map((p) => probe(p, playouts)) });
  });
} else {
  const dir = option('--snapshots');
  if (!dir) throw new Error('Give --snapshots <dir>.');
  const sizes = (option('--sizes') ?? '2,3,4').split(',').map(Number);
  const cap = Number(option('--positions') ?? 100);
  const playouts = Number(option('--playouts') ?? 10);
  const rounds = (option('--rounds') ?? '5,10,15,20').split(',').map(Number);
  const fromSeed = Number(option('--from-seed') ?? 85001);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const sets = option('--sets')?.split(',');
  const started = performance.now();
  let positions: Position[] = [];
  for (const n of sizes) {
    const found = await choose(join(dir, `full-${n}.jsonl`), n, rounds, fromSeed, cap);
    positions.push(...found);
    process.stderr.write(`${n} players: ${found.length} positions\n`);
  }
  if (sets) positions = positions.filter((p) => sets.includes(p.cell.split('|')[1]));
  const outcomes = await runAll(positions, playouts, workers);
  const seconds = (performance.now() - started) / 1000;
  console.log('# What a purchase is worth, by intervention\n');
  console.log(
    `Positions from the test games of \`${dir}\` (seeds from ${fromSeed}), rounds ${rounds.join(', ')}, up to ${cap} positions a cell, ${playouts} playouts an arm, the rule-based agent at every seat. ${positions.length} positions, ${seconds.toFixed(0)} seconds on ${workers} processes.\n`,
  );
  const summaries = summarize(outcomes);
  report(summaries, 50);
  const json = option('--json');
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify({ cap, playouts, rounds, fromSeed, summaries, outcomes }));
    process.stderr.write(`Saved ${json}\n`);
  }
}
