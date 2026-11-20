/**
 * M9's trade report for a learned agent that drafts its own offers: the three measures and their bars,
 * with how it trades.
 *
 *   node scripts/trade-report.ts --model <export.ts> --size 2 [--rules full|short] [--suite <file>]
 *        [--members a,b,c] [--school <member>] [--games 5000] [--seeds 2600000] [--workers 4] [--json <file>]
 *
 * The agent is `model:<path>?own` (the network drafts and answers); the ruled copy is
 * `model:<path>?trade=<school>` (the school's offers and answers, the network's play otherwise), the
 * school by default the holder of the size's style line. Tables, `--games` games each on the same seeds:
 *
 *   copies   two copies of the agent, and league members (`--members`, by default the baseline and the
 *            refuser) in turn in the other seats;
 *   others   at two players only, the agent against each member in turn, for deals with others;
 *   learned  the agent as the one among ruled copies;
 *   ruled    a ruled copy as the one among copies of the agent;
 *   alone    every seat the agent (at two players the copies table is this table).
 *
 * Bars (`src/sim/trade-measures.ts`): the suite (at most 2% of refusals accepted, 10% of acceptances
 * refused); deals between copies no more one-sided than deals with others; the learned trader above an
 * even share among ruled copies and the ruled copy not above it among learned ones; the agent alone
 * finishing 98% of its games. Then, for the agent's seats at the copies and others tables: offers made
 * and accepted a game, the price over list of what it buys and sells for cash, how often a deal
 * completes the other side's group, and the table report of the copies table with M3b's seat measures.
 */
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { completion } from '../src/env/observe.ts';
import { createEngine, SHORT_GAME_RULES, threeKingdoms } from '../src/index.ts';
import type { PlayerId, TradeOffer } from '../src/index.ts';
import { nextFloat, seedFrom } from '../src/rng.ts';
import { dealSheet } from '../src/sim/deal.ts';
import { memberAgent } from '../src/sim/league.ts';
import { describeScore, scoreSuite } from '../src/sim/offer-suite.ts';
import type { Suite } from '../src/sim/offer-suite.ts';
import { addPolitics, createPoliticsWatch } from '../src/sim/politics.ts';
import { contextOf } from '../src/sim/style-agent.ts';
import type { SeatAgent } from '../src/sim/styles.ts';
import { addMoment, addMoments, copiesBar, emptyMoments, finishBar, meanOf, oneSided, ruledBars, suiteBar } from '../src/sim/trade-measures.ts';
import type { Bar, Moments } from '../src/sim/trade-measures.ts';
import { v1 } from '../src/sim/valuation.ts';
import { createDebtWindows, debtWindow } from '../src/sim/window.ts';
import { memberOf } from './lines.ts';
import './model-loader.ts';
import { addTally, emptyTally, report } from './table.ts';
import type { TableTally } from './table.ts';

const ACTION_LIMIT = 40000;
const WORKER = '--trade-worker'; // not table.ts's own worker flag, whose module this script imports

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const model = option('--model');
const size = Number(option('--size') ?? 2);
const rules = (option('--rules') ?? 'full') as 'full' | 'short';
const engine = rules === 'short' ? createEngine(threeKingdoms, SHORT_GAME_RULES) : createEngine(threeKingdoms);
const ctx = contextOf(engine);
const school = option('--school') ?? memberOf(`style-${size}`);
const agent = `model:${model}?own`;
const ruled = `model:${model}?trade=${school}`;
const members = (option('--members') ?? 'baseline,refuser').split(',').filter(Boolean);

type TableName = 'copies' | 'others' | 'learned' | 'ruled' | 'alone';

