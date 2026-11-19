/**
 * Plays the league's standard tables and prints the league report.
 *
 *   node scripts/league.ts [--sizes 2,3,4] [--games 2000] [--mixed 20000] [--members a,b,c] [--seeds 2100000]
 *        [--workers 8] [--json <file>]
 *
 * One among copies: one seat for member X, the rest for copies of member Y, for every ordered pair
 * of members meant for the size, on the same seeds. Mixed: every seat drawn from the members. The
 * members are the fixed ones and the admitted styles unless `--members` names them.
 */
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Engine, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { leagueOf, memberAgent } from '../src/sim/league.ts';
import './model-loader.ts';
import { rate } from '../src/sim/rating.ts';
import type { Order } from '../src/sim/rating.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';
import { addPolitics, createPoliticsWatch, emptyTablePolitics } from '../src/sim/politics.ts';
import type { TablePolitics } from '../src/sim/politics.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import { v1 } from '../src/sim/valuation.ts';

const ACTION_LIMIT = 40000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

export interface TableResult {
  finished: boolean;
  /** Seat index of the winner, or -1. */
  winner: number;
  /** Seat indices in finishing order, first to last; empty if unfinished. */
  order: number[];
  turns: number;
  /** The table's measures of politics, when they were asked for. */
  politics?: TablePolitics;
}

