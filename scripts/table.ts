/**
 * One named table, played many times: each seat's win share, and what the table shows of politics.
 *
 *   node scripts/table.ts --seats style-4,baseline,balancer,balancer [--games 5000] [--seeds 1120000] [--workers 6] [--json file]
 *
 * A seat is a league member by name, or `style-2`, `style-3`, `style-4` for whoever holds that line
 * in assets/lines.json. The seats are fixed; the opening roll sets the order of play, and the seed
 * fixes the dice, so two tables on the same seeds differ only by who sits in them.
 *
 * Seats that offer at a rival's debt are given the debt window. Every action goes through the
 * engine's checks, and a refused action stops the run.
 */
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEngine, threeKingdoms } from '../src/index.ts';
import type { Engine, PlayerId } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { memberAgent } from '../src/sim/league.ts';
import './model-loader.ts';
import { addPolitics, createPoliticsWatch, DEAL_KINDS, emptySeatPolitics, emptyTablePolitics } from '../src/sim/politics.ts';
import type { SeatPolitics, TablePolitics } from '../src/sim/politics.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { v1 } from '../src/sim/valuation.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';

const ACTION_LIMIT = 40000;

export interface TableTally {
  games: number;
  finished: number;
  turns: number;
  /** Wins by seat. */
  wins: number[];
  seats: SeatPolitics[];
  table: TablePolitics;
}

export const emptyTally = (size: number): TableTally => ({
  games: 0,
  finished: 0,
  turns: 0,
  wins: Array.from({ length: size }, () => 0),
  seats: Array.from({ length: size }, emptySeatPolitics),
  table: emptyTablePolitics(),
});

/** The league member behind a seat's name: a line of succession stands for its holder. */
export function memberOf(name: string): string {
  if (!/^style-[234]$/.test(name)) return name;
  const lines = JSON.parse(readFileSync(new URL('../assets/lines.json', import.meta.url), 'utf8')) as { lines: Record<string, { holder: string }> };
  const holder = lines.lines[name]?.holder;
  if (!holder) throw new Error(`No holder recorded for ${name}.`);
  return holder;
}