/** The members of a table for one game, seat by seat. */
function seatsOf(table: TableName, game: number): string[] {
  const member = (k: number) => members[(game + k) % members.length];
  if (table === 'copies') return [agent, agent, ...Array.from({ length: size - 2 }, (_, k) => member(k))];
  if (table === 'others') return [agent, member(0)];
  if (table === 'learned') return [agent, ...Array.from({ length: size - 1 }, () => ruled)];
  if (table === 'ruled') return [ruled, ...Array.from({ length: size - 1 }, () => agent)];
  return Array.from({ length: size }, () => agent);
}

/** What one range of games of one table gives. */
interface Part {
  table: TableName;
  from: number;
  tally: TableTally;
  /** Wins of the seats of interest: the learned agent at `learned`, the ruled copy at `ruled`. */
  focusWins: number;
  copies: Moments;
  others: Moments;
  /** The agent's seats at the copies and others tables. */
  offers: number;
  accepted: number;
  buy: Moments;
  sell: Moments;
  completes: number;
  deals: number;
  games: number;
}

function emptyPart(table: TableName, from: number): Part {
  return { table, from, tally: emptyTally(size), focusWins: 0, copies: emptyMoments(), others: emptyMoments(), offers: 0, accepted: 0, buy: emptyMoments(), sell: emptyMoments(), completes: 0, deals: 0, games: 0 };
}

const offerKey = (offer: TradeOffer) => JSON.stringify([offer.from, offer.to, offer.give, offer.receive]);

function play(table: TableName, seed: number, game: number, part: Part): void {
  const names = seatsOf(table, game);
  const ids = names.map((_, i) => `p${i + 1}`);
  const agents = new Map<PlayerId, SeatAgent>(ids.map((id, i) => [id, memberAgent(names[i])]));
  const isAgent = (id: PlayerId) => names[ids.indexOf(id)] === agent;
  const holder = { rng: seedFrom(`trade-report-${size}-${seed}`) };
  const random = () => nextFloat(holder);
  const watch = createPoliticsWatch(ctx, ids, v1(size));
  const windows = createDebtWindows();
  const proposed = new Map<string, { gains: [number, number]; completesOther: boolean }>();
  let state = engine.newGame({ players: ids, seed });
  for (let actions = 0; state.winner === null && actions < ACTION_LIMIT; actions++) {
    const waiting = engine.awaiting(state);
    const early = debtWindow(engine, state, (id) => agents.get(id), random, windows);
    const actor = early ? early.actor : waiting[Math.floor(random() * waiting.length)];
    const action = early ? early.action : agents.get(actor)?.choose(engine, state, actor, random);
    if (!action) throw new Error(`${names.join(',')}, seed ${seed}: ${actor} has no action.`);
    const result = engine.apply(state, action);
    if (!result.ok) throw new Error(`${names.join(',')}, seed ${seed}: ${JSON.stringify(action)} was refused: ${result.error.message}`);
    const measured = table === 'copies' || table === 'others';
    for (const event of result.events) {
      if (!measured) break;
      if (event.type === 'TRADE_PROPOSED') {
        // The deal as the valuation reads it in the position it was made in.
        const sheet = dealSheet(ctx, state, event.offer, v1(size));
        const from = ids.indexOf(event.offer.from);
        const to = ids.indexOf(event.offer.to);
        const other = isAgent(event.offer.from) ? event.offer.to : event.offer.from;
        proposed.set(offerKey(event.offer), { gains: [sheet.delta[from], sheet.delta[to]], completesOther: completion(ctx, state, event.offer, other) !== null });
        if (isAgent(event.offer.from)) part.offers += 1;
      }
      if (event.type === 'TRADE_ACCEPTED') {
        const seen = proposed.get(offerKey(event.offer));
        if (!seen) continue;
        const between = isAgent(event.offer.from) && isAgent(event.offer.to);
        const withOther = isAgent(event.offer.from) !== isAgent(event.offer.to);
        if (between) addMoment(part.copies, oneSided(...seen.gains));
        if (withOther) addMoment(part.others, oneSided(...seen.gains));
        if (isAgent(event.offer.from)) part.accepted += 1;
        if (isAgent(event.offer.from) || isAgent(event.offer.to)) {
          part.deals += 1;
          if (seen.completesOther && !between) part.completes += 1;
          // The price over list of a property bought or sold for cash alone.
          const { give, receive } = event.offer;
          const one = (props: string[]) => (props.length === 1 ? ctx.properties.get(props[0])?.price ?? 0 : 0);
          for (const seat of [event.offer.from, event.offer.to].filter(isAgent)) {
            const gets = seat === event.offer.from ? receive : give;
            const pays = seat === event.offer.from ? give : receive;
            if (gets.properties.length === 1 && pays.properties.length === 0 && pays.cash > 0) addMoment(part.buy, pays.cash / one(gets.properties));
            if (pays.properties.length === 1 && gets.properties.length === 0 && gets.cash > 0) addMoment(part.sell, gets.cash / one(pays.properties));
          }
        }
      }
    }
    watch.note(state, result.events, result.state);
    state = result.state;
    for (const a of agents.values()) a.observe(result.events, state);
  }
  const seen = watch.finish(state);
  const t = part.tally;
  t.games += 1;
  part.games += 1;
  if (state.winner !== null) {
    t.finished += 1;
    t.turns += state.turn.number;
    t.wins[ids.indexOf(state.winner)] += 1;
    if ((table === 'learned' || table === 'ruled') && state.winner === ids[0]) part.focusWins += 1;
  }
  ids.forEach((id, i) => addPolitics(t.seats[i], seen.seats[id]));
  addPolitics(t.table, seen.table);
}

