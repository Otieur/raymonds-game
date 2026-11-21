/**
 * Builds an offer suite (M9, task 6): offers whose right answer for the receiver is measured by
 * playing both versions of the position out.
 *
 *   node scripts/make-offer-suite.ts --snapshots <dir> --size 4 [--rules full|short]
 *        [--players statesman-book-2,found-4-b2t1p1c2,...] [--candidates 1000] [--playouts 40]
 *        [--rounds 10,15,20,30] [--from-seed 2500000] [--cases 200] [--workers 6] --out <file>
 *
 * Positions come from `<dir>/<rules>-<size>.jsonl`. In each, the candidates of every template are
 * listed (`src/sim/offer-suite.ts`) and the one whose cell has the fewest so far is taken, until
 * `--candidates` positions are chosen. Each is played out `--playouts` times with and without the
 * offer, with the same fresh dice for both versions, by `--players` (one member for each seat, in the
 * order of play; one name fills every seat). A case is kept when the receiver's change in win share is
 * at least 5 points either way and its 95% interval, from the paired differences, excludes zero; it is
 * labelled accept when the change is positive. The suite takes half accept and half refuse, spread over
 * the templates, and is written as JSON with a report on standard output.
 */
import { fork } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { GameState, PlayerId, TradeOffer } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { applyDeal } from '../src/sim/deal.ts';
import { memberAgent } from '../src/sim/league.ts';
import { isValidOffer, offerCandidates, SUITE_VERSION, TEMPLATES } from '../src/sim/offer-suite.ts';
import type { Suite, SuiteCase, Template } from '../src/sim/offer-suite.ts';
import { stateOf } from '../src/sim/snapshot.ts';
import type { SnapshotRow } from '../src/sim/snapshot.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { v1 } from '../src/sim/valuation.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';
import './model-loader.ts';

const ACTION_LIMIT = 40000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const rules = (option('--rules') ?? 'full') as 'full' | 'short';
const engine = rules === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
const ctx = contextOf(engine);

interface Position {
  row: SnapshotRow;
  template: Template;
  cell: string;
  deal: TradeOffer;
}

interface Priced extends Position {
  /** Wins with and without the offer, for the receiver, the proposer and the best-placed other seat; and the paired differences for the receiver. */
  withDeal: [number, number, number];
  without: [number, number, number];
  receiverDiffs: number[];
  unfinished: number;
}

/** Plays a position to the end with one member in each seat; returns the winner, or null if it runs past the limit. */
function playOut(start: GameState, seed: string, players: string[]): PlayerId | null {
  const holder = { rng: seedFrom(`${seed}-agents`) };
  const random = () => nextFloat(holder);
  const agents = new Map<PlayerId, SeatAgent>(start.players.map((p, i) => [p.id, memberAgent(players[i % players.length])]));
  const windows = createDebtWindows();
  let state = start;
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`No action for ${actor} in a playout (${seed}).`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`A playout action was refused (${seed}): ${result.error.message}`);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  return state.winner;
}

function price(position: Position, playouts: number, players: string[]): Priced {
  const { row, deal } = position;
  const base = stateOf(ctx, row);
  const chances = v1(row.n).chances(ctx, base);
  const others = base.players.filter((p) => !p.bankrupt && p.id !== deal.from && p.id !== deal.to);
  const other = others.sort((a, b) => chances[base.players.indexOf(b)] - chances[base.players.indexOf(a)])[0]?.id ?? null;
  const seats = [deal.to, deal.from, other];
  const withDeal: [number, number, number] = [0, 0, 0];
  const without: [number, number, number] = [0, 0, 0];
  const receiverDiffs: number[] = [];
  let unfinished = 0;
  for (let j = 0; j < playouts; j++) {
    const draw = `suite-${row.table}-${row.seed}-${row.round}-${position.cell}-${deal.from}-${j}`;
    const fresh = stateOf(ctx, row, draw);
    const a = playOut(applyDeal(ctx, fresh, deal), draw, players);
    const b = playOut(fresh, draw, players);
    if (a === null || b === null) unfinished += 1;
    for (const [winner, wins] of [[a, withDeal], [b, without]] as const) {
      const at = winner === null ? -1 : seats.indexOf(winner);
      if (at !== -1) wins[at] += 1;
    }
    receiverDiffs.push((a === deal.to ? 1 : 0) - (b === deal.to ? 1 : 0));
  }
  return { ...position, withDeal, without, receiverDiffs, unfinished };
}

