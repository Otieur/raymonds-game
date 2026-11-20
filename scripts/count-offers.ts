/**
 * Counts the accepted offers in league games that the learner's drafts cannot express (M9, task 8):
 * deals of several properties a side, cash both ways, or jail cards. Action version 3 drafts an ask
 * (one property asked for, at most one given, cash one way) or a sale (one property given for cash).
 *
 *   node scripts/count-offers.ts --size 4 [--rules full|short] [--members a,b,c] [--games 2000]
 *        [--seeds 2700000] [--workers 4]
 *
 * Each game seats members drawn at random, with a draw fixed by the seed, from `--members` or by
 * default from the league for the size (every school meant for it, the admitted styles, the baseline
 * and the refuser; random play and the False friend, test opponents, are left out). By M9, if more than one accepted offer in ten cannot be
 * expressed, drafts of several properties are added.
 */
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { PlayerId } from '../src/index.ts';
import { wilson } from '../src/sim/intervals.ts';
import { leagueOf, memberAgent } from '../src/sim/league.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { expressible } from '../src/sim/trade-measures.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';
import './model-loader.ts';

const ACTION_LIMIT = 40000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const size = Number(option('--size') ?? 4) as 2 | 3 | 4;
const rules = (option('--rules') ?? 'full') as 'full' | 'short';
const engine = rules === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
// Random play and the False friend are test opponents, not schools that play the game (M3b).
const TEST_OPPONENTS = ['random', 'false-friend'];
const members = option('--members')?.split(',').filter(Boolean) ?? leagueOf(size).map((m) => m.name).filter((name) => !TEST_OPPONENTS.includes(name));

interface Count {
  games: number;
  accepted: number;
  inexpressible: number;
  shapes: Record<string, number>;
  /** Inexpressible offers by the member that made them. */
  byProposer: Record<string, number>;
}

const empty = (): Count => ({ games: 0, accepted: 0, inexpressible: 0, shapes: {}, byProposer: {} });

function play(seed: number, count: Count): void {
  const draw = { rng: seedFrom(`count-offers-${size}-${seed}`) };
  const names = Array.from({ length: size }, () => members[Math.floor(nextFloat(draw) * members.length)]);
  const ids = names.map((_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, memberAgent(names[i])]));
  const holder = { rng: seedFrom(`count-offers-play-${size}-${seed}`) };
  const random = () => nextFloat(holder);
  const windows = createDebtWindows();
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`${names.join(',')}, seed ${seed}: ${actor} has no action.`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`${names.join(',')}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    for (const event of result.events) {
      if (event.type !== 'TRADE_ACCEPTED') continue;
      count.accepted += 1;
      const { ok, shape } = expressible(event.offer);
      if (ok) continue;
      count.inexpressible += 1;
      count.shapes[shape] = (count.shapes[shape] ?? 0) + 1;
      const proposer = names[ids.indexOf(event.offer.from)];
      count.byProposer[proposer] = (count.byProposer[proposer] ?? 0) + 1;
    }
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  count.games += 1;
}

const add = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
};

if (process.argv.includes('--worker')) {
  process.on('message', (job: { from: number; count: number }) => {
    const count = empty();
    for (let seed = job.from; seed < job.from + job.count; seed++) play(seed, count);
    process.send?.(count);
  });
} else {
  for (const name of members) memberAgent(name);
  const games = Number(option('--games') ?? 2000);
  const start = Number(option('--seeds') ?? 2_700_000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const chunk = Math.max(10, Math.ceil(games / (workers * 4)));
  const jobs: { from: number; count: number }[] = [];
  for (let from = start; from < start + games; from += chunk) jobs.push({ from, count: Math.min(chunk, start + games - from) });
  const began = performance.now();
  const total = await new Promise<Count>((resolve, reject) => {
    const sum = empty();
    let next = 0;
    let done = 0;
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--worker']);
      const give = () => (next < jobs.length ? child.send(jobs[next++]) : child.disconnect());
      child.on('message', (part: Count) => {
        sum.games += part.games;
        sum.accepted += part.accepted;
        sum.inexpressible += part.inexpressible;
        add(sum.shapes, part.shapes);
        add(sum.byProposer, part.byProposer);
        done += 1;
        if (done === jobs.length) resolve(sum);
        give();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(`A worker stopped with code ${code}.`));
      });
      give();
    }
  });
  const share = total.accepted ? total.inexpressible / total.accepted : NaN;
  const [rawLow, high] = wilson(total.inexpressible, total.accepted);
  const low = Math.max(0, rawLow); // Wilson's lower end can come out a hair below zero when nothing was counted
  const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');
  const sorted = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);
  const lines = [
    `# Offers a draft cannot express: ${rules} game, ${size} players`,
    '',
    `${total.games} games on seeds ${start} to ${start + games - 1}, members drawn from ${members.length} (${members.join(', ')}); ${((performance.now() - began) / 1000).toFixed(0)} s.`,
    '',
    `${total.accepted} offers accepted, ${(total.accepted / Math.max(1, total.games)).toFixed(2)} a game; ${total.inexpressible} of them a draft cannot express: ${pct(share)} (${pct(low)} to ${pct(high)}).`,
    share > 0.1 ? 'More than one in ten: by M9, drafts of several properties are to be added.' : 'Not more than one in ten: by M9, drafts stay as they are.',
    '',
    '| Shape | Accepted |',
    '| --- | ---: |',
    ...sorted(total.shapes).map(([shape, n]) => `| ${shape} | ${n} |`),
    '',
    '| Proposer | Inexpressible offers accepted |',
    '| --- | ---: |',
    ...sorted(total.byProposer).map(([name, n]) => `| ${name} | ${n} |`),
  ];
  console.log(lines.join('\n'));
}
