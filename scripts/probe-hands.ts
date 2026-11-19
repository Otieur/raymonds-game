/**
 * Measures what a deal between seats is worth by intervention: take a position from a simulated
 * game, apply the deal, and play both versions to the end many times. It extends the study of
 * purchases from the bank (scripts/probe-value.ts) to changes of hands, and sets the deal sheet's
 * figure for the same positions beside what was measured.
 *
 *   node scripts/probe-hands.ts --snapshots <dir> [--sizes 3,4] [--positions 50] [--playouts 8]
 *        [--rounds 5,10,20] [--from-seed 85001] [--workers 6] [--json <file>]
 *
 * Kinds of deal:
 *   second  a seat that holds one street of a group of three buys a second from a rival, at 1, 1.5
 *           and 2 times its list price, with the third street in the bank or in a third seat's hands;
 *   denial  a seat buys, from a third seat, the street a rival lacks, at 1 and 2 times list, split by
 *           the buyer's rank among that rival's opponents (nearest, middle, last);
 *   estate  a seat buys a failing seat's most valuable free street at list price: one of a group it
 *           holds part of, or the one its strongest rival wants.
 * Both versions of a position are played out with the same fresh draws of dice and decks, by the
 * rule-based agent at every seat. For each cell the report gives the change in win share of the
 * buyer, the seller and the best-placed of the other seats, with what the deal sheet says.
 */
import { fork } from 'node:child_process';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContext } from '../src/context.ts';
import type { Context } from '../src/context.ts';
import { chooseHeuristicAction, createAgentMemory, createEngine, threeKingdoms } from '../src/index.ts';
import type { GameState, PlayerId, StreetSquare } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { applyDeal, dealSheet, distressOf, isFailing, threatOf } from '../src/sim/deal.ts';
import type { Deal } from '../src/sim/deal.ts';
import { isOut, stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';
import { v1 } from '../src/sim/valuation.ts';
import type { Valuation } from '../src/sim/valuation.ts';

const ACTION_LIMIT = 40000;
const SETS = ['chain', 'yuan', 'wei', 'shu'];
const FAIL_BELOW = 0.4;

export interface Candidate {
  cell: string;
  deal: Deal;
  /** The seat outside the deal with the highest chance, or null with two players. */
  other: PlayerId | null;
}

const cashFor = (from: PlayerId, to: PlayerId, cash: number, property: string): Deal => ({
  from,
  to,
  give: { cash, properties: [], jailCards: 0 },
  receive: { cash: 0, properties: [property], jailCards: 0 },
});

/** Every deal of the three kinds that a position offers, each with the cell it belongs to. */
export function candidatesOf(ctx: Context, state: GameState, round: number, valuation: Valuation): Candidate[] {
  const out: Candidate[] = [];
  const size = state.players.length;
  const alive = state.players.filter((p) => !p.bankrupt);
  const chances = valuation.chances(ctx, state);
  const chanceOf = (id: PlayerId) => chances[state.players.findIndex((p) => p.id === id)];
  const otherOf = (a: PlayerId, b: PlayerId): PlayerId | null =>
    alive.filter((p) => p.id !== a && p.id !== b).sort((p, q) => chanceOf(q.id) - chanceOf(p.id))[0]?.id ?? null;
  const free = (streets: readonly StreetSquare[], sq: StreetSquare) => !state.properties[sq.id].mortgaged && streets.every((mate) => state.properties[mate.id].level === 0);
  const add = (cell: string, deal: Deal) => out.push({ cell, deal, other: otherOf(deal.from, deal.to) });

  for (const set of SETS) {
    const streets = ctx.groups.get(set) ?? [];
    if (streets.length !== 3) continue;
    const owners = streets.map((sq) => state.properties[sq.id].owner);

    // Second street: the buyer holds one, the seller another, and the third is with the bank or a third seat.
    for (const buyer of alive) {
      if (owners.filter((owner) => owner === buyer.id).length !== 1) continue;
      for (const target of streets) {
        const seller = state.properties[target.id].owner;
        if (seller === null || seller === buyer.id || !free(streets, target)) continue;
        const third = streets.find((sq) => sq.id !== target.id && state.properties[sq.id].owner !== buyer.id) as StreetSquare;
        const holder = state.properties[third.id].owner;
        if (holder === seller) continue;
        for (const multiple of [1, 1.5, 2]) {
          const cash = Math.round(target.price * multiple);
          if (buyer.cash >= cash) add(`${size}|second|${set}|${round}|${multiple}|${holder === null ? 'bank' : 'third'}`, cashFor(buyer.id, seller, cash, target.id));
        }
      }
    }

    // Denial: a rival holds two, a third seat holds the last, and another seat buys it.
    if (alive.length >= 3) {
      for (const rival of alive) {
        if (owners.filter((owner) => owner === rival.id).length !== 2) continue;
        const target = streets.find((sq) => state.properties[sq.id].owner !== rival.id) as StreetSquare;
        const seller = state.properties[target.id].owner;
        if (seller === null || !free(streets, target)) continue;
        const opponents = alive.filter((p) => p.id !== rival.id).sort((p, q) => chanceOf(q.id) - chanceOf(p.id));
        opponents.forEach((buyer, place) => {
          if (buyer.id === seller) return;
          const rank = place === 0 ? 'nearest' : place === opponents.length - 1 ? 'last' : 'middle';
          for (const multiple of [1, 2]) {
            const cash = Math.round(target.price * multiple);
            if (buyer.cash >= cash) add(`${size}|denial|${set}|${round}|${multiple}|${rank}`, cashFor(buyer.id, seller, cash, target.id));
          }
        });
      }
    }
  }

  // Estate: a failing seat's most valuable free street, bought at list price.
  if (alive.length >= 3) {
    for (const failing of alive) {
      if (!isFailing(distressOf(ctx, state, failing.id, valuation, [], chances), FAIL_BELOW)) continue;
      const streets = ctx.propertyOrder
        .filter((sq): sq is StreetSquare => sq.kind === 'street' && state.properties[sq.id].owner === failing.id && free(ctx.groups.get(sq.group) ?? [], sq))
        .sort((a, b) => b.price - a.price);
      for (const buyer of alive) {
        if (buyer.id === failing.id) continue;
        const useful = streets.find((sq) => (ctx.groups.get(sq.group) ?? []).some((mate) => state.properties[mate.id].owner === buyer.id));
        if (useful && buyer.cash >= useful.price) add(`${size}|estate|self|${round}`, cashFor(buyer.id, failing.id, useful.price, useful.id));
        const rivals = alive.filter((p) => p.id !== buyer.id && p.id !== failing.id);
        const top = rivals.map((p) => ({ id: p.id, threat: threatOf(ctx, state, p.id, valuation, chances) })).sort((a, b) => b.threat.potential - a.threat.potential)[0];
        const wanted = top?.threat.wants;
        if (wanted && state.properties[wanted].owner === failing.id) {
          const sq = streets.find((street) => street.id === wanted);
          if (sq && buyer.cash >= sq.price) add(`${size}|estate|rival|${round}`, cashFor(buyer.id, failing.id, sq.price, sq.id));
        }
      }
    }
  }
  return out;
}

interface Position {
  row: SnapshotRow;
  cell: string;
  deal: Deal;
  other: PlayerId | null;
}

/** Wins and the deal sheet's figures for the buyer, the seller and the best-placed of the others. */
interface Outcome {
  cell: string;
  playouts: number;
  unfinished: number;
  without: [number, number, number];
  withDeal: [number, number, number];
  predicted: [number, number, number];
}

const engine = createEngine(threeKingdoms);
const ctx = buildContext(engine.board, engine.rules);

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
  const { row, deal } = position;
  const valuation = v1(row.n);
  const base = stateOf(ctx, row);
  const sheet = dealSheet(ctx, base, deal, valuation);
  const seats = [deal.from, deal.to, position.other];
  const predicted = seats.map((id) => (id === null ? 0 : sheet.delta[base.players.findIndex((p) => p.id === id)])) as [number, number, number];
  const without: [number, number, number] = [0, 0, 0];
  const withDeal: [number, number, number] = [0, 0, 0];
  let unfinished = 0;
  for (let j = 0; j < playouts; j++) {
    const draw = `hands-${row.table}-${row.seed}-${row.round}-${position.cell}-${deal.from}-${j}`;
    const fresh = stateOf(ctx, row, draw);
    for (const [start, wins] of [[fresh, without], [applyDeal(ctx, fresh, deal), withDeal]] as const) {
      const winner = playOut(start, draw);
      if (winner === null) unfinished += 1;
      else {
        const at = seats.indexOf(winner);
        if (at !== -1) wins[at] += 1;
      }
    }
  }
  return { cell: position.cell, playouts, unfinished, without, withDeal, predicted };
}