/** Plays one game of a named table into a tally. */
export function playNamed(engine: Engine, members: string[], seed: number, tally: TableTally): void {
  const ctx = contextOf(engine);
  const holder = { rng: seedFrom(`table-${members.length}-${seed}`) };
  const random = () => nextFloat(holder);
  const ids = members.map((_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, memberAgent(members[i])]));
  const watch = createPoliticsWatch(ctx, ids, v1(members.length));
  const windows = createDebtWindows();
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`${members.join(',')}, seed ${seed}: ${actor} has no action.`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`${members.join(',')}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    watch.note(state, result.events, result.state);
    state = result.state;
    for (const agent of agents.values()) agent.observe(result.events, state);
  }
  const seen = watch.finish(state);
  tally.games += 1;
  if (state.winner !== null) {
    tally.finished += 1;
    tally.turns += state.turn.number;
    tally.wins[ids.indexOf(state.winner)] += 1;
  }
  ids.forEach((id, i) => addPolitics(tally.seats[i], seen.seats[id]));
  addPolitics(tally.table, seen.table);
}

export function addTally(into: TableTally, from: TableTally): TableTally {
  into.games += from.games;
  into.finished += from.finished;
  into.turns += from.turns;
  from.wins.forEach((wins, i) => (into.wins[i] += wins));
  from.seats.forEach((seat, i) => addPolitics(into.seats[i], seat));
  addPolitics(into.table, from.table);
  return into;
}

function wilson(wins: number, games: number): [number, number] {
  if (games === 0) return [NaN, NaN];
  const z = 1.96;
  const p = wins / games;
  const centre = (p + (z * z) / (2 * games)) / (1 + (z * z) / games);
  const half = (z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games))) / (1 + (z * z) / games);
  return [centre - half, centre + half];
}

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');
const per = (v: number, n: number, digits = 2) => (n > 0 ? (v / n).toFixed(digits) : 'n/a');
const share = (wins: number, games: number) => {
  const [low, high] = wilson(wins, games);
  return `${pct(wins / games)} (${pct(low)} to ${pct(high)})`;
};

/** The report for a tally, as lines of Markdown. */
export function report(names: string[], members: string[], tally: TableTally, seeds: [number, number]): string[] {
  const out: string[] = [];
  const t = tally.table;
  out.push(`# Table: ${names.join(', ')}`, '');
  out.push(`${tally.games} games on seeds ${seeds[0]} to ${seeds[1]}; ${pct(tally.finished / tally.games)} finished; ${per(tally.turns, tally.finished, 0)} turns on average. An even share is ${pct(1 / members.length)}.`, '');
  out.push('| Seat | Member | Win share |', '| ---: | --- | --- |');
  members.forEach((member, i) => out.push(`| ${i + 1} | ${names[i]}${names[i] === member ? '' : ` (${member})`} | ${share(tally.wins[i], tally.finished)} |`));
  out.push('');
  const kinds = [...new Set(names)].filter((name) => names.filter((n) => n === name).length > 1);
  for (const name of kinds) {
    const wins = names.reduce((sum, n, i) => (n === name ? sum + tally.wins[i] : sum), 0);
    const count = names.filter((n) => n === name).length;
    out.push(`The ${count} seats of ${name} together: ${share(wins, tally.finished)}; an even share for ${count} seats is ${pct(count / members.length)}.`);
  }
  if (kinds.length > 0) out.push('');
  out.push('## The table', '', '| Measure | Value |', '| --- | --- |');
  out.push(`| The seat ranked first at round 10 won | ${share(t.leader10Wins, t.leader10)} of ${t.leader10} finished games that reached it |`);
  out.push(`| The seat ranked first at round 20 won | ${share(t.leader20Wins, t.leader20)} of ${t.leader20} |`);
  out.push(`| Changes of lead, a game | ${per(t.leadChanges, t.games)} |`);
  out.push(`| Bankruptcies, a game | ${per(t.bankruptcies, t.games)} |`);
  out.push(`| Estates that went to the seat ranked first, by list price | ${pct(t.toLeaderValue / t.bankruptValue)} |`);
  out.push(`| Property sold at a debt, of all that was sold there or passed at a bankruptcy | ${pct(t.soldAtDebtValue / (t.soldAtDebtValue + t.bankruptValue))} |`);
  out.push(`| Property sold in the ten rounds before a bankruptcy, of that and what passed at it | ${pct(t.soldBeforeValue / (t.soldBeforeValue + t.bankruptValue))} |`);
  out.push('', '## Each seat', '');
  out.push(`| Measure | ${names.map((name, i) => `${i + 1} ${name}`).join(' | ')} |`, `| --- | ${names.map(() => '---:').join(' | ')} |`);
  const row = (label: string, value: (s: SeatPolitics) => string) => out.push(`| ${label} | ${tally.seats.map(value).join(' | ')} |`);
  row('Deals, a game', (s) => per(s.deals, s.games));
  row('Share of deals with the seat ranked first', (s) => pct(s.dealsWithFirst / s.deals));
  row('Share of deals with the seat ranked last', (s) => pct(s.dealsWithLast / s.deals));
  row('Change of the best-ranked outsider, points a deal', (s) => per(s.outsiderDelta, s.outsiderDeals));
  row('Early deals, a game', (s) => per(s.earlyDeals, s.games));
  row('Mean round of an early deal', (s) => per(s.earlyRounds, s.earlyDeals, 1));
  row('Denying deals, a game', (s) => per(s.denyingDeals, s.games));
  row('Estate bought, list price a game', (s) => per(s.estateValue, s.games, 0));
  for (const kind of DEAL_KINDS) row(`Price over list: ${kind}`, (s) => per(s.paid[kind], s.list[kind]));
  row('Asks per purchase', (s) => per(s.asks, s.purchases));
  row('Share of bankruptcies as creditor', (s) => pct(s.creditorOf / t.bankruptcies));
  row('Invitations sent, a game', (s) => per(s.invitations, s.games));
  row('Share of invitations accepted', (s) => pct(s.invitationsAccepted / s.invitations));
  row('Share of accepted invitations answered in kind', (s) => pct(s.agreements / s.invitationsAccepted));
  row('Deals with an ally, a game', (s) => per(s.dealsAllied, s.games));
  row('Rounds an alliance lasted', (s) => per(s.allianceRounds, s.agreements, 1));
  row('Offers at a rival\'s debt, a game', (s) => per(s.debtOffers, s.games));
  row('Share of those accepted', (s) => pct(s.debtOffersAccepted / s.debtOffers));
  row('Own uncovered debts survived', (s) => pct(s.ownDebtsSurvived / s.ownDebts));
  return out;
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

interface Job {
  members: string[];
  from: number;
  to: number;
}

if (process.argv.includes('--worker')) {
  const engine = createEngine(threeKingdoms);
  process.on('message', (job: Job) => {
    const tally = emptyTally(job.members.length);
    for (let seed = job.from; seed <= job.to; seed++) playNamed(engine, job.members, seed, tally);
    process.send?.(tally);
  });
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const names = (option('--seats') ?? '').split(',').filter(Boolean);
  if (names.length < 2 || names.length > 4) throw new Error('Give two to four seats with --seats a,b,c,d.');
  const members = names.map(memberOf);
  const games = Number(option('--games') ?? 5000);
  const start = Number(option('--seeds') ?? 1_120_000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const chunk = Math.max(25, Math.ceil(games / (workers * 4)));
  const jobs: Job[] = [];
  for (let from = start; from < start + games; from += chunk) jobs.push({ members, from, to: Math.min(start + games - 1, from + chunk - 1) });
  const total = emptyTally(members.length);
  const began = performance.now();
  await new Promise<void>((resolve, reject) => {
    let next = 0;
    let done = 0;
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), ['--worker']);
      const give = () => (next < jobs.length ? child.send(jobs[next++]) : child.disconnect());
      child.on('message', (tally: TableTally) => {
        addTally(total, tally);
        done += 1;
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
  const lines = report(names, members, total, [start, start + games - 1]);
  lines.push('', `${((performance.now() - began) / 1000).toFixed(0)} s on ${Math.min(workers, jobs.length)} processes.`);
  console.log(lines.join('\n'));
  const json = option('--json');
  if (json) writeFileSync(json, JSON.stringify({ names, members, seeds: [start, start + games - 1], tally: total }, null, 2));
}