/** Plays one game with the named members in seats 0, 1, ... (the opening roll then sets the order of play). */
export function playTable(engine: Engine, members: string[], seed: number, tag = 'league', politics = false): TableResult {
  const holder = { rng: seedFrom(`${tag}-${members.length}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = members.map((_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, memberAgent(members[i])]));
  const eliminated: PlayerId[] = [];
  const windows = createDebtWindows();
  const watch = politics ? createPoliticsWatch(contextOf(engine), ids, v1(members.length)) : null;
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    // At a debt the debtor cannot cover, seats that offer for its property are asked first.
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`${members.join(',')}, seed ${seed}: ${actor} has no action.`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`${members.join(',')}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    watch?.note(state, result.events, result.state);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
    for (const event of result.events) if (event.type === 'BANKRUPT') eliminated.push(event.player);
  }
  const seen = watch?.finish(state).table;
  if (state.winner === null) return { finished: false, winner: -1, order: [], turns: state.turn.number, politics: seen };
  const winner = ids.indexOf(state.winner);
  const rest = ids.filter((id) => id !== state.winner && !eliminated.includes(id));
  const order = [state.winner, ...rest, ...[...eliminated].reverse()].map((id) => ids.indexOf(id));
  return { finished: true, winner, order, turns: state.turn.number, politics: seen };
}

type Job =
  | { kind: 'pair'; size: number; x: string; y: string; from: number; to: number; key: string }
  | { kind: 'mixed'; size: number; members: string[]; from: number; to: number; key: string };

interface JobResult {
  key: string;
  /** The job's first seed. */
  from: number;
  /** For one-among-copies tables: the one's outcome by seed from `from` (1 a win, 0 none, -1 unfinished). */
  outcomes?: number[];
  games: number;
  finished: number;
  wins: number;
  turns: number;
  orders: Order[];
  /** For mixed tables: the table's measures of politics. */
  politics?: TablePolitics;
}

function runJob(engine: Engine, job: Job): JobResult {
  const out: JobResult = { key: job.key, from: job.from, outcomes: job.kind === 'pair' ? [] : undefined, games: 0, finished: 0, wins: 0, turns: 0, orders: [] };
  for (let seed = job.from; seed <= job.to; seed++) {
    let seats: string[];
    if (job.kind === 'pair') seats = [job.x, ...Array.from({ length: job.size - 1 }, () => job.y)];
    else {
      const holder = { rng: seedFrom(`mixed-${job.size}-${seed}`) };
      seats = Array.from({ length: job.size }, () => job.members[Math.floor(nextFloat(holder) * job.members.length)]);
    }
    const result = playTable(engine, seats, seed, 'league', job.kind === 'mixed');
    if (result.politics) out.politics = addPolitics(out.politics ?? emptyTablePolitics(), result.politics);
    out.games += 1;
    out.outcomes?.push(!result.finished ? -1 : result.winner === 0 ? 1 : 0);
    if (!result.finished) continue;
    out.finished += 1;
    out.turns += result.turns;
    if (result.winner === 0) out.wins += 1;
    if (job.kind === 'mixed') out.orders.push(result.order.map((i) => seats[i]));
  }
  return out;
}

export function runJobs(jobs: Job[], workers: number): Promise<JobResult[]> {
  const results: JobResult[] = [];
  const started = performance.now();
  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve([]);
    let next = 0;
    let done = 0;
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), ['--worker']);
      const give = () => {
        if (next < jobs.length) child.send(jobs[next++]);
        else child.disconnect();
      };
      child.on('message', (result: JobResult) => {
        results.push(result);
        done += 1;
        if (done % 50 === 0 || done === jobs.length) process.stderr.write(`${done} of ${jobs.length} jobs, ${((performance.now() - started) / 1000).toFixed(0)} s\n`);
        if (done === jobs.length) resolve(results);
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

function wilson(wins: number, games: number): [number, number] {
  if (games === 0) return [NaN, NaN];
  const z = 1.96;
  const p = wins / games;
  const centre = (p + (z * z) / (2 * games)) / (1 + (z * z) / games);
  const half = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / (1 + (z * z) / games);
  return [centre - half, centre + half];
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

if (process.argv[2] === '--worker') {
  const engine = createEngine(threeKingdoms);
  process.on('message', (job: Job) => process.send?.(runJob(engine, job)));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = (option('--sizes') ?? '2,3,4').split(',').map(Number) as (2 | 3 | 4)[];
  const games = Number(option('--games') ?? 2000);
  const mixed = Number(option('--mixed') ?? 20000);
  const start = Number(option('--seeds') ?? 2_100_000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const named = option('--members')?.split(',');
  const chunk = Math.max(50, Math.round(games / 4));
  const jobs: Job[] = [];
  const membersBySize = new Map<number, string[]>();
  for (const size of sizes) {
    const members = named ?? leagueOf(size, { schools: false }).map((m) => m.name);
    membersBySize.set(size, members);
    for (const x of members) {
      for (const y of members) {
        if (x === y) continue;
        for (let from = start; from < start + games; from += chunk) {
          jobs.push({ kind: 'pair', size, x, y, from, to: Math.min(start + games - 1, from + chunk - 1), key: `${size}|${x}|${y}` });
        }
      }
    }
    const mixedChunk = 500;
    for (let from = start + 50_000; from < start + 50_000 + mixed; from += mixedChunk) {
      jobs.push({ kind: 'mixed', size, members, from, to: Math.min(start + 50_000 + mixed - 1, from + mixedChunk - 1), key: `${size}|mixed` });
    }
  }
  const started = performance.now();
  const results = await runJobs(jobs, workers);
  const totals = new Map<string, JobResult>();
  for (const r of results) {
    const t = totals.get(r.key) ?? { key: r.key, from: r.from, games: 0, finished: 0, wins: 0, turns: 0, orders: [] };
    t.games += r.games;
    t.finished += r.finished;
    t.wins += r.wins;
    t.turns += r.turns;
    t.orders.push(...r.orders);
    if (r.politics) t.politics = addPolitics(t.politics ?? emptyTablePolitics(), r.politics);
    totals.set(r.key, t);
  }
  console.log('# League report\n');
  console.log(`${games} games for each ordered pair, ${mixed} mixed games, for each table size; seeds from ${start}. ${((performance.now() - started) / 1000).toFixed(0)} s on ${workers} processes.\n`);
  const json: Record<string, unknown> = {};
  for (const size of sizes) {
    const members = membersBySize.get(size) as string[];
    const even = 1 / size;
    const share = (x: string, y: string) => {
      const t = totals.get(`${size}|${x}|${y}`);
      return t && t.finished > 0 ? t.wins / t.finished : NaN;
    };
    console.log(`## ${size} players\n`);
    console.log(`The win share of the row's member as the one among copies of the column's member (an even share is ${pct(even)}).\n`);
    console.log(`| One of | ${members.join(' | ')} |`);
    console.log(`| --- | ${members.map(() => '---:').join(' | ')} |`);
    for (const x of members) console.log(`| ${x} | ${members.map((y) => (x === y ? '' : pct(share(x, y)))).join(' | ')} |`);
    console.log('');
    const mixedTotal = totals.get(`${size}|mixed`);
    const ratings = rate(mixedTotal?.orders ?? [], members, members.includes('baseline') ? 'baseline' : members[0]);
    console.log('| Member | Mean over the row | Worst row | Rating (baseline 0, 100 a doubling) |');
    console.log('| --- | ---: | --- | ---: |');
    const rows = members.map((x) => {
      const values = members.filter((y) => y !== x).map((y) => ({ y, v: share(x, y) }));
      const mean = values.reduce((a, b) => a + b.v, 0) / values.length;
      const worst = values.reduce((a, b) => (b.v < a.v ? b : a), values[0]);
      const r = ratings.find((q) => q.member === x);
      return { x, mean, worst, r };
    });
    for (const { x, mean, worst, r } of rows.sort((a, b) => (b.r?.rating ?? 0) - (a.r?.rating ?? 0))) {
      console.log(`| ${x} | ${pct(mean)} | ${worst ? `${pct(worst.v)} against ${worst.y}` : ''} | ${r ? `${r.rating.toFixed(0)} (${r.low.toFixed(0)} to ${r.high.toFixed(0)})` : ''} |`);
    }
    console.log('');
    const beats = (x: string, y: string) => {
      const t = totals.get(`${size}|${x}|${y}`);
      if (!t || t.finished === 0) return false;
      return wilson(t.wins, t.finished)[0] > even;
    };
    const cycles: string[] = [];
    for (const a of members) for (const b of members) for (const c of members) {
      if (a < b && a < c && b !== c && beats(a, b) && beats(b, c) && beats(c, a)) cycles.push(`${a} > ${b} > ${c} > ${a}`);
    }
    console.log(cycles.length ? `Cycles: ${cycles.join('; ')}.\n` : 'No cycle among three members, each step clear of its interval.\n');
    if (mixedTotal) {
      console.log(`Mixed tables: ${mixedTotal.games} games, ${pct(mixedTotal.finished / mixedTotal.games)} finished, ${(mixedTotal.turns / Math.max(1, mixedTotal.finished)).toFixed(0)} turns on average.\n`);
      const p = mixedTotal.politics;
      if (p) {
        console.log(
          `At the mixed tables the seat ranked first by the valuation at round 10 went on to win ${pct(p.leader10Wins / Math.max(1, p.leader10))} of ${p.leader10} games, and the one ranked first at round 20, ${pct(p.leader20Wins / Math.max(1, p.leader20))} of ${p.leader20}. ` +
            `The lead changed ${(p.leadChanges / Math.max(1, p.games)).toFixed(2)} times a game. Of bankrupt players' property, by list price, ${pct(p.toLeaderValue / Math.max(1, p.bankruptValue))} went to the seat that was ranked first.\n`,
        );
      }
    }
    json[size] = { members, matrix: Object.fromEntries(members.map((x) => [x, Object.fromEntries(members.filter((y) => y !== x).map((y) => [y, share(x, y)]))])), ratings };
  }
  const out = option('--json');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(json));
  }
}