async function choose(file: string, rounds: number[], fromSeed: number, cap: number): Promise<Position[]> {
  const counts = new Map<string, number>();
  const chosen: Position[] = [];
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    const row = JSON.parse(line) as SnapshotRow;
    if (row.seed < fromSeed || !rounds.includes(row.round)) continue;
    const state = stateOf(ctx, row);
    for (let seat = 0; seat < row.n; seat++) if (isOut(row, seat)) state.players[seat].bankrupt = true;
    const candidates = candidatesOf(ctx, state, row.round, v1(row.n)).filter((c) => (counts.get(c.cell) ?? 0) < cap);
    if (candidates.length === 0) continue;
    // The candidate whose cell is emptiest, ties broken by a draw fixed by the position.
    const holder = { rng: seedFrom(`hands-${row.table}-${row.seed}-${row.round}`) };
    const least = Math.min(...candidates.map((c) => counts.get(c.cell) ?? 0));
    const pool = candidates.filter((c) => (counts.get(c.cell) ?? 0) === least);
    const pick = pool[Math.floor(nextFloat(holder) * pool.length)];
    chosen.push({ row, cell: pick.cell, deal: pick.deal, other: pick.other });
    counts.set(pick.cell, (counts.get(pick.cell) ?? 0) + 1);
  }
  return chosen;
}

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
        if (done % 20 === 0 || done === jobs.length) process.stderr.write(`${done} of ${jobs.length} jobs, ${((performance.now() - started) / 1000).toFixed(0)} s\n`);
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