if (process.argv.includes(WORKER)) {
  process.on('message', (job: { table: TableName; from: number; count: number; start: number }) => {
    const part = emptyPart(job.table, job.from);
    for (let g = job.from; g < job.from + job.count; g++) play(job.table, job.start + g, g, part);
    process.send?.(part);
  });
} else {
  if (!model) throw new Error('Give --model <export.ts>.');
  for (const name of [agent, ruled, ...members]) memberAgent(name); // refuses an unknown name before any work
  const games = Number(option('--games') ?? 5000);
  const start = Number(option('--seeds') ?? 2_600_000);
  const workers = Number(option('--workers') ?? Math.max(1, availableParallelism() - 2));
  const tables: TableName[] = size === 2 ? ['copies', 'others', 'learned', 'ruled'] : ['copies', 'learned', 'ruled', 'alone'];
  const chunk = Math.max(10, Math.ceil(games / (workers * 4)));
  const jobs = tables.flatMap((table) => Array.from({ length: Math.ceil(games / chunk) }, (_, k) => ({ table, from: k * chunk, count: Math.min(chunk, games - k * chunk), start })));
  const began = performance.now();
  const parts = await new Promise<Part[]>((resolve, reject) => {
    const got: Part[] = [];
    let next = 0;
    for (let w = 0; w < Math.min(workers, jobs.length); w++) {
      const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), WORKER]);
      const give = () => (next < jobs.length ? child.send(jobs[next++]) : child.disconnect());
      child.on('message', (part: Part) => {
        got.push(part);
        if (got.length % 20 === 0 || got.length === jobs.length) process.stderr.write(`${got.length} of ${jobs.length} jobs, ${((performance.now() - began) / 1000).toFixed(0)} s\n`);
        if (got.length === jobs.length) resolve(got);
        give();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code) reject(new Error(`A worker stopped with code ${code}.`));
      });
      give();
    }
  });

  const merged = new Map<TableName, Part>();
  for (const part of parts) {
    const into = merged.get(part.table) ?? emptyPart(part.table, 0);
    addTally(into.tally, part.tally);
    into.focusWins += part.focusWins;
    addMoments(into.copies, part.copies);
    addMoments(into.others, part.others);
    addMoments(into.buy, part.buy);
    addMoments(into.sell, part.sell);
    for (const key of ['offers', 'accepted', 'completes', 'deals', 'games'] as const) into[key] += part[key];
    merged.set(part.table, into);
  }
  const get = (table: TableName) => merged.get(table) ?? emptyPart(table, 0);
  const copies = get('copies');
  const others = get('others');
  const deals = { copies: addMoments(emptyMoments(), copies.copies), others: addMoments(addMoments(emptyMoments(), copies.others), others.others) };
  const alone = size === 2 ? copies : get('alone');

  const bars: Bar[] = [];
  const lines: string[] = [];
  let suiteLine = '';
  const suiteFile = option('--suite');
  if (suiteFile) {
    const suite = JSON.parse(readFileSync(suiteFile, 'utf8')) as Suite;
    const score = scoreSuite(engine, ctx, suite, () => memberAgent(agent));
    bars.push(suiteBar(score));
    suiteLine = describeScore(model ?? '', score);
  }
  bars.push(copiesBar(deals.copies, deals.others));
  bars.push(...ruledBars({ wins: get('learned').focusWins, finished: get('learned').tally.finished }, { wins: get('ruled').focusWins, finished: get('ruled').tally.finished }, size));
  bars.push(finishBar(alone.tally.finished, alone.tally.games));

  const measuredGames = copies.games + others.games;
  const fmt = (m: Moments, digits = 2) => (m.n ? `${meanOf(m).mean.toFixed(digits)} over ${m.n}` : 'none');
  lines.push(`# Trade report: ${model}, ${rules} game, ${size} players`, '');
  lines.push(`The agent ${agent}; the ruled copy trades by ${school}; members ${members.join(', ')}. ${games} games a table on seeds ${start} to ${start + games - 1}; ${((performance.now() - began) / 1000).toFixed(0)} s on ${workers} processes.`, '');
  lines.push('| Bar | Met | Reading |', '| --- | --- | --- |', ...bars.map((b) => `| ${b.name} | ${b.passed ? 'yes' : 'no'} | ${b.reading} |`), '');
  if (suiteLine) lines.push(suiteLine, '');
  lines.push('## How it trades', '', `At the copies${size === 2 ? ' and others' : ''} tables (${measuredGames} games), for the agent's seats:`, '');
  lines.push('| Measure | Value |', '| --- | --- |');
  lines.push(`| Offers made, a game | ${measuredGames ? ((copies.offers + others.offers) / measuredGames).toFixed(2) : 'n/a'} |`);
  lines.push(`| Of those, accepted | ${copies.offers + others.offers ? `${(((copies.accepted + others.accepted) / (copies.offers + others.offers)) * 100).toFixed(1)}%` : 'n/a'} |`);
  lines.push(`| Price over list of a property bought for cash | ${fmt(addMoments(addMoments(emptyMoments(), copies.buy), others.buy))} |`);
  lines.push(`| Price over list of a property sold for cash | ${fmt(addMoments(addMoments(emptyMoments(), copies.sell), others.sell))} |`);
  lines.push(`| Deals with another seat that completed that seat's group | ${copies.completes + others.completes} of ${copies.deals + others.deals} |`);
  lines.push(`| One-sidedness of deals between copies, points | ${fmt(deals.copies)} |`);
  lines.push(`| One-sidedness of deals with others, points | ${fmt(deals.others)} |`, '');
  const labels = seatsOf('copies', 0).map((name, i) => (name === agent ? 'agent' : size > 2 ? `members in turn (seat ${i + 1})` : name));
  lines.push(...report(labels, labels, copies.tally, [start, start + games - 1]).map((line) => (line.startsWith('#') ? `#${line}` : line)));
  console.log(lines.join('\n'));
  const json = option('--json');
  if (json) writeFileSync(json, JSON.stringify({ model, size, rules, school, members, games, seeds: [start, start + games - 1], bars, suite: suiteLine }, null, 2));
}