if (process.argv.includes('--worker')) {
  process.on('message', (job: { index: number; positions: Position[]; playouts: number; players: string[] }) => {
    process.send?.({ index: job.index, priced: job.positions.map((p) => price(p, job.playouts, job.players)) });
  });
} else {
  const dir = option('--snapshots');
  const out = option('--out');
  if (!dir || !out) throw new Error('Give --snapshots <dir> and --out <file>.');
  const size = Number(option('--size') ?? 4);
  const players = (option('--players') ?? 'baseline').split(',').filter(Boolean);
  for (const name of players) memberAgent(name); // refuses an unknown name before any work
  const want = Number(option('--candidates') ?? 1000);
  const playouts = Number(option('--playouts') ?? 40);
  const rounds = (option('--rounds') ?? '10,15,20,30').split(',').map(Number);
  const fromSeed = Number(option('--from-seed') ?? 2_500_000);
  const cases = Number(option('--cases') ?? 200);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));

  // Choose positions: in each, the candidate whose cell has the fewest so far.
  const file = join(dir, `${rules}-${size}.jsonl`);
  const counts = new Map<string, number>();
  const chosen: Position[] = [];
  let seeds: [number, number] = [Infinity, -Infinity];
  if (!existsSync(file)) throw new Error(`No snapshots at ${file}: write them first with the study's --snapshots for the ${rules} game at ${size} players.`);
  const reader = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of reader) {
    if (chosen.length >= want) break;
    if (!line) continue;
    const row = JSON.parse(line) as SnapshotRow;
    if (row.n !== size || row.seed < fromSeed || !rounds.includes(row.round)) continue;
    const state = stateOf(ctx, row);
    const candidates = offerCandidates(ctx, state, row.round, v1(row.n)).filter((c) => isValidOffer(engine, ctx, row, c.deal));
    if (candidates.length === 0) continue;
    const least = Math.min(...candidates.map((c) => counts.get(c.cell) ?? 0));
    const pool = candidates.filter((c) => (counts.get(c.cell) ?? 0) === least);
    const pick = pool[Math.floor(nextFloat({ rng: seedFrom(`suite-${row.table}-${row.seed}-${row.round}`) }) * pool.length)];
    chosen.push({ row, template: pick.template, cell: pick.cell, deal: pick.deal });
    counts.set(pick.cell, (counts.get(pick.cell) ?? 0) + 1);
    seeds = [Math.min(seeds[0], row.seed), Math.max(seeds[1], row.seed)];
  }
  process.stderr.write(`${chosen.length} positions chosen in ${counts.size} cells\n`);

  // Price them on worker processes.
  const CHUNK = 5;
  const jobs: Position[][] = [];
  for (let i = 0; i < chosen.length; i += CHUNK) jobs.push(chosen.slice(i, i + CHUNK));
  const parts: Priced[][] = [];
  const began = performance.now();
  await new Promise<void>((resolve, reject) => {
    let next = 0;
    let done = 0;
    if (jobs.length === 0) resolve();
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--worker']);
      const give = () => (next < jobs.length ? child.send({ index: next, positions: jobs[next++], playouts, players }) : child.disconnect());
      child.on('message', (message: { index: number; priced: Priced[] }) => {
        parts[message.index] = message.priced;
        done += 1;
        if (done % 20 === 0 || done === jobs.length) process.stderr.write(`${done} of ${jobs.length} jobs, ${((performance.now() - began) / 1000).toFixed(0)} s\n`);
        if (done === jobs.length) resolve();
        give();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(`A worker stopped with code ${code}.`));
      });
      give();
    }
  });
  const priced = parts.flat();

  // Keep the clear cases, then take half accept and half refuse, spread over the templates.
  const kept: SuiteCase[] = [];
  for (const p of priced) {
    const n = p.receiverDiffs.length;
    const mean = p.receiverDiffs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(p.receiverDiffs.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, n - 1));
    const half = (1.96 * sd) / Math.sqrt(n);
    if (Math.abs(mean) < 0.05 || Math.abs(mean) - half <= 0) continue;
    kept.push({
      template: p.template, cell: p.cell, row: p.row, deal: p.deal, label: mean > 0 ? 'accept' : 'refuse',
      receiver: mean, half, proposer: (p.withDeal[1] - p.without[1]) / n, other: (p.withDeal[2] - p.without[2]) / n,
    });
  }
  const take = (label: 'accept' | 'refuse', count: number): SuiteCase[] => {
    const byTemplate = new Map<string, SuiteCase[]>();
    for (const c of kept.filter((k) => k.label === label)) {
      const queue = byTemplate.get(c.template) ?? [];
      queue.push(c);
      byTemplate.set(c.template, queue);
    }
    const queues = [...byTemplate.values()];
    const out: SuiteCase[] = [];
    for (let round = 0; out.length < count && queues.some((q) => q.length > round); round++) {
      for (const q of queues) if (q[round] && out.length < count) out.push(q[round]);
    }
    return out;
  };
  const suiteCases = [...take('accept', Math.ceil(cases / 2)), ...take('refuse', Math.floor(cases / 2))];
  const suite: Suite = { version: SUITE_VERSION, size, rules, players, playouts, seeds, cases: suiteCases };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(suite));

  const lines = [
    `# Offer suite: ${rules} game, ${size} players`,
    '',
    `${chosen.length} positions from seeds ${seeds[0]} to ${seeds[1]} at rounds ${rounds.join(', ')}; ${playouts} playouts a version by ${players.join(', ')}; ` +
      `${priced.reduce((a, p) => a + p.unfinished, 0)} playouts of ${priced.length * playouts} unfinished. ${kept.length} clear cases (receiver's change at least 5 points, interval clear of zero); ` +
      `the suite takes ${suiteCases.filter((c) => c.label === 'accept').length} to accept and ${suiteCases.filter((c) => c.label === 'refuse').length} to refuse. ${((performance.now() - began) / 1000).toFixed(0)} s.`,
    '',
    '| Template | Candidates priced | Clear: accept | Clear: refuse | In the suite |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...TEMPLATES.map((t) => `| ${t} | ${priced.filter((p) => p.template === t).length} | ${kept.filter((k) => k.template === t && k.label === 'accept').length} | ${kept.filter((k) => k.template === t && k.label === 'refuse').length} | ${suiteCases.filter((c) => c.template === t).length} |`),
  ];
  console.log(lines.join('\n'));
}