export interface CellSummary {
  cell: string;
  positions: number;
  /** For the buyer, the seller and the other: the measured change, half its 95% interval, and the deal sheet's figure. */
  measured: [number, number, number];
  half: [number, number, number];
  predicted: [number, number, number];
  unfinished: number;
}

export function summarize(outcomes: Outcome[]): CellSummary[] {
  const byCell = new Map<string, Outcome[]>();
  for (const o of outcomes) byCell.set(o.cell, [...(byCell.get(o.cell) ?? []), o]);
  const out: CellSummary[] = [];
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  for (const [cell, list] of byCell) {
    const who = [0, 1, 2] as const;
    const changes = who.map((k) => list.map((o) => (o.withDeal[k] - o.without[k]) / o.playouts));
    const means = changes.map(mean);
    const halves = changes.map((d, k) => (1.96 * Math.sqrt(d.reduce((a, v) => a + (v - means[k]) ** 2, 0) / Math.max(1, d.length - 1))) / Math.sqrt(Math.max(1, d.length)));
    out.push({
      cell,
      positions: list.length,
      measured: means as [number, number, number],
      half: halves as [number, number, number],
      predicted: who.map((k) => mean(list.map((o) => o.predicted[k]))) as [number, number, number],
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
  const centre = (a.length - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - centre) * (rb[i] - centre);
    da += (ra[i] - centre) ** 2;
    db += (rb[i] - centre) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** The gate's reading and the table of cells, as lines of Markdown. A cell under `thin` positions is marked. */
export function report(summaries: CellSummary[], thin: number): string[] {
  const pts = (v: number) => (v * 100).toFixed(1);
  const usable = summaries.filter((s) => s.positions >= thin);
  const clear = usable.filter((s) => Math.abs(s.measured[0]) > s.half[0]);
  const agree = clear.filter((s) => Math.sign(s.predicted[0]) === Math.sign(s.measured[0])).length;
  const rho = usable.length > 2 ? spearman(usable.map((s) => s.measured[0]), usable.map((s) => s.predicted[0])) : NaN;
  const out = [
    `Cells with at least ${thin} positions: ${usable.length} of ${summaries.length}. Of those, ${clear.length} have a measured change for the buyer whose interval excludes zero; the deal sheet has the same sign in ${agree}` +
      `${clear.length > 0 ? ` (${((agree / clear.length) * 100).toFixed(1)}%)` : ''}. Rank correlation of the sheet's figure and the measured one for the buyer, over the usable cells: ${Number.isNaN(rho) ? 'n/a' : rho.toFixed(3)}.`,
    '',
    'Changes are in points of win share: measured, with half its 95% interval, then the deal sheet\'s figure. "Other" is the best-placed seat outside the deal.',
    '',
    '| Cell | Positions | Buyer | Sheet | Seller | Sheet | Other | Sheet |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const s of summaries) {
    const cell = (k: 0 | 1 | 2) => `${pts(s.measured[k])} ± ${pts(s.half[k])} | ${pts(s.predicted[k])}`;
    out.push(`| ${s.cell.split('|').join(' / ')}${s.positions < thin ? ' (thin)' : ''} | ${s.positions} | ${cell(0)} | ${cell(1)} | ${cell(2)} |`);
  }
  return out;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[2] === '--worker') {
  const playouts = Number(process.argv[3]);
  process.on('message', (job: { index: number; positions: Position[] }) => {
    process.send?.({ index: job.index, outcomes: job.positions.map((p) => probe(p, playouts)) });
  });
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = option('--snapshots');
  if (!dir) throw new Error('Give --snapshots <dir>.');
  const sizes = (option('--sizes') ?? '3,4').split(',').map(Number);
  const cap = Number(option('--positions') ?? 50);
  const playouts = Number(option('--playouts') ?? 8);
  const rounds = (option('--rounds') ?? '5,10,20').split(',').map(Number);
  const fromSeed = Number(option('--from-seed') ?? 85001);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const started = performance.now();
  const positions: Position[] = [];
  for (const n of sizes) {
    const found = await choose(join(dir, `full-${n}.jsonl`), rounds, fromSeed, cap);
    positions.push(...found);
    process.stderr.write(`${n} players: ${found.length} positions\n`);
  }
  const outcomes = await runAll(positions, playouts, workers);
  const summaries = summarize(outcomes);
  console.log('# What a deal between seats is worth, by intervention\n');
  console.log(
    `Positions from the test games of \`${dir}\` (seeds from ${fromSeed}), rounds ${rounds.join(', ')}, up to ${cap} positions a cell, ${playouts} playouts a version, the rule-based agent at every seat. ` +
      `${positions.length} positions, ${((performance.now() - started) / 1000).toFixed(0)} seconds on ${workers} processes.\n`,
  );
  console.log(report(summaries, 30).join('\n'));
  const json = option('--json');
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify({ cap, playouts, rounds, fromSeed, summaries, outcomes }));
    process.stderr.write(`Saved ${json}\n`);
  }
}
